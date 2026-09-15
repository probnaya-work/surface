import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { enrollmentGrantHash } from '../lib/crypto.js';
import { AccessService } from '../lib/service.js';
import { MemoryStore } from '../lib/memory-store.js';
import { createWebAuthn } from '../lib/webauthn.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

const config = {
  origin: 'http://localhost:4174',
  rpID: 'localhost',
  sessionHashKey: 'session-key-'.padEnd(40, 's'),
  recoveryHashKey: 'recovery-key-'.padEnd(40, 'r'),
  networkHashKey: 'network-key-'.padEnd(40, 'n'),
};

function fixture() {
  let now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const store = new MemoryStore();
  const service = new AccessService({ config, store, webauthn: createWebAuthn(config), clock: () => now });
  const holder = { id: randomUUID(), publicId: 'PROB–H–TEST', webauthnUserId: Buffer.alloc(32, 9).toString('base64url'), condition: 'pending', createdAt: now, updatedAt: now };
  const grant = 'test-enrollment-grant-0000000000000001';
  const seed = () => store.seedHolder(holder, { id: randomUUID(), holderId: holder.id, tokenHash: enrollmentGrantHash(grant), createdAt: now, expiresAt: now + 86_400_000, consumedAt: null });
  return { service, store, holder, grant, now: () => now, advance: (ms) => { now += ms; }, seed };
}

async function enroll(f, authenticator = new VirtualAuthenticator()) {
  await f.seed();
  const start = await f.service.enrollmentOptions({ preauthToken: undefined, payload: { grant: f.grant, label: 'PRIMARY PASSKEY' }, network: '192.0.2.1' });
  const credential = await authenticator.registration(start.options);
  const result = await f.service.enrollmentVerify({ preauthToken: start.binding.token, payload: { ceremonyId: start.ceremonyId, label: 'PRIMARY PASSKEY', credential }, network: '192.0.2.1' });
  return { ...result, authenticator };
}

async function authenticate(f, authenticator, preauthToken) {
  const start = await f.service.authenticationOptions({ preauthToken, network: '192.0.2.2' });
  const credential = authenticator.authentication(start.options, f.holder.webauthnUserId);
  return f.service.authenticationVerify({ preauthToken: start.binding.token, payload: { ceremonyId: start.ceremonyId, credential }, network: '192.0.2.2' });
}

async function verifyPresence(f, auth, authenticator) {
  const start = await f.service.presenceOptions({ sessionToken: auth.token, csrf: auth.csrf, network: '192.0.2.3' });
  const credential = authenticator.authentication(start.options, f.holder.webauthnUserId);
  return f.service.presenceVerify({ sessionToken: auth.token, csrf: auth.csrf, payload: { ceremonyId: start.ceremonyId, credential }, network: '192.0.2.3' });
}

test('valid registration creates one credential, session, and single-display recovery set', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  assert.equal(enrolled.holder.publicId, 'PROB–H–TEST');
  assert.equal(enrolled.recoveryCodes.length, 10);
  assert.equal(new Set(enrolled.recoveryCodes).size, 10);
  assert.equal((await f.store.listCredentials(f.holder.id)).length, 1);
  assert.equal((await f.service.status(enrolled.token)).record.recovery, 'CODES ACTIVE');
});

test('valid usernameless authentication creates a fresh session', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const authenticated = await authenticate(f, enrolled.authenticator);
  assert.notEqual(authenticated.token, enrolled.token);
  assert.equal((await f.service.status(authenticated.token)).holder.publicId, f.holder.publicId);
});

test('authentication fails closed if credential state changes after verification', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const complete = f.store.completeAuthentication.bind(f.store);
  f.store.completeAuthentication = async (input) => {
    f.store.credentials.get(input.credentialId).counter += 1;
    return complete(input);
  };
  await assert.rejects(
    () => authenticate(f, enrolled.authenticator),
    (error) => error.publicMessage === 'ACCESS COULD NOT BE VERIFIED',
  );
});

test('the pinned verifier rejects a non-increasing positive counter before audit', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  await authenticate(f, enrolled.authenticator);
  enrolled.authenticator.counter = 0;
  await assert.rejects(
    () => authenticate(f, enrolled.authenticator),
    (error) => error.publicMessage === 'ACCESS COULD NOT BE VERIFIED',
  );
  assert.equal(f.store.auditEvents.filter((event) => event.type === 'signature-counter-anomaly').length, 0);
});

test('expired and reused challenges fail closed', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const expired = await f.service.authenticationOptions({ network: '192.0.2.4' });
  const response = enrolled.authenticator.authentication(expired.options, f.holder.webauthnUserId);
  f.advance(5 * 60_000 + 1);
  await assert.rejects(() => f.service.authenticationVerify({ preauthToken: expired.binding.token, payload: { ceremonyId: expired.ceremonyId, credential: response }, network: '192.0.2.4' }), /authentication_failed/);

  const start = await f.service.authenticationOptions({ network: '192.0.2.5' });
  const once = enrolled.authenticator.authentication(start.options, f.holder.webauthnUserId);
  await f.service.authenticationVerify({ preauthToken: start.binding.token, payload: { ceremonyId: start.ceremonyId, credential: once }, network: '192.0.2.5' });
  await assert.rejects(() => f.service.authenticationVerify({ preauthToken: start.binding.token, payload: { ceremonyId: start.ceremonyId, credential: once }, network: '192.0.2.5' }), /authentication_failed/);
});

test('invalid challenge, origin, RP ID, signature, and missing UV are generic failures', async () => {
  for (const overrides of [
    { challenge: 'wrong' },
    { origin: 'https://evil.example' },
    { rpID: 'probnaya.work', origin: config.origin },
    { invalidSignature: true },
    { flags: 0x01 },
  ]) {
    const f = fixture();
    const enrolled = await enroll(f);
    const start = await f.service.authenticationOptions({ network: '198.51.100.1' });
    const response = enrolled.authenticator.authentication(start.options, f.holder.webauthnUserId, overrides);
    await assert.rejects(
      () => f.service.authenticationVerify({ preauthToken: start.binding.token, payload: { ceremonyId: start.ceremonyId, credential: response }, network: '198.51.100.1' }),
      (error) => error.publicMessage === 'ACCESS COULD NOT BE VERIFIED',
    );
  }
});

test('unknown credentials, wrong owner, and malformed payloads are rejected', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const unknown = new VirtualAuthenticator();
  const start = await f.service.authenticationOptions({ network: '198.51.100.2' });
  await assert.rejects(() => f.service.authenticationVerify({ preauthToken: start.binding.token, payload: { ceremonyId: start.ceremonyId, credential: unknown.authentication(start.options, f.holder.webauthnUserId) }, network: '198.51.100.2' }), /authentication_failed/);
  await assert.rejects(() => f.service.authenticationVerify({ preauthToken: 'not-valid', payload: { ceremonyId: 'x', credential: {} }, network: '198.51.100.2' }));

  const auth = await authenticate(f, enrolled.authenticator);
  const secondHolder = { id: randomUUID(), publicId: 'PROB–H–OTHER', webauthnUserId: Buffer.alloc(32, 8).toString('base64url'), condition: 'active', createdAt: f.now(), updatedAt: f.now() };
  f.store.holders.set(secondHolder.id, secondHolder);
  const original = await f.store.findCredential(enrolled.authenticator.credentialId.toString('base64url'));
  original.holderId = secondHolder.id;
  f.store.credentials.set(original.credentialId, original);
  const presence = await f.service.presenceOptions({ sessionToken: auth.token, csrf: auth.csrf, network: '198.51.100.2' });
  await assert.rejects(() => f.service.presenceVerify({ sessionToken: auth.token, csrf: auth.csrf, payload: { ceremonyId: presence.ceremonyId, credential: enrolled.authenticator.authentication(presence.options, secondHolder.webauthnUserId) }, network: '198.51.100.2' }), /presence_failed/);
});

test('credential enrollment and revocation require session, CSRF, and recent presence', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  await assert.rejects(() => f.service.addKeyOptions({ payload: { label: 'NEW KEY' } }), /unauthorized/);
  await assert.rejects(() => f.service.revokeKey({ payload: { credentialRef: 'abc' }, network: '203.0.113.1' }), /unauthorized/);
  await assert.rejects(() => f.service.replaceRecoveryCodes({ sessionToken: enrolled.token, network: '203.0.113.1' }), /forbidden/);
  await assert.rejects(() => f.service.addKeyOptions({ sessionToken: enrolled.token, csrf: 'wrong', payload: { label: 'NEW KEY' } }), /forbidden/);
  f.advance(5 * 60_000 + 1);
  await assert.rejects(() => f.service.addKeyOptions({ sessionToken: enrolled.token, csrf: enrolled.csrf, payload: { label: 'NEW KEY' } }), /forbidden/);
});

test('fresh presence permits another key and owner-scoped revocation invalidates sessions', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  let auth = await verifyPresence(f, enrolled, enrolled.authenticator);
  const another = new VirtualAuthenticator();
  const start = await f.service.addKeyOptions({ sessionToken: auth.token, csrf: auth.csrf, payload: { label: 'SECURITY KEY' } });
  const added = await f.service.addKeyVerify({ sessionToken: auth.token, csrf: auth.csrf, payload: { ceremonyId: start.ceremonyId, label: 'SECURITY KEY', credential: await another.registration(start.options) }, network: '203.0.113.2' });
  const record = await f.service.status(added.token);
  assert.equal(record.record.credentials.length, 2);
  const target = record.record.credentials[1];
  auth = await verifyPresence(f, { token: record.token, csrf: record.csrf }, enrolled.authenticator);
  const revoked = await f.service.revokeKey({ sessionToken: auth.token, csrf: auth.csrf, payload: { credentialRef: target.ref }, network: '203.0.113.2' });
  assert.equal(revoked.sessionInvalidated, true);
  await assert.rejects(() => f.service.status(auth.token), /unauthorized/);
});

test('recovery codes are single-use and attempts are rate-limited', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const code = enrolled.recoveryCodes[0];
  const recovered = await f.service.recoveryBegin({ payload: { code }, network: '203.0.113.3' });
  assert.ok(recovered.token);
  await assert.rejects(() => f.service.recoveryBegin({ payload: { code }, network: '203.0.113.4' }), /recovery_failed/);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => f.service.recoveryBegin({ payload: { code: `0000-0000-0000-0000-0000-0000-0000-000${attempt}` }, network: '203.0.113.5' }));
  }
  await assert.rejects(
    () => f.service.recoveryBegin({ payload: { code: '0000-0000-0000-0000-0000-0000-0000-9999' }, network: '203.0.113.5' }),
    (error) => error.status === 429,
  );
});

test('recovery creates only a replacement ceremony, rotates codes, and invalidates sessions', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const recovered = await f.service.recoveryBegin({ payload: { code: enrolled.recoveryCodes[0] }, network: '203.0.113.6' });
  const replacement = new VirtualAuthenticator();
  const start = await f.service.recoveryRegistrationOptions({ recoveryToken: recovered.token, csrf: recovered.csrf, payload: { label: 'RECOVERY KEY' } });
  const completed = await f.service.recoveryRegistrationVerify({ recoveryToken: recovered.token, csrf: recovered.csrf, payload: { ceremonyId: start.ceremonyId, label: 'RECOVERY KEY', credential: await replacement.registration(start.options) }, network: '203.0.113.6' });
  assert.equal(completed.recoveryCodes.length, 10);
  await assert.rejects(() => f.service.status(enrolled.token), /unauthorized/);
  await assert.rejects(() => f.service.recoveryRegistrationOptions({ recoveryToken: recovered.token, csrf: recovered.csrf, payload: { label: 'AGAIN' } }), /unauthorized/);
});

test('replacing recovery codes invalidates an outstanding recovery session', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const pending = await f.service.recoveryBegin({ payload: { code: enrolled.recoveryCodes[0] }, network: '203.0.113.8' });
  const replacement = await f.service.replaceRecoveryCodes({ sessionToken: enrolled.token, csrf: enrolled.csrf, network: '203.0.113.9' });
  assert.equal(replacement.recoveryCodes.length, 10);
  await assert.rejects(
    () => f.service.recoveryRegistrationOptions({ recoveryToken: pending.token, csrf: pending.csrf, payload: { label: 'STALE RECOVERY' } }),
    /unauthorized/,
  );
});

test('an issued recovery set never permits revocation of the last credential', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const record = await f.service.status(enrolled.token);
  assert.equal(record.record.recovery, 'CODES ACTIVE');
  const present = await verifyPresence(f, { token: record.token, csrf: record.csrf }, enrolled.authenticator);
  await assert.rejects(
    () => f.service.revokeKey({ sessionToken: present.token, csrf: present.csrf, payload: { credentialRef: record.record.credentials[0].ref }, network: '203.0.113.7' }),
    (error) => error.status === 403,
  );
});

test('session rotates after renewal, old token is invalid, and presence expires', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  f.advance(15 * 60_000);
  const rotated = await f.service.status(enrolled.token);
  assert.equal(rotated.rotated, true);
  assert.notEqual(rotated.token, enrolled.token);
  await assert.rejects(() => f.service.status(enrolled.token), /unauthorized/);
  f.advance(5 * 60_000 + 1);
  await assert.rejects(() => f.service.addKeyOptions({ sessionToken: rotated.token, csrf: rotated.csrf, payload: { label: 'TOO LATE' } }), /forbidden/);
});

test('server-side invalidation makes a previously valid session unusable', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  await f.store.revokeHolderSessions(f.holder.id, f.now());
  await assert.rejects(() => f.service.status(enrolled.token), /unauthorized/);
});

test('logout revokes the server session before reporting closure', async () => {
  const f = fixture();
  const enrolled = await enroll(f);
  const result = await f.service.logout(enrolled.token, enrolled.csrf, '192.0.2.99');
  assert.deepEqual(result, { closed: true });
  await assert.rejects(() => f.service.status(enrolled.token), /unauthorized/);
});
