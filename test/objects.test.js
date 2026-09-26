'use strict';

// Object 001 is issued from probnaya-work/objects (ex/) into objects/001 by
// scripts/sync-ex.sh. These tests hold the copied artifact to its manifest and
// hold the interest form to the intake endpoint it posts to.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const handler = require('../api/intake.js');

const surface = path.resolve(__dirname, '..');
const artifact = path.join(surface, 'objects/001');
const manifest = JSON.parse(fs.readFileSync(path.join(artifact, 'SOURCE.json'), 'utf8'));
const page = fs.readFileSync(path.join(artifact, 'index.html'), 'utf8');
const loadObject = () => import(pathToFileURL(path.join(artifact, 'js/object.js')).href);

function files(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(path.join(dir, entry.name), prefix + entry.name + '/')
    : [prefix + entry.name]);
}

test('the artifact holds its runtime files, the manifest and the surface page, nothing else', () => {
  assert.equal(manifest.source, 'probnaya-work/objects/ex');
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.surfaceOwned, 'index.html');
  assert.deepEqual(files(artifact).sort(), [...manifest.runtimeFiles, 'SOURCE.json', 'index.html'].sort());
  const script = fs.readFileSync(path.join(surface, 'scripts/sync-ex.sh'), 'utf8');
  assert.match(script, /Refusing to sync from a modified objects\/ex tree/);
});

test('every runtime import is part of the artifact', () => {
  for (const file of manifest.runtimeFiles.filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(artifact, file), 'utf8');
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      assert.ok(manifest.runtimeFiles.includes(target), `${file} imports ${target}`);
    }
  }
});

test('the page links only wallpapers the artifact carries, by absolute path', () => {
  const linked = [...page.matchAll(/(?:(?:href|src)="|from ')\/objects\/001\/([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(linked.includes('js/page.js'));
  for (const file of linked) assert.ok(manifest.runtimeFiles.includes(file), `${file} is in the artifact`);
  for (const file of manifest.runtimeFiles.filter((f) => f.startsWith('wallpapers/'))) {
    assert.ok(linked.includes(file), `${file} is offered on the page`);
  }
  assert.doesNotMatch(page, /(?:href|src)="(?:\.\/)?(?:js|wallpapers)\//, 'relative paths break at /objects/001 without a slash');
});

test('the page carries every element the behaviour addresses', () => {
  const behaviour = fs.readFileSync(path.join(artifact, 'js/page.js'), 'utf8');
  const ids = [...new Set([...behaviour.matchAll(/getElementById\('([^']+)'\)|field\('([^']+)'\)/g)].map((m) => m[1] || m[2]))];
  assert.ok(ids.length >= 10);
  for (const id of ids) assert.match(page, new RegExp(`id="${id}"`), `#${id}`);
});

test('no download link sits inside another link', () => {
  for (const block of page.split('<div class="ex-download">').slice(1)) {
    const card = block.slice(0, block.indexOf('</div>'));
    let depth = 0;
    for (const tag of card.matchAll(/<(\/?)a\b/g)) {
      depth += tag[1] ? -1 : 1;
      assert.ok(depth <= 1, 'nested <a>');
    }
  }
});

test('the interest message passes the intake endpoint unchanged in meaning', async () => {
  const { interestPayload, INTEREST_LIMITS } = await loadObject();
  const payload = interestPayload({ name: 'A Reader', email: 'reader@example.org', note: 'One for the wall.', website: '' });
  const result = handler.validate(payload);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.channel, 'B');
  assert.match(result.body, /^OBJECT 001 — EX– · INTEREST\nNON-BINDING · NO PAYMENT TAKEN · NO POSTAL ADDRESS TAKEN\n\nOne for the wall\.$/);

  const longest = interestPayload({
    name: 'n'.repeat(INTEREST_LIMITS.name),
    email: 'e'.repeat(INTEREST_LIMITS.email),
    note: 'x'.repeat(INTEREST_LIMITS.note),
  });
  assert.equal(handler.validate(longest).ok, true, handler.validate(longest).error);
  assert.match(page, new RegExp(`id="ex-note"[^>]*maxlength="${INTEREST_LIMITS.note}"`));
});

test('interest arrives as one channel B intake mail naming the object', async () => {
  const { interestPayload } = await loadObject();
  const seen = {};
  handler._setMailer({ createTransport: () => ({ sendMail: async (m) => { seen.message = m; } }) });
  const env = { ...process.env };
  Object.assign(process.env, { SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'from@probnaya.work' });
  try {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: {}, body: interestPayload({ name: 'A Reader', email: 'reader@example.org' }) }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.ok, true);
    assert.equal(seen.message.subject, 'INTAKE / CHANNEL B — A Reader');
    assert.equal(seen.message.replyTo, 'reader@example.org');
    assert.match(seen.message.text, /\nOBJECT 001 — EX– · INTEREST\n/);
    assert.match(seen.message.text, /\n\(no note\)\n/);
  } finally {
    process.env = env;
    handler._setMailer(null);
  }
});

test('a filled honeypot is accepted and never mailed', async () => {
  const { interestPayload } = await loadObject();
  let sent = false;
  handler._setMailer({ createTransport: () => ({ sendMail: async () => { sent = true; } }) });
  try {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: {}, body: interestPayload({ name: 'x', email: 'y@z.io', website: 'http://spam' }) }, res);
    assert.equal(res.code, 200);
    assert.equal(sent, false);
  } finally {
    handler._setMailer(null);
  }
});

test('the objects pages are in the sitemap', () => {
  const sitemap = fs.readFileSync(path.join(surface, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/probnaya\.work\/objects<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/probnaya\.work\/objects\/001<\/loc>/);
});
