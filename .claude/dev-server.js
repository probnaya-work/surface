// Local dev server. Not deployed — Vercel does not serve dot-directories.
//
// `python3 -m http.server` cannot reproduce production routing: it has no
// cleanUrls, no redirects and no serverless functions, so every extensionless
// link on the site (/intake, /instruments, /lab) 404s locally and the intake
// form has nothing to POST to. This mirrors the three things vercel.json and
// the api/ directory give us in production, and nothing else.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4173;

// Mirrors vercel.json "redirects".
const REDIRECTS = [
  { from: '/index', to: '/' },
  { from: '/index.html', to: '/' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Resolve a URL path to a file inside ROOT, or null. Refuses to escape ROOT.
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  // Vercel does not serve dotfiles. Neither do we — .env lives in this root.
  if (decoded.split('/').some((seg) => seg.startsWith('.') && seg !== '')) return null;
  const target = path.resolve(ROOT, '.' + path.posix.normalize(decoded));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;

  const candidates = [target];
  // cleanUrls: /intake -> intake.html
  if (!path.extname(target)) {
    candidates.push(target + '.html', path.join(target, 'index.html'));
  }
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// Minimal stand-in for the Vercel Node request/response helpers the handlers use.
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return res;
  };
  return res;
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  decorate(res);
  const urlPath = new URL(req.url, 'http://localhost').pathname;

  const redirect = REDIRECTS.find((r) => r.from === urlPath);
  if (redirect) {
    res.writeHead(308, { Location: redirect.to });
    res.end();
    return;
  }

  // Serverless functions: /api/intake -> api/intake.js
  if (urlPath.startsWith('/api/')) {
    const name = urlPath.slice('/api/'.length);
    const file = path.join(ROOT, 'api', name + '.js');
    if (!/^[a-z0-9_-]+$/i.test(name) || !fs.existsSync(file)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      req.body = await readJsonBody(req);
      // Re-require each request so handler edits take effect without a restart.
      delete require.cache[require.resolve(file)];
      await require(file)(req, res);
    } catch (err) {
      console.error(`[api] ${urlPath} threw:`, err);
      if (!res.headersSent) res.status(500).json({ error: 'Handler failed' });
    }
    return;
  }

  const file = resolveFile(urlPath);
  if (!file) {
    res.status(404);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('404 Not Found: ' + urlPath);
    return;
  }

  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`PROBNAYA dev server on http://localhost:${PORT}`);
  console.log('cleanUrls + /api functions, mirroring vercel.json');
});
