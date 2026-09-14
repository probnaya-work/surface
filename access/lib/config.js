import {
  PREAUTH_COOKIE_DEVELOPMENT,
  PREAUTH_COOKIE_PRODUCTION,
  PRODUCTION_ORIGIN,
  PRODUCTION_RP_ID,
  RECOVERY_COOKIE_DEVELOPMENT,
  RECOVERY_COOKIE_PRODUCTION,
  SESSION_COOKIE_DEVELOPMENT,
  SESSION_COOKIE_PRODUCTION,
} from './constants.js';

function requireSecret(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const profile = env.ACCESS_ENV;
  if (profile !== 'production' && profile !== 'development' && profile !== 'test') {
    throw new Error('ACCESS_ENV must be production, development, or test');
  }

  const production = profile === 'production';
  const memory = env.ACCESS_USE_MEMORY_STORE === 'true';
  if (production && memory) {
    throw new Error('The in-memory store is forbidden in production');
  }

  let origin = PRODUCTION_ORIGIN;
  let rpID = PRODUCTION_RP_ID;
  if (!production) {
    origin = env.ACCESS_LOCAL_ORIGIN;
    if (typeof origin !== 'string' || !/^http:\/\/localhost:\d{2,5}$/.test(origin)) {
      throw new Error('ACCESS_LOCAL_ORIGIN must be an explicit http://localhost:<port> origin');
    }
    rpID = 'localhost';
  }

  if (production && (env.WEBAUTHN_ORIGIN || env.WEBAUTHN_RP_ID)) {
    throw new Error('Production WebAuthn origin and RP ID are constants, not environment settings');
  }

  const sessionHashKey = requireSecret(env, 'SESSION_HASH_KEY');
  const recoveryHashKey = requireSecret(env, 'RECOVERY_HASH_KEY');
  const networkHashKey = requireSecret(env, 'NETWORK_HASH_KEY');
  if (new Set([sessionHashKey, recoveryHashKey, networkHashKey]).size !== 3) {
    throw new Error('Session, recovery, and network hash keys must be distinct');
  }

  if (!memory && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required unless the local test memory store is enabled');
  }

  return Object.freeze({
    profile,
    production,
    origin,
    rpID,
    sessionHashKey,
    recoveryHashKey,
    networkHashKey,
    databaseURL: env.DATABASE_URL,
    memory,
    cookies: Object.freeze({
      session: production ? SESSION_COOKIE_PRODUCTION : SESSION_COOKIE_DEVELOPMENT,
      preauth: production ? PREAUTH_COOKIE_PRODUCTION : PREAUTH_COOKIE_DEVELOPMENT,
      recovery: production ? RECOVERY_COOKIE_PRODUCTION : RECOVERY_COOKIE_DEVELOPMENT,
    }),
  });
}
