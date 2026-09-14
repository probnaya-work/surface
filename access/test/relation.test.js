import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadConfig } from '../lib/config.js';
import { MemoryStore } from '../lib/memory-store.js';
import { AccessService } from '../lib/service.js';
import { createWebAuthn } from '../lib/webauthn.js';
import { Browser, captureLogger, productionRuntime } from './browser-harness.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

const PUBLIC = 'https://probnaya.work';
const SESSION = '__Host-probnaya_session';

async function enrolled() {
  let now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const store = new MemoryStore();
  const runtime = productionRuntime({ store, clock: () => now });
  const holder = { id: randomUUID(), publicId: 'PROB–H–0142', webauthnUserId: Buffer.alloc(32, 7).toString('base64url'), condition: 'pending', createdAt: now - 86_400_000, updatedAt: now };
  const grant = 'relation-test-enrollment-grant-0000000000001';
  await store.seedHolder(holder, { id: randomUUID(), holderId: holder.id, tokenHash: runtime.service.tokenHash('enrollment', grant), createdAt: now, expiresAt: now + 86_400_000, consumedAt: null });
  const logger = captureLogger();
  const browser = new Browser(runtime, { logger });
  const key = new VirtualAuthenticator();
  const response = await browser.enroll(key, grant);
  assert.equal(response.status, 200, response.body.error);
  return { runtime, store, holder, browser, key, logger, advance: (ms) => { now += ms; }, at: () => now };
}

test('production fixes the relation reader to https://probnaya.work and refuses overrides', () => {
  const env = {
    ACCESS_ENV: 'production',
    SESSION_HASH_KEY: randomBytes(32).toString('base64'),
    RECOVERY_HASH_KEY: randomBytes(32).toString('base64'),
    NETWORK_HASH_KEY: randomBytes(32).toString('base64'),
    DATABASE_URL: 'postgres://access:unused@db.example.test:5432/access?sslmode=verify-full',
  };
  assert.equal(loadConfig(env).publicOrigin, PUBLIC);
  assert.throws(() => loadConfig({ ...env, ACCESS_PUBLIC_ORIGIN: 'https://evil.example' }));
  assert.throws(() => loadConfig({ ...env, ACCESS_PUBLIC_ORIGIN: PUBLIC }));
});

test('development relation reader is absent unless one explicit, different localhost origin is named', () => {
  const env = { ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', ACCESS_USE_MEMORY_STORE: 'true', SESSION_HASH_KEY: 's'.repeat(32), RECOVERY_HASH_KEY: 'r'.repeat(32), NETWORK_HASH_KEY: 'n'.repeat(32) };
  assert.equal(loadConfig(env).publicOrigin, null);
  assert.equal(loadConfig({ ...env, ACCESS_PUBLIC_ORIGIN: 'http://localhost:4173' }).publicOrigin, 'http://localhost:4173');
  for (const origin of ['http://localhost:4174', 'https://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost', '*']) {
    assert.throws(() => loadConfig({ ...env, ACCESS_PUBLIC_ORIGIN: origin }), undefined, origin);
  }
});

test('a recognized holder reads identifier and Access condition only, with exact credentialed CORS', async () => {
  const { browser, runtime, at } = await enrolled();
  const response = await browser.relation();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    relation: {
      holder: { publicId: 'PROB–H–0142' },
      establishedAt: new Date(at()).toISOString(),
      lastVerifiedAt: new Date(at()).toISOString(),
      keys: 1,
      recovery: true,
    },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), PUBLIC);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(browser.jar.get(SESSION)), false);
  assert.equal(serialized.includes(runtime.service.csrfToken('session', browser.jar.get(SESSION))), false);
  assert.equal(/csrf|ref|label/i.test(serialized), false);
});

test('an unrecognized visitor receives a readable 401 without a log line', async () => {
  const { runtime, logger } = await enrolled();
  const visitor = new Browser(runtime, { logger });
  const response = await visitor.relation();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), PUBLIC);
  assert.equal(logger.lines.length, 0);
});

test('every origin except the public origin, and every non-same-site fetch, is refused before session access', async () => {
  const { browser, logger } = await enrolled();
  for (const origin of [undefined, 'null', 'https://access.probnaya.work', 'https://www.probnaya.work', 'https://other.probnaya.work', 'http://probnaya.work', 'https://probnaya.work.evil.example', 'http://localhost:4173']) {
    const headers = { 'sec-fetch-site': 'same-site', ...(origin ? { origin } : {}) };
    const response = await browser.relation(headers);
    assert.equal(response.status, 403, String(origin));
    assert.equal(response.headers.has('access-control-allow-origin'), false, String(origin));
  }
  for (const site of ['cross-site', 'same-origin', 'none']) {
    assert.equal((await browser.relation({ origin: PUBLIC, 'sec-fetch-site': site })).status, 403, site);
  }
  assert.ok(logger.lines.every((line) => !line.includes('PROB–H')));
});

test('the relation read refuses other methods and wrong hosts', async () => {
  const { browser, runtime } = await enrolled();
  const post = await browser.relation({ origin: PUBLIC, 'sec-fetch-site': 'same-site' }, 'POST');
  assert.equal(post.status, 405);
  for (const host of ['probnaya.work', 'surface-access.vercel.app', 'access.probnaya.work:443']) {
    const other = new Browser(runtime, { host });
    other.jar = browser.jar;
    assert.equal((await other.relation()).status, 421, host);
  }
});

test('reading the relation refreshes idle expiry and rotates on schedule, like the Access status read', async () => {
  const { browser, runtime, advance } = await enrolled();
  advance(25 * 60_000);
  assert.equal((await browser.relation()).status, 200);
  const before = browser.jar.get(SESSION);
  advance(25 * 60_000);
  const rotated = await browser.relation();
  assert.equal(rotated.status, 200, 'idle expiry was refreshed by the previous read');
  assert.notEqual(browser.jar.get(SESSION), before, 'session rotated');
  const stale = new Browser(runtime);
  stale.jar.set(SESSION, before);
  assert.equal((await stale.relation()).status, 401);
  assert.equal((await browser.status()).status, 200, 'the Access page shares the rotated session');
});

test('the relation read never extends the absolute lifetime', async () => {
  const { browser, advance } = await enrolled();
  for (let elapsed = 0; elapsed < 8 * 60 * 60_000; elapsed += 20 * 60_000) {
    advance(20 * 60_000);
    await browser.relation();
  }
  assert.equal((await browser.relation()).status, 401);
});

test('logout and key revocation end recognition for the public site', async () => {
  const a = await enrolled();
  assert.equal((await a.browser.post('logout')).status, 200);
  assert.equal((await a.browser.relation()).status, 401);

  const b = await enrolled();
  const second = new VirtualAuthenticator();
  assert.equal((await b.browser.verifyPresence(b.key, b.holder.webauthnUserId)).status, 200);
  assert.equal((await b.browser.addKey(second)).status, 200);
  const two = await b.browser.relation();
  assert.equal(two.body.relation.keys, 2);
  const established = two.body.relation.establishedAt;
  const ref = (await b.browser.status()).body.record.credentials[0].ref;
  assert.equal((await b.browser.verifyPresence(b.key, b.holder.webauthnUserId)).status, 200);
  assert.equal((await b.browser.post('revoke-key', { credentialRef: ref })).status, 200);
  assert.equal((await b.browser.relation()).status, 401);
  assert.equal((await b.browser.present(second, b.holder.webauthnUserId)).status, 200);
  const after = await b.browser.relation();
  assert.equal(after.body.relation.keys, 1);
  assert.equal(after.body.relation.establishedAt, established, 'the relation keeps its first establishment');
});

test('the relation service method is independent of the HTTP layer', async () => {
  const config = loadConfig({ ACCESS_ENV: 'test', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', ACCESS_PUBLIC_ORIGIN: 'http://localhost:4173', ACCESS_USE_MEMORY_STORE: 'true', SESSION_HASH_KEY: 's'.repeat(32), RECOVERY_HASH_KEY: 'r'.repeat(32), NETWORK_HASH_KEY: 'n'.repeat(32) });
  const service = new AccessService({ config, store: new MemoryStore(), webauthn: createWebAuthn(config) });
  await assert.rejects(service.relation(undefined), (error) => error.status === 401);
  await assert.rejects(service.relation('A'.repeat(43)), (error) => error.status === 401);
});
