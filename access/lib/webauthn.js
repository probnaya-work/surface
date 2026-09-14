import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { RP_NAME } from './constants.js';

export function createWebAuthn(config) {
  return Object.freeze({
    async registrationOptions({ holder, credentials }) {
      return generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: config.rpID,
        userID: Buffer.from(holder.webauthnUserId, 'base64url'),
        userName: holder.publicId,
        userDisplayName: holder.publicId,
        attestationType: 'none',
        timeout: 60_000,
        excludeCredentials: credentials.map((credential) => ({
          id: credential.credentialId,
          transports: credential.transports,
        })),
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
      });
    },

    async authenticationOptions({ credentials } = {}) {
      return generateAuthenticationOptions({
        rpID: config.rpID,
        timeout: 60_000,
        userVerification: 'required',
        ...(credentials ? {
          allowCredentials: credentials.map((credential) => ({
            id: credential.credentialId,
            transports: credential.transports,
          })),
        } : {}),
      });
    },

    verifyRegistration({ response, challenge }) {
      return verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserPresence: true,
        requireUserVerification: true,
      });
    },

    verifyAuthentication({ response, challenge, credential }) {
      return verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: Number(credential.counter),
          transports: credential.transports,
        },
        requireUserVerification: true,
      });
    },
  });
}
