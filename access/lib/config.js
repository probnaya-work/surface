import {
  PREAUTH_COOKIE_DEVELOPMENT,
  PREAUTH_COOKIE_PRODUCTION,
  PRODUCTION_ORIGIN,
  PRODUCTION_PUBLIC_ORIGIN,
  PRODUCTION_RP_ID,
  RECOVERY_COOKIE_DEVELOPMENT,
  RECOVERY_COOKIE_PRODUCTION,
  SESSION_COOKIE_DEVELOPMENT,
  SESSION_COOKIE_PRODUCTION,
} from './constants.js';

function requireSecret(env, name, production) {
  const value = env[name];
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  // Production keys must look like encoded random material (for example
  // `openssl rand -base64 32`), not a padded word or a repeated character.
  if (production && (value.length < 43 || new Set(value).size < 10)) {
    throw new Error(`${name} must be at least 32 random bytes encoded as base64 or hex`);
  }
  return value;
}

// postgres.js validates the server certificate and hostname only for
// `sslmode=verify-full`; `require`, `prefer`, and `allow` disable validation.
function requireVerifiedDatabaseTransport(databaseURL) {
  let url;
  try {
    url = new URL(databaseURL);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Production DATABASE_URL must use sslmode=verify-full');
  }
  // postgres.js forwards unrecognized query parameters to the server as startup
  // settings, so libpq-only options fail every connection at request time.
  for (const name of ['channel_binding', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'sslcrl']) {
    if (url.searchParams.has(name)) throw new Error(`Production DATABASE_URL must not include libpq-only parameter ${name}`);
  }
}

export function loadConfig(env = process.env) {
  const profile = env.ACCESS_ENV;
  if (profile !== 'production' && profile !== 'development' && profile !== 'test') {
    throw new Error('ACCESS_ENV must be production, development, or test');
  }

  const production = profile === 'production';

  // On Vercel, only the Production environment may run Access at all.
  // Preview and development deployments never authenticate.
  if (env.VERCEL) {
    if (!production) throw new Error('Only the production profile may run on Vercel');
    if (env.VERCEL_ENV !== 'production') throw new Error('Access runs only in the Vercel Production environment');
  }

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

  // The public site reads the relation cross-origin. Production fixes it; local
  // development may name one explicit localhost origin or leave the read closed.
  let publicOrigin = PRODUCTION_PUBLIC_ORIGIN;
  if (!production) {
    publicOrigin = env.ACCESS_PUBLIC_ORIGIN || null;
    if (publicOrigin !== null && (!/^http:\/\/localhost:\d{2,5}$/.test(publicOrigin) || publicOrigin === origin)) {
      throw new Error('ACCESS_PUBLIC_ORIGIN must be a different explicit http://localhost:<port> origin');
    }
  }

  if (production && (env.WEBAUTHN_ORIGIN || env.WEBAUTHN_RP_ID || env.ACCESS_LOCAL_ORIGIN || env.ACCESS_PUBLIC_ORIGIN)) {
    throw new Error('Production WebAuthn origin and RP ID are constants, not environment settings');
  }
  if (production && (env.ACCESS_DEV_ENROLLMENT_TOKEN || env.ACCESS_DEV_PUBLIC_ID)) {
    throw new Error('Development enrollment settings are forbidden in production');
  }

  const sessionHashKey = requireSecret(env, 'SESSION_HASH_KEY', production);
  const recoveryHashKey = requireSecret(env, 'RECOVERY_HASH_KEY', production);
  const networkHashKey = requireSecret(env, 'NETWORK_HASH_KEY', production);
  if (new Set([sessionHashKey, recoveryHashKey, networkHashKey]).size !== 3) {
    throw new Error('Session, recovery, and network hash keys must be distinct');
  }

  if (!memory && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required unless the local test memory store is enabled');
  }
  if (production) requireVerifiedDatabaseTransport(env.DATABASE_URL);

  return Object.freeze({
    profile,
    production,
    origin,
    publicOrigin,
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
