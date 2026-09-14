import assert from 'node:assert/strict';
import test from 'node:test';
import { requireHost } from '../api/access.js';
import { cookie, parseCookies, requireExactOrigin } from '../lib/http.js';

test('production session cookie is host-only, Secure, HttpOnly, and SameSite Strict', () => {
  const value = cookie('__Host-probnaya_session', 'opaque', { production: true });
  assert.match(value, /^__Host-probnaya_session=opaque; Path=\/;/);
  assert.match(value, /; Secure/);
  assert.match(value, /; HttpOnly/);
  assert.match(value, /; SameSite=Strict/);
  assert.doesNotMatch(value, /Domain=/i);
  assert.doesNotMatch(value, /Expires=/i);
});

test('origin validation is exact and rejects absent, parent, wildcard-like, and sibling origins', () => {
  const expected = 'https://access.probnaya.work';
  assert.doesNotThrow(() => requireExactOrigin({ headers: { origin: expected } }, expected));
  for (const origin of [undefined, 'https://probnaya.work', 'https://other.probnaya.work', 'https://access.probnaya.work.evil.example']) {
    assert.throws(() => requireExactOrigin({ headers: { origin } }, expected), (error) => error.status === 403);
  }
});

test('host validation is exact and rejects parent, wildcard-like, sibling, and port variants', () => {
  const config = { origin: 'https://access.probnaya.work' };
  assert.doesNotThrow(() => requireHost({ headers: { host: 'access.probnaya.work' } }, config));
  for (const host of [undefined, 'probnaya.work', '*.probnaya.work', 'other.probnaya.work', 'access.probnaya.work.evil.example', 'access.probnaya.work:443']) {
    assert.throws(() => requireHost({ headers: { host } }, config), (error) => error.status === 421);
  }
});

test('cookie parser does not let later duplicate names replace the first value', () => {
  const parsed = parseCookies('a=first; b=two; a=second');
  assert.equal(parsed.a, 'first');
  assert.equal(parsed.b, 'two');
});
