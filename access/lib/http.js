import { BODY_LIMIT_BYTES } from './constants.js';
import { AccessError, badRequest } from './errors.js';

export const API_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

export function requireExactOrigin(req, expectedOrigin) {
  const origin = req.headers?.origin;
  if (origin !== expectedOrigin) throw new AccessError(403, 'invalid_origin', 'REQUEST NOT AUTHORIZED');
}

export function requireJSON(req) {
  const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new AccessError(415, 'invalid_content_type', 'REQUEST COULD NOT BE PROCESSED');
}

export async function readJSON(req) {
  requireJSON(req);
  if (req.body !== undefined) {
    const serialized = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(serialized) > BODY_LIMIT_BYTES) throw new AccessError(413, 'body_too_large', 'REQUEST COULD NOT BE PROCESSED');
    try {
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      throw badRequest();
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) throw new AccessError(413, 'body_too_large', 'REQUEST COULD NOT BE PROCESSED');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest();
  }
}

export function parseCookies(header = '') {
  const result = Object.create(null);
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !(name in result)) result[name] = value;
  }
  return result;
}

export function cookie(name, value, { production, maxAge } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (production) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

export function expireCookie(name, production) {
  return cookie(name, '', { production, maxAge: 0 });
}

export function clientNetwork(req) {
  const value = req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return String(value).split(',')[0].trim().slice(0, 128);
}

export function sendJSON(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  for (const [name, value] of Object.entries({ ...API_HEADERS, ...extraHeaders })) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

export function sendError(res, error) {
  const recognized = error instanceof AccessError;
  const status = recognized ? error.status : 500;
  const headers = recognized && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
  sendJSON(res, status, {
    ok: false,
    error: recognized ? error.publicMessage : 'ACCESS SERVICE UNAVAILABLE',
  }, headers);
}
