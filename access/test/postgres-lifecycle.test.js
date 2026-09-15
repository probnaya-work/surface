import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
import { REQUEST_NETWORK_LIMIT } from '../lib/constants.js';
import { applyMigrations, MIGRATION_ROOT } from '../lib/migrations.js';
import { PostgresStore } from '../lib/postgres-store.js';
import { Browser, captureLogger, productionRuntime, recordingNotifier } from './browser-harness.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

const databaseURL = process.env.ACCESS_TEST_DATABASE_URL;

if (!databaseURL) {
  test('PostgreSQL lifecycle and migration tests', { skip: 'Set ACCESS_TEST_DATABASE_URL to an isolated PostgreSQL database' }, () => {});
} else {
  const admin = postgres(databaseURL, { max: 1, idle_timeout: 5, onnotice: () => {} });
  const schemas = [];
  const closers = [];

  async function createSchema() {
    const schema = `access_life_${randomBytes(8).toString('hex')}`;
    await admin`CREATE SCHEMA ${admin(schema)}`;
    schemas.push(schema);
    const url = new URL(databaseURL);
    url.searchParams.set('search_path', schema);
    const sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
    closers.push(() => sql.end());
    return { schema, url: url.toString(), sql };
  }

  function storeFor(url) {
    const store = new PostgresStore(url);
    closers.push(() => store.close());
    return store;
  }

  test.after(async () => {
    await Promise.all(closers.map((close) => close()));
    for (const schema of schemas) await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    await admin.end();
  });

  const FORWARD = ['002_holder_authority.sql', '003_suspension_expires_grants.sql'];

  test('fresh database: migrations apply in order once, then only idempotent forward migrations re-run', { timeout: 30_000 }, async () => {
    const { sql } = await createSchema();
    assert.deepEqual(await applyMigrations(sql), ['001_access.sql', ...FORWARD]);
    assert.deepEqual(await applyMigrations(sql), FORWARD);
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`;
    assert.equal(tables.length, 10);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid = 'access_holders'::regclass AND NOT tgisinternal`;
    assert.equal(count, 1);
  });

  test('populated upgrade: 002 and 003 invalidate authority of suspended and non-active holders only, and re-running changes nothing', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const connection = await sql.reserve();
    try {
      await connection.unsafe(await readFile(resolve(MIGRATION_ROOT, '001_access.sql'), 'utf8'));
    } finally {
      connection.release();
    }
    const store = storeFor(url);
    const runtime = productionRuntime({ store, clock: () => Date.now() });

    async function enrolledHolder(publicId) {
      const grant = randomBytes(32).toString('base64url');
      const issued = await store.issueEnrollmentGrant({
        mode: 'new',
        holder: { id: randomUUID(), publicId, webauthnUserId: randomBytes(32).toString('base64url') },
        grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: runtime.service.tokenHash('enrollment', grant), expiresAt: Date.now() + 86_400_000 },
        now: Date.now(),
      });
      const browser = new Browser(runtime);
      const enrolled = await browser.enroll(new VirtualAuthenticator(), grant);
      assert.equal(enrolled.status, 200, enrolled.body.error);
      const recovery = new Browser(runtime);
      await recovery.expectOk('recovery-begin', { code: enrolled.body.recoveryCodes[0] });
      return { holderId: issued.holderId, browser, recovery };
    }

    const active = await enrolledHolder('PROB–H–UPGRADEA');
    const suspended = await enrolledHolder('PROB–H–UPGRADES');
    // Before 002 there is no trigger: suspension leaves live authority behind.
    await sql`UPDATE access_holders SET condition = 'suspended' WHERE id = ${suspended.holderId}`;
    const [{ live }] = await sql`SELECT count(*)::int AS live FROM access_sessions WHERE holder_id = ${suspended.holderId} AND revoked_at IS NULL`;
    assert.equal(live, 1);
    // Two pending holders with outstanding links; one is suspended before 003 exists.
    const pendingLink = async (publicId) => {
      const grant = randomBytes(32).toString('base64url');
      const issued = await store.issueEnrollmentGrant({ mode: 'new', holder: { id: randomUUID(), publicId, webauthnUserId: randomBytes(32).toString('base64url') }, grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: runtime.service.tokenHash('enrollment', grant), expiresAt: Date.now() + 86_400_000 }, now: Date.now() });
      return { grant, holderId: issued.holderId };
    };
    const openLink = await pendingLink('PROB–H–UPGRADEP');
    const frozenLink = await pendingLink('PROB–H–UPGRADEF');
    await sql`UPDATE access_holders SET condition = 'suspended' WHERE id = ${frozenLink.holderId}`;

    assert.deepEqual(await applyMigrations(sql), FORWARD);
    const authority = async (holderId) => (await sql`
      SELECT
        (SELECT count(*)::int FROM access_sessions WHERE holder_id = ${holderId} AND revoked_at IS NULL) AS sessions,
        (SELECT count(*)::int FROM access_recovery_sessions WHERE holder_id = ${holderId} AND consumed_at IS NULL) AS recovery
    `)[0];
    assert.deepEqual(await authority(active.holderId), { sessions: 1, recovery: 1 });
    assert.deepEqual(await authority(suspended.holderId), { sessions: 0, recovery: 0 });
    const snapshot = await sql`SELECT id, revoked_at FROM access_sessions ORDER BY id`;

    const grants = await sql`SELECT id, expires_at FROM access_enrollment_grants ORDER BY id`;
    assert.deepEqual(await applyMigrations(sql), FORWARD);
    assert.deepEqual(await sql`SELECT id, revoked_at FROM access_sessions ORDER BY id`, snapshot);
    assert.deepEqual(await sql`SELECT id, expires_at FROM access_enrollment_grants ORDER BY id`, grants, 're-running 003 changes no grant');
    await sql`UPDATE access_holders SET condition = 'pending' WHERE id = ${frozenLink.holderId}`;
    assert.equal((await new Browser(runtime).post('enrollment-options', { grant: frozenLink.grant, label: 'FROZEN' })).status, 400, '003 expires links of holders suspended before it');
    assert.equal((await new Browser(runtime).enroll(new VirtualAuthenticator(), openLink.grant)).status, 200, 'links of pending holders are untouched');
    assert.equal((await active.browser.status()).status, 200, 'active holder session survives the upgrade');
    assert.equal((await active.recovery.post('recovery-resume', {}, { csrf: null })).status, 200, 'active holder recovery survives the upgrade');

    await store.setHolderCondition({ publicId: 'PROB–H–UPGRADES', action: 'reactivate', now: Date.now(), auditId: randomUUID() });
    assert.equal((await suspended.browser.status()).status, 401, 'reactivation does not resurrect sessions');
    assert.equal((await suspended.recovery.post('recovery-resume', {}, { csrf: null })).status, 401, 'reactivation does not resurrect recovery');
  });

  test('every ceremony end to end through the production-profile handler on PostgreSQL', { timeout: 60_000 }, async (t) => {
    const { url, sql } = await createSchema();
    await applyMigrations(sql);
    const store = storeFor(url);
    let offset = 0;
    const runtime = productionRuntime({ store, clock: () => Date.now() + offset });
    const publicId = 'PROB–H–LIFECYCLE';
    const issue = async (mode = 'reissue') => {
      const grant = randomBytes(32).toString('base64url');
      const result = await store.issueEnrollmentGrant({
        mode,
        holder: { id: randomUUID(), publicId, webauthnUserId: randomBytes(32).toString('base64url') },
        grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: runtime.service.tokenHash('enrollment', grant), expiresAt: Date.now() + 86_400_000 },
        now: Date.now(),
      });
      return { grant, result };
    };

    const primary = new VirtualAuthenticator();
    const second = new VirtualAuthenticator();
    const replacement = new VirtualAuthenticator();
    const browser = new Browser(runtime);
    let userHandle;
    let codes;

    await t.test('operator grants: explicit creation, explicit replacement, and refusal once established', async () => {
      assert.deepEqual((await issue('reissue')).result, { issued: false, reason: 'unknown' }, 'reissue never creates a holder');
      const first = await issue('new');
      assert.equal(first.result.created, true);
      const again = await issue('new');
      assert.deepEqual(again.result, { issued: false, reason: 'exists', condition: 'pending' }, 'new never replaces an outstanding link');
      assert.equal((await browser.post('enrollment-options', { grant: again.grant, label: 'REFUSED NEW' })).status, 400);
      const replaced = await issue('reissue');
      assert.deepEqual([replaced.result.issued, replaced.result.created], [true, false]);
      assert.equal((await browser.post('enrollment-options', { grant: first.grant, label: 'OLD GRANT' })).status, 400, 'replaced grant no longer works');
      const enrolled = await browser.enroll(primary, replaced.grant);
      assert.equal(enrolled.status, 200, enrolled.body.error);
      codes = enrolled.body.recoveryCodes;
      assert.equal(codes.length, 10);
      assert.deepEqual((await issue('reissue')).result, { issued: false, reason: 'not-pending', condition: 'active' }, 'no grant for an active holder');
      assert.deepEqual((await issue('new')).result, { issued: false, reason: 'exists', condition: 'active' });
      [{ webauthn_user_id: userHandle }] = await sql`SELECT webauthn_user_id FROM access_holders WHERE public_id = ${publicId}`;
      const [grantRow] = await sql`SELECT count(*)::int AS consumed FROM access_enrollment_grants WHERE consumed_at IS NOT NULL`;
      assert.equal(grantRow.consumed, 1);
    });

    await t.test('first-enrollment response loss: the identical retry fails and the created key authenticates', async () => {
      const grant = randomBytes(32).toString('base64url');
      const lostHolder = { id: randomUUID(), publicId: 'PROB–H–LOSTRESPONSE', webauthnUserId: randomBytes(32).toString('base64url') };
      await store.issueEnrollmentGrant({ mode: 'new', holder: lostHolder, grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: runtime.service.tokenHash('enrollment', grant), expiresAt: Date.now() + 86_400_000 }, now: Date.now() });
      const lost = new Browser(runtime);
      const key = new VirtualAuthenticator();
      const start = await lost.expectOk('enrollment-options', { grant, label: 'LOST' });
      const payload = { ceremonyId: start.ceremonyId, label: 'LOST', credential: await key.registration(start.options, lost.webauthnOverrides()) };
      const preauth = lost.jar.get('__Host-probnaya_preauth');
      assert.equal((await lost.post('enrollment-verify', payload)).status, 200);
      // The response never reached the browser: its jar still holds only the preauthentication cookie.
      lost.jar.clear();
      lost.jar.set('__Host-probnaya_preauth', preauth);
      assert.equal((await lost.post('enrollment-verify', payload)).status, 400);
      assert.equal((await lost.post('enrollment-options', { grant, label: 'AGAIN' })).status, 400, 'grant consumed exactly once');
      assert.equal((await lost.present(key, lostHolder.webauthnUserId)).status, 200);
      assert.equal((await lost.status()).body.record.recovery, 'CODES ACTIVE', 'codes must be replaced from the record');
    });

    await t.test('status, logout, and usernameless return', async () => {
      const status = await browser.status();
      assert.equal(status.body.holder.publicId, publicId);
      assert.equal(status.body.record.recovery, 'CODES ACTIVE');
      assert.equal((await browser.post('logout')).status, 200);
      assert.equal((await browser.status()).status, 401);
      assert.equal((await browser.present(primary, userHandle)).status, 200);
      assert.equal((await browser.status()).status, 200);
    });

    await t.test('wrong user handle, replayed assertion, and wrong-origin assertion fail generically', async () => {
      const other = new Browser(runtime);
      assert.equal((await other.present(primary, randomBytes(32).toString('base64url'))).status, 400);
      const start = await other.expectOk('authentication-options');
      const assertion = primary.authentication(start.options, userHandle, other.webauthnOverrides());
      assert.equal((await other.post('authentication-verify', { ceremonyId: start.ceremonyId, credential: assertion })).status, 200);
      assert.equal((await other.post('authentication-verify', { ceremonyId: start.ceremonyId, credential: assertion })).status, 400, 'challenge is single-use');
      const foreign = await other.expectOk('authentication-options');
      const phished = primary.authentication(foreign.options, userHandle, { origin: 'https://probnaya.work' });
      assert.equal((await other.post('authentication-verify', { ceremonyId: foreign.ceremonyId, credential: phished })).status, 400);
      const [{ counter }] = await sql`SELECT max(signature_counter)::int AS counter FROM access_credentials`;
      assert.equal(counter, primary.counter - 1, 'the rejected assertions did not advance the stored counter');
    });

    await t.test('second key: presence, registration, duplicate refusal without losing the session', async () => {
      assert.equal((await browser.verifyPresence(primary, userHandle)).status, 200);
      const added = await browser.addKey(second);
      assert.equal(added.status, 200, added.body.error);
      const duplicate = await browser.addKey(second, 'DUPLICATE');
      assert.equal(duplicate.status, 400);
      assert.equal((await browser.status()).status, 200, 'rolled-back add-key keeps the authorizing session');
      const [{ transports }] = await sql`SELECT transports FROM access_credentials WHERE label = 'SECOND KEY'`;
      assert.deepEqual(transports, ['internal']);
      assert.equal((await new Browser(runtime).present(second, userHandle)).status, 200);
    });

    await t.test('revocation: presence required, all sessions end, revoked key fails, last key is kept', async () => {
      const record = (await browser.status()).body.record;
      assert.equal(record.credentials.length, 2);
      const secondRef = record.credentials.find((item) => item.label === 'SECOND KEY').ref;
      const bystander = new Browser(runtime);
      assert.equal((await bystander.present(primary, userHandle)).status, 200);
      assert.equal((await browser.verifyPresence(primary, userHandle)).status, 200);
      assert.equal((await browser.post('revoke-key', { credentialRef: secondRef })).status, 200);
      assert.equal((await browser.status()).status, 401);
      assert.equal((await bystander.status()).status, 401);
      assert.equal((await new Browser(runtime).present(second, userHandle)).status, 400);
      assert.equal((await browser.present(primary, userHandle)).status, 200);
      assert.equal((await browser.verifyPresence(primary, userHandle)).status, 200);
      const lastRef = (await browser.status()).body.record.credentials[0].ref;
      const refused = await browser.post('revoke-key', { credentialRef: lastRef });
      assert.deepEqual([refused.status, refused.body.error], [403, 'KEY COULD NOT BE REVOKED']);
    });

    await t.test('recovery-code rotation invalidates the previous set', async () => {
      const replaced = await browser.post('replace-recovery-codes');
      assert.equal(replaced.status, 200, replaced.body.error);
      assert.equal((await new Browser(runtime).post('recovery-begin', { code: codes[3] })).status, 400);
      codes = replaced.body.recoveryCodes;
      assert.equal((await browser.status()).status, 200, 'rotated session remains valid');
    });

    await t.test('recovery: cancel, reload, complete, lost response, retained key, new login', async () => {
      const recovering = new Browser(runtime, { network: '198.51.100.77' });
      const begun = await recovering.expectOk('recovery-begin', { code: codes[0] });
      await recovering.recoveryRegistration(begun.csrf, new VirtualAuthenticator());
      const resumed = await recovering.expectOk('recovery-resume', {}, { csrf: null });
      const attempt = await recovering.recoveryRegistration(resumed.csrf, replacement);
      const completed = await attempt.verify();
      assert.equal(completed.status, 200, completed.body.error);
      assert.equal((await attempt.verify()).status, 401);
      assert.equal((await browser.status()).status, 401, 'ordinary sessions invalidated');
      assert.equal((await new Browser(runtime).post('recovery-begin', { code: codes[1] })).status, 400, 'source set replaced');
      assert.equal((await new Browser(runtime).post('recovery-begin', { code: completed.body.recoveryCodes[0] })).status, 200, 'new set works');
      assert.equal((await recovering.present(replacement, userHandle)).status, 200);
      assert.equal((await browser.present(primary, userHandle)).status, 200, 'old credential retained until revoked');
      const audit = await sql`SELECT event_type FROM access_audit_events WHERE event_type IN ('recovery-code-accepted', 'recovery-completed', 'recovery-set-replaced')`;
      assert.ok(audit.some((row) => row.event_type === 'recovery-completed'));
    });

    await t.test('suspension via operator tooling ends sessions and recovery; reactivation restores key login only', async () => {
      const open = new Browser(runtime);
      await open.expectOk('recovery-begin', { code: (await (async () => {
        assert.equal((await browser.verifyPresence(primary, userHandle)).status, 200);
        const rotated = await browser.expectOk('replace-recovery-codes');
        return rotated.recoveryCodes[0];
      })()) });
      const suspended = await store.setHolderCondition({ publicId, action: 'suspend', now: Date.now(), auditId: randomUUID() });
      assert.deepEqual(suspended, { changed: true, condition: 'suspended' });
      assert.equal((await browser.status()).status, 401);
      assert.equal((await open.post('recovery-resume', {}, { csrf: null })).status, 401);
      assert.equal((await new Browser(runtime).present(primary, userHandle)).status, 400);
      assert.equal((await issue('reissue')).result.issued, false, 'no grant while suspended');
      assert.deepEqual(await store.setHolderCondition({ publicId, action: 'reactivate', now: Date.now(), auditId: randomUUID() }), { changed: true, condition: 'active' });
      assert.equal((await open.post('recovery-resume', {}, { csrf: null })).status, 401);
      assert.equal((await browser.present(primary, userHandle)).status, 200);
      const events = await sql`SELECT event_type FROM access_audit_events WHERE outcome = 'operator' ORDER BY occurred_at`;
      assert.deepEqual(events.map((row) => row.event_type).filter((type) => type.startsWith('holder-')), ['holder-suspended', 'holder-reactivated']);
    });

    await t.test('idle expiry is enforced against PostgreSQL state', async () => {
      assert.equal((await browser.status()).status, 200);
      offset = 30 * 60_000;
      assert.equal((await browser.status()).status, 401);
      offset = 0;
    });

    await t.test('pruning removes only authority that stopped being usable', async () => {
      const before = await sql`SELECT (SELECT count(*)::int FROM access_audit_events) AS audits, (SELECT count(*)::int FROM access_credentials) AS credentials`;
      const result = await store.pruneExpired({ now: Date.now() + 60 * 86_400_000, retentionMs: 30 * 86_400_000 });
      assert.ok(result.ceremonies > 0 && result.sessions > 0 && result.rateLimits > 0);
      const after = await sql`SELECT (SELECT count(*)::int FROM access_audit_events) AS audits, (SELECT count(*)::int FROM access_credentials) AS credentials`;
      assert.deepEqual(after, before);
    });
  });

  test('suspending a pending holder ends its outstanding link; reactivation returns it to pending without reviving the link', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    await applyMigrations(sql);
    const store = storeFor(url);
    const runtime = productionRuntime({ store, clock: () => Date.now() });
    const publicId = 'PROB–H–NOKEYS';
    const issue = async (mode) => {
      const grant = randomBytes(32).toString('base64url');
      const result = await store.issueEnrollmentGrant({ mode, holder: { id: randomUUID(), publicId, webauthnUserId: randomBytes(32).toString('base64url') }, grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: runtime.service.tokenHash('enrollment', grant), expiresAt: Date.now() + 7 * 86_400_000 }, now: Date.now() });
      return { grant, result };
    };
    const old = await issue('new');
    assert.equal(old.result.issued, true);

    assert.deepEqual(await store.setHolderCondition({ publicId, action: 'suspend', now: Date.now(), auditId: randomUUID() }), { changed: true, condition: 'suspended' });
    assert.equal((await new Browser(runtime).post('enrollment-options', { grant: old.grant, label: 'WHILE SUSPENDED' })).status, 400, 'pending holder + grant → suspend → grant unusable');
    assert.equal((await issue('reissue')).result.issued, false, 'no new link while suspended');
    const [{ usable }] = await sql`SELECT count(*)::int AS usable FROM access_enrollment_grants WHERE holder_id = ${old.result.holderId} AND consumed_at IS NULL AND expires_at > now()`;
    assert.equal(usable, 0, 'suspension expires the grant itself, not only the holder condition');

    assert.deepEqual(await store.setHolderCondition({ publicId, action: 'reactivate', now: Date.now(), auditId: randomUUID() }), { changed: true, condition: 'pending' });
    assert.equal((await new Browser(runtime).post('enrollment-options', { grant: old.grant, label: 'AFTER REACTIVATION' })).status, 400, 'pending holder + grant → suspend → reactivate → old grant remains unusable');
    const fresh = await issue('reissue');
    assert.equal(fresh.result.issued, true, 'reissue after reactivation issues a genuinely new grant');
    assert.notEqual(fresh.grant, old.grant);
    assert.equal((await new Browser(runtime).post('enrollment-options', { grant: old.grant, label: 'OLD AFTER REISSUE' })).status, 400);
    assert.equal((await new Browser(runtime).enroll(new VirtualAuthenticator(), fresh.grant)).status, 200);
    const [{ condition }] = await sql`SELECT condition FROM access_holders WHERE public_id = ${publicId}`;
    assert.equal(condition, 'active');
    assert.deepEqual(await store.setHolderCondition({ publicId: 'PROB–H–UNKNOWN', action: 'suspend', now: Date.now(), auditId: randomUUID() }), { changed: false, reason: 'unknown-holder' });
  });

  test('an access request writes no holder, grant, ceremony, session, audit event, or address to PostgreSQL', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    await applyMigrations(sql);
    const store = storeFor(url);
    const notifier = recordingNotifier();
    const runtime = productionRuntime({ store, clock: () => Date.now(), notifier });
    const address = 'request.person+access@example.org';
    const counts = async () => (await sql`
      SELECT
        (SELECT count(*)::int FROM access_holders) AS holders,
        (SELECT count(*)::int FROM access_enrollment_grants) AS grants,
        (SELECT count(*)::int FROM access_ceremonies) AS ceremonies,
        (SELECT count(*)::int FROM access_sessions) AS sessions,
        (SELECT count(*)::int FROM access_audit_events) AS audits
    `)[0];
    const before = await counts();
    const response = await new Browser(runtime).post('request-access', { email: address });
    assert.equal(response.status, 200);
    assert.deepEqual(await counts(), before);
    assert.equal(notifier.sent.length, 1);
    // No column of any Access table holds the address, in any form.
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`;
    for (const { table_name: table } of tables) {
      const [{ found }] = await sql.unsafe(`SELECT count(*)::int AS found FROM ${table} t WHERE t::text ILIKE $1`, [`%${address.split('@')[0]}%`]);
      assert.equal(found, 0, `${table} must not contain the address`);
    }
    const [{ buckets }] = await sql`SELECT count(*)::int AS buckets FROM access_rate_limits`;
    assert.equal(buckets, 2, 'only the network and daily rate-limit buckets are written');
  });

  test('on PostgreSQL a blocked requesting network stays blocked past its window', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    await applyMigrations(sql);
    let offset = 0;
    const store = storeFor(url);
    const runtime = productionRuntime({ store, clock: () => Date.now() + offset, notifier: recordingNotifier() });
    const browser = new Browser(runtime, { network: '203.0.113.60' });
    for (let attempt = 0; attempt < REQUEST_NETWORK_LIMIT.limit; attempt += 1) assert.equal((await browser.post('request-access', { email: `p${attempt}@example.org` })).status, 200);
    assert.equal((await browser.post('request-access', { email: 'over@example.org' })).status, 429);
    offset = REQUEST_NETWORK_LIMIT.windowMs + 1000;
    assert.equal((await browser.post('request-access', { email: 'over@example.org' })).status, 429, 'the block outlasts the window');
    offset = REQUEST_NETWORK_LIMIT.blockMs + 1000;
    assert.equal((await browser.post('request-access', { email: 'over@example.org' })).status, 200);
  });

  test('concurrent --new for one identifier creates exactly one pending holder and one link', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    await applyMigrations(sql);
    const stores = [storeFor(url), storeFor(url)];
    const runtime = productionRuntime({ store: stores[0], clock: () => Date.now() });
    const results = await Promise.all(stores.map((store) => store.issueEnrollmentGrant({
      mode: 'new',
      holder: { id: randomUUID(), publicId: 'PROB–H–RACE', webauthnUserId: randomBytes(32).toString('base64url') },
      grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: runtime.service.tokenHash('enrollment', randomBytes(32).toString('base64url')), expiresAt: Date.now() + 86_400_000 },
      now: Date.now(),
    })));
    assert.deepEqual(results.map((result) => result.issued).sort(), [false, true]);
    const [{ holders, grants }] = await sql`SELECT (SELECT count(*)::int FROM access_holders) AS holders, (SELECT count(*)::int FROM access_enrollment_grants) AS grants`;
    assert.deepEqual([holders, grants], [1, 1]);
  });

  test('issueEnrollmentGrant refuses to run without explicit operator intent', async () => {
    const { url, sql } = await createSchema();
    await applyMigrations(sql);
    const store = storeFor(url);
    await assert.rejects(() => store.issueEnrollmentGrant({ holder: { id: randomUUID(), publicId: 'PROB–H–NOINTENT', webauthnUserId: 'x' }, grant: {}, now: Date.now() }), /mode new or reissue/);
    const [{ holders }] = await sql`SELECT count(*)::int AS holders FROM access_holders`;
    assert.equal(holders, 0);
  });

  test('database unavailable: generic unavailable response and a bounded log line', { timeout: 30_000 }, async () => {
    const unreachable = new PostgresStore('postgres://access:not-a-real-password@127.0.0.1:1/access');
    closers.push(() => unreachable.close());
    const logger = captureLogger();
    const runtime = productionRuntime({ store: unreachable, clock: () => Date.now() });
    const browser = new Browser(runtime, { logger });
    const response = await browser.post('authentication-options');
    assert.equal(response.status, 500);
    assert.equal(response.body.error, 'ACCESS SERVICE UNAVAILABLE');
    const [entry] = logger.lines.map((line) => JSON.parse(line));
    assert.equal(entry.outcome, 'error');
    assert.equal(entry.code, 'ECONNREFUSED');
    assert.equal(logger.lines.join('').includes('not-a-real-password'), false);
  });
}
