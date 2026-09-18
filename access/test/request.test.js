import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { loadConfig } from '../lib/config.js';
import { REQUEST_DAILY_LIMIT, REQUEST_NETWORK_LIMIT, REQUEST_RECIPIENT, REQUEST_UNAVAILABLE } from '../lib/constants.js';
import { MemoryStore } from '../lib/memory-store.js';
import { createRequestNotifier, requestMessage } from '../lib/notify.js';
import { requestReference } from '../lib/service.js';
import { Browser, captureLogger, PRODUCTION_ENV, productionRuntime, recordingNotifier } from './browser-harness.js';

const INVALID_ADDRESS = 'THIS ADDRESS COULD NOT BE USED. CHECK IT AND TRY AGAIN.';

function fixture({ notifier = recordingNotifier() } = {}) {
  let now = Date.UTC(2026, 8, 16, 20, 40, 0);
  const store = new MemoryStore();
  const runtime = productionRuntime({ store, clock: () => now, notifier });
  return { store, runtime, notifier, advance: (ms) => { now += ms; } };
}

let network = 0;
const freshNetwork = () => `198.51.100.${(network += 1) % 250}`;

test('a request sends one message to the PROBNAYA mailbox and returns nothing about the address', async () => {
  const { runtime, notifier } = fixture();
  const response = await new Browser(runtime).post('request-access', { email: '  noor.haddad@fastmail.com ' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, received: true });
  assert.equal(notifier.sent.length, 1);
  const [sent] = notifier.sent;
  assert.equal(sent.email, 'noor.haddad@fastmail.com');
  assert.match(sent.reference, /^R–[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.equal(sent.receivedAt, Date.UTC(2026, 8, 16, 20, 40, 0));

  const message = requestMessage({ ...sent, from: 'mail@probnaya.work' });
  assert.equal(message.to, REQUEST_RECIPIENT);
  assert.deepEqual(message.replyTo, { name: '', address: 'noor.haddad@fastmail.com' });
  assert.equal(message.subject, `ACCESS / REQUEST ${sent.reference}`);
  assert.equal(message.subject.includes('noor'), false, 'the subject carries only the reference');
  assert.match(message.text, new RegExp(`approve-request -- '${sent.reference}'`));
  assert.match(message.text, /Send the printed MESSAGE block to this address as a new message/);
  assert.doesNotMatch(message.text, /npm ci|npm run holders|create-enrollment -- --new/);
  assert.equal(Object.keys(message).includes('cc') || Object.keys(message).includes('bcc'), false);
});

test('a request creates no holder, grant, ceremony, session, recovery, or audit event, and stores no address', async () => {
  const { store, runtime } = fixture();
  const address = 'someone.unique@example.org';
  assert.equal((await new Browser(runtime).post('request-access', { email: address })).status, 200);
  for (const name of ['holders', 'credentials', 'ceremonies', 'sessions', 'recoverySessions', 'grants', 'recoveryCodes', 'activeRecoverySets']) {
    assert.equal(store[name].size, 0, `${name} stays empty`);
  }
  assert.equal(store.auditEvents.length, 0);
  assert.equal(store.rateLimits.size, 2, 'only the network and daily buckets are written');
  const serialized = JSON.stringify([...store.rateLimits]);
  assert.equal(serialized.includes('someone'), false);
  assert.equal(serialized.includes('198.51.100'), false, 'network identity is stored only as a keyed hash');
});

test('malformed and unsafe addresses are refused before anything is sent', async () => {
  const { runtime, notifier } = fixture();
  const refused = [
    '', 'plain', 'a@b', 'a@b.c', 'a b@example.org', 'a@example.org\r\nBcc: x@evil.test', 'a@example.org\nx',
    'a@example.org,b@example.org', 'a@example.org;b@example.org', '"quoted"@example.org', 'Name <a@example.org>',
    'a@@example.org', 'a@exa mple.org', '.a@example.org', 'a.@example.org', 'a..b@example.org',
    `${'x'.repeat(65)}@example.org`, `a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(63)}.org`,
    'ноор@example.org', 'a@-example.org',
  ];
  for (const email of refused) {
    const response = await new Browser(runtime, { network: freshNetwork() }).post('request-access', { email });
    assert.deepEqual([response.status, response.body.error], [400, INVALID_ADDRESS], JSON.stringify(email));
  }
  for (const data of [{}, { email: 42 }, { email: ['a@example.org'] }, { email: 'a@example.org', name: 'Noor' }, { email: 'a@example.org', reason: 'curious' }]) {
    const response = await new Browser(runtime, { network: freshNetwork() }).post('request-access', data);
    assert.equal(response.status, 400, JSON.stringify(data));
  }
  assert.equal(notifier.sent.length, 0);
  for (const email of ["o'neil+access@sub.example.co.uk", 'A.B-C_d@EXAMPLE.org']) {
    assert.equal((await new Browser(runtime, { network: freshNetwork() }).post('request-access', { email })).status, 200, email);
  }
});

test('requests are limited per network, and one network being blocked does not block another', async () => {
  const { runtime, notifier, advance } = fixture();
  const browser = new Browser(runtime, { network: '203.0.113.50' });
  for (let attempt = 0; attempt < REQUEST_NETWORK_LIMIT.limit; attempt += 1) {
    assert.equal((await browser.post('request-access', { email: `a${attempt}@example.org` })).status, 200);
  }
  const limited = await browser.post('request-access', { email: 'again@example.org' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await new Browser(runtime, { network: '203.0.113.51' }).post('request-access', { email: 'other@example.org' })).status, 200);
  // The memory store resets an expired window before honoring a longer block
  // (a documented difference from PostgreSQL); the block outlasting the window is
  // asserted against PostgreSQL in postgres-lifecycle.test.js.
  advance(REQUEST_NETWORK_LIMIT.blockMs);
  assert.equal((await browser.post('request-access', { email: 'again@example.org' })).status, 200);
  assert.equal(notifier.sent.length, REQUEST_NETWORK_LIMIT.limit + 2);
});

test('the daily ceiling pauses requests from every network and says where to write instead', async () => {
  const { runtime, notifier, advance } = fixture();
  for (let index = 0; index < REQUEST_DAILY_LIMIT.limit; index += 1) {
    const response = await new Browser(runtime, { network: `10.${Math.floor(index / 250)}.${index % 250}.1` }).post('request-access', { email: `n${index}@example.org` });
    assert.equal(response.status, 200, `request ${index}`);
  }
  const paused = await new Browser(runtime, { network: '192.0.2.77' }).post('request-access', { email: 'late@example.org' });
  assert.deepEqual([paused.status, paused.body.error], [503, REQUEST_UNAVAILABLE]);
  assert.equal(notifier.sent.length, REQUEST_DAILY_LIMIT.limit, 'nothing is sent past the ceiling');
  advance(REQUEST_DAILY_LIMIT.windowMs + REQUEST_DAILY_LIMIT.blockMs);
  assert.equal((await new Browser(runtime, { network: '192.0.2.78' }).post('request-access', { email: 'tomorrow@example.org' })).status, 200);
});

test('without request mail configuration only the request action is unavailable', async () => {
  const { runtime } = fixture({ notifier: null });
  const browser = new Browser(runtime);
  const response = await browser.post('request-access', { email: 'a@example.org' });
  assert.deepEqual([response.status, response.body.error], [503, REQUEST_UNAVAILABLE]);
  assert.equal((await browser.post('authentication-options')).status, 200, 'PRESENT KEY does not depend on mail');
});

test('delivery failure is generic and the log carries no address, reference, or driver text', async () => {
  const logger = captureLogger();
  const { runtime } = fixture({ notifier: recordingNotifier({ fail: true }) });
  const response = await new Browser(runtime, { logger }).post('request-access', { email: 'private.person@example.org' });
  assert.deepEqual([response.status, response.body.error], [503, REQUEST_UNAVAILABLE]);
  const text = logger.lines.join('\n');
  for (const secret of ['private.person', 'example.org', '535', 'Username', 'operator@example.test', 'R–']) {
    assert.equal(text.includes(secret), false, `log must not contain ${secret}`);
  }
  assert.deepEqual(logger.lines.map((line) => JSON.parse(line)).map((entry) => [entry.action, entry.status, entry.code]), [['request-access', 503, 'request_delivery_failed']]);
});

test('request-access keeps the exact-origin POST boundary', async () => {
  const { runtime, notifier } = fixture();
  for (const origin of [null, 'https://probnaya.work', 'https://evil.probnaya.work', 'http://localhost:4174']) {
    const response = await new Browser(runtime, { origin, network: freshNetwork() }).post('request-access', { email: 'a@example.org' });
    assert.equal(response.status, 403, String(origin));
  }
  assert.equal(notifier.sent.length, 0);
});

test('request references are non-personal and distinct', () => {
  const references = new Set(Array.from({ length: 500 }, () => requestReference()));
  assert.ok(references.size > 495);
  for (const reference of references) assert.match(reference, /^R–[0-9A-HJKMNP-TV-Z]{6}$/);
});

// v1 sends as mail@probnaya.work through the same Workspace account as intake.
const requestMail = {
  ACCESS_REQUEST_SMTP_USER: 'operator@probnaya.work',
  ACCESS_REQUEST_SMTP_PASS: 'abcd efgh ijkl mnop',
  ACCESS_REQUEST_SMTP_FROM: 'mail@probnaya.work',
};

test('request mail configuration: absent disables, complete enables (including mail@probnaya.work), partial or malformed settings refuse to start', () => {
  assert.equal(loadConfig(PRODUCTION_ENV).requestMail, null);
  assert.deepEqual({ ...loadConfig({ ...PRODUCTION_ENV, ...requestMail }).requestMail }, {
    transport: 'smtp', user: requestMail.ACCESS_REQUEST_SMTP_USER, pass: requestMail.ACCESS_REQUEST_SMTP_PASS, from: requestMail.ACCESS_REQUEST_SMTP_FROM,
  });
  for (const name of Object.keys(requestMail)) {
    assert.throws(() => loadConfig({ ...PRODUCTION_ENV, ...requestMail, [name]: undefined }), /requires all/, name);
  }
  for (const override of [
    { ACCESS_REQUEST_SMTP_USER: 'mail@probnaya.work' },
    { ACCESS_REQUEST_SMTP_USER: 'MAIL@probnaya.work', ACCESS_REQUEST_SMTP_FROM: 'MAIL@probnaya.work' },
    { ACCESS_REQUEST_SMTP_USER: 'access-requests@probnaya.work', ACCESS_REQUEST_SMTP_FROM: 'access-requests@probnaya.work' },
  ]) {
    assert.equal(loadConfig({ ...PRODUCTION_ENV, ...requestMail, ...override }).requestMail.transport, 'smtp', JSON.stringify(override));
  }
  assert.throws(() => loadConfig({ ...PRODUCTION_ENV, ...requestMail, ACCESS_REQUEST_SMTP_PASS: 'short' }), /app password/);
  assert.throws(() => loadConfig({ ...PRODUCTION_ENV, ...requestMail, ACCESS_REQUEST_SMTP_FROM: 'Access <a@probnaya.work>' }), /plain addresses/);
});

test('the console request outbox exists only for local development', () => {
  const development = { ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', ACCESS_USE_MEMORY_STORE: 'true', SESSION_HASH_KEY: randomBytes(32).toString('base64'), RECOVERY_HASH_KEY: randomBytes(32).toString('base64'), NETWORK_HASH_KEY: randomBytes(32).toString('base64') };
  assert.equal(loadConfig({ ...development, ACCESS_DEV_REQUEST_OUTBOX: 'console' }).requestMail.transport, 'console');
  assert.throws(() => loadConfig({ ...PRODUCTION_ENV, ACCESS_DEV_REQUEST_OUTBOX: 'console' }), /forbidden in production/);
  assert.throws(() => loadConfig({ ...development, ACCESS_DEV_REQUEST_OUTBOX: 'smtp' }), /only be console/);
  assert.throws(() => loadConfig({ ...development, ...requestMail, ACCESS_DEV_REQUEST_OUTBOX: 'console' }), /not both/);
});

test('the SMTP notifier verifies TLS to the fixed host and sends only to the PROBNAYA mailbox', async () => {
  assert.equal(createRequestNotifier(null), null);
  const calls = { transports: [], messages: [] };
  const mailer = { createTransport: (options) => { calls.transports.push(options); return { sendMail: async (message) => { calls.messages.push(message); } }; } };
  const notifier = createRequestNotifier({ transport: 'smtp', user: 'operator@probnaya.work', pass: 'abcd efgh ijkl mnop', from: 'mail@probnaya.work' }, { mailer });
  await notifier.send({ email: 'a@example.org', reference: 'R–4QX7NC', receivedAt: 0 });
  await notifier.send({ email: 'b@example.org', reference: 'R–4QX7ND', receivedAt: 0 });
  assert.equal(calls.transports.length, 1, 'one transport is reused');
  const [options] = calls.transports;
  assert.deepEqual([options.host, options.port, options.secure], ['smtp.gmail.com', 465, true]);
  assert.equal(options.tls?.rejectUnauthorized, undefined, 'certificate verification is never disabled');
  assert.deepEqual(calls.messages.map((message) => [message.from, message.to, message.replyTo.address]), [
    ['mail@probnaya.work', REQUEST_RECIPIENT, 'a@example.org'],
    ['mail@probnaya.work', REQUEST_RECIPIENT, 'b@example.org'],
  ]);

  const written = [];
  const outbox = createRequestNotifier({ transport: 'console' }, { output: { write: (text) => written.push(text) } });
  await outbox.send({ email: 'local@example.org', reference: 'R–LOCAL0', receivedAt: 0 });
  assert.match(written.join(''), /local request outbox/);
});

test('the installed Nodemailer builds the request message with Reply-To and no extra recipients', async () => {
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  const info = await transporter.sendMail(requestMessage({ from: 'mail@probnaya.work', email: 'noor.haddad@fastmail.com', reference: 'R–4QX7NC', receivedAt: 0 }));
  const message = JSON.parse(info.message);
  assert.deepEqual(message.to.map((entry) => entry.address), [REQUEST_RECIPIENT]);
  assert.deepEqual(message.replyTo.map((entry) => entry.address), ['noor.haddad@fastmail.com']);
  assert.equal(message.cc, undefined);
  assert.equal(message.bcc, undefined);
  assert.deepEqual(info.envelope.to, [REQUEST_RECIPIENT], 'the SMTP envelope has one recipient');
  assert.equal(info.envelope.from, 'mail@probnaya.work', 'the envelope sender matches From, so SPF can align with probnaya.work');
});
