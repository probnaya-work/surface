import { createHmac } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { requestEmail } from './validation.js';

// Private contact lookups for Observation ownership (docs/observation-ownership.md).
//
// An address is never stored for matching. Only a keyed HMAC of its canonical form
// is stored, under a dedicated key that is not an Access runtime secret: every
// lookup is computed by an operator command, and the runtime only compares stored
// values. The same two functions below are used for the address an Observation was
// sent from and for the address an establishment link was sent to, so the two can
// only ever match when they were derived identically.

export const CONTACT_LOOKUP_DOMAIN = 'probnaya-access/observation-contact/v1:';
export const CONTACT_LOOKUP_PREFIX = 'hmac-sha256:contact-v1:';
export const CONTACT_LOOKUP_PATTERN = /^hmac-sha256:contact-v1:[A-Za-z0-9_-]{43}$/;

// Canonical form: surrounding space removed, Unicode NFC, the address checked
// with the same rules Access requests use, the domain converted to ASCII, and the
// whole address lower-cased. Provider-specific rewriting (dots, plus tags) is not
// applied: two addresses are one contact only when mail to one reaches the other
// by standard rules.
export function normalizeContactAddress(value) {
  if (typeof value !== 'string') throw new Error('The address could not be used');
  const trimmed = value.normalize('NFC').trim();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) throw new Error('The address could not be used');
  const domain = domainToASCII(trimmed.slice(at + 1).toLowerCase());
  if (!domain) throw new Error('The address could not be used');
  let address;
  try {
    address = requestEmail(`${trimmed.slice(0, at)}@${domain}`);
  } catch {
    throw new Error('The address could not be used');
  }
  return address.toLowerCase();
}

// The key must be random material of at least 32 bytes, encoded (for example
// `openssl rand -base64 32`), and must differ from every Access runtime key.
export function requireContactKey(value, env = {}) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || value.length < 43 || new Set(value).size < 10) {
    throw new Error('OBSERVATION_CONTACT_KEY must be at least 32 random bytes encoded as base64 or hex');
  }
  for (const name of ['SESSION_HASH_KEY', 'RECOVERY_HASH_KEY', 'NETWORK_HASH_KEY']) {
    if (env[name] && env[name] === value) throw new Error('OBSERVATION_CONTACT_KEY must differ from every Access runtime key');
  }
  return value;
}

export function contactLookup(key, address) {
  const digest = createHmac('sha256', requireContactKey(key))
    .update(`${CONTACT_LOOKUP_DOMAIN}${normalizeContactAddress(address)}`, 'utf8')
    .digest('base64url');
  return `${CONTACT_LOOKUP_PREFIX}${digest}`;
}
