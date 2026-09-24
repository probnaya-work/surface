'use strict';

// /api/views — the public reading count of each published Observation.
//
//   GET  /api/views?n=001,002   → { counts: { "001": 12, "002": 3 } }
//   POST /api/views { number }  → { number, count }   one more reading
//
// What counts as a reading is decided in the browser (js/observation-views.js):
// one browser, one Observation, once a day. The request carries the archival
// number and nothing else — no cookie, no identifier, no address is sent, read,
// stored, or logged here. The store holds one integer per number and nothing
// more (docs/observations-publishing.md §11).
//
// The store is one JSON file in Vercel Blob, read and written over its REST API
// with fetch; there is no client dependency. Two readings landing in the same
// instant can overwrite one another and lose a count — at this scale that is the
// price of not running a database, and the count is a reading count, not a
// ledger. Without a configured store the counts are empty and the pages show no
// count at all.

// Readings taken before this counter existed, counted by the same rule from
// Vercel Web Analytics: unique visitors per day to the Observation's own sheet,
// summed over the days (`vercel metrics vercel.analytics_pageview.count
// -a unique/visitor_id -g 1d --group-by request_path`). Views of the index are
// left out: they cannot be attributed to one piece. Measured up to
// 2026-09-24T23:00Z. Every later reading is counted by the store.
const BEFORE = Object.freeze({ '001': 11, '002': 14 });

const NUMBER = /^\d{3}$/;
const MAX_NUMBERS = 50;
const BLOB_API = 'https://blob.vercel-storage.com';
const BLOB_PATH = 'observations/views.json';

// Injected by tests: no real store, no real logs.
let _store = null;
let _log = (line) => console.log(line);

// Local development only, like OBSERVATIONS_DEV_OUTBOX: an in-memory store that
// forgets on restart. Refused on Vercel. Kept on globalThis because the dev server
// re-requires a handler on every request.
const memory = globalThis.__probnayaViewsMemory || (globalThis.__probnayaViewsMemory = { counts: {} });

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const store = _store || readStore();

  if (req.method === 'GET') {
    const numbers = requestedNumbers(req);
    if (!numbers) {
      res.setHeader('Cache-Control', 'no-store');
      return refuse(res, 400, 'invalid_numbers');
    }
    // Shared briefly at the edge: a count seconds old is still the count.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
    if (!store) return res.status(200).json({ counts: {} });
    try {
      return res.status(200).json({ counts: only(await store.read(), numbers) });
    } catch (err) {
      _log(`views: read_failed ${code(err)}`);
      return res.status(200).json({ counts: {} });
    }
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return refuse(res, 405, 'method_not_allowed');
  }
  if (!sameSite(req)) return refuse(res, 403, 'cross_site');
  const number = req.body && typeof req.body === 'object' ? req.body.number : undefined;
  if (typeof number !== 'string' || !NUMBER.test(number)) return refuse(res, 400, 'invalid_number');
  if (!store) return refuse(res, 503, 'not_configured');

  try {
    const counts = await store.read();
    const taken = (Number(counts[number]) || 0) + 1;
    await store.write({ ...counts, [number]: taken });
    return res.status(200).json({ number, count: taken + (BEFORE[number] || 0) });
  } catch (err) {
    _log(`views: write_failed ${code(err)}`);
    return refuse(res, 502, 'store_failed');
  }
};

function refuse(res, status, code) {
  return res.status(status).json({ error: code });
}

function code(err) {
  return err && err.code ? err.code : 'error';
}

// What the store holds, plus what was read before the counter existed, for the
// numbers the page asked about. A number nobody has read yet is left out.
function only(counts, numbers) {
  const out = {};
  for (const n of numbers) {
    const total = (Number(counts[n]) || 0) + (BEFORE[n] || 0);
    if (total > 0) out[n] = total;
  }
  return out;
}

function requestedNumbers(req) {
  const raw = new URL(req.url || '/', 'http://localhost').searchParams.get('n');
  if (!raw) return null;
  const numbers = [...new Set(raw.split(','))];
  if (numbers.length > MAX_NUMBERS || !numbers.every((n) => NUMBER.test(n))) return null;
  return numbers;
}

// A browser always sends Origin on a POST. A request without one, or from another
// site, is not a reading on this site. (This keeps casual inflation out; it is not
// an authentication boundary and does not pretend to be one.)
function sameSite(req) {
  const origin = req.headers && req.headers.origin;
  const host = req.headers && (req.headers['x-forwarded-host'] || req.headers.host);
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The store: one JSON file in Vercel Blob
// ---------------------------------------------------------------------------

function readStore() {
  if (process.env.VIEWS_DEV_MEMORY === '1' && !process.env.VERCEL) return memoryStore();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? blobStore(token) : null;
}

function blobStore(token) {
  const auth = { Authorization: `Bearer ${token}` };
  // The public URL is not known until the file is written, so it is looked up
  // once and kept for the life of the instance.
  let url = null;

  async function api(path, init) {
    const response = await fetch(`${BLOB_API}${path}`, {
      ...init,
      headers: { ...auth, 'x-api-version': '7', ...(init && init.headers) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw fail(response.status);
    return response.json();
  }

  async function locate() {
    if (url) return url;
    const listed = await api(`/?prefix=${encodeURIComponent(BLOB_PATH)}&limit=1`, { method: 'GET' });
    const blob = listed.blobs && listed.blobs[0];
    url = blob ? blob.url : null;
    return url;
  }

  return {
    async read() {
      const at = await locate();
      if (!at) return {};   // nothing written yet: nothing has been read yet
      // Past the CDN copy: a reading taken a second ago must already be in it.
      const response = await fetch(`${at}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
      if (response.status === 404) return {};
      if (!response.ok) throw fail(response.status);
      const body = await response.json();
      return body && typeof body === 'object' ? body : {};
    },
    async write(counts) {
      const put = await api(`/${encodeURI(BLOB_PATH)}`, {
        method: 'PUT',
        headers: {
          'x-content-type': 'application/json',
          'x-access': 'public',
          'x-add-random-suffix': '0',
          'x-cache-control-max-age': '60',
          'x-allow-overwrite': '1',
        },
        body: JSON.stringify(counts),
      });
      if (put && put.url) url = put.url;
    },
  };
}

function fail(status) {
  const err = new Error('store request failed');
  err.code = `http_${status}`;
  return err;
}

function memoryStore() {
  return {
    read: async () => ({ ...memory.counts }),
    write: async (counts) => { memory.counts = { ...counts }; },
  };
}

module.exports._setStore = (store) => { _store = store; };
module.exports._setLog = (log) => { _log = log; };
module.exports.blobStore = blobStore;
module.exports.BEFORE = BEFORE;
