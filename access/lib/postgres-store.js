import postgres from 'postgres';
import { SESSION_IDLE_MS } from './constants.js';

class TransactionConflict extends Error {}

const ms = (value) => value instanceof Date ? value.getTime() : Number(value);
const date = (value) => new Date(value);

function holder(row) {
  return row && { id: row.id, publicId: row.public_id, webauthnUserId: row.webauthn_user_id, condition: row.condition, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) };
}

function credential(row) {
  return row && {
    id: row.id,
    managementRef: row.management_ref,
    holderId: row.holder_id,
    credentialId: row.credential_id,
    publicKey: Buffer.from(row.public_key),
    counter: Number(row.signature_counter),
    transports: row.transports || [],
    label: row.label,
    kind: row.kind,
    deviceType: row.device_type,
    backedUp: row.backed_up,
    issuedAt: ms(row.issued_at),
    lastUsedAt: row.last_used_at ? ms(row.last_used_at) : null,
    revokedAt: row.revoked_at ? ms(row.revoked_at) : null,
    counterAnomalyAt: row.counter_anomaly_at ? ms(row.counter_anomaly_at) : null,
  };
}

function session(row) {
  return row && {
    id: row.id,
    tokenHash: row.token_hash,
    csrfHash: row.csrf_hash,
    holderId: row.holder_id,
    credentialId: row.credential_id,
    issuedAt: ms(row.issued_at),
    lastActiveAt: ms(row.last_active_at),
    renewAfter: ms(row.renew_after),
    idleExpiresAt: ms(row.idle_expires_at),
    absoluteExpiresAt: ms(row.absolute_expires_at),
    lastVerifiedAt: ms(row.last_verified_at),
    revokedAt: row.revoked_at ? ms(row.revoked_at) : null,
  };
}

async function lockHolder(sql, holderId, requiredCondition) {
  const [row] = await sql`SELECT * FROM access_holders WHERE id = ${holderId} FOR UPDATE`;
  if (!row || (requiredCondition && row.condition !== requiredCondition)) return null;
  return holder(row);
}

async function lockLiveSession(sql, { tokenHash, holderId, recent = false }) {
  const rows = recent
    ? await sql`
        SELECT id FROM access_sessions
        WHERE token_hash = ${tokenHash} AND holder_id = ${holderId} AND revoked_at IS NULL
          AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp()
          AND last_verified_at >= clock_timestamp() - INTERVAL '5 minutes'
        FOR UPDATE
      `
    : await sql`
        SELECT id FROM access_sessions
        WHERE token_hash = ${tokenHash} AND holder_id = ${holderId} AND revoked_at IS NULL
          AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp()
        FOR UPDATE
      `;
  return rows.length === 1;
}

async function insertCredential(sql, item) {
  return sql`
    INSERT INTO access_credentials (
      id, management_ref, holder_id, credential_id, public_key, signature_counter,
      transports, label, kind, device_type, backed_up, issued_at, last_used_at,
      revoked_at, counter_anomaly_at
    ) VALUES (
      ${item.id}, ${item.managementRef}, ${item.holderId}, ${item.credentialId}, ${item.publicKey},
      ${item.counter}, ${item.transports}, ${item.label}, ${item.kind}, ${item.deviceType},
      ${item.backedUp}, ${date(item.issuedAt)}, ${item.lastUsedAt ? date(item.lastUsedAt) : null},
      ${item.revokedAt ? date(item.revokedAt) : null}, ${item.counterAnomalyAt ? date(item.counterAnomalyAt) : null}
    ) ON CONFLICT (credential_id) DO NOTHING
    RETURNING credential_id
  `;
}

async function insertSession(sql, item) {
  return sql`
    INSERT INTO access_sessions (
      id, token_hash, csrf_hash, holder_id, credential_id, issued_at, last_active_at,
      renew_after, idle_expires_at, absolute_expires_at, last_verified_at, revoked_at
    ) VALUES (
      ${item.id}, ${item.tokenHash}, ${item.csrfHash}, ${item.holderId}, ${item.credentialId},
      ${date(item.issuedAt)}, ${date(item.lastActiveAt)}, ${date(item.renewAfter)},
      ${date(item.idleExpiresAt)}, ${date(item.absoluteExpiresAt)}, ${date(item.lastVerifiedAt)}, null
    )
  `;
}

async function insertRecovery(sql, set, codes) {
  await sql`INSERT INTO access_recovery_sets (id, holder_id, issued_at, replaced_at) VALUES (${set.id}, ${set.holderId}, ${date(set.issuedAt)}, null)`;
  for (const code of codes) {
    await sql`INSERT INTO access_recovery_codes (set_id, holder_id, code_hash, used_at) VALUES (${code.setId}, ${code.holderId}, ${code.codeHash}, null)`;
  }
}

async function insertAudit(sql, event) {
  await sql`INSERT INTO access_audit_events (id, holder_id, event_type, outcome, credential_ref, network_hash, occurred_at) VALUES (${event.id}, ${event.holderId || null}, ${event.type}, ${event.outcome}, ${event.credentialRef || null}, ${event.networkHash || null}, ${date(event.occurredAt)})`;
}

async function updateCredential(sql, credentialId, expectedCounter, item) {
  return sql`
    UPDATE access_credentials SET signature_counter = ${item.counter}, device_type = ${item.deviceType},
      backed_up = ${item.backedUp}, last_used_at = ${date(item.lastUsedAt)},
      counter_anomaly_at = CASE WHEN ${item.anomaly} THEN ${date(item.lastUsedAt)} ELSE counter_anomaly_at END
    WHERE credential_id = ${credentialId} AND signature_counter = ${expectedCounter} AND revoked_at IS NULL RETURNING id
  `;
}

export class PostgresStore {
  constructor(url) {
    this.sql = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, prepare: true });
  }

  async close() { await this.sql.end(); }

  async seedHolder(item, grant) {
    await this.sql.begin(async (sql) => {
      await sql`INSERT INTO access_holders (id, public_id, webauthn_user_id, condition, created_at, updated_at) VALUES (${item.id}, ${item.publicId}, ${item.webauthnUserId}, ${item.condition}, ${date(item.createdAt)}, ${date(item.updatedAt)})`;
      await sql`INSERT INTO access_enrollment_grants (id, holder_id, token_hash, created_at, expires_at, consumed_at) VALUES (${grant.id}, ${grant.holderId}, ${grant.tokenHash}, ${date(grant.createdAt)}, ${date(grant.expiresAt)}, null)`;
    });
  }

  // Operator path for establishment. Intent is explicit so one person's link can
  // never be replaced by mistake: `new` only creates a pending holder under an
  // unused public identifier; `reissue` only replaces the grant of an existing
  // pending holder, expiring every earlier unconsumed grant. Active and suspended
  // holders are refused: a grant is never a way into an established record.
  async issueEnrollmentGrant({ mode, holder: item, grant, now }) {
    if (mode !== 'new' && mode !== 'reissue') throw new Error('issueEnrollmentGrant requires mode new or reissue');
    return this.sql.begin(async (sql) => {
      const [existing] = await sql`SELECT * FROM access_holders WHERE public_id = ${item.publicId} FOR UPDATE`;
      let holderId = item.id;
      let created = false;
      if (mode === 'new') {
        if (existing) return { issued: false, reason: 'exists', condition: existing.condition };
        try {
          await sql.savepoint((inner) => inner`INSERT INTO access_holders (id, public_id, webauthn_user_id, condition, created_at, updated_at) VALUES (${item.id}, ${item.publicId}, ${item.webauthnUserId}, 'pending', ${date(now)}, ${date(now)})`);
        } catch (error) {
          // A concurrent `new` for the same identifier committed first.
          if (error?.code === '23505') return { issued: false, reason: 'exists' };
          throw error;
        }
        created = true;
      } else if (!existing) {
        return { issued: false, reason: 'unknown' };
      } else if (existing.condition !== 'pending') {
        return { issued: false, reason: 'not-pending', condition: existing.condition };
      } else {
        holderId = existing.id;
        await sql`UPDATE access_enrollment_grants SET expires_at = LEAST(expires_at, ${date(now)}) WHERE holder_id = ${holderId} AND consumed_at IS NULL`;
      }
      await sql`INSERT INTO access_enrollment_grants (id, holder_id, token_hash, created_at, expires_at, consumed_at, operator_note) VALUES (${grant.id}, ${holderId}, ${grant.tokenHash}, ${date(now)}, ${date(grant.expiresAt)}, null, ${grant.operatorNote || null})`;
      await insertAudit(sql, { id: grant.auditId, holderId, type: 'enrollment-grant-issued', outcome: 'operator', occurredAt: now });
      return { issued: true, created, holderId };
    });
  }

  // Suspension is an incident-containment state. The migration 002 trigger
  // invalidates ordinary and recovery sessions in this same transaction.
  // Reactivation restores `active` only when an active credential remains;
  // otherwise the holder returns to `pending` and needs a new enrollment grant.
  async setHolderCondition({ publicId, action, now, auditId }) {
    return this.sql.begin(async (sql) => {
      const [existing] = await sql`SELECT * FROM access_holders WHERE public_id = ${publicId} FOR UPDATE`;
      if (!existing) return { changed: false, reason: 'unknown-holder' };
      let next;
      if (action === 'suspend') {
        if (existing.condition === 'suspended') return { changed: false, reason: 'already-suspended', condition: existing.condition };
        next = 'suspended';
      } else if (action === 'reactivate') {
        if (existing.condition !== 'suspended') return { changed: false, reason: 'not-suspended', condition: existing.condition };
        const [{ count }] = await sql`SELECT count(*)::int AS count FROM access_credentials WHERE holder_id = ${existing.id} AND revoked_at IS NULL`;
        next = count > 0 ? 'active' : 'pending';
      } else {
        throw new Error('Unknown holder condition action');
      }
      await sql`UPDATE access_holders SET condition = ${next}, updated_at = ${date(now)} WHERE id = ${existing.id}`;
      await insertAudit(sql, { id: auditId, holderId: existing.id, type: action === 'suspend' ? 'holder-suspended' : 'holder-reactivated', outcome: 'operator', occurredAt: now });
      return { changed: true, condition: next };
    });
  }

  // Bounded retention for authority that can no longer be used. Audit events,
  // holders, credentials, grants, and recovery codes are never pruned here.
  async pruneExpired({ now, retentionMs }) {
    const cutoff = date(now - retentionMs);
    return this.sql.begin(async (sql) => {
      const ceremonies = await sql`DELETE FROM access_ceremonies WHERE expires_at < ${cutoff}`;
      const rateLimits = await sql`DELETE FROM access_rate_limits WHERE window_started_at < ${cutoff} AND blocked_until < ${cutoff}`;
      const sessions = await sql`DELETE FROM access_sessions WHERE COALESCE(revoked_at, LEAST(idle_expires_at, absolute_expires_at)) < ${cutoff}`;
      const recoverySessions = await sql`DELETE FROM access_recovery_sessions WHERE expires_at < ${cutoff}`;
      return { ceremonies: ceremonies.count, rateLimits: rateLimits.count, sessions: sessions.count, recoverySessions: recoverySessions.count };
    });
  }

  async findGrant(tokenHash, now) {
    const [row] = await this.sql`SELECT * FROM access_enrollment_grants WHERE token_hash = ${tokenHash} AND consumed_at IS NULL AND expires_at > ${date(now)} LIMIT 1`;
    return row && { id: row.id, holderId: row.holder_id, tokenHash: row.token_hash, createdAt: ms(row.created_at), expiresAt: ms(row.expires_at), consumedAt: null };
  }

  async findHolder(id) {
    const [row] = await this.sql`SELECT * FROM access_holders WHERE id = ${id}`;
    return holder(row);
  }

  async createCeremony(item) {
    await this.sql`INSERT INTO access_ceremonies (id, purpose, binding_hash, holder_id, reference_id, challenge, created_at, expires_at, consumed_at) VALUES (${item.id}, ${item.purpose}, ${item.bindingHash}, ${item.holderId}, ${item.referenceId}, ${item.challenge}, ${date(item.createdAt)}, ${date(item.expiresAt)}, null)`;
  }

  async consumeCeremony({ id, bindingHash, purpose, now }) {
    const [row] = await this.sql`
      UPDATE access_ceremonies SET consumed_at = ${date(now)}
      WHERE id = ${id} AND binding_hash = ${bindingHash} AND purpose = ${purpose}
        AND consumed_at IS NULL AND expires_at > ${date(now)}
      RETURNING *
    `;
    return row && { id: row.id, purpose: row.purpose, bindingHash: row.binding_hash, holderId: row.holder_id, referenceId: row.reference_id, challenge: row.challenge, expiresAt: ms(row.expires_at), consumedAt: ms(row.consumed_at) };
  }

  async findCredential(credentialId) {
    const [row] = await this.sql`SELECT * FROM access_credentials WHERE credential_id = ${credentialId}`;
    return credential(row);
  }

  async listCredentials(holderId, activeOnly = true) {
    const rows = activeOnly
      ? await this.sql`SELECT * FROM access_credentials WHERE holder_id = ${holderId} AND revoked_at IS NULL ORDER BY issued_at`
      : await this.sql`SELECT * FROM access_credentials WHERE holder_id = ${holderId} ORDER BY issued_at`;
    return rows.map(credential);
  }

  async completeFirstRegistration({ grantId, holderId, credential: item, session: sessionItem, recoverySet, codeRecords, audits, now }) {
    try {
      return await this.sql.begin(async (sql) => {
        if (!(await lockHolder(sql, holderId, 'pending'))) throw new TransactionConflict();
        const grants = await sql`UPDATE access_enrollment_grants SET consumed_at = ${date(now)} WHERE id = ${grantId} AND holder_id = ${holderId} AND consumed_at IS NULL AND expires_at > ${date(now)} RETURNING id`;
        if (grants.length !== 1) throw new TransactionConflict();
        const inserted = await insertCredential(sql, item);
        if (inserted.length !== 1) throw new TransactionConflict();
        const holders = await sql`UPDATE access_holders SET condition = 'active', updated_at = ${date(now)} WHERE id = ${holderId} AND condition = 'pending' RETURNING id`;
        if (holders.length !== 1) throw new TransactionConflict();
        await insertSession(sql, sessionItem);
        await insertRecovery(sql, recoverySet, codeRecords);
        for (const event of audits) await insertAudit(sql, event);
        return true;
      });
    } catch (error) {
      if (error instanceof TransactionConflict) return false;
      throw error;
    }
  }

  async completeAuthentication({ holderId, credentialId, expectedCounter, credentialUpdate, session: sessionItem, audits }) {
    try {
      return await this.sql.begin(async (sql) => {
        if (!(await lockHolder(sql, holderId, 'active'))) throw new TransactionConflict();
        if ((await updateCredential(sql, credentialId, expectedCounter, credentialUpdate)).length !== 1) throw new TransactionConflict();
        await insertSession(sql, sessionItem);
        for (const event of audits) await insertAudit(sql, event);
        return true;
      });
    } catch (error) {
      if (error instanceof TransactionConflict) return false;
      throw error;
    }
  }

  async completePresence({ holderId, oldSessionHash, credentialId, expectedCounter, credentialUpdate, session: sessionItem, audits, now }) {
    try {
      return await this.sql.begin(async (sql) => {
        if (!(await lockHolder(sql, holderId, 'active'))) throw new TransactionConflict();
        const previous = await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE token_hash = ${oldSessionHash} AND holder_id = ${holderId} AND revoked_at IS NULL AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp() RETURNING id`;
        if (previous.length !== 1 || (await updateCredential(sql, credentialId, expectedCounter, credentialUpdate)).length !== 1) throw new TransactionConflict();
        await insertSession(sql, sessionItem);
        for (const event of audits) await insertAudit(sql, event);
        return true;
      });
    } catch (error) {
      if (error instanceof TransactionConflict) return false;
      throw error;
    }
  }

  async getSession(tokenHash, now) {
    const [row] = await this.sql`
      SELECT s.* FROM access_sessions s JOIN access_holders h ON h.id = s.holder_id
      WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND s.idle_expires_at > ${date(now)}
        AND s.absolute_expires_at > ${date(now)} AND h.condition = 'active'
    `;
    return session(row);
  }

  async touchSession(tokenHash, now) {
    const rows = await this.sql`
      UPDATE access_sessions s SET last_active_at = ${date(now)},
        idle_expires_at = LEAST(${date(now + SESSION_IDLE_MS)}, absolute_expires_at)
      FROM access_holders h
      WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND s.holder_id = h.id AND h.condition = 'active'
        AND s.idle_expires_at > CURRENT_TIMESTAMP AND s.absolute_expires_at > CURRENT_TIMESTAMP
      RETURNING s.id
    `;
    return rows.length === 1;
  }

  async rotateSession(oldHash, item, now) {
    return this.sql.begin(async (sql) => {
      if (!(await lockHolder(sql, item.holderId, 'active'))) return false;
      const rows = await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE token_hash = ${oldHash} AND holder_id = ${item.holderId} AND revoked_at IS NULL AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp() RETURNING id`;
      if (rows.length !== 1) return false;
      await insertSession(sql, item);
      return true;
    });
  }

  async completeLogout({ tokenHash, holderId, now, audit }) {
    return this.sql.begin(async (sql) => {
      if (!(await lockHolder(sql, holderId))) return false;
      const rows = await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE token_hash = ${tokenHash} AND holder_id = ${holderId} AND revoked_at IS NULL RETURNING id`;
      if (rows.length !== 1) return false;
      await insertAudit(sql, audit);
      return true;
    });
  }

  async revokeHolderSessions(holderId, now) {
    await this.sql.begin(async (sql) => {
      if (!(await lockHolder(sql, holderId))) return;
      await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE holder_id = ${holderId} AND revoked_at IS NULL`;
    });
  }

  async completeAddKey({ oldSessionHash, credential: item, session: sessionItem, audit, now }) {
    try {
      return await this.sql.begin(async (sql) => {
        if (!(await lockHolder(sql, item.holderId, 'active'))) throw new TransactionConflict();
        const previous = await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE token_hash = ${oldSessionHash} AND holder_id = ${item.holderId} AND revoked_at IS NULL AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp() AND last_verified_at >= clock_timestamp() - INTERVAL '5 minutes' RETURNING id`;
        if (previous.length !== 1 || (await insertCredential(sql, item)).length !== 1) throw new TransactionConflict();
        await insertSession(sql, sessionItem);
        await insertAudit(sql, audit);
        return true;
      });
    } catch (error) {
      if (error instanceof TransactionConflict) return false;
      throw error;
    }
  }

  async revokeCredentialAndSessions({ holderId, authorizingSessionHash, managementRef, now, audit }) {
    return this.sql.begin(async (sql) => {
      if (!(await lockHolder(sql, holderId, 'active'))) return false;
      if (!(await lockLiveSession(sql, { tokenHash: authorizingSessionHash, holderId, recent: true }))) return false;
      const active = await sql`SELECT id, management_ref FROM access_credentials WHERE holder_id = ${holderId} AND revoked_at IS NULL ORDER BY id FOR UPDATE`;
      const target = active.find((item) => item.management_ref === managementRef);
      if (!target) return false;
      if (active.length <= 1) return false;
      await sql`UPDATE access_credentials SET revoked_at = ${date(now)} WHERE id = ${target.id}`;
      await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE holder_id = ${holderId} AND revoked_at IS NULL`;
      await insertAudit(sql, audit);
      return true;
    });
  }

  async hasActiveRecoveryCodes(holderId) {
    const rows = await this.sql`SELECT 1 FROM access_recovery_sets s WHERE s.holder_id = ${holderId} AND s.replaced_at IS NULL AND EXISTS (SELECT 1 FROM access_recovery_codes c WHERE c.set_id = s.id AND c.used_at IS NULL) LIMIT 1`;
    return rows.length === 1;
  }

  async beginRecovery({ codeHash, session: sessionItem, audit, now }) {
    return this.sql.begin(async (sql) => {
      const [candidate] = await sql`
        SELECT c.holder_id, c.set_id
        FROM access_recovery_codes c JOIN access_recovery_sets s ON s.id = c.set_id
        WHERE c.code_hash = ${codeHash} AND c.used_at IS NULL AND s.replaced_at IS NULL
        LIMIT 1
      `;
      if (!candidate || !(await lockHolder(sql, candidate.holder_id, 'active'))) return null;
      const [row] = await sql`
        UPDATE access_recovery_codes c SET used_at = ${date(now)}
        FROM access_recovery_sets s
        WHERE c.code_hash = ${codeHash} AND c.set_id = ${candidate.set_id} AND c.used_at IS NULL
          AND s.id = c.set_id AND s.holder_id = ${candidate.holder_id} AND s.replaced_at IS NULL
        RETURNING c.holder_id, c.set_id
      `;
      if (!row) return null;
      await sql`INSERT INTO access_recovery_sessions (id, token_hash, csrf_hash, holder_id, set_id, issued_at, expires_at, consumed_at) VALUES (${sessionItem.id}, ${sessionItem.tokenHash}, ${sessionItem.csrfHash}, ${row.holder_id}, ${row.set_id}, ${date(sessionItem.issuedAt)}, ${date(sessionItem.expiresAt)}, null)`;
      await insertAudit(sql, { ...audit, holderId: row.holder_id });
      return { holderId: row.holder_id, setId: row.set_id };
    });
  }

  async getRecoverySession(tokenHash, now) {
    const [row] = await this.sql`
      SELECT rs.* FROM access_recovery_sessions rs
      JOIN access_holders h ON h.id = rs.holder_id
      JOIN access_recovery_sets s ON s.id = rs.set_id AND s.holder_id = rs.holder_id
      WHERE rs.token_hash = ${tokenHash} AND rs.consumed_at IS NULL AND rs.expires_at > ${date(now)}
        AND h.condition = 'active' AND s.replaced_at IS NULL
    `;
    return row && { id: row.id, tokenHash: row.token_hash, csrfHash: row.csrf_hash, holderId: row.holder_id, setId: row.set_id, issuedAt: ms(row.issued_at), expiresAt: ms(row.expires_at), consumedAt: null };
  }

  async completeRecovery({ recoveryTokenHash, holderId, credential: item, recoverySet, codeRecords, audits, now }) {
    try {
      return await this.sql.begin(async (sql) => {
        if (!(await lockHolder(sql, holderId, 'active'))) throw new TransactionConflict();
        const sessions = await sql`
          UPDATE access_recovery_sessions rs SET consumed_at = ${date(now)}
          WHERE rs.token_hash = ${recoveryTokenHash} AND rs.holder_id = ${holderId}
            AND rs.consumed_at IS NULL AND rs.expires_at > clock_timestamp()
            AND EXISTS (
              SELECT 1 FROM access_recovery_sets s
              WHERE s.id = rs.set_id AND s.holder_id = ${holderId} AND s.replaced_at IS NULL
            )
          RETURNING rs.id, rs.set_id
        `;
        if (sessions.length !== 1) throw new TransactionConflict();
        const inserted = await insertCredential(sql, item);
        if (inserted.length !== 1) throw new TransactionConflict();
        const replaced = await sql`UPDATE access_recovery_sets SET replaced_at = ${date(now)} WHERE id = ${sessions[0].set_id} AND holder_id = ${holderId} AND replaced_at IS NULL RETURNING id`;
        if (replaced.length !== 1) throw new TransactionConflict();
        await sql`UPDATE access_recovery_sessions SET consumed_at = ${date(now)} WHERE holder_id = ${holderId} AND consumed_at IS NULL`;
        await insertRecovery(sql, recoverySet, codeRecords);
        await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE holder_id = ${holderId} AND revoked_at IS NULL`;
        for (const event of audits) await insertAudit(sql, event);
        return true;
      });
    } catch (error) {
      if (error instanceof TransactionConflict) return false;
      throw error;
    }
  }

  async replaceRecoverySetAndRotate({ holderId, recoverySet, codeRecords, oldSessionHash, session: sessionItem, audit, now }) {
    try {
      return await this.sql.begin(async (sql) => {
        if (!(await lockHolder(sql, holderId, 'active'))) throw new TransactionConflict();
        const previous = await sql`UPDATE access_sessions SET revoked_at = ${date(now)} WHERE token_hash = ${oldSessionHash} AND holder_id = ${holderId} AND revoked_at IS NULL AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp() AND last_verified_at >= clock_timestamp() - INTERVAL '5 minutes' RETURNING id`;
        if (previous.length !== 1) throw new TransactionConflict();
        await sql`UPDATE access_recovery_sets SET replaced_at = ${date(now)} WHERE holder_id = ${holderId} AND replaced_at IS NULL`;
        await sql`UPDATE access_recovery_sessions SET consumed_at = ${date(now)} WHERE holder_id = ${holderId} AND consumed_at IS NULL`;
        await insertRecovery(sql, recoverySet, codeRecords);
        await insertSession(sql, sessionItem);
        await insertAudit(sql, audit);
        return true;
      });
    } catch (error) {
      if (error instanceof TransactionConflict) return false;
      throw error;
    }
  }

  async checkRateLimit({ key, limit, windowMs, blockMs, now }) {
    return this.sql.begin(async (sql) => {
      await sql`INSERT INTO access_rate_limits (bucket_key, count, window_started_at, blocked_until) VALUES (${key}, 0, ${date(now)}, ${date(0)}) ON CONFLICT (bucket_key) DO NOTHING`;
      const [bucket] = await sql`SELECT * FROM access_rate_limits WHERE bucket_key = ${key} FOR UPDATE`;
      if (ms(bucket.blocked_until) > now) return { allowed: false, retryAfter: Math.ceil((ms(bucket.blocked_until) - now) / 1000) };
      let count = bucket.count;
      let started = ms(bucket.window_started_at);
      if (started + windowMs <= now) { count = 0; started = now; }
      count += 1;
      const blockedUntil = count > limit ? now + blockMs : 0;
      await sql`UPDATE access_rate_limits SET count = ${count}, window_started_at = ${date(started)}, blocked_until = ${date(blockedUntil)} WHERE bucket_key = ${key}`;
      return blockedUntil ? { allowed: false, retryAfter: Math.ceil(blockMs / 1000) } : { allowed: true, retryAfter: 0 };
    });
  }

}
