'use strict';

const handler = require('./intake.js');
const { validate } = handler;

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
  const r = validate({ from: 'Ada Lovelace', body: 'A computing problem.', channel: 'A' });
  assert.equal(r.ok, true);
  assert.equal(r.channel, 'A');
  assert.equal(r.from, 'Ada Lovelace');
});

test('validate: valid channel B', () => {
  const r = validate({ from: 'Ada', body: 'A proposal.', channel: 'B' });
  assert.equal(r.ok, true);
  assert.equal(r.channel, 'B');
});

test('validate: channel normalised to uppercase', () => {
  const r = validate({ from: 'Ada', body: 'Problem.', channel: 'a' });
  assert.equal(r.ok, true);
  assert.equal(r.channel, 'A');
});

test('validate: missing from', () => {
  const r = validate({ from: '', body: 'Problem.', channel: 'A' });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('validate: whitespace-only from', () => {
  const r = validate({ from: '   ', body: 'Problem.', channel: 'A' });
  assert.equal(r.ok, false);
});

test('validate: missing body', () => {
  const r = validate({ from: 'Ada', body: '', channel: 'A' });
  assert.equal(r.ok, false);
});

test('validate: from too long', () => {
  const r = validate({ from: 'A'.repeat(201), body: 'Problem.', channel: 'A' });
  assert.equal(r.ok, false);
});

test('validate: body too long', () => {
  const r = validate({ from: 'Ada', body: 'B'.repeat(4001), channel: 'A' });
  assert.equal(r.ok, false);
});

test('validate: invalid channel', () => {
  const r = validate({ from: 'Ada', body: 'Problem.', channel: 'C' });
  assert.equal(r.ok, false);
});

test('validate: CR/LF stripped from from field', () => {
  const r = validate({ from: 'Ada\r\nLovelace', body: 'Problem.', channel: 'A' });
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
  const req = mockReq({ body: { from: 'Bot', body: 'Spam.', channel: 'A', __hp: 'gotcha' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.equal(sendCalled, false);
});

test('handler: missing required field returns 400', async () => {
  okMailer();
  const req = mockReq({ body: { from: '', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
  assert.ok(res._body.error);
});

test('handler: body too long returns 400', async () => {
  okMailer();
  const req = mockReq({ body: { from: 'Ada', body: 'X'.repeat(4001), channel: 'A' } });
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
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
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
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
});

test('handler: SMTP network error returns 500', async () => {
  throwMailer();
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
});

test('handler: successful submission returns 200 with id', async () => {
  okMailer();
  const req = mockReq({ body: { from: 'Ada Lovelace', body: 'A computing problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.ok(typeof res._body.id === 'string');
  assert.ok(res._body.id.startsWith('Q-'));
});

test('handler: successful channel B submission', async () => {
  okMailer();
  const req = mockReq({ body: { from: 'Ada', body: 'A proposal.', channel: 'B' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
});

test('handler: error response does not expose provider detail', async () => {
  failMailer();
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  const errStr = JSON.stringify(res._body).toLowerCase();
  assert.ok(!errStr.includes('smtp'),       'SMTP must not leak');
  assert.ok(!errStr.includes('gmail'),      'Gmail must not leak');
  assert.ok(!errStr.includes('nodemailer'), 'nodemailer must not leak');
  assert.ok(!errStr.includes('google'),     'Google must not leak');
});
