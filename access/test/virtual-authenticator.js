import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64 = (value) => Buffer.from(value).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest();

export class VirtualAuthenticator {
  constructor() {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: 'jwk' });
    this.coseKey = new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]);
    this.credentialId = hash(pair.publicKey.export({ type: 'spki', format: 'der' })).subarray(0, 24);
    this.counter = 0;
  }

  async registration(options, overrides = {}) {
    const rpID = overrides.rpID || options.rp.id;
    const origin = overrides.origin || `http://${rpID}:4174`;
    const challenge = overrides.challenge || options.challenge;
    const flags = overrides.flags ?? 0x45;
    const cose = Buffer.from(await isoCBOR.encode(this.coseKey));
    const credentialLength = Buffer.alloc(2);
    credentialLength.writeUInt16BE(this.credentialId.length);
    const counter = Buffer.alloc(4);
    const authData = Buffer.concat([
      hash(rpID),
      Buffer.from([flags]),
      counter,
      Buffer.alloc(16),
      credentialLength,
      this.credentialId,
      cose,
    ]);
    const attestationObject = await isoCBOR.encode(new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]));
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
    const id = b64(this.credentialId);
    return {
      id,
      rawId: id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
    };
  }

  authentication(options, userHandle, overrides = {}) {
    const rpID = overrides.rpID || options.rpId;
    const origin = overrides.origin || `http://${rpID}:4174`;
    const challenge = overrides.challenge || options.challenge;
    const flags = overrides.flags ?? 0x05;
    this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([hash(rpID), Buffer.from([flags]), counter]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
    const signature = overrides.invalidSignature
      ? Buffer.alloc(64, 7)
      : sign('sha256', Buffer.concat([authenticatorData, hash(clientDataJSON)]), this.privateKey);
    const id = b64(this.credentialId);
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authenticatorData),
        signature: b64(signature),
        userHandle,
      },
    };
  }
}
