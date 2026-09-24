'use strict';

// Tests for api/views.js. No store is ever contacted: an in-memory store is
// injected, and the Blob client is exercised against a stubbed fetch.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/views.js');

let store, logs;

beforeEach(() => {
  const data = {};
  store = {
    data,
    read: async () => ({ ...data }),
    write: async (counts) => { for (const k of Object.keys(data)) delete data[k]; Object.assign(data, counts); },
  };
  logs = [];
  handler._setStore(store);
  handler._setLog((line) => logs.push(line));
});

function req({ method = 'GET', url = '/api/views', body, headers = {} } = {}) {
  return { method, url, body, headers: { host: 'probnaya.work', ...headers } };
}

function res() {
  const out = { statusCode: 200, headers: {}, body: undefined };
  out.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
  out.status = (code) => { out.statusCode = code; return out; };
  out.json = (value) => { out.body = value; return out; };
  return out;
}

const post = (body, headers = { origin: 'https://probnaya.work' }) =>
  req({ method: 'POST', body, headers });

test('a reading increments the count of that number only', async () => {
  let r = res(); await handler(post({ number: '007' }), r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { number: '007', count: 1 });
  r = res(); await handler(post({ number: '007' }), r);
  assert.equal(r.body.count, 2);
  assert.equal(store.data['008'], undefined);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('counts are read for the requested numbers, and zero is left out', async () => {
  store.data['007'] = 7;
  const r = res();
  await handler(req({ url: '/api/views?n=007,008' }), r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { counts: { '007': 7 } });
  assert.match(r.headers['cache-control'], /s-maxage=30/);
});

test('readings from before the counter are added to what the store holds', async () => {
  assert.ok(handler.BEFORE['001'] > 0);
  store.data['001'] = 2;
  let r = res(); await handler(req({ url: '/api/views?n=001' }), r);
  assert.equal(r.body.counts['001'], handler.BEFORE['001'] + 2);
  r = res(); await handler(post({ number: '001' }), r);
  assert.equal(r.body.count, handler.BEFORE['001'] + 3);
  assert.equal(store.data['001'], 3);
});

test('only three-digit archival numbers are accepted', async () => {
  for (const number of ['1', '0001', 'abc', '../x', 1, null, undefined]) {
    const r = res(); await handler(post({ number }), r);
    assert.equal(r.statusCode, 400, String(number));
  }
  for (const url of ['/api/views', '/api/views?n=', '/api/views?n=001,x', '/api/views?n=' + Array.from({ length: 51 }, (_, i) => String(i).padStart(3, '0')).join(',')]) {
    const r = res(); await handler(req({ url }), r);
    assert.equal(r.statusCode, 400, url);
  }
  assert.deepEqual(store.data, {});
});

test('a reading must come from this site', async () => {
  for (const headers of [{}, { origin: 'https://elsewhere.example' }, { origin: 'not a url' }]) {
    const r = res(); await handler(post({ number: '001' }, headers), r);
    assert.equal(r.statusCode, 403);
  }
  const r = res();
  await handler(post({ number: '001' }, { origin: 'https://probnaya.work', 'x-forwarded-host': 'probnaya.work' }), r);
  assert.equal(r.statusCode, 200);
});

test('other methods are refused', async () => {
  const r = res(); await handler(req({ method: 'DELETE' }), r);
  assert.equal(r.statusCode, 405);
  assert.equal(r.headers.allow, 'GET, POST');
});

test('without a store the page gets no counts and a reading is not taken', async () => {
  handler._setStore(null);
  const saved = { ...process.env };
  for (const k of ['BLOB_READ_WRITE_TOKEN', 'VIEWS_DEV_MEMORY']) delete process.env[k];
  try {
    let r = res(); await handler(req({ url: '/api/views?n=001' }), r);
    assert.deepEqual(r.body, { counts: {} });
    r = res(); await handler(post({ number: '001' }), r);
    assert.equal(r.statusCode, 503);
  } finally {
    Object.assign(process.env, saved);
  }
});

test('the development memory store is refused on Vercel', async () => {
  handler._setStore(null);
  const saved = { ...process.env };
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.VIEWS_DEV_MEMORY = '1';
  process.env.VERCEL = '1';
  try {
    const r = res(); await handler(post({ number: '001' }), r);
    assert.equal(r.statusCode, 503);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('a failing store yields no counts and logs a code only', async () => {
  let readable = false;
  handler._setStore({
    read: async () => { if (readable) return {}; const e = new Error('boom'); e.code = 'http_500'; throw e; },
    write: async () => { throw new Error('boom'); },
  });
  let r = res(); await handler(req({ url: '/api/views?n=001' }), r);
  assert.deepEqual(r.body, { counts: {} });
  r = res(); await handler(post({ number: '001' }), r);
  assert.equal(r.statusCode, 502);
  readable = true;                       // the file reads, but cannot be written back
  r = res(); await handler(post({ number: '001' }), r);
  assert.equal(r.statusCode, 502);
  assert.deepEqual(logs, ['views: read_failed http_500', 'views: write_failed http_500', 'views: write_failed error']);
});

test('the blob store finds its file, reads it past the CDN copy, and overwrites it', async () => {
  const calls = [];
  const realFetch = global.fetch;
  const BLOB = 'https://store.public.blob.vercel-storage.com/observations/views.json';
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.startsWith('https://blob.vercel-storage.com/?prefix=')) {
      return { ok: true, status: 200, json: async () => ({ blobs: [{ url: BLOB }] }) };
    }
    if (url.startsWith(BLOB)) return { ok: true, status: 200, json: async () => ({ '001': 4 }) };
    return { ok: true, status: 200, json: async () => ({ url: BLOB }) };
  };
  try {
    const client = handler.blobStore('not-a-real-token');
    assert.deepEqual(await client.read(), { '001': 4 });
    await client.write({ '001': 5 });

    assert.equal(calls[0].init.headers.Authorization, 'Bearer not-a-real-token');
    assert.match(calls[1].url, /\?t=\d+$/);            // not the cached copy
    assert.equal(calls[1].init.cache, 'no-store');
    assert.equal(calls[2].url, 'https://blob.vercel-storage.com/observations/views.json');
    assert.equal(calls[2].init.method, 'PUT');
    assert.equal(calls[2].init.headers['x-access'], 'public');
    assert.equal(calls[2].init.headers['x-add-random-suffix'], '0');
    assert.equal(calls[2].init.body, JSON.stringify({ '001': 5 }));
    assert.equal(calls.length, 3);                    // the file is located once

    await client.read();
    assert.equal(calls.length, 4);
  } finally {
    global.fetch = realFetch;
  }
});

test('an unwritten blob reads as no counts at all', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ blobs: [] }) });
  try {
    assert.deepEqual(await handler.blobStore('not-a-real-token').read(), {});
  } finally {
    global.fetch = realFetch;
  }
});
