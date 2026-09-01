'use strict';

// Mock fetch globally before loading the handler so no real Resend calls are made.
let mockFetch;
global.fetch = (...args) => mockFetch(...args);

process.env.RESEND_API_KEY = 'test_key';

const handler = require('./intake.js');
const { validate } = handler;

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Helpers
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

function okFetch() {
  mockFetch = async () => ({ ok: true, json: async () => ({}) });
}

function failFetch() {
  mockFetch = async () => ({ ok: false, status: 500 });
}

function throwFetch() {
  mockFetch = async () => { throw new Error('network error'); };
}

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

test('handler: honeypot filled returns 200 without calling Resend', async () => {
  let fetchCalled = false;
  mockFetch = async () => { fetchCalled = true; return { ok: true }; };
  const req = mockReq({ body: { from: 'Bot', body: 'Spam.', channel: 'A', __hp: 'gotcha' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.equal(fetchCalled, false);
});

test('handler: missing required field returns 400', async () => {
  okFetch();
  const req = mockReq({ body: { from: '', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
  assert.ok(res._body.error);
});

test('handler: body too long returns 400', async () => {
  okFetch();
  const req = mockReq({ body: { from: 'Ada', body: 'X'.repeat(4001), channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
});

test('handler: missing API key returns 500', async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
  process.env.RESEND_API_KEY = saved;
});

test('handler: Resend returns non-OK returns 500', async () => {
  failFetch();
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
});

test('handler: Resend throws returns 500', async () => {
  throwFetch();
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 500);
  assert.equal(res._body.error, 'Submission unavailable');
});

test('handler: successful submission returns 200 with id', async () => {
  okFetch();
  const req = mockReq({ body: { from: 'Ada Lovelace', body: 'A computing problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  assert.ok(typeof res._body.id === 'string');
  assert.ok(res._body.id.startsWith('Q-'));
});

test('handler: successful channel B submission', async () => {
  okFetch();
  const req = mockReq({ body: { from: 'Ada', body: 'A proposal.', channel: 'B' } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
});

test('handler: error response does not expose provider detail', async () => {
  failFetch();
  const req = mockReq({ body: { from: 'Ada', body: 'Problem.', channel: 'A' } });
  const res = mockRes();
  await handler(req, res);
  const errStr = JSON.stringify(res._body);
  assert.ok(!errStr.includes('resend'), 'provider name must not leak');
  assert.ok(!errStr.includes('RESEND'), 'provider name must not leak');
  assert.ok(!errStr.includes('api.resend'), 'provider URL must not leak');
});
