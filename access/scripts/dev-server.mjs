import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import handler from '../api/access.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const origin = process.env.ACCESS_LOCAL_ORIGIN;
if (!origin || !/^http:\/\/localhost:\d{2,5}$/.test(origin)) throw new Error('Set ACCESS_LOCAL_ORIGIN=http://localhost:<port>');
const port = Number(new URL(origin).port);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store, max-age=0',
};

createServer(async (req, res) => {
  Object.entries(securityHeaders).forEach(([name, value]) => res.setHeader(name, value));
  if (req.url?.split('?', 1)[0] === '/api/access') return handler(req, res);
  const pathname = decodeURIComponent(new URL(req.url || '/', origin).pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = resolve(root, relative);
  if (!target.startsWith(`${root}/`)) { res.statusCode = 404; return res.end('Not found'); }
  try {
    if (!(await stat(target)).isFile()) throw new Error('not file');
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    createReadStream(target).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => process.stdout.write(`PROBNAYA Access local server: ${origin}\n`));
