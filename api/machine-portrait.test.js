'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./machine-portrait.js');

const HASH = 'ab'.repeat(32);
const ATTEMPT = '123e4567-e89b-42d3-a456-426614174000';
const SESSION = 'cs_test_a12345678901234567890';

process.env.STRIPE_SECRET_KEY = 'sk_test_example';
process.env.STRIPE_PRICE_ID = 'price_machineportrait';
process.env.MPA_PUBLIC_URL = 'https://probnaya.work/instrument-mpa/';
process.env.STRIPE_LIVEMODE = 'false';

function mockReq(body, method = 'POST') {
  return { method, body };
}

function mockRes() {
  const response = { headers: {}, statusCode: null, body: null };
  response.setHeader = (name, value) => { response.headers[name] = value; };
  response.status = code => { response.statusCode = code; return response; };
  response.json = body => { response.body = body; return response; };
  return response;
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function createRequest(overrides = {}) {
  return { action: 'create-checkout', attemptId: ATTEMPT, draftHash: HASH, protocol: handler.PROTOCOL, ...overrides };
}

function verifyRequest(overrides = {}) {
  return { action: 'verify-issuance', sessionId: SESSION, draftHash: HASH, protocol: handler.PROTOCOL, ...overrides };
}

function paidSession(overrides = {}) {
  return {
    id: SESSION,
    livemode: false,
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 500,
    currency: 'eur',
    metadata: { protocol: handler.PROTOCOL, draft_hash: HASH },
    line_items: {
      has_more: false,
      data: [{ quantity: 1, amount_total: 500, currency: 'eur', price: { id: 'price_machineportrait' } }],
    },
    payment_intent: { status: 'succeeded', latest_charge: { paid: true, created: 1788681600 } },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_example';
  process.env.STRIPE_PRICE_ID = 'price_machineportrait';
  process.env.MPA_PUBLIC_URL = 'https://probnaya.work/instrument-mpa/';
  process.env.STRIPE_LIVEMODE = 'false';
});

test('rejects non-POST requests and disables caching', async () => {
  const res = mockRes();
  await handler(mockReq({}, 'GET'), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
});

test('validates bounded, exact create and verify schemas', () => {
  assert.equal(handler.validateRequest(createRequest()).ok, true);
  assert.equal(handler.validateRequest(verifyRequest()).ok, true);
  assert.equal(handler.validateRequest(createRequest({ matrix: '0'.repeat(1024) })).ok, false);
  assert.equal(handler.validateRequest(createRequest({ draftHash: 'x'.repeat(64) })).ok, false);
  assert.equal(handler.validateRequest(verifyRequest({ protocol: 'MPA-ISSUANCE/2' })).ok, false);
  assert.equal(handler.validateRequest(verifyRequest({ sessionId: 'not-a-session' })).ok, false);
});

test('creates hosted Checkout with server-owned price and idempotency', async () => {
  const seen = {};
  handler._setFetch(async (url, options) => {
    seen.url = url;
    seen.options = options;
    return jsonResponse({ id: SESSION, url: 'https://checkout.stripe.com/c/pay/example', mode: 'payment', livemode: false, amount_total: 500, currency: 'eur', line_items: paidSession().line_items });
  });
  const res = mockRes();
  await handler(mockReq(createRequest()), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { checkoutUrl: 'https://checkout.stripe.com/c/pay/example', sessionId: SESSION });
  assert.equal(seen.options.headers['Idempotency-Key'], `mpa-checkout:${ATTEMPT}`);
  assert.equal(seen.options.headers['Stripe-Version'], '2026-02-25.clover');
  const form = seen.options.body;
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('line_items[0][price]'), 'price_machineportrait');
  assert.equal(form.get('line_items[0][quantity]'), '1');
  assert.equal(form.get('payment_method_types[0]'), 'card');
  assert.equal(form.get('metadata[draft_hash]'), HASH);
  assert.equal(form.get('metadata[protocol]'), handler.PROTOCOL);
  assert.equal(form.get('expand[0]'), 'line_items.data.price');
  assert.equal(form.has('matrix'), false);
  assert.match(form.get('success_url'), /session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.match(form.get('cancel_url'), /checkout=cancelled/);
});

test('same attempt produces the same Stripe idempotency key', async () => {
  const keys = [];
  handler._setFetch(async (_url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    return jsonResponse({ id: SESSION, url: 'https://checkout.stripe.com/c/pay/example', mode: 'payment', livemode: false, amount_total: 500, currency: 'eur', line_items: paidSession().line_items });
  });
  await handler(mockReq(createRequest()), mockRes());
  await handler(mockReq(createRequest()), mockRes());
  assert.deepEqual(keys, [`mpa-checkout:${ATTEMPT}`, `mpa-checkout:${ATTEMPT}`]);
});

test('verifies a paid Session and returns stable minimal authorization', async () => {
  const seen = {};
  handler._setFetch(async (url, options) => {
    seen.url = url;
    seen.options = options;
    return jsonResponse(paidSession());
  });
  const first = mockRes();
  const second = mockRes();
  await handler(mockReq(verifyRequest()), first);
  await handler(mockReq(verifyRequest()), second);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, second.body);
  assert.equal(first.body.authorized, true);
  assert.equal(first.body.draftHash, HASH);
  assert.equal(first.body.issueDigest, handler.issueDigest(SESSION, HASH));
  assert.equal(first.body.issuedAt, '2026-09-06T08:00:00.000Z');
  assert.equal('sessionId' in first.body, false);
  assert.match(seen.url, /expand%5B%5D=line_items\.data\.price/);
  assert.equal(seen.options.method, 'GET');
});

for (const [name, mutation, code] of [
  ['unpaid Session', { payment_status: 'unpaid' }, 'payment_incomplete'],
  ['incomplete Session', { status: 'open' }, 'payment_incomplete'],
  ['wrong mode', { mode: 'subscription' }, 'payment_incomplete'],
  ['wrong amount', { amount_total: 499 }, 'payment_amount_mismatch'],
  ['wrong currency', { currency: 'usd' }, 'payment_amount_mismatch'],
  ['wrong environment', { livemode: true }, 'session_environment_mismatch'],
  ['missing commitment', { metadata: {} }, 'commitment_missing'],
  ['wrong price', { line_items: { has_more: false, data: [{ quantity: 1, amount_total: 500, currency: 'eur', price: { id: 'price_other' } }] } }, 'line_item_mismatch'],
  ['wrong quantity', { line_items: { has_more: false, data: [{ quantity: 2, amount_total: 500, currency: 'eur', price: { id: 'price_machineportrait' } }] } }, 'line_item_mismatch'],
]) {
  test(`does not issue for ${name}`, async () => {
    handler._setFetch(async () => jsonResponse(paidSession(mutation)));
    const res = mockRes();
    await handler(mockReq(verifyRequest()), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, code);
  });
}

test('does not issue when the supplied draft hash differs from Stripe metadata', async () => {
  handler._setFetch(async () => jsonResponse(paidSession()));
  const res = mockRes();
  await handler(mockReq(verifyRequest({ draftHash: 'cd'.repeat(32) })), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'commitment_mismatch');
});

test('returns a generic temporary failure without leaking Stripe details', async () => {
  handler._setFetch(async () => jsonResponse({ error: { message: 'secret Stripe detail' } }, false, 500));
  const res = mockRes();
  await handler(mockReq(verifyRequest()), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'Payment service temporarily unavailable');
  assert.doesNotMatch(JSON.stringify(res.body), /secret Stripe detail/);
});

test('fails closed when configuration is incomplete', async () => {
  delete process.env.STRIPE_PRICE_ID;
  const res = mockRes();
  await handler(mockReq(createRequest()), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'configuration_unavailable');
});
