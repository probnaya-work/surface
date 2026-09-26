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

test('the interest message passes the intake endpoint unchanged in meaning', async () => {
  const { interestPayload, INTEREST_LIMITS } = await loadObject();
  const result = handler.validate(interestPayload({ email: 'reader@example.org', website: '' }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.channel, 'B');
  assert.equal(result.from, 'reader@example.org');
  assert.equal(result.body, 'OBJECT 001 — EX– · INTEREST\nNON-BINDING · NO PAYMENT TAKEN · NO POSTAL ADDRESS TAKEN');

  const longest = interestPayload({ email: 'e'.repeat(INTEREST_LIMITS.email) });
  assert.equal(handler.validate(longest).ok, true, handler.validate(longest).error);
  assert.equal(handler.validate(interestPayload({ email: '' })).ok, false, 'an empty address is refused');
  assert.match(page, new RegExp(`id="ex-email"[^>]*maxlength="${INTEREST_LIMITS.email}"`));
});

test('the form asks for an email and nothing else', () => {
  const form = page.slice(page.indexOf('<form id="ex-form"'), page.indexOf('</form>'));
  const fields = [...form.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(fields.length, 2, 'the email and the honeypot');
  assert.match(fields[0], /id="ex-email"[^>]*type="email"[^>]*required/);
  assert.match(fields[1], /id="ex-hp"[^>]*tabindex="-1"/);
});

test('interest arrives as one channel B intake mail naming the object', async () => {
  const { interestPayload } = await loadObject();
  const seen = {};
  handler._setMailer({ createTransport: () => ({ sendMail: async (m) => { seen.message = m; } }) });
  const env = { ...process.env };
  Object.assign(process.env, { SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'from@probnaya.work' });
  try {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: {}, body: interestPayload({ email: 'reader@example.org' }) }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.ok, true);
    assert.equal(seen.message.subject, 'INTAKE / CHANNEL B — reader@example.org');
    assert.equal(seen.message.replyTo, 'reader@example.org');
    assert.match(seen.message.text, /\nOBJECT 001 — EX– · INTEREST\nNON-BINDING/);
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
    await handler({ method: 'POST', headers: {}, body: interestPayload({ email: 'y@z.io', website: 'http://spam' }) }, res);
    assert.equal(res.code, 200);
    assert.equal(sent, false);
  } finally {
    handler._setMailer(null);
  }
});

test('the wallpaper pack is the primary action and carries all six files', () => {
  assert.match(page, /<a class="ex-primary" href="\/objects\/001\/wallpapers\/probnaya-ex-wallpapers\.zip" download>/);
  const pngs = manifest.runtimeFiles.filter((f) => /wallpapers\/probnaya-ex-(dark|light|interlaced)-/.test(f));
  assert.equal(pngs.length, 6);
});

test('each objects page shares its own 1200 × 630 image, with the same alt on both cards', () => {
  for (const [file, image] of [['objects/index.html', 'og-objects-1200x630.png'], ['objects/001/index.html', 'og-object-001-1200x630.png']]) {
    const html = fs.readFileSync(path.join(surface, file), 'utf8');
    const url = `https://probnaya.work/assets/${image}`;
    assert.match(html, new RegExp(`<meta property="og:image" content="${url}">`), file);
    assert.match(html, new RegExp(`<meta name="twitter:image" content="${url}">`), file);
    const alts = [...html.matchAll(/<meta (?:property="og:image:alt"|name="twitter:image:alt") content="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(alts.length, 2, file);
    assert.equal(alts[0], alts[1], file);
    const png = fs.readFileSync(path.join(surface, 'assets', image));
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], image);
  }
});

test('the objects pages are in the sitemap', () => {
  const sitemap = fs.readFileSync(path.join(surface, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/probnaya\.work\/objects<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/probnaya\.work\/objects\/001<\/loc>/);
});
