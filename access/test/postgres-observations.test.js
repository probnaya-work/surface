import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import postgres from 'postgres';
import { contactLookup, normalizeContactAddress } from '../lib/contact.js';
import { enrollmentGrantHash, randomToken } from '../lib/crypto.js';
import { applyMigrations, MIGRATION_ROOT } from '../lib/migrations.js';
import { PostgresStore } from '../lib/postgres-store.js';
import { Browser, productionRuntime } from './browser-harness.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

// Observation ownership on real PostgreSQL: concurrent claims, and the operator
// commands run as an operator runs them. Synthetic identities only.
const databaseURL = process.env.ACCESS_TEST_DATABASE_URL;
const ACCESS_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'http://localhost:4174';
const KEY = randomBytes(32).toString('base64');
const SENDER = 'synthetic.sender@example.test';

if (!databaseURL) {
  test('PostgreSQL Observation ownership tests', { skip: 'Set ACCESS_TEST_DATABASE_URL to an isolated PostgreSQL database' }, () => {});
} else {
  const admin = postgres(databaseURL, { max: 1, idle_timeout: 5, onnotice: () => {} });
  const schemas = [];
  const closers = [];
  const work = mkdtempSync(join(tmpdir(), 'probnaya-ownership-'));

  // A synthetic public tree: one published Observation, as the Git workflow writes it.
  const publicRoot = join(work, 'site');
  mkdirSync(join(publicRoot, 'observations', '001'), { recursive: true });
  writeFileSync(join(publicRoot, 'observations', '001', 'observation.json'), JSON.stringify({ number: '001', status: 'published', published_at: '2026-09-21T10:00:00.000Z', title: 'A Synthetic Title', author: 'S.', blocks: [{ text: 'body.md' }] }));
  writeFileSync(join(publicRoot, 'observations', 'ledger.json'), JSON.stringify({ numbers: { '001': { first_published_at: '2026-09-21T10:00:00.000Z', withdrawn_at: null } } }));

  async function createSchema() {
    const schema = `access_obs_${randomBytes(8).toString('hex')}`;
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

  // The address travels on file descriptor 3 from a private file, never in argv.
  function operator(script, args, url, { input = '', address = null } = {}) {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: ORIGIN, DATABASE_URL: url, OBSERVATION_CONTACT_KEY: KEY, OBSERVATIONS_ROOT: publicRoot };
    let fd = null;
    if (address !== null) {
      const file = join(work, `address-${randomUUID()}`);
      writeFileSync(file, `${address}\n`, { mode: 0o600 });
      fd = openSync(file, 'r');
      env.OBSERVATION_CONTACT_FD = '3';
    }
    try {
      const run = spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: ACCESS_ROOT, env, input, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe', fd ?? 'ignore'] });
      return { status: run.status, stdout: run.stdout, stderr: run.stderr, argv: args.join(' ') };
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  const noSecrets = (run, label) => {
    const text = `${run.stdout}${run.stderr}${run.argv}`.toLowerCase();
    for (const secret of [SENDER, 'example.test', contactLookup(KEY, SENDER).toLowerCase(), 'hmac-sha256', KEY.toLowerCase()]) {
      assert.equal(text.includes(secret), false, `${label} printed ${secret}`);
    }
  };

  async function holderWithContact(store, runtime, address) {
    const id = randomUUID();
    const token = randomToken();
    const now = Date.now();
    await store.seedHolder(
      { id, publicId: `PROB–H–${randomBytes(3).toString('hex').toUpperCase()}`, webauthnUserId: randomToken(), condition: 'pending', createdAt: now, updatedAt: now },
      { id: randomUUID(), holderId: id, tokenHash: enrollmentGrantHash(token), createdAt: now, expiresAt: now + 86_400_000, contactLookup: address ? contactLookup(KEY, address) : null },
    );
    const browser = new Browser(runtime);
    assert.equal((await browser.enroll(new VirtualAuthenticator(), token)).status, 200);
    return { id, browser };
  }

  test.after(async () => {
    await Promise.all(closers.map((close) => close()));
    for (const schema of schemas) await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    await admin.end();
    rmSync(work, { recursive: true, force: true });
  });

  test('operator path end to end: register by descriptor, approve with a verified address, explicit claim, detach', { timeout: 120_000 }, async (t) => {
    const { url, sql, store } = await createSchema();
    const runtime = productionRuntime({ store, clock: () => Date.now() });

    await t.test('register refuses without confirmation, then stores only the lookup; a retry is idempotent', async () => {
      const refused = operator('observation-owner.mjs', ['register', '001'], url, { input: 'n\n', address: SENDER });
      assert.equal(refused.status, 0, refused.stderr);
      assert.match(refused.stderr, /Nothing was recorded/);
      assert.equal((await sql`SELECT count(*)::int AS n FROM access_observation_ownership`)[0].n, 0);

      const run = operator('observation-owner.mjs', ['register', '001'], url, { input: 'y\n', address: `  ${SENDER.toUpperCase()} ` });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, 'Observation 001 is registered: awaiting account.\n');
      noSecrets(run, 'register');
      const [row] = await sql`SELECT contact_lookup, title, published_on::text AS day, status, holder_id FROM access_observation_ownership`;
      assert.deepEqual(row, { contact_lookup: contactLookup(KEY, SENDER), title: 'A Synthetic Title', day: '2026-09-21', status: 'awaiting_account', holder_id: null });

      const retry = operator('observation-owner.mjs', ['register', '001'], url, { input: 'y\n', address: SENDER });
      assert.equal(retry.status, 0, retry.stderr);
      assert.match(retry.stdout, /already registered to this address \(awaiting_account\)\. Nothing changed/);
      const other = operator('observation-owner.mjs', ['register', '001'], url, { input: 'y\n', address: 'another.sender@example.test' });
      assert.equal(other.status, 1);
      assert.match(other.stderr, /already registered to a different address/);
      assert.equal((await sql`SELECT contact_lookup FROM access_observation_ownership`)[0].contact_lookup, contactLookup(KEY, SENDER));
    });

    await t.test('an address is never accepted as an argument, and an unpublished number is refused', async () => {
      for (const args of [['register', '001', SENDER], ['register', SENDER]]) {
        const run = operator('observation-owner.mjs', args, url, { input: 'y\n' });
        assert.equal(run.status, 1);
        assert.match(run.stderr, /^Usage:/);
        assert.equal(run.stderr.includes(SENDER), false);
      }
      const unpublished = operator('observation-owner.mjs', ['register', '002'], url, { input: 'y\n', address: SENDER });
      assert.equal(unpublished.status, 1);
      assert.match(unpublished.stderr, /Observation 002 is not published in this checkout/);
      const noInput = operator('observation-owner.mjs', ['register', '001'], url, { input: 'y\n' });
      assert.equal(noInput.status, 1);
      assert.match(noInput.stderr, /A terminal or OBSERVATION_CONTACT_FD is required/);
    });

    let holderBrowser;
    await t.test('approve-request records the address the link goes to; opening the link verifies it and reveals the offer', async () => {
      const run = operator('approve-request.mjs', ['R–0BS001'], url, { input: 'y\n', address: SENDER });
      assert.equal(run.status, 0, run.stderr);
      noSecrets(run, 'approve-request');
      assert.match(run.stdout, /exactly the address entered above/);
      const token = /#establish=([A-Za-z0-9_-]{43})/.exec(run.stdout)[1];
      const [grant] = await sql`SELECT contact_lookup, consumed_at FROM access_enrollment_grants WHERE token_hash = ${enrollmentGrantHash(token)}`;
      assert.deepEqual(grant, { contact_lookup: contactLookup(KEY, SENDER), consumed_at: null });

      holderBrowser = new Browser(runtime);
      assert.equal((await holderBrowser.enroll(new VirtualAuthenticator(), token)).status, 200);
      const found = await holderBrowser.expectOk('observations');
      assert.deepEqual(found, { ok: true, offers: [{ number: '001', title: 'A Synthetic Title', publishedOn: '2026-09-21', basis: 'address' }], held: [] });
      assert.equal((await sql`SELECT status FROM access_observation_ownership`)[0].status, 'offered');
      assert.equal((await sql`SELECT holder_id FROM access_observation_ownership`)[0].holder_id, null, 'discovery claims nothing');

      const skipped = operator('approve-request.mjs', ['R–0BS002'], url, { input: 'y\n' });
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.equal((await sql`SELECT contact_lookup FROM access_enrollment_grants WHERE operator_note = 'R–0BS002'`)[0].contact_lookup, null, 'the address stays optional');
    });

    await t.test('claim, list, and detach; the ownership never names an address', async () => {
      assert.equal((await holderBrowser.post('observation-claim', { number: '001' })).status, 200);
      assert.equal((await holderBrowser.post('observation-claim', { number: '001' })).status, 200, 'idempotent');
      assert.deepEqual((await holderBrowser.expectOk('observations')).held, [{ number: '001', title: 'A Synthetic Title', publishedOn: '2026-09-21' }]);
      const list = operator('observation-owner.mjs', ['list'], url);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /^1 Observation with private ownership\n001 {2}claimed {10}owner PROB–H–0001\n$/);
      noSecrets(list, 'list');
      const detach = operator('observation-owner.mjs', ['detach', '001'], url);
      assert.equal(detach.status, 0, detach.stderr);
      assert.equal(detach.stdout, 'Observation 001 is detached (was claimed). The public Observation is unchanged.\n');
      assert.equal(operator('observation-owner.mjs', ['detach', '001'], url).stdout, 'Observation 001 was already detached. Nothing changed.\n');
      assert.deepEqual((await holderBrowser.expectOk('observations')).held, []);
      assert.deepEqual((await holderBrowser.expectOk('observations')).offers, []);
      const record = readFileSync(join(publicRoot, 'observations', '001', 'observation.json'), 'utf8');
      assert.equal(record.includes('detached') || record.includes('PROB–H'), false, 'the public record is untouched');

      const reoffer = operator('observation-owner.mjs', ['offer', '001', 'PROB–H–0001'], url, { input: 'y\n' });
      assert.equal(reoffer.status, 0, reoffer.stderr);
      assert.deepEqual((await holderBrowser.expectOk('observations')).offers.map((o) => o.basis), ['operator']);
      const audits = await sql`SELECT event_type FROM access_audit_events WHERE event_type LIKE 'observation-%' ORDER BY occurred_at, event_type`;
      assert.deepEqual(new Set(audits.map((a) => a.event_type)), new Set(['observation-contact-registered', 'observation-claimed', 'observation-detached', 'observation-offered']));
    });
  });

  test('concurrent claims from separate connection pools leave exactly one owner', { timeout: 60_000 }, async () => {
    const { url, sql, store } = await createSchema();
    await store.registerObservationContact({ number: '001', contactLookup: contactLookup(KEY, SENDER), title: 'Race', publishedOn: '2026-09-21', now: Date.now(), auditId: randomUUID() });
    const holders = [];
    for (let i = 0; i < 4; i += 1) {
      const own = new PostgresStore(url);
      closers.push(() => own.close());
      holders.push(await holderWithContact(own, productionRuntime({ store: own, clock: () => Date.now() }), SENDER));
    }
    const attempts = await Promise.all(holders.flatMap((h) => [0, 1, 2].map(() => h.browser.post('observation-claim', { number: '001' }))));
    const [{ owner }] = await sql`SELECT holder_id AS owner FROM access_observation_ownership WHERE observation_number = '001' AND status = 'claimed'`;
    const winner = holders.find((h) => h.id === owner);
    assert.ok(winner);
    attempts.forEach((response, index) => assert.equal(response.status, holders[Math.floor(index / 3)] === winner ? 200 : 409));
    assert.equal((await sql`SELECT count(*)::int AS n FROM access_audit_events WHERE event_type = 'observation-claimed'`)[0].n, 1);
    for (const h of holders.filter((item) => item !== winner)) assert.deepEqual((await h.browser.expectOk('observations')).offers, []);
  });

  test('an unverified address finds nothing on PostgreSQL', async () => {
    const { sql, store } = await createSchema();
    const runtime = productionRuntime({ store, clock: () => Date.now() });
    await store.registerObservationContact({ number: '001', contactLookup: contactLookup(KEY, SENDER), title: 'Pending', publishedOn: '2026-09-21', now: Date.now(), auditId: randomUUID() });
    const h = await holderWithContact(store, runtime, null);
    // A grant carrying the matching address that was never opened.
    await sql`INSERT INTO access_enrollment_grants (id, holder_id, token_hash, created_at, expires_at, consumed_at, contact_lookup) VALUES (${randomUUID()}, ${h.id}, ${'sha256:never-opened'}, now(), now(), null, ${contactLookup(KEY, SENDER)})`;
    assert.deepEqual((await h.browser.expectOk('observations')).offers, []);
    assert.equal((await h.browser.post('observation-claim', { number: '001' })).status, 409);
    assert.equal((await sql`SELECT status FROM access_observation_ownership`)[0].status, 'awaiting_account');
  });

  test('migration 004 grants the runtime only holder-side writes and never the address lookup column', async () => {
    const { sql } = await createSchema();
    const text = readFileSync(join(MIGRATION_ROOT, '004_observation_ownership.sql'), 'utf8');
    const grants = /DO \$\$[\s\S]*?\$\$;/g.exec(text.slice(text.indexOf('-- Least privilege')))[0];
    // Roles are cluster-wide: create them, grant, check, and roll everything back.
    await sql.begin(async (tx) => {
      for (const role of ['access_runtime', 'access_operator']) {
        const [{ exists }] = await tx`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
        if (!exists) await tx.unsafe(`CREATE ROLE ${role} NOLOGIN`);
      }
      await tx.unsafe(grants);
      const can = async (role, privilege, column = null) => (await (column
        ? tx`SELECT has_column_privilege(${role}, 'access_observation_ownership', ${column}, ${privilege}) AS ok`
        : tx`SELECT has_table_privilege(${role}, 'access_observation_ownership', ${privilege}) AS ok`))[0].ok;
      assert.equal(await can('access_runtime', 'SELECT'), true);
      assert.equal(await can('access_runtime', 'INSERT'), false);
      assert.equal(await can('access_runtime', 'DELETE'), false);
      assert.equal(await can('access_runtime', 'UPDATE', 'status'), true);
      assert.equal(await can('access_runtime', 'UPDATE', 'contact_lookup'), false);
      assert.equal(await can('access_runtime', 'UPDATE', 'offered_holder_id'), false);
      assert.equal(await can('access_runtime', 'UPDATE', 'detached_at'), false);
      assert.equal(await can('access_operator', 'INSERT'), true);
      assert.equal(await can('access_operator', 'DELETE'), false);
      throw Object.assign(new Error('rollback'), { rollback: true });
    }).catch((error) => { if (!error.rollback) throw error; });
  });

  test('the stored form is the shared normalization and HMAC, and nothing else', async () => {
    const { sql, store } = await createSchema();
    await store.registerObservationContact({ number: '003', contactLookup: contactLookup(KEY, ' Synthetic.Sender@EXAMPLE.test'), title: null, publishedOn: '2026-09-23', now: Date.now(), auditId: randomUUID() });
    const [row] = await sql`SELECT row_to_json(o)::text AS json FROM access_observation_ownership o`;
    assert.equal(row.json.includes(normalizeContactAddress(SENDER)), false);
    assert.equal(row.json.includes(contactLookup(KEY, SENDER)), true);
    await assert.rejects(sql`UPDATE access_observation_ownership SET contact_lookup = ${SENDER}`, /check constraint/, 'a plaintext address cannot be stored');
  });
}
