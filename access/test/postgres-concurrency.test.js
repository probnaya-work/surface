import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import postgres from 'postgres';
import { enrollmentGrantHash } from '../lib/crypto.js';
import { PostgresStore } from '../lib/postgres-store.js';
import { AccessService } from '../lib/service.js';
import { createWebAuthn } from '../lib/webauthn.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

const databaseURL = process.env.ACCESS_TEST_DATABASE_URL;

if (!databaseURL) {
  test('PostgreSQL concurrency regressions', { skip: 'Set ACCESS_TEST_DATABASE_URL to an isolated PostgreSQL database' }, () => {});
} else {
  const config = {
    origin: 'http://localhost:4174',
    rpID: 'localhost',
    sessionHashKey: 'postgres-session-key-'.padEnd(48, 's'),
    recoveryHashKey: 'postgres-recovery-key-'.padEnd(48, 'r'),
    networkHashKey: 'postgres-network-key-'.padEnd(48, 'n'),
  };
  const tables = [
    'access_audit_events',
    'access_rate_limits',
    'access_recovery_sessions',
    'access_recovery_codes',
    'access_recovery_sets',
    'access_enrollment_grants',
    'access_sessions',
    'access_ceremonies',
    'access_credentials',
    'access_holders',
  ];
  const schema = `access_test_${randomBytes(8).toString('hex')}`;
  const admin = postgres(databaseURL, { max: 1, idle_timeout: 5, onnotice: () => {} });
  const testURL = new URL(databaseURL);
  testURL.searchParams.set('search_path', schema);
  const stores = [];
  const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

  function deferred() {
    let resolvePromise;
    const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; });
    return { promise, resolve: resolvePromise };
  }

  function delay(ms) {
    return new Promise((resolveValue) => setTimeout(resolveValue, ms));
  }

  async function waitUntil(timestamp) {
    await delay(Math.max(0, timestamp - Date.now() + 50));
  }

  function makeStore() {
    const store = new PostgresStore(testURL.toString());
    stores.push(store);
    return store;
  }

  function makeService(fixture, store = makeStore()) {
    return { store, service: new AccessService({ config, store, webauthn: createWebAuthn(config), clock: () => fixture.now }) };
  }

  async function resetDatabase() {
    const store = stores[0] || makeStore();
    await store.sql.unsafe(`TRUNCATE ${tables.join(',')}`);
  }

  async function fixture() {
    await resetDatabase();
    const f = { now: Date.now() };
    Object.assign(f, makeService(f));
    f.holder = {
      id: randomUUID(),
      publicId: 'PROB–H–PGTEST',
      webauthnUserId: Buffer.alloc(32, 9).toString('base64url'),
      condition: 'pending',
      createdAt: f.now,
      updatedAt: f.now,
    };
    f.grant = `postgres-test-grant-${randomBytes(18).toString('base64url')}`;
    await f.store.seedHolder(f.holder, {
      id: randomUUID(),
      holderId: f.holder.id,
      tokenHash: enrollmentGrantHash(f.grant),
      createdAt: f.now,
      expiresAt: f.now + 86_400_000,
      consumedAt: null,
    });
    f.key = new VirtualAuthenticator();
    const start = await f.service.enrollmentOptions({ payload: { grant: f.grant, label: 'PRIMARY' }, network: '192.0.2.1' });
    f.auth = await f.service.enrollmentVerify({
      preauthToken: start.binding.token,
      payload: { ceremonyId: start.ceremonyId, label: 'PRIMARY', credential: await f.key.registration(start.options) },
      network: '192.0.2.1',
    });
    return f;
  }

  function peer(f) {
    return makeService(f);
  }

  async function holdHolder(holderId) {
    const store = makeStore();
    const acquired = deferred();
    const release = deferred();
    const transaction = store.sql.begin(async (sql) => {
      const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`;
      await sql`SELECT id FROM access_holders WHERE id = ${holderId} FOR UPDATE`;
      acquired.resolve(pid);
      await release.promise;
    });
    return { blockerPid: await acquired.promise, release: release.resolve, transaction };
  }

  async function waitForBlockedBy(blockerPid) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [{ blocked }] = await admin`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE ${blockerPid} = ANY (pg_blocking_pids(pid))
        ) AS blocked
      `;
      if (blocked) return;
      await delay(10);
    }
    throw new Error(`Expected a database lock wait behind backend ${blockerPid}`);
  }

  // Pauses a transaction immediately after the first matching statement and
  // resolves `hit` with that transaction's backend PID, so a test can prove a
  // competitor is waiting on this transaction's locks instead of sleeping.
  function pauseAfter(store, predicate) {
    const hit = deferred();
    const release = deferred();
    const original = store.sql;
    let used = false;
    store.sql = new Proxy(original, {
      get(target, key) {
        if (key !== 'begin') return Reflect.get(target, key);
        return (callback) => original.begin((transaction) => callback(async (parts, ...values) => {
          const result = await transaction(parts, ...values);
          if (!used && predicate(parts.join('?'))) {
            used = true;
            const [{ pid }] = await transaction`SELECT pg_backend_pid() AS pid`;
            hit.resolve(pid);
            await release.promise;
          }
          return result;
        }));
      },
    });
    return { hit: hit.promise, release: release.resolve };
  }

  async function prepareRecovery(f, code, service = f.service) {
    const authority = await service.recoveryBegin({ payload: { code }, network: '192.0.2.2' });
    const options = await service.recoveryRegistrationOptions({ recoveryToken: authority.token, csrf: authority.csrf, payload: { label: 'RECOVERED' } });
    const key = new VirtualAuthenticator();
    return {
      key,
      input: {
        recoveryToken: authority.token,
        csrf: authority.csrf,
        payload: { ceremonyId: options.ceremonyId, label: 'RECOVERED', credential: await key.registration(options.options) },
        network: '192.0.2.2',
      },
    };
  }

  async function addSecondCredential(f) {
    const key = new VirtualAuthenticator();
    const options = await f.service.addKeyOptions({ sessionToken: f.auth.token, csrf: f.auth.csrf, payload: { label: 'SECOND' } });
    const added = await f.service.addKeyVerify({
      sessionToken: f.auth.token,
      csrf: f.auth.csrf,
      payload: { ceremonyId: options.ceremonyId, label: 'SECOND', credential: await key.registration(options.options) },
      network: '192.0.2.3',
    });
    return { key, auth: added };
  }

  test.before(async () => {
    await admin`CREATE SCHEMA ${admin(schema)}`;
    const migrationFiles = (await readdir(migrationRoot)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    const migrationStore = makeStore();
    const connection = await migrationStore.sql.reserve();
    try {
      for (const name of migrationFiles) await connection.unsafe(await readFile(resolve(migrationRoot, name), 'utf8'));
    } finally {
      connection.release();
    }
  });

  test.after(async () => {
    await Promise.all(stores.map((store) => store.close()));
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    await admin.end();
  });

  test('migration 002 is idempotent and installs one suspension trigger', async () => {
    const store = makeStore();
    const migration = await readFile(resolve(migrationRoot, '002_holder_authority.sql'), 'utf8');
    const connection = await store.sql.reserve();
    try {
      await connection.unsafe(migration);
      await connection.unsafe(migration);
    } finally {
      connection.release();
    }
    const [{ count }] = await store.sql`
      SELECT count(*)::int AS count
      FROM pg_trigger
      WHERE tgrelid = 'access_holders'::regclass
        AND tgname = 'access_holders_freeze_authority'
        AND NOT tgisinternal
    `;
    assert.equal(count, 1);
  });

  test('IR-01: concurrent recovery completion has exactly one valid winner', async () => {
    const f = await fixture();
    const competing = peer(f);
    const attacker = await prepareRecovery(f, f.auth.recoveryCodes[0]);
    const legitimate = await prepareRecovery(f, f.auth.recoveryCodes[1], competing.service);
    const pause = pauseAfter(f.store, (query) => query.includes('UPDATE access_recovery_sessions'));
    const first = f.service.recoveryRegistrationVerify(attacker.input);
    let second;
    try {
      const firstPid = await pause.hit;
      second = competing.service.recoveryRegistrationVerify(legitimate.input);
      second.catch(() => {});
      await waitForBlockedBy(firstPid);
    } finally {
      pause.release();
    }
    const outcomes = await Promise.allSettled([first, second]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal((await f.store.listCredentials(f.holder.id)).length, 2);
    const winner = outcomes[0].status === 'fulfilled' ? attacker : legitimate;
    const loser = winner === attacker ? legitimate : attacker;
    const winnerCodes = outcomes.find((outcome) => outcome.status === 'fulfilled').value.recoveryCodes;
    const winnerLogin = await f.service.authenticationOptions({ network: '192.0.2.9' });
    await f.service.authenticationVerify({ preauthToken: winnerLogin.binding.token, payload: { ceremonyId: winnerLogin.ceremonyId, credential: winner.key.authentication(winnerLogin.options, f.holder.webauthnUserId) }, network: '192.0.2.9' });
    const loserLogin = await f.service.authenticationOptions({ network: '192.0.2.9' });
    await assert.rejects(() => f.service.authenticationVerify({ preauthToken: loserLogin.binding.token, payload: { ceremonyId: loserLogin.ceremonyId, credential: loser.key.authentication(loserLogin.options, f.holder.webauthnUserId) }, network: '192.0.2.9' }), /authentication_failed/);
    assert.ok(await f.service.recoveryBegin({ payload: { code: winnerCodes[0] }, network: '192.0.2.10' }));
  });

  test('IR-02: recovery invalidation defeats concurrent session rotation', async () => {
    const f = await fixture();
    const recoveryService = peer(f).service;
    f.now += 15 * 60_000;
    const recovery = await prepareRecovery(f, f.auth.recoveryCodes[0], recoveryService);
    const pause = pauseAfter(f.store, (query) => query.includes('UPDATE access_sessions SET revoked_at'));
    const rotation = f.service.status(f.auth.token);
    rotation.catch(() => {});
    let completion;
    try {
      const rotationPid = await pause.hit;
      completion = recoveryService.recoveryRegistrationVerify(recovery.input);
      completion.catch(() => {});
      await waitForBlockedBy(rotationPid);
    } finally {
      pause.release();
    }
    await completion;
    // Rotation commits first, so recovery must revoke its successor. Status may
    // observe that revocation before it returns; both outcomes are secure.
    const rotated = await rotation.catch((error) => {
      assert.match(error.message, /unauthorized/);
      return null;
    });
    if (rotated) await assert.rejects(() => recoveryService.status(rotated.token), /unauthorized/);
    await assert.rejects(() => recoveryService.status(f.auth.token), /unauthorized/);
  });

  test('IR-03: logout invalidation prevents a queued credential revocation', async () => {
    const f = await fixture();
    const { auth } = await addSecondCredential(f);
    const target = (await f.store.listCredentials(f.holder.id))[1];
    const entered = deferred();
    const release = deferred();
    const revoke = f.store.revokeCredentialAndSessions.bind(f.store);
    f.store.revokeCredentialAndSessions = async (input) => {
      entered.resolve();
      await release.promise;
      return revoke(input);
    };
    const pending = f.service.revokeKey({ sessionToken: auth.token, csrf: auth.csrf, payload: { credentialRef: target.managementRef }, network: '192.0.2.4' });
    await entered.promise;
    await peer(f).service.logout(auth.token, auth.csrf, '192.0.2.4');
    release.resolve();
    await assert.rejects(() => pending, /forbidden|unauthorized/);
    assert.equal((await f.store.listCredentials(f.holder.id)).length, 2);
  });

  test('IR-04: a suspended holder cannot begin recovery', async () => {
    const f = await fixture();
    await f.store.sql`UPDATE access_holders SET condition = 'suspended' WHERE id = ${f.holder.id}`;
    await assert.rejects(
      () => f.service.recoveryBegin({ payload: { code: f.auth.recoveryCodes[0] }, network: '192.0.2.5' }),
      /recovery_failed/,
    );
  });

  test('IR-04: suspension invalidates recovery authority before credential insertion', async () => {
    const f = await fixture();
    const prepared = await prepareRecovery(f, f.auth.recoveryCodes[0]);
    const suspender = makeStore();
    const entered = deferred();
    const release = deferred();
    const suspension = suspender.sql.begin(async (sql) => {
      const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`;
      await sql`UPDATE access_holders SET condition = 'suspended' WHERE id = ${f.holder.id}`;
      entered.resolve(pid);
      await release.promise;
    });
    const suspenderPid = await entered.promise;
    const completion = f.service.recoveryRegistrationVerify(prepared.input);
    completion.catch(() => {});
    try {
      await waitForBlockedBy(suspenderPid);
    } finally {
      release.resolve();
      await suspension;
    }
    await assert.rejects(() => completion, /recovery_failed|unauthorized/);
    await f.store.sql`UPDATE access_holders SET condition = 'active' WHERE id = ${f.holder.id}`;
    await assert.rejects(
      () => f.service.recoveryRegistrationOptions({ recoveryToken: prepared.input.recoveryToken, csrf: prepared.input.csrf, payload: { label: 'AFTER REACTIVATION' } }),
      /unauthorized/,
    );
    assert.equal((await f.store.listCredentials(f.holder.id)).length, 1);
  });

  test('RR-01: queued credential revocation rechecks session deadlines after the holder lock', async (t) => {
    const cases = [
      {
        name: 'idle session lifetime',
        position: (store, tokenHash) => store.sql`
          UPDATE access_sessions
          SET idle_expires_at = clock_timestamp() + INTERVAL '1 second',
              absolute_expires_at = clock_timestamp() + INTERVAL '1 hour',
              last_verified_at = clock_timestamp()
          WHERE token_hash = ${tokenHash}
          RETURNING extract(epoch FROM idle_expires_at) * 1000 AS deadline
        `,
      },
      {
        name: 'absolute session lifetime',
        position: (store, tokenHash) => store.sql`
          UPDATE access_sessions
          SET idle_expires_at = clock_timestamp() + INTERVAL '1 hour',
              absolute_expires_at = clock_timestamp() + INTERVAL '1 second',
              last_verified_at = clock_timestamp()
          WHERE token_hash = ${tokenHash}
          RETURNING extract(epoch FROM absolute_expires_at) * 1000 AS deadline
        `,
      },
      {
        name: 'recent-auth lifetime',
        position: (store, tokenHash) => store.sql`
          UPDATE access_sessions
          SET idle_expires_at = clock_timestamp() + INTERVAL '1 hour',
              absolute_expires_at = clock_timestamp() + INTERVAL '1 hour',
              last_verified_at = clock_timestamp() - INTERVAL '5 minutes' + INTERVAL '1 second'
          WHERE token_hash = ${tokenHash}
          RETURNING extract(epoch FROM last_verified_at + INTERVAL '5 minutes') * 1000 AS deadline
        `,
      },
    ];

    for (const item of cases) {
      await t.test(item.name, async () => {
        const f = await fixture();
        const { auth } = await addSecondCredential(f);
        const target = (await f.store.listCredentials(f.holder.id))[1];
        const tokenHash = f.service.tokenHash('session', auth.token);
        const hold = await holdHolder(f.holder.id);
        let pending;
        try {
          const [{ deadline }] = await item.position(f.store, tokenHash);
          pending = f.store.revokeCredentialAndSessions({
            holderId: f.holder.id,
            authorizingSessionHash: tokenHash,
            managementRef: target.managementRef,
            now: f.now,
            audit: {
              id: randomUUID(),
              holderId: f.holder.id,
              type: 'credential-revoked',
              outcome: 'success',
              occurredAt: f.now,
            },
          });
          await waitForBlockedBy(hold.blockerPid);
          await waitUntil(Number(deadline));
        } finally {
          hold.release();
          await hold.transaction;
        }
        assert.equal(await pending, false);
        assert.equal((await f.store.listCredentials(f.holder.id)).length, 2);
      });
    }
  });

  test('RR-01: queued recovery completion rechecks recovery-session expiry after the holder lock', async () => {
    const f = await fixture();
    const prepared = await prepareRecovery(f, f.auth.recoveryCodes[0]);
    const tokenHash = f.service.tokenHash('recovery-session', prepared.input.recoveryToken);
    const hold = await holdHolder(f.holder.id);
    let completion;
    try {
      const [{ deadline }] = await f.store.sql`
        UPDATE access_recovery_sessions
        SET expires_at = clock_timestamp() + INTERVAL '1 second'
        WHERE token_hash = ${tokenHash}
        RETURNING extract(epoch FROM expires_at) * 1000 AS deadline
      `;
      f.now = Date.now();
      completion = f.service.recoveryRegistrationVerify(prepared.input);
      await waitForBlockedBy(hold.blockerPid);
      await waitUntil(Number(deadline));
    } finally {
      hold.release();
      await hold.transaction;
    }
    await assert.rejects(() => completion, /recovery_failed/);
    assert.equal((await f.store.listCredentials(f.holder.id)).length, 1);
  });
}
