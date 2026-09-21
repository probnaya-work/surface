import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { CONTACT_LOOKUP_PATTERN, contactLookup, normalizeContactAddress, requireContactKey } from '../lib/contact.js';
import { enrollmentGrantHash, keyedHash, randomToken } from '../lib/crypto.js';
import { MemoryStore } from '../lib/memory-store.js';
import { Browser, PRODUCTION_ENV, captureLogger, productionRuntime } from './browser-harness.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

// Synthetic identities only. No real contributor address appears in this file.
const KEY = randomBytes(32).toString('base64');
const SENDER = 'Sender.Synthetic@Example.TEST';
const lookup = (address, key = KEY) => contactLookup(key, address);

function world() {
  let now = Date.UTC(2026, 8, 21, 12, 0, 0);
  const store = new MemoryStore();
  const runtime = productionRuntime({ store, clock: () => now });
  const logger = captureLogger();
  const responses = [];
  return { store, runtime, logger, responses, now: () => now, advance: (ms) => { now += ms; } };
}

// A holder established through a link mailed to `address` (so that address is
// verified), or through a link with no recorded address.
async function holder(w, { address = null, publicId = `PROB–H–${randomBytes(2).toString('hex').toUpperCase()}`, extraGrants = [] } = {}) {
  const id = randomUUID();
  const token = randomToken();
  const now = w.now();
  await w.store.seedHolder(
    { id, publicId, webauthnUserId: randomToken(), condition: 'pending', createdAt: now, updatedAt: now },
    { id: randomUUID(), holderId: id, tokenHash: enrollmentGrantHash(token), createdAt: now, expiresAt: now + 86_400_000, consumedAt: null, contactLookup: address ? lookup(address) : null },
  );
  for (const grant of extraGrants) w.store.grants.set(`extra:${randomUUID()}`, { id: randomUUID(), holderId: id, createdAt: now, ...grant });
  const browser = new Browser(w.runtime, { logger: w.logger });
  const original = browser.send.bind(browser);
  browser.send = async (request) => {
    const response = await original(request);
    w.responses.push(response.body);
    return response;
  };
  const enrolled = await browser.enroll(new VirtualAuthenticator(), token);
  assert.equal(enrolled.status, 200);
  return { id, publicId, browser };
}

function register(w, number = '001', { address = SENDER, title = 'It Is Late Night, Synthetic' } = {}) {
  return w.store.registerObservationContact({ number, contactLookup: lookup(address), title, publishedOn: '2026-09-21', now: w.now(), auditId: randomUUID() });
}

const offers = async (h) => (await h.browser.expectOk('observations')).offers;
const held = async (h) => (await h.browser.expectOk('observations')).held;

test('normalization is one canonical form for both sides of a match', () => {
  const canonical = 'sender.synthetic@example.test';
  for (const variant of ['sender.synthetic@example.test', '  Sender.Synthetic@EXAMPLE.test ', 'SENDER.SYNTHETIC@Example.Test']) {
    assert.equal(normalizeContactAddress(variant), canonical);
    assert.equal(lookup(variant), lookup(canonical));
  }
  assert.equal(normalizeContactAddress('person@BÜCHER.example'), 'person@xn--bcher-kva.example');
  // Different mailboxes by standard rules stay different: no provider rewriting.
  assert.notEqual(lookup('sender.synthetic+tag@example.test'), lookup(canonical));
  assert.notEqual(lookup('sendersynthetic@example.test'), lookup(canonical));
  for (const bad of ['', 'no-at-sign', 'a@b', 'two@@example.test', 'x@example.test\r\nBcc: y@example.test', 42]) {
    assert.throws(() => normalizeContactAddress(bad), /could not be used/);
  }
});

test('the lookup is a keyed HMAC under a dedicated key, separate from every other project secret', () => {
  const value = lookup(SENDER);
  assert.match(value, CONTACT_LOOKUP_PATTERN);
  assert.equal(value.includes('example'), false);
  assert.notEqual(lookup(SENDER, randomBytes(32).toString('base64')), value, 'another key gives an unrelated value');
  const canonical = normalizeContactAddress(SENDER);
  for (const name of ['SESSION_HASH_KEY', 'RECOVERY_HASH_KEY', 'NETWORK_HASH_KEY']) {
    assert.notEqual(`hmac-sha256:contact-v1:${keyedHash(PRODUCTION_ENV[name], canonical)}`, value);
    assert.throws(() => requireContactKey(PRODUCTION_ENV[name], PRODUCTION_ENV), /must differ from every Access runtime key/);
  }
  assert.throws(() => requireContactKey('short'), /at least 32 random bytes/);
  assert.throws(() => requireContactKey('a'.repeat(64)), /at least 32 random bytes/);
  assert.throws(() => contactLookup(undefined, SENDER), /OBSERVATION_CONTACT_KEY/);
});

test('the same verified address finds the pending Observation, and finding it claims nothing', async () => {
  const w = world();
  await register(w);
  const a = await holder(w, { address: '  sender.synthetic@EXAMPLE.test' });
  assert.deepEqual(await offers(a), [{ number: '001', title: 'It Is Late Night, Synthetic', publishedOn: '2026-09-21', basis: 'address' }]);
  assert.deepEqual(await held(a), []);
  assert.equal(w.store.observations.get('001').status, 'offered');
  assert.equal(w.store.observations.get('001').holderId, null);
});

test('an unverified or different address finds nothing', async () => {
  const w = world();
  await register(w);
  // The matching grant was never opened; the holder was established another way.
  const unverified = await holder(w, { extraGrants: [{ tokenHash: 'sha256:unused', expiresAt: w.now() - 1, consumedAt: null, contactLookup: lookup(SENDER) }] });
  const other = await holder(w, { address: 'someone.else@example.test' });
  const none = await holder(w);
  for (const h of [unverified, other, none]) assert.deepEqual(await offers(h), []);
  assert.equal(w.store.observations.get('001').status, 'awaiting_account');
  assert.equal((await unverified.browser.post('observation-claim', { number: '001' })).status, 409);
});

test('acceptance is explicit and adds the Observation to the account only', async () => {
  const w = world();
  await register(w);
  const a = await holder(w, { address: SENDER });
  await offers(a);
  await offers(a);
  assert.deepEqual(await held(a), [], 'repeated discovery never claims');
  assert.equal((await a.browser.post('observation-claim', { number: '001' })).body.claimed, true);
  assert.deepEqual(await held(a), [{ number: '001', title: 'It Is Late Night, Synthetic', publishedOn: '2026-09-21' }]);
  assert.deepEqual(await offers(a), []);
  const record = w.store.observations.get('001');
  assert.equal(record.status, 'claimed');
  assert.equal(record.holderId, a.id);
});

test('claiming requires the session CSRF token and a well-formed number', async () => {
  const w = world();
  await register(w);
  const a = await holder(w, { address: SENDER });
  assert.equal((await a.browser.post('observation-claim', { number: '001' }, { csrf: null })).status, 403);
  assert.equal((await a.browser.post('observations', {}, { csrf: null })).status, 403);
  for (const number of ['1', '0001', '000', 'abc', 1]) assert.equal((await a.browser.post('observation-claim', { number })).status, 400);
  assert.equal((await a.browser.post('observation-claim', { number: '001', extra: true })).status, 400);
  assert.equal(w.store.observations.get('001').status, 'awaiting_account');
  assert.equal((await new Browser(w.runtime).post('observation-claim', { number: '001' })).status, 401);
});

test('Not mine claims nothing and is never offered to that holder again', async () => {
  const w = world();
  await register(w);
  const a = await holder(w, { address: SENDER });
  const b = await holder(w, { address: SENDER });
  await offers(a);
  assert.equal((await a.browser.post('observation-decline', { number: '001' })).body.declined, true);
  assert.equal((await a.browser.post('observation-decline', { number: '001' })).status, 200, 'repeatable');
  assert.deepEqual(await offers(a), []);
  assert.deepEqual(await held(a), []);
  assert.equal(w.store.observations.get('001').holderId, null);
  assert.equal((await a.browser.post('observation-claim', { number: '001' })).status, 409);
  assert.equal((await offers(b)).length, 1, 'another verified holder is unaffected');
});

test('only one owner: a claimed Observation is not offered elsewhere, and concurrent claims yield one', async () => {
  const w = world();
  await register(w);
  const a = await holder(w, { address: SENDER });
  const b = await holder(w, { address: SENDER });
  const results = await Promise.all([
    a.browser.post('observation-claim', { number: '001' }),
    b.browser.post('observation-claim', { number: '001' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? a : b;
  const loser = winner === a ? b : a;
  assert.equal(w.store.observations.get('001').holderId, winner.id);
  assert.deepEqual(await offers(loser), []);
  assert.deepEqual(await held(loser), []);
  assert.equal((await loser.browser.post('observation-decline', { number: '001' })).status, 409);
});

test('retries are idempotent for claims and registrations', async () => {
  const w = world();
  assert.deepEqual(await register(w), { registered: true, created: true });
  assert.equal((await register(w)).created, false);
  assert.equal((await register(w, '001', { address: 'someone.else@example.test' })).reason, 'different-contact');
  const a = await holder(w, { address: SENDER });
  for (let i = 0; i < 3; i += 1) assert.equal((await a.browser.post('observation-claim', { number: '001' })).status, 200);
  assert.equal(w.store.auditEvents.filter((e) => e.type === 'observation-claimed').length, 1, 'one claim recorded');
  assert.equal((await register(w, '001', { address: 'someone.else@example.test' })).registered, false);
  assert.equal((await w.store.registerObservationContact({ number: '001', contactLookup: lookup('someone.else@example.test'), title: 'x', publishedOn: '2026-09-21', replace: true, now: w.now(), auditId: randomUUID() })).reason, 'claimed');
});

test('detaching undoes only the private association', async () => {
  const w = world();
  await register(w);
  const a = await holder(w, { address: SENDER });
  await a.browser.expectOk('observation-claim', { number: '001' });
  assert.equal((await w.store.detachObservation({ number: '001', now: w.now(), auditId: randomUUID() })).detached, true);
  assert.equal((await w.store.detachObservation({ number: '001', now: w.now(), auditId: randomUUID() })).repeated, true);
  assert.deepEqual(await held(a), []);
  assert.deepEqual(await offers(a), [], 'a detached Observation is not re-offered by address');
  assert.equal((await a.browser.post('observation-claim', { number: '001' })).status, 409);
});

test('an operator offer reaches one verified holder, whatever address they used', async () => {
  const w = world();
  const a = await holder(w, { publicId: 'PROB–H–0003' });
  const b = await holder(w, { address: SENDER });
  const offered = await w.store.offerObservation({ number: '002', publicId: 'PROB–H–0003', title: null, publishedOn: '2026-09-22', now: w.now(), auditId: randomUUID() });
  assert.equal(offered.offered, true);
  assert.deepEqual(await offers(a), [{ number: '002', title: null, publishedOn: '2026-09-22', basis: 'operator' }]);
  assert.deepEqual(await offers(b), []);
  await a.browser.expectOk('observation-claim', { number: '002' });
  assert.equal((await w.store.offerObservation({ number: '002', publicId: b.publicId, title: null, publishedOn: '2026-09-22', now: w.now(), auditId: randomUUID() })).reason, 'claimed');
});

test('no address, lookup, or ownership internals appear in responses or logs', async () => {
  const w = world();
  await register(w);
  const a = await holder(w, { address: SENDER });
  const b = await holder(w, { address: SENDER });
  await offers(a);
  await a.browser.post('observation-claim', { number: '001' });
  await b.browser.post('observation-claim', { number: '001' });
  await b.browser.post('observation-decline', { number: '001' });
  await a.browser.post('observation-claim', { number: 'bad' });
  await a.browser.status();
  await a.browser.relation();
  const text = JSON.stringify(w.responses) + JSON.stringify(await a.browser.status()) + JSON.stringify((await a.browser.relation()).body) + w.logger.lines.join('\n');
  const canonical = normalizeContactAddress(SENDER);
  for (const secret of [SENDER, canonical, 'example.test', lookup(SENDER), 'hmac-sha256', 'contact', 'lookup', 'awaiting_account', 'offered_holder', a.id, b.id]) {
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `leaked ${secret}`);
  }
  assert.ok(w.logger.lines.some((line) => line.includes('observation_unavailable')), 'refusals are still logged as codes');
});
