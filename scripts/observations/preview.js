'use strict';

// Serves the site locally with one draft placed in the sequence, rendered by the
// same template and the same build plan as publication. Nothing is written: the
// index and the sheets are rendered on each request, so an edit to the record,
// the text, or an image shows on reload. Every rendered page is noindex.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const records = require('./records');
const { plan, INDEX_FILE } = require('./build');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// The draft as it would read if it were published now. Returns { item, problems }.
function previewItem(root, number, { now = Date.now() } = {}) {
  const where = records.locate(root, number);
  if (!where) return { item: null, problems: [`no Observation "${number}"`] };
  if (where === 'both') return { item: null, problems: [`"${number}" exists both as a draft and as published`] };
  const item = records.inspect(root, number, where, { now });
  const expected = (m) => where === 'draft' && /^a draft has no published_at/.test(m);
  const problems = item.errors.filter((m) => !expected(m));
  const record = item.record;
  const renderable = record && Array.isArray(record.blocks) &&
    item.blocks.length > 0 && item.blocks.length === record.blocks.length;
  if (!renderable) return { item: null, problems };
  if (where === 'published') return { item: null, published: true, problems };
  const publishedAt = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { item: { ...item, record: { ...record, status: 'published', published_at: publishedAt } }, problems };
}

function resolveStatic(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.split('/').some((seg) => seg.startsWith('.') || seg.startsWith('_'))) return null;
  const target = path.resolve(root, '.' + path.posix.normalize(decoded));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  const base = path.basename(target);
  if (base === records.RECORD_FILE || /^body(-\d+)?\.(md|txt)$/.test(base)) return null; // never deployed either
  const candidates = [target];
  if (!path.extname(target)) candidates.push(target + '.html', path.join(target, 'index.html'));
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

function startPreview(root, number, { port = 4177, log = console.log } = {}) {
  const server = http.createServer((req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    let urlPath;
    try { urlPath = new URL(req.url, 'http://localhost').pathname; } catch { return send(400, 'text/plain', 'Bad request'); }

    // The draft's own images, from the draft directory.
    const imagePrefix = `/observations/${number}/images/`;
    if (urlPath.startsWith(imagePrefix)) {
      const where = records.locate(root, number);
      const dir = where && records.recordDir(root, number, where === 'both' ? 'draft' : where);
      const rel = decodeURIComponent(urlPath.slice(`/observations/${number}/`.length));
      if (!dir || records.safeRelative(dir, rel)) return send(404, 'text/plain; charset=utf-8', 'Not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(path.join(dir, rel)).pipe(res);
    }

    const page = /^\/observations(?:\/([a-z0-9-]+))?\/?$/.exec(urlPath);
    if (page || urlPath === '/observations.html') {
      let rendered;
      try {
        const { item, problems, published } = previewItem(root, number);
        if (!item && !published) return send(409, 'text/plain; charset=utf-8', `Cannot preview "${number}":\n${problems.join('\n')}`);
        rendered = plan(root, { extra: item ? [item] : [], robots: 'noindex, nofollow' });
      } catch (err) {
        return send(500, 'text/plain; charset=utf-8', err.message);
      }
      const want = page && page[1]
        ? rendered.items.find((it) => it.number === page[1])
        : null;
      if (page && page[1] && !want) return send(404, 'text/plain; charset=utf-8', 'Not found');
      const file = want
        ? path.join(path.relative(root, want.dir), records.GENERATED_FILE)
        : INDEX_FILE;
      let html = rendered.files.find((f) => f.file === file).content;
      if (file === INDEX_FILE) html = html.replace('<meta name="viewport"', '<meta name="robots" content="noindex, nofollow">\n<meta name="viewport"');
      return send(200, 'text/html; charset=utf-8', html);
    }

    if (urlPath.startsWith('/api/')) return send(404, 'application/json', '{"error":"Not available in preview"}');
    const file = resolveStatic(root, urlPath);
    if (!file) return send(404, 'text/plain; charset=utf-8', `404 Not Found: ${urlPath}`);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      log(`Preview of "${number}" (not published, noindex):`);
      log(`  its own sheet  http://localhost:${actual}/observations/${number}`);
      log(`  in the index   http://localhost:${actual}/observations#${number}`);
      log('Reload after editing. Ctrl-C to stop.');
      resolve(server);
    });
  });
}

module.exports = { previewItem, startPreview };
