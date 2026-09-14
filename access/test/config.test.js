import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { loadConfig } from '../lib/config.js';
import { PRODUCTION_ORIGIN, PRODUCTION_RP_ID } from '../lib/constants.js';

const secrets = {
  SESSION_HASH_KEY: randomBytes(32).toString('base64'),
  RECOVERY_HASH_KEY: randomBytes(32).toString('base64'),
  NETWORK_HASH_KEY: randomBytes(32).toString('hex'),
  DATABASE_URL: 'postgres://access:unused@db.example.test:5432/access?sslmode=verify-full',
};
const production = { ...secrets, ACCESS_ENV: 'production' };

test('production origin and RP ID are fixed exact constants', () => {
  const config = loadConfig(production);
  assert.equal(config.origin, PRODUCTION_ORIGIN);
  assert.equal(config.rpID, PRODUCTION_RP_ID);
  assert.equal(config.cookies.session, '__Host-probnaya_session');
  assert.equal(config.cookies.recovery, '__Host-probnaya_recovery');
  assert.equal(config.cookies.preauth, '__Host-probnaya_preauth');
});

test('production rejects wildcard, alternate, parent, and localhost origin or RP overrides', () => {
  for (const override of [
    { WEBAUTHN_ORIGIN: 'https://*.probnaya.work' },
    { WEBAUTHN_RP_ID: 'probnaya.work' },
    { WEBAUTHN_ORIGIN: PRODUCTION_ORIGIN },
    { ACCESS_LOCAL_ORIGIN: 'http://localhost:4174' },
    { ACCESS_USE_MEMORY_STORE: 'true' },
    { ACCESS_DEV_ENROLLMENT_TOKEN: 'LOCAL-DEVELOPMENT-ENROLLMENT-TOKEN-0001' },
  ]) {
    assert.throws(() => loadConfig({ ...production, ...override }), undefined, JSON.stringify(override));
  }
});

test('development accepts only an explicit localhost origin and fixed localhost RP ID', () => {
  const config = loadConfig({ ...secrets, ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', ACCESS_USE_MEMORY_STORE: 'true' });
  assert.equal(config.origin, 'http://localhost:4174');
  assert.equal(config.rpID, 'localhost');
  for (const origin of ['https://preview.vercel.app', 'http://127.0.0.1:4174', 'http://localhost', 'https://localhost:4174']) {
    assert.throws(() => loadConfig({ ...secrets, ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: origin, ACCESS_USE_MEMORY_STORE: 'true' }), undefined, origin);
  }
});

test('cryptographic purposes require distinct keys with production-grade entropy', () => {
  assert.throws(() => loadConfig({ ...production, RECOVERY_HASH_KEY: secrets.SESSION_HASH_KEY }), /distinct/);
  assert.throws(() => loadConfig({ ...production, NETWORK_HASH_KEY: 'n'.repeat(64) }), /random bytes/);
  assert.throws(() => loadConfig({ ...production, SESSION_HASH_KEY: 'session-key-'.padEnd(48, 's') }), /random bytes/);
  assert.throws(() => loadConfig({ ...production, SESSION_HASH_KEY: randomBytes(16).toString('base64') }), /32 bytes/);
  assert.throws(() => loadConfig({ ...production, SESSION_HASH_KEY: undefined }), /SESSION_HASH_KEY/);
});

test('production database transport must verify the server certificate', () => {
  for (const url of [
    'postgres://access:unused@db.example.test/access',
    'postgres://access:unused@db.example.test/access?sslmode=require',
    'postgres://access:unused@db.example.test/access?sslmode=prefer',
    'postgres://access:unused@db.example.test/access?sslmode=disable',
    'postgres://access:unused@db.example.test/access?sslmode=verify-ca',
    'mysql://access:unused@db.example.test/access?sslmode=verify-full',
    'postgres://access:unused@db.example.test/access?sslmode=verify-full&channel_binding=require',
    'postgres://access:unused@db.example.test/access?sslmode=verify-full&sslrootcert=system',
    'not a url',
  ]) {
    assert.throws(() => loadConfig({ ...production, DATABASE_URL: url }), /DATABASE_URL/, url);
  }
  assert.throws(() => loadConfig({ ...production, DATABASE_URL: undefined }), /DATABASE_URL/);
});

test('on Vercel only the Production environment may run, and only with the production profile', () => {
  assert.doesNotThrow(() => loadConfig({ ...production, VERCEL: '1', VERCEL_ENV: 'production' }));
  assert.throws(() => loadConfig({ ...production, VERCEL: '1', VERCEL_ENV: 'preview' }), /Production environment/);
  assert.throws(() => loadConfig({ ...production, VERCEL: '1', VERCEL_ENV: 'development' }), /Production environment/);
  assert.throws(() => loadConfig({ ...production, VERCEL: '1' }), /Production environment/);
  assert.throws(
    () => loadConfig({ ...secrets, ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', ACCESS_USE_MEMORY_STORE: 'true', VERCEL: '1', VERCEL_ENV: 'preview' }),
    /production profile/,
  );
});
