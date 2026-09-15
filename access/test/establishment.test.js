import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { ENROLLMENT_GRANT_MS } from '../lib/constants.js';
import { ENROLLMENT_GRANT_DOMAIN, enrollmentGrantHash, keyedHash } from '../lib/crypto.js';
import { MemoryStore } from '../lib/memory-store.js';
import { getRuntime, resetRuntimeForTests } from '../lib/runtime.js';
import { Browser, productionRuntime, recordingNotifier } from './browser-harness.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

// Establishment through a link: the grant is the same primitive as before, now
// read from the link by the page and sent only by CREATE PASSKEY.
// `legacy` stores the grant the way grants were stored before the enrollment-grant
// digest: HMAC(SESSION_HASH_KEY, "enrollment:" + token).
async function pendingHolder({ condition = 'pending', expiresIn = ENROLLMENT_GRANT_MS, legacy = false } = {}) {
  let now = Date.UTC(2026, 8, 17, 11, 30, 0);
  const store = new MemoryStore();
  const runtime = productionRuntime({ store, clock: () => now, notifier: recordingNotifier() });
  const holder = { id: randomUUID(), publicId: 'PROB–H–0144', webauthnUserId: randomBytes(32).toString('base64url'), condition, createdAt: now, updatedAt: now };
  const grant = randomBytes(32).toString('base64url');
  const tokenHash = legacy ? keyedHash(runtime.config.sessionHashKey, `enrollment:${grant}`) : enrollmentGrantHash(grant);
  await store.seedHolder(holder, { id: randomUUID(), holderId: holder.id, tokenHash, createdAt: now, expiresAt: now + expiresIn, consumedAt: null });
  return { store, runtime, holder, grant, advance: (ms) => { now += ms; } };
}

test('establishment links last seven days: usable just before, refused at expiry', async () => {
  assert.equal(ENROLLMENT_GRANT_MS, 7 * 24 * 60 * 60 * 1000);
  const early = await pendingHolder();
  early.advance(ENROLLMENT_GRANT_MS - 60_000);
  assert.equal((await new Browser(early.runtime).enroll(new VirtualAuthenticator(), early.grant)).status, 200);

  const late = await pendingHolder();
  late.advance(ENROLLMENT_GRANT_MS);
  assert.equal((await new Browser(late.runtime).post('enrollment-options', { grant: late.grant, label: 'LATE' })).status, 400);
  assert.equal(late.store.holders.get(late.holder.id).condition, 'pending');
});

test('local development seeds its establishment grant with the same seven-day lifetime', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', ACCESS_USE_MEMORY_STORE: 'true',
    SESSION_HASH_KEY: randomBytes(32).toString('base64'), RECOVERY_HASH_KEY: randomBytes(32).toString('base64'), NETWORK_HASH_KEY: randomBytes(32).toString('base64'),
    ACCESS_DEV_ENROLLMENT_TOKEN: 'LOCAL-DEVELOPMENT-ENROLLMENT-TOKEN-0144', ACCESS_DEV_PUBLIC_ID: 'PROB–H–0144',
  });
  try {
    resetRuntimeForTests();
    const { store } = await getRuntime();
    const [grant] = store.grants.values();
    assert.equal(grant.expiresAt - grant.createdAt, ENROLLMENT_GRANT_MS);
    assert.equal(grant.tokenHash, enrollmentGrantHash('LOCAL-DEVELOPMENT-ENROLLMENT-TOKEN-0144'), 'dev seeding uses the grant digest');
  } finally {
    process.env = saved;
    resetRuntimeForTests();
  }
});

test('a never-issued, empty, or malformed grant establishes nothing', async () => {
  const { runtime, store, holder } = await pendingHolder();
  for (const grant of [randomBytes(32).toString('base64url'), '', 'not a grant', 'x'.repeat(300)]) {
    const response = await new Browser(runtime, { network: `192.0.2.${grant.length % 250}` }).post('enrollment-options', { grant, label: 'GUESS' });
    assert.equal(response.status, 400, JSON.stringify(grant));
  }
  assert.equal(store.ceremonies.size, 0);
  assert.equal(store.holders.get(holder.id).condition, 'pending');
});

test('opening a link is harmless: status reads and relation reads never touch the grant', async () => {
  const { runtime, grant } = await pendingHolder();
  const browser = new Browser(runtime);
  for (let read = 0; read < 25; read += 1) {
    assert.equal((await browser.status()).status, 401);
    assert.equal((await browser.relation()).status, 401);
  }
  assert.equal((await browser.enroll(new VirtualAuthenticator(), grant)).status, 200);
});

test('a scanner that presses CREATE PASSKEY elsewhere cannot consume the grant or lock out the person', async () => {
  const { runtime, grant, store, holder } = await pendingHolder();
  const scanner = new Browser(runtime, { network: '40.94.0.10' });
  let response;
  for (let attempt = 0; attempt < 12; attempt += 1) response = await scanner.post('enrollment-options', { grant, label: 'PRIMARY PASSKEY' });
  assert.equal(response.status, 429, 'the scanner network is limited');
  assert.equal(store.holders.get(holder.id).condition, 'pending');
  assert.equal([...store.grants.values()][0].consumedAt, null, 'options never consume the grant');
  assert.equal((await new Browser(runtime, { network: '203.0.113.144' }).enroll(new VirtualAuthenticator(), grant)).status, 200);
});

test('no session exists until a verified registration commits', async () => {
  const { runtime, grant, store, holder } = await pendingHolder();
  const browser = new Browser(runtime);
  const start = await browser.expectOk('enrollment-options', { grant, label: 'PRIMARY PASSKEY' });
  assert.equal(browser.jar.has('__Host-probnaya_session'), false);
  const credential = await new VirtualAuthenticator().registration(start.options, { origin: 'https://probnaya.work' });
  assert.equal((await browser.post('enrollment-verify', { ceremonyId: start.ceremonyId, label: 'PRIMARY PASSKEY', credential })).status, 400);
  assert.equal(browser.jar.has('__Host-probnaya_session'), false);
  assert.equal(store.sessions.size, 0);
  assert.equal(store.holders.get(holder.id).condition, 'pending');
  assert.equal((await new Browser(runtime).enroll(new VirtualAuthenticator(), grant)).status, 200, 'a failed ceremony leaves the link usable');
});

test('a used link is refused on replay, and establishes nothing further', async () => {
  const { runtime, grant, store } = await pendingHolder();
  const first = new Browser(runtime);
  assert.equal((await first.enroll(new VirtualAuthenticator(), grant)).status, 200);
  const replay = new Browser(runtime, { network: '198.51.100.201' });
  assert.equal((await replay.post('enrollment-options', { grant, label: 'AGAIN' })).status, 400);
  assert.equal(store.credentials.size, 1);
  assert.equal((await first.relation()).body.relation.holder.publicId, 'PROB–H–0144', 'the established relation is what the Interior reads');
});

test('a link cannot open a suspended or an established holder', async () => {
  for (const condition of ['suspended', 'active']) {
    const { runtime, grant, store, holder } = await pendingHolder({ condition });
    assert.equal((await new Browser(runtime).post('enrollment-options', { grant, label: condition })).status, 400, condition);
    assert.equal(store.holders.get(holder.id).condition, condition, 'condition is unchanged');
    assert.equal(store.sessions.size, 0);
  }
});

test('an access request never creates establishment authority, even for a pending holder\'s own address', async () => {
  const { runtime, store } = await pendingHolder();
  const before = { holders: store.holders.size, grants: store.grants.size };
  assert.equal((await new Browser(runtime).post('request-access', { email: 'noor.haddad@fastmail.com' })).status, 200);
  assert.deepEqual({ holders: store.holders.size, grants: store.grants.size }, before);
  assert.equal(store.ceremonies.size, 0);
  assert.equal(store.sessions.size, 0);
});

test('new grants are stored as a domain-separated SHA-256 digest that needs no application secret', () => {
  const token = 'Hk3vQ2wZ8pL0sT5yN1bR7cX4mD9fJ6aE2gU3hK5nW0q';
  assert.equal(ENROLLMENT_GRANT_DOMAIN, 'probnaya-access/enrollment-grant/v1:');
  assert.equal(enrollmentGrantHash(token), 'sha256:X1JRb1SsEi474TJjOANF5b1uSVXzr44tCCYV3F3FHZE', 'fixed vector');
  assert.equal(enrollmentGrantHash.length, 1, 'the digest takes only the token');
  assert.notEqual(enrollmentGrantHash(token), enrollmentGrantHash(`${token}x`));
  assert.notEqual(enrollmentGrantHash(token).slice(7), keyedHash(randomBytes(32).toString('base64'), `enrollment:${token}`));
});

test('a new-format grant establishes and is stored only as its digest', async () => {
  const { runtime, grant, store, holder } = await pendingHolder();
  const [stored] = store.grants.values();
  assert.equal(stored.tokenHash, enrollmentGrantHash(grant));
  assert.equal(JSON.stringify([...store.grants]).includes(grant), false, 'the token itself is never stored');
  assert.equal((await new Browser(runtime).enroll(new VirtualAuthenticator(), grant)).status, 200);
  assert.equal(store.holders.get(holder.id).condition, 'active');
  assert.ok([...store.grants.values()][0].consumedAt, 'successful registration consumes the grant');
});

test('a new-format grant does not depend on SESSION_HASH_KEY; sessions still do', async () => {
  const { store, grant, holder } = await pendingHolder();
  const rotated = productionRuntime({ store, clock: () => Date.UTC(2026, 8, 17, 11, 31, 0), env: { SESSION_HASH_KEY: randomBytes(32).toString('base64') } });
  const browser = new Browser(rotated);
  assert.equal((await browser.enroll(new VirtualAuthenticator(), grant)).status, 200, 'a runtime with another session key verifies the grant');
  assert.equal(store.holders.get(holder.id).condition, 'active');
  const other = productionRuntime({ store, clock: () => Date.UTC(2026, 8, 17, 11, 32, 0), env: { SESSION_HASH_KEY: randomBytes(32).toString('base64') } });
  const stranger = new Browser(other);
  stranger.jar = new Map(browser.jar);
  assert.equal((await stranger.status()).status, 401, 'a session cookie is bound to the session key that issued it');
});

test('legacy HMAC grants still establish, and remain single-use, expiring, and blocked by suspension', async () => {
  const legacy = await pendingHolder({ legacy: true });
  const browser = new Browser(legacy.runtime);
  assert.equal((await browser.enroll(new VirtualAuthenticator(), legacy.grant)).status, 200);
  assert.equal(legacy.store.holders.get(legacy.holder.id).condition, 'active');
  assert.equal((await new Browser(legacy.runtime, { network: '198.51.100.77' }).post('enrollment-options', { grant: legacy.grant, label: 'AGAIN' })).status, 400, 'replay refused');

  const expired = await pendingHolder({ legacy: true });
  expired.advance(ENROLLMENT_GRANT_MS);
  assert.equal((await new Browser(expired.runtime).post('enrollment-options', { grant: expired.grant, label: 'LATE' })).status, 400, 'expiry refused');

  const suspended = await pendingHolder({ legacy: true, condition: 'suspended' });
  assert.equal((await new Browser(suspended.runtime).post('enrollment-options', { grant: suspended.grant, label: 'SUSPENDED' })).status, 400, 'suspended holder refused');

  const opened = await pendingHolder({ legacy: true });
  for (let read = 0; read < 5; read += 1) assert.equal((await new Browser(opened.runtime).status()).status, 401);
  assert.equal([...opened.store.grants.values()][0].consumedAt, null, 'opening the page consumes nothing');
});

test('a legacy grant is only found through the legacy lookup, never as a bare token or digest', async () => {
  const legacy = await pendingHolder({ legacy: true });
  const [stored] = legacy.store.grants.values();
  assert.equal(stored.tokenHash.startsWith('sha256:'), false);
  for (const guess of [stored.tokenHash.replace(/[^A-Za-z0-9_-]/g, ''), enrollmentGrantHash(legacy.grant).slice(7)]) {
    assert.equal((await new Browser(legacy.runtime, { network: `192.0.2.${guess.length}` }).post('enrollment-options', { grant: guess, label: 'GUESS' })).status, 400);
  }
});
