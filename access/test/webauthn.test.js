import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebAuthn } from '../lib/webauthn.js';
import { VirtualAuthenticator } from './virtual-authenticator.js';

const config = { origin: 'http://localhost:4174', rpID: 'localhost' };

test('real library verifies a UV registration and authentication', async () => {
  const webauthn = createWebAuthn(config);
  const authenticator = new VirtualAuthenticator();
  const holder = { publicId: 'PROB–H–TEST', webauthnUserId: Buffer.alloc(32, 3).toString('base64url') };
  const registrationOptions = await webauthn.registrationOptions({ holder, credentials: [] });
  assert.equal(registrationOptions.rp.id, 'localhost');
  assert.equal(registrationOptions.authenticatorSelection.residentKey, 'required');
  assert.equal(registrationOptions.authenticatorSelection.userVerification, 'required');
  assert.equal(registrationOptions.attestation, 'none');
  assert.ok(Buffer.from(registrationOptions.challenge, 'base64url').length >= 32);
  const registration = await webauthn.verifyRegistration({ response: await authenticator.registration(registrationOptions), challenge: registrationOptions.challenge });
  assert.equal(registration.verified, true);
  assert.equal(registration.registrationInfo.userVerified, true);

  const authenticationOptions = await webauthn.authenticationOptions();
  assert.equal(authenticationOptions.allowCredentials, undefined);
  assert.equal(authenticationOptions.userVerification, 'required');
  const response = authenticator.authentication(authenticationOptions, holder.webauthnUserId);
  const authentication = await webauthn.verifyAuthentication({
    response,
    challenge: authenticationOptions.challenge,
    credential: {
      credentialId: registration.registrationInfo.credential.id,
      publicKey: registration.registrationInfo.credential.publicKey,
      counter: 0,
      transports: ['internal'],
    },
  });
  assert.equal(authentication.verified, true);
  assert.equal(authentication.authenticationInfo.userVerified, true);
});

test('real verifier rejects invalid challenge, origin, RP ID, signature, and missing UV', async () => {
  const webauthn = createWebAuthn(config);
  const authenticator = new VirtualAuthenticator();
  const holder = { publicId: 'PROB–H–TEST', webauthnUserId: Buffer.alloc(32, 4).toString('base64url') };
  const regOptions = await webauthn.registrationOptions({ holder, credentials: [] });
  const reg = await webauthn.verifyRegistration({ response: await authenticator.registration(regOptions), challenge: regOptions.challenge });
  const stored = { credentialId: reg.registrationInfo.credential.id, publicKey: reg.registrationInfo.credential.publicKey, counter: 0, transports: ['internal'] };

  const challengeOptions = await webauthn.authenticationOptions();
  await assert.rejects(() => webauthn.verifyAuthentication({ response: authenticator.authentication(challengeOptions, holder.webauthnUserId, { challenge: 'wrong' }), challenge: challengeOptions.challenge, credential: stored }));
  const originOptions = await webauthn.authenticationOptions();
  await assert.rejects(() => webauthn.verifyAuthentication({ response: authenticator.authentication(originOptions, holder.webauthnUserId, { origin: 'https://evil.example' }), challenge: originOptions.challenge, credential: stored }));
  const rpOptions = await webauthn.authenticationOptions();
  await assert.rejects(() => webauthn.verifyAuthentication({ response: authenticator.authentication(rpOptions, holder.webauthnUserId, { rpID: 'probnaya.work', origin: config.origin }), challenge: rpOptions.challenge, credential: stored }));
  const signatureOptions = await webauthn.authenticationOptions();
  await assert.rejects(() => webauthn.verifyAuthentication({ response: authenticator.authentication(signatureOptions, holder.webauthnUserId, { invalidSignature: true }), challenge: signatureOptions.challenge, credential: stored }));
  const uvOptions = await webauthn.authenticationOptions();
  await assert.rejects(() => webauthn.verifyAuthentication({ response: authenticator.authentication(uvOptions, holder.webauthnUserId, { flags: 0x01 }), challenge: uvOptions.challenge, credential: stored }));
});
