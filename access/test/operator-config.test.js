import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCTION_ORIGIN } from '../lib/constants.js';
import { loadOperatorConfig, requireOperatorRole } from '../lib/operator-config.js';

const verified = 'postgres://access_operator:unused@db.example.test:5432/neondb?sslmode=verify-full';

test('production operator config needs only ACCESS_ENV and a certificate-verified DATABASE_URL', () => {
  const config = loadOperatorConfig({ ACCESS_ENV: 'production', DATABASE_URL: verified });
  assert.deepEqual({ ...config }, { profile: 'production', production: true, origin: PRODUCTION_ORIGIN, databaseURL: verified });
  assert.equal('sessionHashKey' in config || 'recoveryHashKey' in config || 'networkHashKey' in config, false, 'no runtime secrets are loaded');
});

test('production operator config refuses unverified transport, libpq-only parameters, memory, and origin overrides', () => {
  for (const url of [
    'postgres://access_operator:unused@db.example.test/neondb',
    'postgres://access_operator:unused@db.example.test/neondb?sslmode=require',
    'postgres://access_operator:unused@db.example.test/neondb?sslmode=verify-full&channel_binding=require',
  ]) {
    assert.throws(() => loadOperatorConfig({ ACCESS_ENV: 'production', DATABASE_URL: url }), /DATABASE_URL/, url);
  }
  assert.throws(() => loadOperatorConfig({ ACCESS_ENV: 'production' }), /DATABASE_URL is required/);
  assert.throws(() => loadOperatorConfig({ ACCESS_ENV: 'production', DATABASE_URL: verified, ACCESS_USE_MEMORY_STORE: 'true' }), /PostgreSQL/);
  assert.throws(() => loadOperatorConfig({ ACCESS_ENV: 'production', DATABASE_URL: verified, ACCESS_LOCAL_ORIGIN: 'http://localhost:4174' }), /fixed Access origin/);
  assert.throws(() => loadOperatorConfig({ DATABASE_URL: verified }), /ACCESS_ENV/);
  assert.throws(() => loadOperatorConfig({ ACCESS_ENV: 'test', DATABASE_URL: verified }), /ACCESS_ENV/);
});

test('development operator config needs an explicit localhost origin', () => {
  const config = loadOperatorConfig({ ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'http://localhost:4174', DATABASE_URL: 'postgres://review@127.0.0.1:55439/postgres' });
  assert.equal(config.origin, 'http://localhost:4174');
  assert.throws(() => loadOperatorConfig({ ACCESS_ENV: 'development', DATABASE_URL: 'postgres://x@127.0.0.1/db' }), /ACCESS_LOCAL_ORIGIN/);
  assert.throws(() => loadOperatorConfig({ ACCESS_ENV: 'development', ACCESS_LOCAL_ORIGIN: 'https://access.probnaya.work', DATABASE_URL: 'postgres://x@127.0.0.1/db' }), /ACCESS_LOCAL_ORIGIN/);
});

test('operator commands refuse access_runtime everywhere and require access_operator in production', () => {
  assert.throws(() => requireOperatorRole('access_runtime', { production: false }), /access_runtime/);
  assert.throws(() => requireOperatorRole('access_runtime', { production: true }), /access_runtime/);
  assert.throws(() => requireOperatorRole('neondb_owner', { production: true }), /must connect as access_operator/);
  assert.equal(requireOperatorRole('access_operator', { production: true }), 'access_operator');
  assert.equal(requireOperatorRole('review', { production: false }), 'review');
});
