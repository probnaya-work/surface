import { badRequest } from './errors.js';
import { TRANSPORTS } from './constants.js';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function exactObject(value, keys, required = keys) {
  if (!plainObject(value)) throw badRequest();
  const actual = Object.keys(value).sort();
  const allowed = [...keys].sort();
  if (actual.some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) {
    throw badRequest();
  }
  return value;
}

export function boundedString(value, { min = 1, max, pattern } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw badRequest();
  }
  return value;
}

export function credentialLabel(value) {
  const normalized = boundedString(value, { min: 1, max: 48 }).normalize('NFKC').trim();
  if (!normalized || normalized.length > 48 || /[\u0000-\u001F\u007F]/.test(normalized)) throw badRequest();
  return normalized;
}

// An address PROBNAYA can reply to, and nothing more. Deliberately narrower than
// RFC 5321: plain ASCII atext local parts and dotted hostname domains, so the value
// can never carry a second recipient, a display name, or a header break.
const REQUEST_EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function requestEmail(value) {
  if (typeof value !== 'string') throw badRequest('invalid_email', 'THIS ADDRESS COULD NOT BE USED. CHECK IT AND TRY AGAIN.');
  const address = value.trim();
  const [local = ''] = address.split('@', 1);
  if (address.length > 254 || local.length > 64 || !REQUEST_EMAIL.test(address)) {
    throw badRequest('invalid_email', 'THIS ADDRESS COULD NOT BE USED. CHECK IT AND TRY AGAIN.');
  }
  return address;
}

export function base64url(value, max = 4096) {
  return boundedString(value, { max, pattern: BASE64URL });
}

export function webauthnResponse(value, kind) {
  exactObject(value, ['id', 'rawId', 'response', 'type', 'clientExtensionResults', 'authenticatorAttachment'], ['id', 'rawId', 'response', 'type', 'clientExtensionResults']);
  base64url(value.id, 2048);
  base64url(value.rawId, 2048);
  if (value.id !== value.rawId || value.type !== 'public-key') throw badRequest();
  exactObject(value.clientExtensionResults, Object.keys(value.clientExtensionResults), []);
  if (kind === 'registration') {
    exactObject(value.response, ['clientDataJSON', 'attestationObject', 'transports', 'authenticatorData', 'publicKey', 'publicKeyAlgorithm'], ['clientDataJSON', 'attestationObject']);
    base64url(value.response.clientDataJSON, 16384);
    base64url(value.response.attestationObject, 65536);
    if (value.response.transports !== undefined && (!Array.isArray(value.response.transports) || value.response.transports.some((item) => !TRANSPORTS.has(item)))) throw badRequest();
  } else {
    exactObject(value.response, ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle'], ['clientDataJSON', 'authenticatorData', 'signature']);
    base64url(value.response.clientDataJSON, 16384);
    base64url(value.response.authenticatorData, 4096);
    base64url(value.response.signature, 16384);
    if (value.response.userHandle !== undefined && value.response.userHandle !== null) base64url(value.response.userHandle, 1024);
  }
  return value;
}
