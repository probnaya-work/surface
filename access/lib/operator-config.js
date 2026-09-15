import { PRODUCTION_ORIGIN } from './constants.js';
import { requireVerifiedDatabaseTransport } from './config.js';

// Configuration for operator commands (create-enrollment, holder-condition,
// prune-expired, holders). They act only through the database, so they need the
// profile, the Access origin for printed links, and a database URL. They never read
// runtime application secrets such as SESSION_HASH_KEY.
export function loadOperatorConfig(env = process.env) {
  const profile = env.ACCESS_ENV;
  if (profile !== 'production' && profile !== 'development') {
    throw new Error('ACCESS_ENV must be production or development for operator commands');
  }
  const production = profile === 'production';
  if (env.ACCESS_USE_MEMORY_STORE === 'true') throw new Error('Operator commands require PostgreSQL');

  let origin = PRODUCTION_ORIGIN;
  if (production) {
    if (env.ACCESS_LOCAL_ORIGIN) throw new Error('Production operator commands use the fixed Access origin');
  } else {
    origin = env.ACCESS_LOCAL_ORIGIN;
    if (typeof origin !== 'string' || !/^http:\/\/localhost:\d{2,5}$/.test(origin)) {
      throw new Error('Development operator commands need ACCESS_LOCAL_ORIGIN=http://localhost:<port>');
    }
  }

  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (production) requireVerifiedDatabaseTransport(env.DATABASE_URL);
  return Object.freeze({ profile, production, origin, databaseURL: env.DATABASE_URL });
}

// The runtime role must never act as an operator. In production, operator commands
// run only as access_operator, the role granted holder and grant creation.
export function requireOperatorRole(role, { production }) {
  if (role === 'access_runtime') throw new Error('Refusing to run an operator command as access_runtime');
  if (production && role !== 'access_operator') {
    throw new Error(`Production operator commands must connect as access_operator, not ${role}`);
  }
  return role;
}
