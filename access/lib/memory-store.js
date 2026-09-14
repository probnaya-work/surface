function applyCredentialUpdate(credential, update) {
  credential.counter = update.counter;
  credential.deviceType = update.deviceType;
  credential.backedUp = update.backedUp;
  credential.lastUsedAt = update.lastUsedAt;
  if (update.anomaly) credential.counterAnomalyAt = update.lastUsedAt;
}

export class MemoryStore {
  constructor() {
    this.holders = new Map();
    this.credentials = new Map();
    this.credentialsByRef = new Map();
    this.ceremonies = new Map();
    this.sessions = new Map();
    this.recoverySessions = new Map();
    this.grants = new Map();
    this.recoveryCodes = new Map();
    this.activeRecoverySets = new Map();
    this.rateLimits = new Map();
    this.auditEvents = [];
  }

  async seedHolder(holder, grant) {
    this.holders.set(holder.id, structuredClone(holder));
    this.grants.set(grant.tokenHash, structuredClone(grant));
  }

  async findGrant(tokenHash, now) {
    const grant = this.grants.get(tokenHash);
    if (!grant || grant.consumedAt || grant.expiresAt <= now) return null;
    return structuredClone(grant);
  }

  async findHolder(id) {
    const value = this.holders.get(id);
    return value ? structuredClone(value) : null;
  }

  async createCeremony(ceremony) {
    this.ceremonies.set(ceremony.id, structuredClone(ceremony));
  }

  async consumeCeremony({ id, bindingHash, purpose, now }) {
    const ceremony = this.ceremonies.get(id);
    if (!ceremony || ceremony.consumedAt || ceremony.expiresAt <= now || ceremony.bindingHash !== bindingHash || ceremony.purpose !== purpose) return null;
    ceremony.consumedAt = now;
    return structuredClone(ceremony);
  }

  async findCredential(credentialId) {
    const value = this.credentials.get(credentialId);
    return value ? structuredClone(value) : null;
  }

  async listCredentials(holderId, activeOnly = true) {
    return [...this.credentials.values()]
      .filter((item) => item.holderId === holderId && (!activeOnly || !item.revokedAt))
      .sort((a, b) => a.issuedAt - b.issuedAt)
      .map((item) => structuredClone(item));
  }

  async completeFirstRegistration({ grantId, holderId, credential, session, recoverySet, codeRecords, audits, now }) {
    const holder = this.holders.get(holderId);
    const grant = [...this.grants.values()].find((item) => item.id === grantId);
    if (!holder || !grant || grant.consumedAt || grant.expiresAt <= now || this.credentials.has(credential.credentialId)) return false;
    grant.consumedAt = now;
    holder.condition = 'active';
    holder.updatedAt = now;
    this.credentials.set(credential.credentialId, structuredClone(credential));
    this.credentialsByRef.set(credential.managementRef, credential.credentialId);
    this.sessions.set(session.tokenHash, structuredClone(session));
    this.activeRecoverySets.set(holderId, structuredClone(recoverySet));
    for (const code of codeRecords) this.recoveryCodes.set(code.codeHash, structuredClone(code));
    for (const event of audits) this.auditEvents.push(structuredClone(event));
    return true;
  }

  async completeAuthentication({ holderId, credentialId, expectedCounter, credentialUpdate, session, audits }) {
    const credential = this.credentials.get(credentialId);
    const holder = this.holders.get(holderId);
    if (!holder || holder.condition !== 'active' || !credential || credential.holderId !== holderId || credential.revokedAt || credential.counter !== expectedCounter || this.sessions.has(session.tokenHash)) return false;
    applyCredentialUpdate(credential, credentialUpdate);
    this.sessions.set(session.tokenHash, structuredClone(session));
    for (const event of audits) this.auditEvents.push(structuredClone(event));
    return true;
  }

  async completePresence({ holderId, oldSessionHash, credentialId, expectedCounter, credentialUpdate, session, audits, now }) {
    const previous = this.sessions.get(oldSessionHash);
    const credential = this.credentials.get(credentialId);
    const holder = this.holders.get(holderId);
    if (!holder || holder.condition !== 'active' || !previous || previous.holderId !== holderId || previous.revokedAt || previous.idleExpiresAt <= now || previous.absoluteExpiresAt <= now || !credential || credential.holderId !== holderId || credential.revokedAt || credential.counter !== expectedCounter || this.sessions.has(session.tokenHash)) return false;
    previous.revokedAt = now;
    applyCredentialUpdate(credential, credentialUpdate);
    this.sessions.set(session.tokenHash, structuredClone(session));
    for (const event of audits) this.auditEvents.push(structuredClone(event));
    return true;
  }

  async getSession(tokenHash, now) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
    const holder = this.holders.get(session.holderId);
    if (!holder || holder.condition !== 'active') return null;
    return structuredClone(session);
  }

  async setSessionCsrf(tokenHash, csrfHash, now) {
    const session = this.sessions.get(tokenHash);
    const holder = session && this.holders.get(session.holderId);
    if (!holder || holder.condition !== 'active' || !session || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return false;
    session.csrfHash = csrfHash;
    session.lastActiveAt = now;
    session.idleExpiresAt = Math.min(now + 30 * 60 * 1000, session.absoluteExpiresAt);
    return true;
  }

  async rotateSession(oldHash, session, now) {
    const previous = this.sessions.get(oldHash);
    const holder = this.holders.get(session.holderId);
    if (!holder || holder.condition !== 'active' || !previous || previous.holderId !== session.holderId || previous.revokedAt || previous.idleExpiresAt <= now || previous.absoluteExpiresAt <= now) return false;
    previous.revokedAt = now;
    this.sessions.set(session.tokenHash, structuredClone(session));
    return true;
  }

  async completeLogout({ tokenHash, holderId, now, audit }) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.holderId !== holderId || session.revokedAt) return false;
    session.revokedAt = now;
    this.auditEvents.push(structuredClone(audit));
    return true;
  }

  async revokeHolderSessions(holderId, now) {
    for (const session of this.sessions.values()) {
      if (session.holderId === holderId && !session.revokedAt) session.revokedAt = now;
    }
  }

  async completeAddKey({ oldSessionHash, credential, session, audit, now }) {
    const previous = this.sessions.get(oldSessionHash);
    const holder = this.holders.get(credential.holderId);
    if (!holder || holder.condition !== 'active' || !previous || previous.holderId !== credential.holderId || previous.revokedAt || previous.idleExpiresAt <= now || previous.absoluteExpiresAt <= now || now - previous.lastVerifiedAt > 5 * 60_000 || this.credentials.has(credential.credentialId) || this.sessions.has(session.tokenHash)) return false;
    previous.revokedAt = now;
    this.credentials.set(credential.credentialId, structuredClone(credential));
    this.credentialsByRef.set(credential.managementRef, credential.credentialId);
    this.sessions.set(session.tokenHash, structuredClone(session));
    this.auditEvents.push(structuredClone(audit));
    return true;
  }

  async revokeCredentialAndSessions({ holderId, authorizingSessionHash, managementRef, now, audit }) {
    const holder = this.holders.get(holderId);
    const authorization = this.sessions.get(authorizingSessionHash);
    if (!holder || holder.condition !== 'active' || !authorization || authorization.holderId !== holderId || authorization.revokedAt || authorization.idleExpiresAt <= now || authorization.absoluteExpiresAt <= now || now - authorization.lastVerifiedAt > 5 * 60_000) return false;
    const credentialId = this.credentialsByRef.get(managementRef);
    const credential = this.credentials.get(credentialId);
    if (!credential || credential.holderId !== holderId || credential.revokedAt) return false;
    const active = await this.listCredentials(holderId);
    if (active.length <= 1) return false;
    credential.revokedAt = now;
    await this.revokeHolderSessions(holderId, now);
    this.auditEvents.push(structuredClone(audit));
    return true;
  }

  async hasActiveRecoveryCodes(holderId) {
    const set = this.activeRecoverySets.get(holderId);
    return Boolean(set && [...this.recoveryCodes.values()].some((code) => code.setId === set.id && !code.usedAt));
  }

  async beginRecovery({ codeHash, session, audit, now }) {
    const record = this.recoveryCodes.get(codeHash);
    const set = record && this.activeRecoverySets.get(record.holderId);
    const holder = record && this.holders.get(record.holderId);
    if (!holder || holder.condition !== 'active' || !record || record.usedAt || !set || set.id !== record.setId || set.replacedAt || this.recoverySessions.has(session.tokenHash)) return null;
    record.usedAt = now;
    const completeSession = { ...session, holderId: record.holderId, setId: record.setId };
    this.recoverySessions.set(session.tokenHash, structuredClone(completeSession));
    this.auditEvents.push(structuredClone({ ...audit, holderId: record.holderId }));
    return { holderId: record.holderId, setId: record.setId };
  }

  async getRecoverySession(tokenHash, now) {
    const session = this.recoverySessions.get(tokenHash);
    const holder = session && this.holders.get(session.holderId);
    const set = session && this.activeRecoverySets.get(session.holderId);
    if (!holder || holder.condition !== 'active' || !set || set.id !== session.setId || set.replacedAt || !session || session.consumedAt || session.expiresAt <= now) return null;
    return structuredClone(session);
  }

  async completeRecovery({ recoveryTokenHash, holderId, credential, recoverySet, codeRecords, audits, now }) {
    const session = this.recoverySessions.get(recoveryTokenHash);
    const activeSet = this.activeRecoverySets.get(holderId);
    const holder = this.holders.get(holderId);
    if (!holder || holder.condition !== 'active' || !session || session.consumedAt || session.expiresAt <= now || session.holderId !== holderId || !activeSet || activeSet.id !== session.setId || activeSet.replacedAt || this.credentials.has(credential.credentialId)) return false;
    session.consumedAt = now;
    const oldSet = this.activeRecoverySets.get(holderId);
    if (oldSet) oldSet.replacedAt = now;
    this.credentials.set(credential.credentialId, structuredClone(credential));
    this.credentialsByRef.set(credential.managementRef, credential.credentialId);
    this.activeRecoverySets.set(holderId, structuredClone(recoverySet));
    for (const code of codeRecords) this.recoveryCodes.set(code.codeHash, structuredClone(code));
    await this.revokeHolderSessions(holderId, now);
    for (const event of audits) this.auditEvents.push(structuredClone(event));
    return true;
  }

  async replaceRecoverySetAndRotate({ holderId, recoverySet, codeRecords, oldSessionHash, session, audit, now }) {
    const previous = this.sessions.get(oldSessionHash);
    const holder = this.holders.get(holderId);
    if (!holder || holder.condition !== 'active' || !previous || previous.holderId !== holderId || previous.revokedAt || previous.idleExpiresAt <= now || previous.absoluteExpiresAt <= now || now - previous.lastVerifiedAt > 5 * 60_000 || this.sessions.has(session.tokenHash)) return false;
    previous.revokedAt = now;
    const oldSet = this.activeRecoverySets.get(holderId);
    if (oldSet) oldSet.replacedAt = now;
    for (const recoverySession of this.recoverySessions.values()) {
      if (recoverySession.holderId === holderId && !recoverySession.consumedAt) recoverySession.consumedAt = now;
    }
    this.activeRecoverySets.set(holderId, structuredClone(recoverySet));
    for (const code of codeRecords) this.recoveryCodes.set(code.codeHash, structuredClone(code));
    this.sessions.set(session.tokenHash, structuredClone(session));
    this.auditEvents.push(structuredClone(audit));
    return true;
  }

  async checkRateLimit({ key, limit, windowMs, blockMs, now }) {
    let bucket = this.rateLimits.get(key);
    if (!bucket || bucket.windowStartedAt + windowMs <= now) {
      bucket = { count: 0, windowStartedAt: now, blockedUntil: 0 };
      this.rateLimits.set(key, bucket);
    }
    if (bucket.blockedUntil > now) return { allowed: false, retryAfter: Math.ceil((bucket.blockedUntil - now) / 1000) };
    bucket.count += 1;
    if (bucket.count > limit) {
      bucket.blockedUntil = now + blockMs;
      return { allowed: false, retryAfter: Math.ceil(blockMs / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

}
