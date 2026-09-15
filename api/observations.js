'use strict';

// POST /api/observations — receives one Observation and delivers it, as one plain
// text message, to the PROBNAYA mailbox. That message is the editorial queue.
//
// Nothing is stored here: no database, no file store, no copy. Submission is not
// publication; publication is a manual edit to observations.html (docs/observations.md).
//
// The whole request must stay under the Vercel Function body limit (4.5 MB). The
// browser prepares oversized images first (js/observation-attachment.js); this
// handler enforces the limits regardless of what the browser did.

const { randomBytes } = require('node:crypto');

const RECIPIENT = 'mail@probnaya.work';
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;

const MAX_REQUEST_BYTES = 4_400_000;
const MAX_ATTACHMENT_BYTES = 3_100_000;
const MAX_ATTACHMENT_BASE64 = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const MAX_MATERIAL = 40_000;
const MAX_NAME = 120;
const MAX_CONTEXT = 160;
const MAX_EMAIL = 200;
const MAX_FILENAME = 100;

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Injected by tests: no real SMTP, no real logs, no real outbox output.
let _testMailer = null;
let _log = (line) => console.log(line);
let _output = process.stdout;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return refuse(res, 405, 'method_not_allowed');
  }
  if (!isJsonRequest(req)) return refuse(res, 415, 'unsupported_media_type');
  if (declaredLength(req) > MAX_REQUEST_BYTES) return refuse(res, 413, 'payload_too_large');

  let data;
  try {
    data = req.body;
  } catch {
    return refuse(res, 400, 'malformed_json');
  }
  if (!isPlainObject(data)) return refuse(res, 400, 'invalid_request');
  if (bodyBytes(data) > MAX_REQUEST_BYTES) return refuse(res, 413, 'payload_too_large');

  // Honeypot: accept silently, deliver nothing, record nothing.
  if (typeof data.website === 'string' && data.website.trim() !== '') {
    res.status(200).json({ ok: true });
    return;
  }

  const input = validate(data);
  if (!input.ok) return refuse(res, input.status, input.code, input.field);

  const config = readConfig();
  if (!config) return unavailable(res, 'configuration_unavailable');

  const message = buildMessage(input.value, {
    reference: createReference(),
    receivedAt: new Date(),
    from: config.from,
  });

  try {
    if (config.outbox) writeOutbox(message);
    else await deliver(config, message);
  } catch (error) {
    return unavailable(res, 'delivery_failed', error);
  }

  res.status(200).json({ ok: true });
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(data) {
  if (!isPlainObject(data)) return invalid(400, 'invalid_request');

  for (const key of ['material', 'name', 'context', 'email']) {
    if (data[key] !== undefined && data[key] !== null && typeof data[key] !== 'string') {
      return invalid(400, 'invalid_request', key);
    }
  }

  const material = normaliseText(data.material || '').trim();
  if (!material) return invalid(400, 'material_required', 'material');
  if (material.length > MAX_MATERIAL) return invalid(400, 'material_too_long', 'material');

  const name = singleLine(data.name);
  if (name.length > MAX_NAME) return invalid(400, 'name_too_long', 'name');

  const context = singleLine(data.context);
  if (context.length > MAX_CONTEXT) return invalid(400, 'context_too_long', 'context');

  const email = singleLine(data.email);
  if (!email) return invalid(400, 'email_required', 'email');
  if (email.length > MAX_EMAIL) return invalid(400, 'email_too_long', 'email');
  if (!isEmail(email)) return invalid(400, 'email_invalid', 'email');

  let attachment = null;
  if (data.attachment !== undefined && data.attachment !== null) {
    const parsed = parseAttachment(data.attachment);
    if (!parsed.ok) return parsed;
    attachment = parsed.value;
  }

  return { ok: true, value: { material, name, context, email, attachment } };
}

function parseAttachment(raw) {
  if (!isPlainObject(raw)) return invalid(400, 'invalid_attachment', 'attachment');
  const { data } = raw;
  if (typeof data !== 'string' || data.length === 0) return invalid(400, 'invalid_attachment', 'attachment');
  if (data.length > MAX_ATTACHMENT_BASE64) return invalid(413, 'attachment_too_large', 'attachment');
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return invalid(400, 'invalid_attachment', 'attachment');

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) return invalid(400, 'invalid_attachment', 'attachment');
  if (bytes.length > MAX_ATTACHMENT_BYTES) return invalid(413, 'attachment_too_large', 'attachment');

  // The declared name and any declared type are never trusted for the content type.
  const type = detectType(bytes);
  if (!type) return invalid(415, 'unsupported_attachment', 'attachment');

  const originalBytes = Number.isSafeInteger(raw.originalBytes) && raw.originalBytes > 0 ? raw.originalBytes : null;

  return {
    ok: true,
    value: {
      bytes,
      type,
      filename: safeFilename(raw.name, type.ext),
      prepared: raw.prepared === true,
      originalBytes,
    },
  };
}

// Content signatures. Returns { mime, ext } or null.
function detectType(bytes) {
  const startsWith = (signature, offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((value, i) => bytes[offset + i] === value);
  const ascii = (from, to) => (bytes.length >= to ? bytes.toString('latin1', from, to) : '');

  if (startsWith([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis)$/.test(brand)) return { mime: 'image/heic', ext: 'heic' };
    if (/^(mif1|msf1)$/.test(brand)) return { mime: 'image/heif', ext: 'heif' };
  }
  if (ascii(0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (isPlainText(bytes)) return { mime: 'text/plain; charset=utf-8', ext: 'txt' };
  return null;
}

function isPlainText(bytes) {
  if (bytes.includes(0)) return false;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return !/[\x01-\x08\x0E-\x1F\x7F]/.test(text);
}

function safeFilename(name, ext) {
  const raw = typeof name === 'string' ? name : '';
  const basename = raw.split(/[\\/]/).pop() || '';
  const stem = basename
    .replace(/\.[^.]*$/, '')
    .replace(/[\x00-\x1F\x7F"<>:|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_FILENAME - ext.length - 1);
  return `${stem || 'attachment'}.${ext}`;
}

function normaliseText(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function singleLine(value) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function isEmail(value) {
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(value);
}

function invalid(status, code, field) {
  return { ok: false, status, code, field };
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

function buildMessage(value, { reference, receivedAt, from }) {
  const { material, name, context, email, attachment } = value;
  const file = attachment
    ? `${attachment.filename} · ${attachment.type.mime.split(';')[0]} · ${megabytes(attachment.bytes.length)}` +
      (attachment.prepared ? ` · prepared in the browser${attachment.originalBytes ? ` from ${megabytes(attachment.originalBytes)}` : ''}` : ' · as chosen')
    : 'none';

  const text = [
    'OBSERVATION RECEIVED',
    '',
    `REFERENCE  ${reference}`,
    `RECEIVED   ${receivedAt.toISOString()}`,
    `FROM       ${name || 'UNSIGNED'}`,
    `CONTEXT    ${context || '—'}`,
    `EMAIL      ${email}  (private: never published)`,
    `FILE       ${file}`,
    '',
    '--- MATERIAL, AS SENT ---',
    material,
    '--- END ---',
    '',
    'Submission is not publication. Review, keep, or decline in this mailbox;',
    'publish only by following docs/observations.md. Never copy the email',
    'address, reference, or received time into the repository.',
  ].join('\n');

  const message = {
    from,
    to: RECIPIENT,
    replyTo: { name: '', address: email },
    subject: `OBSERVATION / RECEIVED ${reference}`,
    text,
  };
  if (attachment) {
    message.attachments = [{
      filename: attachment.filename,
      content: attachment.bytes,
      contentType: attachment.type.mime,
    }];
  }
  return message;
}

function megabytes(bytes) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function createReference() {
  const bytes = randomBytes(6);
  let out = '';
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `O–${out}`;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function readConfig() {
  // Local development only: print the message instead of sending it. Refused on Vercel.
  if (process.env.OBSERVATIONS_DEV_OUTBOX === '1' && !process.env.VERCEL) {
    return { outbox: true, from: 'observations@localhost' };
  }
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  if (!user || !pass || !from) return null;
  return { outbox: false, user, pass, from };
}

async function deliver(config, message) {
  const mailer = _testMailer || require('nodemailer');
  const transporter = mailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  await transporter.sendMail(message);
}

function writeOutbox(message) {
  const file = message.attachments ? message.attachments[0] : null;
  _output.write([
    '',
    `[local observations outbox] ${message.subject}`,
    `to ${message.to} · reply-to ${message.replyTo.address}`,
    file ? `attachment ${file.filename} · ${file.contentType} · ${file.content.length} bytes` : 'attachment none',
    message.text,
    '',
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// Responses and logging. Log lines carry codes only: never material, names,
// context, addresses, file names, or error messages.
// ---------------------------------------------------------------------------

const MESSAGES = {
  method_not_allowed: 'Method not allowed',
  unsupported_media_type: 'Send JSON',
  payload_too_large: 'Request is too large',
  malformed_json: 'Malformed JSON',
  invalid_request: 'Invalid request',
  material_required: 'Material is required',
  material_too_long: 'Material is too long',
  name_too_long: 'Name is too long',
  context_too_long: 'Context is too long',
  email_required: 'Email is required',
  email_too_long: 'Email is too long',
  email_invalid: 'Email is not valid',
  invalid_attachment: 'Attachment is not valid',
  attachment_too_large: 'Attachment is too large',
  unsupported_attachment: 'Attachment type is not accepted',
};

function refuse(res, status, code, field) {
  log({ outcome: 'refused', status, code });
  const body = { error: MESSAGES[code] || 'Refused', code };
  if (field) body.field = field;
  res.status(status).json(body);
}

function unavailable(res, code, error) {
  const detail = error && typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : undefined;
  log({ outcome: 'error', status: 503, code, ...(detail ? { detail } : {}) });
  res.status(503).json({ error: 'Sending is unavailable', code: 'submission_unavailable' });
}

function log(fields) {
  _log(JSON.stringify({ event: 'observations.request', ...fields }));
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function isJsonRequest(req) {
  const header = req.headers && (req.headers['content-type'] || req.headers['Content-Type']);
  return typeof header === 'string' && /^application\/json\b/i.test(header.trim());
}

function declaredLength(req) {
  const raw = req.headers && (req.headers['content-length'] ?? req.headers['Content-Length']);
  const length = Number(raw);
  return raw !== undefined && Number.isFinite(length) ? length : 0;
}

function bodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return Infinity;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Test seams and pure functions
// ---------------------------------------------------------------------------

module.exports._setMailer = (mock) => { _testMailer = mock; };
module.exports._setLog = (fn) => { _log = fn; };
module.exports._setOutput = (stream) => { _output = stream; };
module.exports.validate = validate;
module.exports.detectType = detectType;
module.exports.safeFilename = safeFilename;
module.exports.buildMessage = buildMessage;
module.exports.createReference = createReference;
module.exports.limits = Object.freeze({
  MAX_REQUEST_BYTES, MAX_ATTACHMENT_BYTES, MAX_MATERIAL, MAX_NAME, MAX_CONTEXT, MAX_EMAIL, MAX_FILENAME,
});
module.exports.RECIPIENT = RECIPIENT;
