'use strict';

const handler = require('./intake.js');
const { validate, isEmailLike } = handler;

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// SMTP mock helpers.
// No real SMTP calls are made. nodemailer is never required during tests
// because _setMailer replaces it before any handler call reaches require().
// ---------------------------------------------------------------------------

function makeMailer(sendMail) {
  return { createTransport: () => ({ sendMail }) };
}

function okMailer() {
  handler._setMailer(makeMailer(async () => {}));
}

// Captures the message object handed to sendMail, for header/body assertions.
function captureMailer() {
  const seen = {};
  handler._setMailer(makeMailer(async (message) => { seen.message = message; }));
  return seen;
}

function failMailer() {
  handler._setMailer(makeMailer(async () => { throw new Error('SMTP send failed'); }));
}

function throwMailer() {
  handler._setMailer(makeMailer(async () => { throw new Error('connect ECONNREFUSED'); }));
}

// ---------------------------------------------------------------------------
// Request / response helpers.
// ---------------------------------------------------------------------------

function mockRes() {
  const r = { _status: null, _body: null, _ended: false };
  r.status = (code) => { r._status = code; return r; };
  r.json   = (body) => { r._body = body; return r; };
  r.end    = ()     => { r._ended = true; return r; };
  return r;
}

function mockReq(overrides) {
  return { method: 'POST', body: {}, ...overrides };
}

// A complete, valid submission. Spread and override per test.
function submission(overrides) {
  return {
    from: 'Ada Lovelace',
    reply: 'ada@example.com',
    body: 'A computing problem.',
    channel: 'A',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Set required env vars before handler tests run.
// ---------------------------------------------------------------------------
process.env.SMTP_USER = 'test_user@workspace.example';
process.env.SMTP_PASS = 'test_pass';
process.env.SMTP_FROM = 'mail@probnaya.work';

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

test('validate: valid channel A', () => {
  const r = validate(submission());
  assert.equal(r.ok, true);
  assert.equal(r.channel, 'A');
  assert.equal(r.from, 'Ada Lovelace');
  assert.equal(r.reply, 'ada@example.com');
});

test('validate: valid channel B', () => {
  const r = validate(submission({ from: 'Ada', body: 'A proposal.', channel: 'B' }));
  assert.equal(r.ok, true);
  assert.equal(r.channel, 'B');
});

test('validate: channel normalised to uppercase', () => {
  const r = validate(submission({ channel: 'a' }));
  assert.equal(r.ok, true);
  assert.equal(r.channel, 'A');
});

test('validate: missing from', () => {
  const r = validate(submission({ from: '' }));
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('validate: whitespace-only from', () => {
  const r = validate(submission({ from: '   ' }));
  assert.equal(r.ok, false);
});

test('validate: missing body', () => {
  const r = validate(submission({ body: '' }));
  assert.equal(r.ok, false);
});

test('validate: from too long', () => {
  const r = validate(submission({ from: 'A'.repeat(201) }));
  assert.equal(r.ok, false);
});

test('validate: body too long', () => {
  const r = validate(submission({ body: 'B'.repeat(4001) }));
  assert.equal(r.ok, false);
});

test('validate: invalid channel', () => {
  const r = validate(submission({ channel: 'C' }));
  assert.equal(r.ok, false);
});

test('validate: CR/LF stripped from from field', () => {
  const r = validate(submission({ from: 'Ada\r\nLovelace' }));
  assert.equal(r.ok, true);
  assert.ok(!r.from.includes('\n'));
  assert.ok(!r.from.includes('\r'));
});

test('validate: null data', () => {
  const r = validate(null);
  assert.equal(r.ok, false);
});

test('validate: array data', () => {
  const r = validate([]);
  assert.equal(r.ok, false);
});

// ---- reply (required on both channels) ----

test('validate: missing reply', () => {
  const r = validate(submission({ reply: '' }));
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('validate: reply absent entirely', () => {
  const r = validate({ from: 'Ada', body: 'Problem.', channel: 'A' });
  assert.equal(r.ok, false);
});

test('validate: whitespace-only reply', () => {
  const r = validate(submission({ reply: '   ' }));
  assert.equal(r.ok, false);
});

test('validate: reply required on channel B too', () => {
  const r = validate(submission({ channel: 'B', body: 'A proposal.', reply: '' }));
  assert.equal(r.ok, false);
});

test('validate: reply too long', () => {
  const r = validate(submission({ reply: 'a'.repeat(195) + '@e.com' }));
  assert.equal(r.ok, false);
});

test('validate: CR/LF stripped from reply field', () => {
  const r = validate(submission({ reply: 'ada@example.com\r\nBcc: x@y.com' }));
  assert.equal(r.ok, true);
  assert.ok(!r.reply.includes('\n'));
  assert.ok(!r.reply.includes('\r'));
});

test('validate: reply need not be an email address', () => {
  const r = validate(submission({ reply: '@ada on signal' }));
  assert.equal(r.ok, true);
  assert.equal(r.reply, '@ada on signal');
});

// ---- tried (optional, channel A only in the UI) ----

test('validate: tried absent normalises to empty string', () => {
  const r = validate(submission());
  assert.equal(r.ok, true);
  assert.equal(r.tried, '');
});

test('validate: tried accepted when present', () => {
  const r = validate(submission({ tried: 'Two runtimes, one ledger.' }));
  assert.equal(r.ok, true);
  assert.equal(r.tried, 'Two runtimes, one ledger.');
});

test('validate: tried too long', () => {
  const r = validate(submission({ tried: 'T'.repeat(2001) }));
  assert.equal(r.ok, false);
});

test('validate: tried line endings normalised', () => {
  const r = validate(submission({ tried: 'one\r\ntwo\rthree' }));
  assert.equal(r.ok, true);
  assert.equal(r.tried, 'one\ntwo\nthree');
});

test('validate: non-string tried ignored', () => {
  const r = validate(submission({ tried: 42 }));
  assert.equal(r.ok, true);
  assert.equal(r.tried, '');
});

// ---------------------------------------------------------------------------
// isEmailLike()
// ---------------------------------------------------------------------------

test('isEmailLike: plain address', () => {
  assert.equal(isEmailLike('ada@example.com'), true);
});

test('isEmailLike: rejects free text', () => {
  assert.equal(isEmailLike('@ada on signal'), false);
  assert.equal(isEmailLike('ada@example'), false);
  assert.equal(isEmailLike('ada example.com'), false);
  assert.equal(isEmailLike(''), false);
});

// ---------------------------------------------------------------------------
// handler()
// ---------------------------------------------------------------------------

test('handler: non-POST returns 405', async () => {
  const req = mockReq({ method: 'GET' });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 405);
  assert.equal(res._ended, true);
});

test('handler: honeypot filled returns 200 without sending mail', async () => {
  let sendCalled = false;
  handler._setMailer(makeMailer(async () => { sendCalled = true; }));
  const req = mockReq({ body: submission({ from: 'Bot', body: 'Spam.', __hp: 'gotcha' }) });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.equal(sendCalled, false);
});

test('handler: missing required field returns 400', async () => {
  okMailer();
  const req = mockReq({ body: submission({ from: '' }) });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
  assert.ok(res._body.error);
});

test('handler: missing reply returns 400', async () => {
  okMailer();
  const req = mockReq({ body: submission({ reply: '' }) });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
  assert.ok(res._body.error);
});

test('handler: body too long returns 400', async () => {
  okMailer();
  const req = mockReq({ body: submission({ body: 'X'.repeat(4001) }) });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
});

test('handler: missing SMTP credentials returns 500', async () => {
  const savedUser = process.env.SMTP_USER;
  const savedPass = process.env.SMTP_PASS;
  const savedFrom = process.env.SMTP_FROM;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  const req = mockReq({ body: submission() });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
  process.env.SMTP_USER = savedUser;
  process.env.SMTP_PASS = savedPass;
  process.env.SMTP_FROM = savedFrom;
});

test('handler: SMTP send failure returns 500', async () => {
  failMailer();
  const req = mockReq({ body: submission() });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
});

test('handler: SMTP network error returns 500', async () => {
  throwMailer();
  const req = mockReq({ body: submission() });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
});

test('handler: successful submission returns 200 with id', async () => {
  okMailer();
  const req = mockReq({ body: submission() });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.ok(typeof res._body.id === 'string');
  assert.ok(res._body.id.startsWith('Q-'));
});

test('handler: successful channel B submission', async () => {
  okMailer();
  const req = mockReq({ body: submission({ from: 'Ada', body: 'A proposal.', channel: 'B' }) });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
});

test('handler: reply address becomes the Reply-To header', async () => {
  const seen = captureMailer();
  const req = mockReq({ body: submission({ reply: 'ada@example.com' }) });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(seen.message.replyTo, 'ada@example.com');
});

test('handler: non-address reply sets no Reply-To but is still recorded', async () => {
  const seen = captureMailer();
  const req = mockReq({ body: submission({ reply: '@ada on signal' }) });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal('replyTo' in seen.message, false);
  assert.match(seen.message.text, /REPLY: @ada on signal/);
});

test('handler: reply address recorded in the message body', async () => {
  const seen = captureMailer();
  const req = mockReq({ body: submission() });
  const res = mockRes();
  await handler(req, res);
  assert.match(seen.message.text, /REPLY: ada@example\.com/);
});

test('handler: tried notes included in the message body when present', async () => {
  const seen = captureMailer();
  const req = mockReq({ body: submission({ tried: 'Two runtimes, one ledger.' }) });
  const res = mockRes();
  await handler(req, res);
  assert.match(seen.message.text, /ALREADY TRIED:\nTwo runtimes, one ledger\./);
});

test('handler: tried section omitted when empty', async () => {
  const seen = captureMailer();
  const req = mockReq({ body: submission({ tried: '' }) });
  const res = mockRes();
  await handler(req, res);
  assert.ok(!seen.message.text.includes('ALREADY TRIED'));
});

test('handler: error response does not expose provider detail', async () => {
  failMailer();
  const req = mockReq({ body: submission() });
  const res = mockRes();
  await handler(req, res);
  const errStr = JSON.stringify(res._body).toLowerCase();
  assert.ok(!errStr.includes('smtp'),       'SMTP must not leak');
  assert.ok(!errStr.includes('gmail'),      'Gmail must not leak');
  assert.ok(!errStr.includes('nodemailer'), 'nodemailer must not leak');
  assert.ok(!errStr.includes('google'),     'Google must not leak');
});
