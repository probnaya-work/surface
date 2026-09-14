import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../lib/config.js';
import { PRODUCTION_ORIGIN, PRODUCTION_RP_ID } from '../lib/constants.js';

const secrets = {
  SESSION_HASH_KEY: 's'.repeat(32),
  RECOVERY_HASH_KEY: 'r'.repeat(32),
  NETWORK_HASH_KEY: 'n'.repeat(32),
  DATABASE_URL: 'postgres://unused',
};

test('production origin and RP ID are fixed exact constants', () => {
  const config = loadConfig({ ...secrets, ACCESS_ENV: 'production' });
  assert.equal(config.origin, PRODUCTION_ORIGIN);
  assert.equal(config.rpID, PRODUCTION_RP_ID);
  assert.equal(config.cookies.session, '__Host-probnaya_session');
});

test('production rejects wildcard or alternate origin and RP overrides', () => {
  assert.throws(() => loadConfig({ ...secrets, ACCESS_ENV: 'production', WEBAUTHN_ORIGIN: 'https://*.probnaya.work' }));
  assert.throws(() => loadConfig({ ...secrets, ACCESS_ENV: 'production', WEBAUTHN_RP_ID: 'probnaya.work' }));
  assert.throws(() => loadConfig({ ...secrets, ACCESS_ENV: 'production', WEBAUTHN_ORIGIN: PRODUCTION_ORIGIN }));
  assert.throws(() => loadConfig({ ...secrets, ACCESS_ENV: 'production', ACCESS_USE_MEMORY_STORE: 'true' }));
});

test('development accepts only an explicit localhost origin and fixed localhost RP ID', () => {
  const config = loadConfig({ ...secrets, ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', ACCESS_USE_MEMORY_STORE: 'true' });
  assert.equal(config.origin, 'http://localhost:4174');
  assert.equal(config.rpID, 'localhost');
  assert.throws(() => loadConfig({ ...secrets, ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'https://preview.vercel.app', ACCESS_USE_MEMORY_STORE: 'true' }));
});

test('cryptographic purposes require distinct secrets', () => {
  assert.throws(() => loadConfig({ ...secrets, ACCESS_ENV: 'production', RECOVERY_HASH_KEY: secrets.SESSION_HASH_KEY }));
});
