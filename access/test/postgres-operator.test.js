import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import postgres from 'postgres';
import { enrollmentGrantHash } from '../lib/crypto.js';
import { applyMigrations } from '../lib/migrations.js';
import { PostgresStore } from '../lib/postgres-store.js';
import { Browser, productionRuntime } from './browser-harness.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

// The operator commands run as child processes exactly as an operator runs them,
// with an environment that holds only ACCESS_ENV, ACCESS_LOCAL_ORIGIN and
// DATABASE_URL: no SESSION_HASH_KEY, RECOVERY_HASH_KEY, or NETWORK_HASH_KEY.
const databaseURL = process.env.ACCESS_TEST_DATABASE_URL;
const ACCESS_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'http://localhost:4174';

if (!databaseURL) {
  test('PostgreSQL operator command tests', { skip: 'Set ACCESS_TEST_DATABASE_URL to an isolated PostgreSQL database' }, () => {});
} else {
  const admin = postgres(databaseURL, { max: 1, idle_timeout: 5, onnotice: () => {} });
  const schemas = [];
  const closers = [];
  let createdRuntimeRole = false;

  async function createSchema() {
    const schema = `access_op_${randomBytes(8).toString('hex')}`;
    await admin`CREATE SCHEMA ${admin(schema)}`;
    schemas.push(schema);
    const url = new URL(databaseURL);
    url.searchParams.set('search_path', schema);
    const sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
    closers.push(() => sql.end());
    await applyMigrations(sql);
    const store = new PostgresStore(url.toString());
    closers.push(() => store.close());
    return { url: url.toString(), sql, store };
  }

  function operator(script, args, url, input) {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: ORIGIN, DATABASE_URL: url };
    const run = spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: ACCESS_ROOT, env, input, encoding: 'utf8', timeout: 30_000 });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  const tokenFrom = (stdout) => /#establish=([A-Za-z0-9_-]{43})\n$/.exec(stdout)?.[1];
  const snapshot = async (sql) => (await sql`
    SELECT
      (SELECT count(*)::int FROM access_holders) AS holders,
      (SELECT count(*)::int FROM access_enrollment_grants) AS grants,
      (SELECT count(*)::int FROM access_audit_events) AS audits,
      (SELECT coalesce(max(updated_at)::text, '') FROM access_holders) AS "holdersUpdated",
      (SELECT coalesce(string_agg(expires_at::text, ',' ORDER BY id), '') FROM access_enrollment_grants) AS expiries
  `)[0];

  test.after(async () => {
    await Promise.all(closers.map((close) => close()));
    for (const schema of schemas) await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    if (createdRuntimeRole) await admin`DROP ROLE access_runtime`;
    await admin.end();
  });

  test('operator commands run without runtime secrets: holders, create-enrollment, reissue, reference guard, suspension, pruning', { timeout: 90_000 }, async (t) => {
    const { url, sql, store } = await createSchema();
    const runtime = productionRuntime({ store, clock: () => Date.now() });
    let firstToken;

    await t.test('holders is read-only and starts empty', async () => {
      const before = await snapshot(sql);
      const run = operator('list-holders.mjs', [], url);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /^0 holders \(read-only transaction: yes\)\n$/);
      assert.deepEqual(await snapshot(sql), before);
    });

    await t.test('create-enrollment --new stores only the SHA-256 digest and prints one working link', async () => {
      const run = operator('create-enrollment.mjs', ['--new', 'PROB–H–0001', 'R–N3X58A'], url);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stderr, /Connected as \w+ \(development, http:\/\/localhost:4174\)/);
      firstToken = tokenFrom(run.stdout);
      assert.ok(firstToken, 'stdout is exactly one link');
      assert.equal(run.stdout, `${ORIGIN}/#establish=${firstToken}\n`);
      const [grant] = await sql`SELECT token_hash, operator_note FROM access_enrollment_grants`;
      assert.deepEqual(grant, { token_hash: enrollmentGrantHash(firstToken), operator_note: 'R–N3X58A' });
    });

    await t.test('a second --new for the same request reference is refused and creates nothing', async () => {
      const before = await snapshot(sql);
      const run = operator('create-enrollment.mjs', ['--new', 'PROB–H–0002', 'R–N3X58A'], url);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /R–N3X58A already produced a grant for PROB–H–0001\. Use --reissue 'PROB–H–0001'/);
      assert.equal(run.stdout, '');
      assert.deepEqual(await snapshot(sql), before);
    });

    await t.test('--reissue replaces the link for the same holder; the old link stops working', async () => {
      const run = operator('create-enrollment.mjs', ['--reissue', 'PROB–H–0001', 'R–N3X58A'], url);
      assert.equal(run.status, 0, run.stderr);
      const replacement = tokenFrom(run.stdout);
      assert.notEqual(replacement, firstToken);
      assert.equal((await new Browser(runtime).post('enrollment-options', { grant: firstToken, label: 'OLD' })).status, 400);
      assert.equal(operator('create-enrollment.mjs', ['--reissue', 'PROB–H–0404', 'R–N3X58A'], url).status, 1, 'reissue never creates');
      firstToken = replacement;
    });

    await t.test('holders shows the open link and reference without changing anything', async () => {
      const before = await snapshot(sql);
      const run = operator('list-holders.mjs', [], url);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /^1 holder \(read-only transaction: yes\)\nPROB–H–0001 +pending +\d{4}-\d{2}-\d{2} +link open +R–N3X58A\n$/);
      assert.equal(run.stdout.includes('sha256:') || run.stdout.includes(firstToken), false, 'no digests or tokens');
      assert.deepEqual(await snapshot(sql), before);
    });

    await t.test('the operator-issued link establishes through the production-profile runtime and is consumed', async () => {
      const browser = new Browser(runtime);
      assert.equal((await browser.enroll(new VirtualAuthenticator(), firstToken)).status, 200);
      const [row] = await sql`SELECT h.condition, g.consumed_at IS NOT NULL AS consumed FROM access_holders h JOIN access_enrollment_grants g ON g.holder_id = h.id WHERE h.public_id = 'PROB–H–0001' AND g.token_hash = ${enrollmentGrantHash(firstToken)}`;
      assert.deepEqual(row, { condition: 'active', consumed: true });
      assert.equal((await new Browser(runtime, { network: '198.51.100.90' }).post('enrollment-options', { grant: firstToken, label: 'REPLAY' })).status, 400);
      assert.equal(operator('create-enrollment.mjs', ['--new', 'PROB–H–0003', 'R–N3X58A'], url).status, 1, 'a used reference stays used after establishment');
    });

    await t.test('holder-condition suspends and reactivates with operator-only configuration; suspension still expires links (003)', async () => {
      const issued = operator('create-enrollment.mjs', ['--new', 'PROB–H–0002', 'R–N3X58B'], url);
      assert.equal(issued.status, 0, issued.stderr);
      const pendingToken = tokenFrom(issued.stdout);
      const suspended = operator('set-holder-condition.mjs', ['PROB–H–0002', 'suspend'], url);
      assert.equal(suspended.status, 0, suspended.stderr);
      assert.equal(suspended.stdout, 'PROB–H–0002 is now suspended.\n');
      const reactivated = operator('set-holder-condition.mjs', ['PROB–H–0002', 'reactivate'], url);
      assert.equal(reactivated.status, 0, reactivated.stderr);
      assert.equal(reactivated.stdout, 'PROB–H–0002 is now pending.\n');
      assert.equal((await new Browser(runtime).post('enrollment-options', { grant: pendingToken, label: 'REVIVED' })).status, 400, 'reactivation does not revive the link');
    });

    await t.test('prune-expired runs with operator-only configuration', async () => {
      const run = operator('prune-expired.mjs', ['30'], url);
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(Object.keys(JSON.parse(run.stdout)).sort(), ['ceremonies', 'rateLimits', 'recoverySessions', 'sessions']);
    });
  });

  test('operator commands refuse to run as access_runtime before changing anything', { timeout: 60_000 }, async () => {
    const [{ exists }] = await admin`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'access_runtime') AS exists`;
    if (!exists) {
      await admin`CREATE ROLE access_runtime NOLOGIN`;
      createdRuntimeRole = true;
    }
    const { url, sql } = await createSchema();
    const asRuntime = new URL(url);
    asRuntime.searchParams.set('options', '-c role=access_runtime');
    const before = await snapshot(sql);
    for (const [script, args] of [
      ['create-enrollment.mjs', ['--new', 'PROB–H–0009', 'R–N3X58C']],
      ['set-holder-condition.mjs', ['PROB–H–0009', 'suspend']],
      ['prune-expired.mjs', []],
      ['list-holders.mjs', []],
    ]) {
      const run = operator(script, args, asRuntime.toString());
      assert.notEqual(run.status, 0, script);
      assert.match(run.stderr, /Refusing to run an operator command as access_runtime/, script);
      assert.equal(run.stdout, '', script);
    }
    assert.deepEqual(await snapshot(sql), before);
  });

  test('a legacy HMAC grant already in PostgreSQL still establishes through the runtime', { timeout: 30_000 }, async () => {
    const { store } = await createSchema();
    const runtime = productionRuntime({ store, clock: () => Date.now() });
    const token = randomBytes(32).toString('base64url');
    const holder = { id: crypto.randomUUID(), publicId: 'PROB–H–LEGACY', webauthnUserId: randomBytes(32).toString('base64url'), condition: 'pending', createdAt: Date.now(), updatedAt: Date.now() };
    await store.seedHolder(holder, { id: crypto.randomUUID(), holderId: holder.id, tokenHash: runtime.service.legacyEnrollmentGrantHash(token), createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, consumedAt: null });
    assert.equal((await new Browser(runtime).enroll(new VirtualAuthenticator(), token)).status, 200);
  });

  test('concurrent --new for one request reference with different identifiers issues exactly one grant', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const stores = [new PostgresStore(url), new PostgresStore(url)];
    closers.push(...stores.map((store) => () => store.close()));
    const results = await Promise.all(stores.map((store, index) => store.issueEnrollmentGrant({
      mode: 'new',
      holder: { id: crypto.randomUUID(), publicId: `PROB–H–00${index + 5}`, webauthnUserId: randomBytes(32).toString('base64url') },
      grant: { id: crypto.randomUUID(), auditId: crypto.randomUUID(), tokenHash: enrollmentGrantHash(randomBytes(32).toString('base64url')), expiresAt: Date.now() + 86_400_000, operatorNote: 'R–N3X58D' },
      now: Date.now(),
    })));
    assert.deepEqual(results.map((result) => result.issued).sort(), [false, true]);
    assert.equal(results.find((result) => !result.issued).reason, 'reference-used');
    const [{ holders, grants }] = await sql`SELECT (SELECT count(*)::int FROM access_holders) AS holders, (SELECT count(*)::int FROM access_enrollment_grants) AS grants`;
    assert.deepEqual([holders, grants], [1, 1]);
  });

  test('approve-request CLI declines without mutation, allocates after confirmation, and refuses reuse', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const declined = operator('approve-request.mjs', ['R–N3X58E'], url, 'n\n');
    assert.equal(declined.status, 0, declined.stderr);
    assert.equal(declined.stdout, '');
    assert.match(declined.stderr, /No holder or link created/);
    assert.deepEqual((await sql`SELECT count(*)::int AS count FROM access_holders`)[0].count, 0);

    const approved = operator('approve-request.mjs', ['R–N3X58E'], url, 'y\n');
    assert.equal(approved.status, 0, approved.stderr);
    assert.match(approved.stderr, /Allocated PROB–H–0001/);
    const token = tokenFrom(approved.stdout);
    assert.ok(token, 'only one bearer link is printed');
    assert.equal(approved.stdout, `${ORIGIN}/#establish=${token}\n`);
    const [row] = await sql`SELECT h.public_id, g.operator_note, g.token_hash FROM access_holders h JOIN access_enrollment_grants g ON g.holder_id = h.id`;
    assert.deepEqual(row, { public_id: 'PROB–H–0001', operator_note: 'R–N3X58E', token_hash: enrollmentGrantHash(token) });

    const duplicate = operator('approve-request.mjs', ['R–N3X58E'], url, 'y\n');
    assert.equal(duplicate.status, 1);
    assert.equal(duplicate.stdout, '');
    assert.match(duplicate.stderr, /already produced a grant for PROB–H–0001\. No new authority issued/);
    assert.deepEqual((await sql`SELECT count(*)::int AS count FROM access_enrollment_grants`)[0].count, 1);
  });

  test('production approval refuses non-TTY input even if DATABASE_URL is exported', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const env = { PATH: process.env.PATH, ACCESS_ENV: 'production', DATABASE_URL: url };
    const run = spawnSync(process.execPath, ['scripts/approve-request.mjs', 'R–N3X58F'], { cwd: ACCESS_ROOT, env, input: 'y\n', encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /terminal is required/);
    assert.equal(run.stdout, '');
    assert.deepEqual((await sql`SELECT count(*)::int AS count FROM access_holders`)[0].count, 0);
  });

  test('concurrent approvals allocate distinct sequential identifiers', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const stores = [new PostgresStore(url), new PostgresStore(url)];
    closers.push(...stores.map((store) => () => store.close()));
    const request = (index) => stores[index].approveRequest({
      holder: { id: crypto.randomUUID(), webauthnUserId: randomBytes(32).toString('base64url') },
      grant: { id: crypto.randomUUID(), auditId: crypto.randomUUID(), tokenHash: enrollmentGrantHash(randomBytes(32).toString('base64url')), expiresAt: Date.now() + 86_400_000, operatorNote: `R–N3X58${index + 1}` },
      now: Date.now(),
    });
    const results = await Promise.all([request(0), request(1)]);
    assert.deepEqual(results.map((result) => result.publicId).sort(), ['PROB–H–0001', 'PROB–H–0002']);
    const rows = await sql`SELECT h.public_id, g.operator_note FROM access_holders h JOIN access_enrollment_grants g ON g.holder_id = h.id ORDER BY h.public_id`;
    assert.deepEqual(rows.map((row) => row.public_id), ['PROB–H–0001', 'PROB–H–0002']);
    assert.equal(new Set(rows.map((row) => row.operator_note)).size, 2);
  });

  test('concurrent approvals of one reference issue one grant, never an implicit reissue', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const stores = [new PostgresStore(url), new PostgresStore(url)];
    closers.push(...stores.map((store) => () => store.close()));
    const now = Date.now();
    const results = await Promise.all(stores.map((store) => store.approveRequest({
      holder: { id: crypto.randomUUID(), webauthnUserId: randomBytes(32).toString('base64url') },
      grant: { id: crypto.randomUUID(), auditId: crypto.randomUUID(), tokenHash: enrollmentGrantHash(randomBytes(32).toString('base64url')), expiresAt: now + 86_400_000, operatorNote: 'R–N3X58K' },
      now,
    })));
    assert.deepEqual(results.map((result) => result.issued).sort(), [false, true]);
    assert.equal(results.find((result) => !result.issued).reason, 'reference-used');
    const [{ holders, grants }] = await sql`SELECT (SELECT count(*)::int FROM access_holders) AS holders, (SELECT count(*)::int FROM access_enrollment_grants) AS grants`;
    assert.deepEqual([holders, grants], [1, 1]);
  });

  test('automatic allocation advances past prior numeric IDs and fails closed at four-digit exhaustion', { timeout: 30_000 }, async () => {
    const { url, sql, store } = await createSchema();
    const now = Date.now();
    const grant = (reference) => ({ id: crypto.randomUUID(), auditId: crypto.randomUUID(), tokenHash: enrollmentGrantHash(randomBytes(32).toString('base64url')), expiresAt: now + 86_400_000, operatorNote: reference });
    await store.issueEnrollmentGrant({ mode: 'new', holder: { id: crypto.randomUUID(), publicId: 'PROB–H–0007', webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant('R–N3X58L'), now });
    const next = await store.approveRequest({ holder: { id: crypto.randomUUID(), webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant('R–N3X58M'), now });
    assert.equal(next.publicId, 'PROB–H–0008', 'gaps are not recycled');
    await store.issueEnrollmentGrant({ mode: 'new', holder: { id: crypto.randomUUID(), publicId: 'PROB–H–9999', webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant('R–N3X58N'), now });
    const before = (await sql`SELECT count(*)::int AS count FROM access_enrollment_grants`)[0].count;
    const exhausted = await store.approveRequest({ holder: { id: crypto.randomUUID(), webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant('R–N3X58P'), now });
    assert.deepEqual(exhausted, { issued: false, reason: 'identifiers-exhausted' });
    assert.equal((await sql`SELECT count(*)::int AS count FROM access_enrollment_grants`)[0].count, before);
  });

  test('approval and manual --new for the same reference create exactly one authority', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const stores = [new PostgresStore(url), new PostgresStore(url)];
    closers.push(...stores.map((store) => () => store.close()));
    const now = Date.now();
    const note = 'R–N3X58G';
    const grant = () => ({ id: crypto.randomUUID(), auditId: crypto.randomUUID(), tokenHash: enrollmentGrantHash(randomBytes(32).toString('base64url')), expiresAt: now + 86_400_000, operatorNote: note });
    const results = await Promise.all([
      stores[0].approveRequest({ holder: { id: crypto.randomUUID(), webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant(), now }),
      stores[1].issueEnrollmentGrant({ mode: 'new', holder: { id: crypto.randomUUID(), publicId: 'PROB–H–0001', webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant(), now }),
    ]);
    assert.deepEqual(results.map((result) => result.issued).sort(), [false, true]);
    const [{ holders, grants }] = await sql`SELECT (SELECT count(*)::int FROM access_holders) AS holders, (SELECT count(*)::int FROM access_enrollment_grants) AS grants`;
    assert.deepEqual([holders, grants], [1, 1]);
  });

  test('approval retries a public-ID collision with simultaneous manual --new for another reference', { timeout: 30_000 }, async () => {
    const { url, sql } = await createSchema();
    const stores = [new PostgresStore(url), new PostgresStore(url)];
    closers.push(...stores.map((store) => () => store.close()));
    const now = Date.now();
    const grant = (reference) => ({ id: crypto.randomUUID(), auditId: crypto.randomUUID(), tokenHash: enrollmentGrantHash(randomBytes(32).toString('base64url')), expiresAt: now + 86_400_000, operatorNote: reference });
    const results = await Promise.all([
      stores[0].approveRequest({ holder: { id: crypto.randomUUID(), webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant('R–N3X58H'), now }),
      stores[1].issueEnrollmentGrant({ mode: 'new', holder: { id: crypto.randomUUID(), publicId: 'PROB–H–0001', webauthnUserId: randomBytes(32).toString('base64url') }, grant: grant('R–N3X58J'), now }),
    ]);
    assert.equal(results[0].issued, true);
    const rows = await sql`SELECT public_id FROM access_holders ORDER BY public_id`;
    assert.equal(new Set(rows.map((row) => row.public_id)).size, rows.length);
    assert.equal(rows.length, results[1].issued ? 2 : 1);
    if (results[1].issued) assert.deepEqual(rows.map((row) => row.public_id), ['PROB–H–0001', 'PROB–H–0002']);
  });
}
