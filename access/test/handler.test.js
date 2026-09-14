import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHandler } from '../api/access.js';
import { clientNetwork } from '../lib/http.js';
import { MemoryStore } from '../lib/memory-store.js';
import { Browser, captureLogger, productionRuntime } from './browser-harness.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

async function productionFixture() {
  let now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const store = new MemoryStore();
  const runtime = productionRuntime({ store, clock: () => now });
  const holder = { id: randomUUID(), publicId: 'PROB–H–HTTP', webauthnUserId: Buffer.alloc(32, 5).toString('base64url'), condition: 'pending', createdAt: now, updatedAt: now };
  const grant = 'handler-test-enrollment-grant-000000000001';
  await store.seedHolder(holder, { id: randomUUID(), holderId: holder.id, tokenHash: runtime.service.tokenHash('enrollment', grant), createdAt: now, expiresAt: now + 86_400_000, consumedAt: null });
  return { runtime, store, holder, grant, advance: (ms) => { now += ms; } };
}

async function enrolledBrowser() {
  const f = await productionFixture();
  const browser = new Browser(f.runtime);
  const key = new VirtualAuthenticator();
  const enrolled = await browser.enroll(key, f.grant);
  assert.equal(enrolled.status, 200, enrolled.body.error);
  return { ...f, browser, key, codes: enrolled.body.recoveryCodes };
}

test('production enrollment issues host-only Secure HttpOnly SameSite=Strict cookies and no token in the body', async () => {
  const { browser } = await enrolledBrowser();
  const session = browser.setCookies.find((item) => item.name === '__Host-probnaya_session' && item.value);
  assert.ok(session, 'session cookie issued');
  assert.deepEqual(session.attributes, ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure']);
  const preauth = browser.setCookies.find((item) => item.name === '__Host-probnaya_preauth' && item.value);
  assert.deepEqual(preauth.attributes, ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=300']);
  assert.ok(!browser.jar.has('__Host-probnaya_preauth'), 'preauthentication cookie is cleared after enrollment');
  const status = await browser.status();
  assert.equal(status.status, 200);
  assert.equal(JSON.stringify(status.body).includes(browser.jar.get('__Host-probnaya_session')), false);
  assert.equal(status.headers.get('cache-control'), 'no-store, max-age=0');
});

test('production handler rejects preview, parent, sibling, and port hosts before any store access', async () => {
  const store = new Proxy({}, { get: () => { throw new Error('store must not be touched'); } });
  const runtime = productionRuntime({ store, clock: () => Date.now() });
  for (const host of ['surface-access-git-main.vercel.app', 'probnaya.work', 'www.probnaya.work', 'other.probnaya.work', 'access.probnaya.work:443', 'localhost:4174']) {
    const browser = new Browser(runtime, { host });
    assert.equal((await browser.status()).status, 421, host);
    assert.equal((await browser.post('authentication-options')).status, 421, host);
  }
});

test('production handler rejects missing, parent, sibling, localhost, and preview origins on every POST', async () => {
  const { runtime } = await productionFixture();
  for (const origin of [null, 'https://probnaya.work', 'https://www.probnaya.work', 'https://other.probnaya.work', 'http://access.probnaya.work', 'http://localhost:4174', 'https://surface-access.vercel.app', 'null']) {
    const browser = new Browser(runtime, { origin });
    const response = await browser.post('authentication-options');
    assert.equal(response.status, 403, String(origin));
    assert.equal(response.body.error, 'REQUEST NOT AUTHORIZED');
  }
});

test('status reads are refused for cross-site and same-site fetches and never rotate CSRF (IR-05)', async () => {
  const { browser } = await enrolledBrowser();
  const csrf = browser.csrf;
  for (const site of ['same-site', 'cross-site']) {
    assert.equal((await browser.status({ 'sec-fetch-site': site })).status, 403, site);
  }
  const first = await browser.status();
  const second = await browser.status({});
  assert.equal(first.body.csrf, csrf);
  assert.equal(second.body.csrf, csrf);
  assert.equal((await browser.post('presence-options', {}, { csrf })).status, 200);
});

test('omitted, wrong, and foreign-session CSRF values are refused on authenticated mutations', async () => {
  const { browser, runtime, grant } = await enrolledBrowser();
  for (const csrf of [null, 'wrong', runtime.service.csrfToken('session', 'another-session-token')]) {
    assert.equal((await browser.post('presence-options', {}, { csrf })).status, 403, String(csrf));
    assert.equal((await browser.post('logout', {}, { csrf })).status, 403, String(csrf));
  }
  assert.equal((await browser.post('enrollment-options', { grant, label: 'AGAIN' })).status, 400);
});

test('concurrent tabs share one CSRF value across status reads', async () => {
  const { browser, runtime } = await enrolledBrowser();
  const second = new Browser(runtime);
  second.jar = browser.jar;
  const tabA = await browser.status();
  const tabB = await second.status();
  assert.equal(tabA.body.csrf, tabB.body.csrf);
  assert.equal((await browser.post('presence-options', {}, { csrf: tabA.body.csrf })).status, 200);
});

test('session rotation after fifteen minutes issues a new cookie and CSRF; the predecessor stops working', async () => {
  const { browser, runtime, advance } = await enrolledBrowser();
  const before = browser.jar.get('__Host-probnaya_session');
  const beforeCsrf = browser.csrf;
  advance(15 * 60_000);
  const rotated = await browser.status();
  assert.equal(rotated.status, 200);
  assert.notEqual(browser.jar.get('__Host-probnaya_session'), before);
  assert.notEqual(rotated.body.csrf, beforeCsrf);
  const stale = new Browser(runtime);
  stale.jar.set('__Host-probnaya_session', before);
  assert.equal((await stale.status()).status, 401);
});

test('idle and absolute lifetimes are enforced server-side; rotation preserves the absolute deadline', async () => {
  const idle = await enrolledBrowser();
  idle.advance(30 * 60_000);
  assert.equal((await idle.browser.status()).status, 401);

  const absolute = await enrolledBrowser();
  for (let elapsed = 0; elapsed < 8 * 60 * 60_000 - 14 * 60_000; elapsed += 14 * 60_000) {
    absolute.advance(14 * 60_000);
    assert.equal((await absolute.browser.status()).status, 200, `alive at ${elapsed + 14 * 60_000}ms`);
  }
  absolute.advance(14 * 60_000);
  assert.equal((await absolute.browser.status()).status, 401);
});

test('recent presence expires after five minutes and VERIFY PRESENCE renews it', async () => {
  const { browser, key, holder, advance } = await enrolledBrowser();
  advance(5 * 60_000 + 1);
  const late = await browser.post('add-key-options', { label: 'LATE' });
  assert.equal(late.status, 403);
  assert.equal(late.body.error, 'VERIFY PRESENCE REQUIRED');
  assert.equal((await browser.verifyPresence(key, holder.webauthnUserId)).status, 200);
  assert.equal((await browser.post('add-key-options', { label: 'NOW' })).status, 200);
});

test('recovery authority survives a cancelled authenticator and a reload without spending another code', async () => {
  const { browser, runtime, key, holder, codes } = await enrolledBrowser();
  const recovering = new Browser(runtime, { network: '198.51.100.40' });
  const begun = await recovering.expectOk('recovery-begin', { code: codes[0] });
  const recoveryCookie = recovering.setCookies.find((item) => item.name === '__Host-probnaya_recovery');
  assert.deepEqual(recoveryCookie.attributes, ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=600']);

  // The authenticator prompt is cancelled: options were issued, nothing was verified.
  await recovering.recoveryRegistration(begun.csrf, new VirtualAuthenticator());
  // The page reloads and loses its in-memory CSRF value.
  const resumed = await recovering.expectOk('recovery-resume', {}, { csrf: null });
  assert.equal(resumed.csrf, begun.csrf);
  assert.equal((await recovering.post('recovery-begin', { code: codes[0] })).status, 400, 'the spent code is not reusable');

  const replacement = new VirtualAuthenticator();
  const attempt = await recovering.recoveryRegistration(resumed.csrf, replacement);
  const completed = await attempt.verify();
  assert.equal(completed.status, 200, completed.body.error);
  assert.equal(completed.body.recoveryCodes.length, 10);

  // A retried completion after a lost response finds its authority consumed.
  assert.equal((await attempt.verify()).status, 401);
  assert.equal((await recovering.post('recovery-resume', {}, { csrf: null })).status, 401);
  assert.equal((await browser.status()).status, 401, 'ordinary sessions were invalidated');
  assert.equal((await recovering.present(replacement, holder.webauthnUserId)).status, 200);
  assert.equal((await new Browser(runtime).present(key, holder.webauthnUserId)).status, 200, 'retained credentials still authenticate until revoked');
});

test('recovery-resume without recovery authority is unauthorized and resume attempts are rate-limited', async () => {
  const { runtime, codes } = await enrolledBrowser();
  const browser = new Browser(runtime);
  assert.equal((await browser.post('recovery-resume', {}, { csrf: null })).status, 401);
  await browser.expectOk('recovery-begin', { code: codes[1] });
  let limited;
  for (let attempt = 0; attempt < 14; attempt += 1) limited = await browser.post('recovery-resume', {}, { csrf: null });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('failures are logged as bounded identifiers without secrets, codes, cookies, or driver messages', async () => {
  const { browser, codes } = await enrolledBrowser();
  const logger = browser.logger;
  await browser.post('presence-options', {}, { csrf: 'wrong-csrf-value' });
  await browser.post('recovery-begin', { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
  await browser.post('not-an-action-<script>');

  const failing = createHandler({
    runtime: async () => { const error = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'); error.code = 'ECONNREFUSED'; throw error; },
    logger,
  });
  const response = await new Promise((resolve) => {
    const res = { setHeader() {}, end: (text) => resolve({ status: res.statusCode, body: JSON.parse(text) }) };
    failing({ method: 'GET', headers: {} }, res);
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'ACCESS SERVICE UNAVAILABLE');

  const text = logger.lines.join('\n');
  for (const secret of [browser.jar.get('__Host-probnaya_session'), browser.csrf, codes[0], 'wrong-csrf-value', 'ZZZZ', '<script>', 'password', '10.0.0.5']) {
    assert.equal(text.includes(secret), false, `log must not contain ${secret}`);
  }
  const entries = logger.lines.map((line) => JSON.parse(line));
  assert.deepEqual(entries.map((entry) => [entry.action, entry.status, entry.code]), [
    ['presence-options', 403, 'forbidden'],
    ['recovery-begin', 400, 'recovery_failed'],
    [null, 400, 'invalid_request'],
    [null, 500, 'ECONNREFUSED'],
  ]);
});

test('production network identity uses the platform-overwritten X-Forwarded-For only', () => {
  const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-vercel-forwarded-for': '192.0.2.200', 'x-real-ip': '192.0.2.201' };
  assert.equal(clientNetwork({ headers, socket: { remoteAddress: '127.0.0.1' } }, { production: true }), '203.0.113.9');
  assert.equal(clientNetwork({ headers: { 'x-vercel-forwarded-for': '192.0.2.200' } }, { production: true }), 'unknown');
  assert.equal(clientNetwork({ headers, socket: { remoteAddress: '127.0.0.1' } }, { production: false }), '127.0.0.1');
});

test('suspension, revocation, and cancelled native ceremonies surface generic, non-enumerating errors', async () => {
  const { browser, runtime, key, holder, store } = await enrolledBrowser();
  const unknown = await new Browser(runtime).present(new VirtualAuthenticator(), holder.webauthnUserId);
  assert.deepEqual([unknown.status, unknown.body.error], [400, 'ACCESS COULD NOT BE VERIFIED']);
  // A started but never verified ceremony (cancelled prompt) leaves nothing to clean up.
  await browser.expectOk('authentication-options');
  store.holders.get(holder.id).condition = 'suspended';
  const suspended = await new Browser(runtime).present(key, holder.webauthnUserId);
  assert.deepEqual([suspended.status, suspended.body.error], [400, 'ACCESS COULD NOT BE VERIFIED']);
  assert.equal((await browser.status()).status, 401);
});

test('credential and recovery mutation paths are rate-limited per holder or recovery authority (IR-07)', async () => {
  const { browser, key, holder, runtime, codes } = await enrolledBrowser();
  let response;
  for (let attempt = 0; attempt < 13; attempt += 1) response = await browser.post('add-key-options', { label: 'FLOOD' });
  assert.equal(response.status, 429);

  const other = await enrolledBrowser();
  for (let attempt = 0; attempt < 7; attempt += 1) {
    if (attempt % 2 === 0) assert.equal((await other.browser.verifyPresence(other.key, other.holder.webauthnUserId)).status, 200);
    response = await other.browser.post('replace-recovery-codes');
  }
  assert.equal(response.status, 429);

  const recovering = new Browser(runtime, { network: '198.51.100.90' });
  const begun = await recovering.expectOk('recovery-begin', { code: codes[2] });
  for (let attempt = 0; attempt < 13; attempt += 1) response = await recovering.post('recovery-registration-options', { label: 'FLOOD' }, { csrf: begun.csrf });
  assert.equal(response.status, 429);
  assert.equal((await browser.verifyPresence(key, holder.webauthnUserId)).status, 200, 'limits do not block presence verification');
});
