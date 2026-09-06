'use strict';

const { createHash } = require('node:crypto');

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2026-02-25.clover';
const PROTOCOL = 'MPA-ISSUANCE/1';
const EXPECTED_AMOUNT = 500;
const EXPECTED_CURRENCY = 'eur';
const SHA256_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_RE = /^cs_(?:test_|live_)[A-Za-z0-9]{10,200}$/;

let _fetch = (...args) => fetch(...args);

module.exports = async function handler(req, res) {
  setResponseHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const input = validateRequest(req.body);
  if (!input.ok) {
    res.status(400).json({ error: input.error, code: 'invalid_request' });
    return;
  }

  let config;
  try {
    config = readConfig();
  } catch {
    res.status(503).json({ error: 'Payment service is not configured', code: 'configuration_unavailable' });
    return;
  }

  try {
    if (input.action === 'create-checkout') {
      const session = await createCheckout(input, config);
      res.status(200).json({ checkoutUrl: session.url, sessionId: session.id });
      return;
    }

    const authorization = await verifyIssuance(input, config);
    res.status(200).json(authorization);
  } catch (error) {
    if (error instanceof IssuanceError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    res.status(502).json({ error: 'Payment service temporarily unavailable', code: 'stripe_unavailable' });
  }
};

function setResponseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Invalid request');
  if (body.action === 'create-checkout') {
    if (!hasOnly(body, ['action', 'attemptId', 'draftHash', 'protocol'])) return invalid('Invalid Checkout request');
    if (typeof body.attemptId !== 'string' || body.attemptId.length > 64 || !UUID_RE.test(body.attemptId)) return invalid('Invalid attempt identifier');
    if (!validCommitment(body)) return invalid('Invalid issuance commitment');
    return { ok: true, action: body.action, attemptId: body.attemptId, draftHash: body.draftHash, protocol: body.protocol };
  }
  if (body.action === 'verify-issuance') {
    if (!hasOnly(body, ['action', 'sessionId', 'draftHash', 'protocol'])) return invalid('Invalid verification request');
    if (typeof body.sessionId !== 'string' || body.sessionId.length > 255 || !SESSION_RE.test(body.sessionId)) return invalid('Invalid Checkout Session');
    if (!validCommitment(body)) return invalid('Invalid issuance commitment');
    return { ok: true, action: body.action, sessionId: body.sessionId, draftHash: body.draftHash, protocol: body.protocol };
  }
  return invalid('Invalid action');
}

function validCommitment(body) {
  return body.protocol === PROTOCOL && typeof body.draftHash === 'string' && SHA256_RE.test(body.draftHash);
}

function hasOnly(body, names) {
  const keys = Object.keys(body);
  return keys.length === names.length && keys.every(key => names.includes(key));
}

function invalid(error) {
  return { ok: false, error };
}

function readConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const publicUrl = process.env.MPA_PUBLIC_URL;
  const liveValue = process.env.STRIPE_LIVEMODE;
  if (!secretKey || !priceId || !publicUrl || !['true', 'false'].includes(liveValue)) throw new Error('missing configuration');
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new Error('invalid price');
  const url = new URL(publicUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid public URL');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('insecure public URL');
  return { secretKey, priceId, publicUrl: url.toString(), livemode: liveValue === 'true' };
}

async function createCheckout(input, config) {
  const successUrl = checkoutReturnUrl(config.publicUrl, 'session_id', '{CHECKOUT_SESSION_ID}');
  const cancelUrl = checkoutReturnUrl(config.publicUrl, 'checkout', 'cancelled');
  const form = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: input.attemptId,
    'line_items[0][price]': config.priceId,
    'line_items[0][quantity]': '1',
    'payment_method_types[0]': 'card',
    'metadata[draft_hash]': input.draftHash,
    'metadata[protocol]': input.protocol,
    'expand[0]': 'line_items.data.price',
  });
  const session = await stripeRequest('/checkout/sessions', config, {
    method: 'POST',
    body: form,
    idempotencyKey: `mpa-checkout:${input.attemptId}`,
  });
  if (!session || !SESSION_RE.test(session.id || '') || !validCheckoutUrl(session.url) || session.mode !== 'payment' || session.livemode !== config.livemode || session.amount_total !== EXPECTED_AMOUNT || session.currency !== EXPECTED_CURRENCY || !validLineItem(session.line_items, config.priceId)) {
    throw new IssuanceError(502, 'Checkout could not be created', 'invalid_checkout_session');
  }
  return session;
}

function checkoutReturnUrl(publicUrl, key, value) {
  const url = new URL(publicUrl);
  url.searchParams.set(key, value);
  return url.toString().replace(encodeURIComponent(value), value);
}

function validCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com';
  } catch {
    return false;
  }
}

async function verifyIssuance(input, config) {
  const query = new URLSearchParams();
  query.append('expand[]', 'line_items.data.price');
  query.append('expand[]', 'payment_intent.latest_charge');
  const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(input.sessionId)}?${query}`, config, { method: 'GET' });

  if (!session || session.id !== input.sessionId || session.livemode !== config.livemode) deny('Checkout Session is not valid for this environment', 'session_environment_mismatch');
  if (session.mode !== 'payment' || session.status !== 'complete' || session.payment_status !== 'paid') deny('Payment is not complete', 'payment_incomplete');
  if (session.amount_total !== EXPECTED_AMOUNT || session.currency !== EXPECTED_CURRENCY) deny('Payment amount does not match this issuance', 'payment_amount_mismatch');
  if (!session.metadata || session.metadata.protocol !== PROTOCOL || !SHA256_RE.test(session.metadata.draft_hash || '')) deny('Checkout Session has no valid issuance commitment', 'commitment_missing');
  if (session.metadata.draft_hash !== input.draftHash) deny('The retained issuance does not match the paid Checkout Session', 'commitment_mismatch');

  const items = session.line_items;
  if (!validLineItem(items, config.priceId)) {
    deny('Checkout Session does not contain the expected issuance', 'line_item_mismatch');
  }

  const intent = session.payment_intent;
  const charge = intent && typeof intent === 'object' ? intent.latest_charge : null;
  if (!intent || typeof intent !== 'object' || intent.status !== 'succeeded' || !charge || typeof charge !== 'object' || charge.paid !== true || !Number.isInteger(charge.created)) {
    deny('Payment is not complete', 'payment_incomplete');
  }

  const issueDigest = createHash('sha256')
    .update(`${PROTOCOL}\0${session.id}\0${input.draftHash}`, 'utf8')
    .digest('hex');

  return {
    authorized: true,
    protocol: PROTOCOL,
    draftHash: input.draftHash,
    issueDigest,
    issuedAt: new Date(charge.created * 1000).toISOString(),
  };
}

function validLineItem(items, expectedPriceId) {
  const lines = items && Array.isArray(items.data) ? items.data : [];
  const line = lines[0];
  const linePrice = line && line.price;
  const linePriceId = typeof linePrice === 'string' ? linePrice : linePrice && linePrice.id;
  return items && items.has_more === false && lines.length === 1 && line && line.quantity === 1 && linePriceId === expectedPriceId && line.amount_total === EXPECTED_AMOUNT && line.currency === EXPECTED_CURRENCY;
}

async function stripeRequest(path, config, options) {
  const headers = { Authorization: `Bearer ${config.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION };
  if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response;
  try {
    response = await _fetch(STRIPE_API + path, { method: options.method, headers, body: options.body });
  } catch {
    throw new IssuanceError(502, 'Payment service temporarily unavailable', 'stripe_unavailable');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload) throw new IssuanceError(502, 'Payment service temporarily unavailable', 'stripe_unavailable');
  return payload;
}

function deny(message, code) {
  throw new IssuanceError(409, message, code);
}

class IssuanceError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports._setFetch = mock => { _fetch = mock || ((...args) => fetch(...args)); };
module.exports.validateRequest = validateRequest;
module.exports.checkoutReturnUrl = checkoutReturnUrl;
module.exports.issueDigest = (sessionId, draftHash) => createHash('sha256').update(`${PROTOCOL}\0${sessionId}\0${draftHash}`, 'utf8').digest('hex');
module.exports.PROTOCOL = PROTOCOL;
