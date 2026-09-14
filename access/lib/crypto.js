import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function keyedHash(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('base64url');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeCrockford(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += CROCKFORD[(value << (5 - bits)) & 31];
  return output;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const compact = encodeCrockford(randomBytes(20));
    return compact.match(/.{1,4}/g).join('-');
  });
}

export function normalizeRecoveryCode(value) {
  return String(value).toUpperCase().replace(/[\s-]/g, '').replace(/[O]/g, '0').replace(/[IL]/g, '1');
}
