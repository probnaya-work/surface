'use strict';

// Injected by tests to avoid loading nodemailer or making real SMTP calls.
let _testMailer = null;

const RECIPIENT = 'mail@probnaya.work';
const MAX_FROM = 200;
const MAX_REPLY = 200;
const MAX_BODY = 4000;
const MAX_TRIED = 2000;
const MAX_REQUEST_BYTES = 16 * 1024;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    if (typeof res.setHeader === 'function') res.setHeader('Allow', 'POST');
    res.status(405).end();
    return;
  }

  if (requestTooLarge(req, MAX_REQUEST_BYTES)) {
    res.status(413).json({ error: 'Request is too large' });
    return;
  }

  let data;
  try {
    data = req.body;
  } catch {
    res.status(400).json({ error: 'Malformed JSON' });
    return;
  }
  if (bodyTooLarge(data, MAX_REQUEST_BYTES)) {
    res.status(413).json({ error: 'Request is too large' });
    return;
  }

  // Honeypot: silently accept, do not deliver.
  if (data && data.__hp) {
    res.status(200).json({ ok: true, id: 'Q-' + randomId() });
    return;
  }

  const result = validate(data);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  const { from, reply, body, tried, channel } = result;
  const id = 'Q-' + randomId();

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpUser || !smtpPass || !smtpFrom) {
    res.status(500).json({ error: 'Submission unavailable' });
    return;
  }

  const subject = `INTAKE / CHANNEL ${channel} — ${from}`;
  const lines = [
    `CHANNEL: ${channel}`,
    `FROM: ${from}`,
    `REPLY: ${reply}`,
    '',
    body,
  ];
  if (tried) lines.push('', 'ALREADY TRIED:', tried);
  const text = lines.concat([
    '',
    '---',
    `Received: ${new Date().toUTCString()}`,
    `ID: ${id}`,
  ]).join('\n');

  try {
    const mailer = _testMailer || require('nodemailer');
    const transporter = mailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });
    const message = { from: smtpFrom, to: RECIPIENT, subject, text };
    // The field is deliberately open, so set Reply-To only when it is usable as one.
    // The address is recorded in the body either way.
    if (isEmailLike(reply)) message.replyTo = reply;
    await transporter.sendMail(message);
  } catch {
    res.status(500).json({ error: 'Submission unavailable' });
    return;
  }

  res.status(200).json({ ok: true, id });
};

// Named exports for tests.
module.exports._setMailer = (mock) => { _testMailer = mock; };
module.exports.validate = validate;
module.exports.isEmailLike = isEmailLike;

function requestTooLarge(req, limit) {
  const headers = req && req.headers;
  const raw = headers && (headers['content-length'] ?? headers['Content-Length']);
  if (raw === undefined) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > limit;
}

function bodyTooLarge(body, limit) {
  try {
    const json = JSON.stringify(body);
    return typeof json === 'string' && Buffer.byteLength(json, 'utf8') > limit;
  } catch {
    return true;
  }
}

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Invalid request' };
  }

  const from = typeof data.from === 'string' ? data.from.trim() : '';
  const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const tried = typeof data.tried === 'string' ? data.tried.trim() : '';
  const channel = typeof data.channel === 'string'
    ? data.channel.trim().toUpperCase()
    : '';

  if (!from) return { ok: false, error: 'From is required' };
  if (from.length > MAX_FROM) return { ok: false, error: 'From is too long' };
  if (!reply) return { ok: false, error: 'Reply address is required' };
  if (reply.length > MAX_REPLY) return { ok: false, error: 'Reply address is too long' };
  if (!body) return { ok: false, error: 'Body is required' };
  if (body.length > MAX_BODY) return { ok: false, error: 'Body is too long' };
  if (tried.length > MAX_TRIED) return { ok: false, error: 'Notes are too long' };
  if (channel !== 'A' && channel !== 'B') return { ok: false, error: 'Invalid channel' };

  return {
    ok: true,
    // Strip CR/LF from header-interpolated fields (header injection defence).
    from: from.replace(/[\r\n]/g, ' '),
    reply: reply.replace(/[\r\n]/g, ' '),
    // Normalise line endings in free text.
    body: body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    tried: tried.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    channel,
  };
}

function isEmailLike(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function randomId() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
