'use strict';

// Injected by tests to avoid loading nodemailer or making real SMTP calls.
let _testMailer = null;

const RECIPIENT = 'mail@probnaya.work';
const MAX_FROM = 200;
const MAX_BODY = 4000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const data = req.body;

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

  const { from, body, channel } = result;
  const id = 'Q-' + randomId();

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpUser || !smtpPass || !smtpFrom) {
    res.status(500).json({ error: 'Submission unavailable' });
    return;
  }

  const subject = `INTAKE / CHANNEL ${channel} — ${from}`;
  const text = [
    `CHANNEL: ${channel}`,
    `FROM: ${from}`,
    '',
    body,
    '',
    '---',
    `Received: ${new Date().toUTCString()}`,
    `ID: ${id}`,
  ].join('\n');

  try {
    const mailer = _testMailer || require('nodemailer');
    const transporter = mailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({ from: smtpFrom, to: RECIPIENT, subject, text });
  } catch {
    res.status(500).json({ error: 'Submission unavailable' });
    return;
  }

  res.status(200).json({ ok: true, id });
};

// Named exports for tests.
module.exports._setMailer = (mock) => { _testMailer = mock; };
module.exports.validate = validate;

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Invalid request' };
  }

  const from = typeof data.from === 'string' ? data.from.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const channel = typeof data.channel === 'string'
    ? data.channel.trim().toUpperCase()
    : '';

  if (!from) return { ok: false, error: 'From is required' };
  if (from.length > MAX_FROM) return { ok: false, error: 'From is too long' };
  if (!body) return { ok: false, error: 'Body is required' };
  if (body.length > MAX_BODY) return { ok: false, error: 'Body is too long' };
  if (channel !== 'A' && channel !== 'B') return { ok: false, error: 'Invalid channel' };

  return {
    ok: true,
    // Strip CR/LF from header-interpolated field (subject line injection defence).
    from: from.replace(/[\r\n]/g, ' '),
    // Normalise line endings in body.
    body: body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    channel,
  };
}

function randomId() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
