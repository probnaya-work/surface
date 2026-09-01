'use strict';

const RESEND_API = 'https://api.resend.com/emails';
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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Submission unavailable' });
    return;
  }

  const fromAddress = process.env.RESEND_FROM || 'PROBNAYA Intake <intake@probnaya.work>';

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
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress, to: [RECIPIENT], subject, text }),
    });

    if (!r.ok) {
      res.status(500).json({ error: 'Submission unavailable' });
      return;
    }
  } catch {
    res.status(500).json({ error: 'Submission unavailable' });
    return;
  }

  res.status(200).json({ ok: true, id });
};

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
    // Normalise line endings in body; CR alone is not meaningful here.
    body: body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    channel,
  };
}

function randomId() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Named export for tests.
module.exports.validate = validate;
