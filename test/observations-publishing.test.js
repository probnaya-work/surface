'use strict';

// Tests for the Observations publishing workflow (scripts/observations/). Every
// test works in a temporary copy of the pages it touches, with FIXTURE material
// from test/fixtures/observations/; nothing here writes into the repository,
// and nothing contacts git, the network, or a deployment.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const records = require('../scripts/observations/records');
const render = require('../scripts/observations/render');
const { build, plan } = require('../scripts/observations/build');
const workflow = require('../scripts/observations/workflow');
const { probeImage } = require('../scripts/observations/images');
const { startPreview } = require('../scripts/observations/preview');
const { FIXTURES, TEXT_PLAIN, TEXT_MD, makePng, makeJpegHeader, materialise } = require('./fixtures/observations/fixtures');

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

function tempSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-site-'));
  for (const f of ['observations.html', 'sitemap.xml']) fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  return root;
}

function tempDir(prefix = 'obs-src-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Fixtures are named in tests for readability; on disk and in every address they
// are their archival number. N() turns a fixture name into its number.
const N = (key) => (FIXTURES.find((f) => f.name === key) || { number: key }).number;

function draftFixture(root, name) {
  const f = FIXTURES.find((x) => x.name === name);
  return workflow.createDraft(root, materialise(f, path.join(tempDir(), f.name)));
}

function publishFixture(root, name) {
  const f = FIXTURES.find((x) => x.name === name);
  draftFixture(root, name);
  return workflow.publish(root, f.number, { date: f.date, now: NOW });
}

function seedAll(root, order = FIXTURES.map((f) => f.name)) {
  for (const name of order) publishFixture(root, name);
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sheet = (root, key) => read(root, `observations/${N(key)}/index.html`);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function unescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
function between(html, open, close) {
  const out = [];
  let at = 0;
  for (;;) {
    const a = html.indexOf(open, at);
    if (a < 0) return out;
    const b = html.indexOf(close, a + open.length);
    out.push(html.slice(a + open.length, b));
    at = b + close.length;
  }
}
// The <li> for one Observation (a fixture name or a number) in observations.html.
function indexEntry(root, key) {
  const html = read(root, 'observations.html');
  const a = html.indexOf(`<li class="observation" id="${N(key)}">`);
  assert.ok(a >= 0, `${key} is in the index`);
  const next = html.indexOf('\n<li class="observation"', a + 1);
  return html.slice(a, next > 0 ? next : html.indexOf('<!-- END GENERATED: observations-sequence', a));
}

// ---------------------------------------------------------------------------

describe('content combinations', () => {
  const root = tempSite();
  seedAll(root);

  test('text only: paragraphs, no figure, and who it is from stated once, in the margin', () => {
    const li = indexEntry(root, 'fixture-text-only');
    assert.match(li, /<div class="obs-text">/);
    assert.doesNotMatch(li, /<figure|obs-things/);
    assert.match(li, /<p class="obs-from"><span>FROM<\/span><span class="obs-from-name">Fixture Sender<\/span><span class="visually-hidden">, <\/span><span class="obs-context">fixture context line<\/span><\/p>/);
    assert.doesNotMatch(li, /obs-sender|obs-name/, 'no signature line under the material');
    assert.equal(li.split('Fixture Sender').length - 1, 2, 'the name once in the margin, once in the hidden heading');
    assert.doesNotMatch(li, /class="obs-title"/, 'no visible title when none was given');
    assert.match(li, /<h2 class="visually-hidden">From Fixture Sender, 7 Oct 2025<\/h2>/);
  });

  test('one image only, unsigned: a figure, no text block, no caption, no context', () => {
    const li = indexEntry(root, 'fixture-image-only');
    assert.equal((li.match(/<figure/g) || []).length, 1);
    assert.match(li, /obs-things--upright/);
    assert.doesNotMatch(li, /obs-text|obs-caption|obs-context|obs-role/);
    assert.match(li, /<span class="obs-from-name">UNSIGNED<\/span>/);
    assert.doesNotMatch(li, /obs-sender/);
    assert.match(li, /alt="FIXTURE: a synthetic portrait-format test card, a blue frame and a dark cross."/);
    assert.match(li, /width="900" height="1600"/);
  });

  test('several images only: each keeps its ratio, captions only where given', () => {
    const li = indexEntry(root, 'fixture-images-only');
    assert.match(li, /obs-things--several/);
    assert.equal((li.match(/<figure/g) || []).length, 3);
    assert.equal((li.match(/class="obs-caption"/g) || []).length, 1);
    assert.match(li, /width="1600" height="1000"/);
    assert.match(li, /width="1000" height="1000"/);
    assert.match(li, /width="600" height="2400"/);
    assert.match(li, /style="--w: 600px; --r: 0.25"/);
    assert.doesNotMatch(li, /obs-text/);
  });

  test('an image declared before the text, a title, and a quiet role', () => {
    const li = indexEntry(root, 'fixture-image-then-text');
    assert.match(li, /<h2 class="obs-title">FIXTURE — a title the sender gave<\/h2>/);
    assert.match(li, /obs-things--wide/);
    assert.match(li, /<span class="obs-from-name">Fixture Principal<\/span><span class="visually-hidden">, <\/span><span class="obs-role">PRINCIPAL, PROBNAYA<\/span>/);
    assert.doesNotMatch(li, /obs-context/);
    // The role is a quiet line in the margin; nothing else sets the author apart.
    assert.doesNotMatch(li, /obs-sender/);
    assert.ok(li.indexOf('<figure') < li.indexOf('obs-text'), 'the image comes first, as declared');
  });

  test('text declared before an image stays before it', () => {
    const li = indexEntry(root, 'fixture-text-then-image');
    assert.ok(li.indexOf('obs-text') < li.indexOf('<figure'), 'the text comes first, as declared');
    assert.match(li, /obs-things--upright/);
  });

  test('interleaved blocks keep their declared order; consecutive images share a row', () => {
    const li = indexEntry(root, 'fixture-interleaved');
    const order = [...li.matchAll(/class="obs-(text|things obs-things--\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['text', 'things obs-things--wide', 'text', 'things obs-things--several']);
    assert.ok(li.indexOf('A heading the sender wrote') < li.indexOf('card A') && li.indexOf('card A') < li.indexOf('A second text block') &&
      li.indexOf('A second text block') < li.indexOf('card B'));
    assert.match(li, /\(image 1 of 3,/);
    assert.match(li, /\(image 3 of 3,/);
  });

  test('text with several images and Markdown structure', () => {
    const li = indexEntry(root, 'fixture-interleaved');
    assert.equal((li.match(/<figure/g) || []).length, 3);
    assert.equal((li.match(/class="obs-caption"/g) || []).length, 2);
    assert.match(li, /<h3 class="obs-h">1\. A heading the sender wrote<\/h3>/);
    assert.match(li, /<ul class="obs-list"><li>a first item<\/li><li>a second item, with an emoji 💤<\/li><li>a third item<\/li><\/ul>/);
    assert.match(li, /<hr class="obs-rule">/);
    assert.match(li, /<p>A paragraph with <em>italic<\/em>, <strong>bold<\/strong>, and _underscores_ that stay as typed\.<\/p>/);
    assert.match(li, /<p>1\. Numbered lines stay as typed\n2\. with their own numbers<\/p>/);
  });

  test('a small original is never enlarged past its own pixels', () => {
    const li = indexEntry(root, 'fixture-small-original');
    assert.match(li, /style="--w: 240px; --r: 1.5"/);
    const css = fs.readFileSync(path.join(REPO, 'css/style.css'), 'utf8');
    assert.match(css, /max-width: min\(var\(--maxw\), var\(--w\), calc\(88vh \* var\(--r\)\)\)/);
    assert.doesNotMatch(css, /\.obs-thing img[^}]*object-fit:\s*cover/, 'images are never cropped');
  });

  test('every image has alt text and an original to open; nothing is empty', () => {
    const page = read(root, 'observations.html');
    const html = page.slice(page.indexOf('BEGIN GENERATED: observations-sequence'), page.indexOf('END GENERATED: observations-sequence'));
    for (const img of html.match(/<img [^>]+>/g)) assert.match(img, /alt="[^"]+"/);
    assert.equal((html.match(/<figure/g) || []).length, (html.match(/OPEN ORIGINAL/g) || []).length);
    assert.doesNotMatch(html, /<(p|span|h2|figcaption|div)( class="[^"]*")?><\/\1>/, 'no empty elements');
    assert.doesNotMatch(html, /class="obs-caption"><\/span>|class="obs-context"><\/span>/);
  });

  test('each Observation has its own sheet with canonical and social metadata', () => {
    const page = sheet(root, 'fixture-image-then-text');
    assert.match(page, /<link rel="canonical" href="https:\/\/probnaya\.work\/observations\/904">/);
    assert.match(page, /<title>FIXTURE — a title the sender gave — Observations — PROBNAYA<\/title>/);
    assert.match(page, /<meta property="og:type" content="article">/);
    // Even an Observation with its own image shares the section's image.
    assert.match(page, /<meta property="og:image" content="https:\/\/probnaya\.work\/assets\/og-observations-1200x630\.png">/);
    assert.doesNotMatch(page, /og:image" content="[^"]*\/observations\/904\//);
    assert.match(page, /<meta name="author" content="Fixture Principal">/);
    assert.match(page, /<meta property="article:published_time" content="2025-12-02">/);
    assert.match(page, /<meta name="description" content="An observation by Fixture Principal, published as sent by PROBNAYA\.">/);
    assert.match(page, /<h1 class="obs-title">/);
    assert.doesNotMatch(page, /name="robots"/);
    assert.match(page, /<a class="nav-link nav-divided" href="\/observations" aria-current="true">/);
    assert.match(page, /href="\/css\/style\.css"/, 'assets are addressed from the root');

    const textOnly = sheet(root, 'fixture-text-only');
    assert.match(textOnly, /<meta property="og:image" content="https:\/\/probnaya\.work\/assets\/og-observations-1200x630\.png">/);
    assert.doesNotMatch(sheet(root, 'fixture-image-only'), /name="author"/, 'an unsigned Observation names no author');
    assert.match(textOnly, /<h1 class="visually-hidden">From Fixture Sender, 7 Oct 2025<\/h1>/);
    assert.match(sheet(root, 'fixture-image-only'), /<meta name="description" content="An unsigned observation, published as sent by PROBNAYA\.">/);
  });

  test('sheets link to the pieces published before and after', () => {
    // 901 and 902 share a date, so 901 reads first.
    const first = sheet(root, 'fixture-text-only');
    const middle = sheet(root, 'fixture-images-only');
    const last = sheet(root, 'fixture-small-original');
    assert.doesNotMatch(first, /rel="prev"/);
    assert.match(first, /rel="next" href="\/observations\/902"/);
    assert.match(middle, /rel="prev" href="\/observations\/902"/);
    assert.match(middle, /rel="next" href="\/observations\/904"/);
    assert.doesNotMatch(last, /rel="next"/);
  });

  test('the index states its extent without a count and links every date to its sheet', () => {
    const html = read(root, 'observations.html');
    assert.match(html, /<p>SENT BY OTHERS · PUBLISHED BY PROBNAYA · PUBLISHED SINCE OCT 2025<\/p>/);
    // The total number of publications is never displayed, in words or digits.
    const extent = /BEGIN GENERATED: observations-extent[^>]*-->([\s\S]*?)<!-- END GENERATED/.exec(html)[1];
    assert.doesNotMatch(extent, /\b(7|SEVEN)\b|\d+\s+(SINCE|OBSERVATIONS?|PIECES?|PUBLISHED)/i);
    const visible = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(visible, /\b7\s+(SINCE|OBSERVATIONS?|PIECES?)\b/i);
    for (const f of FIXTURES) assert.match(html, new RegExp(`<a class="obs-date" href="/observations/${f.number}">`));
  });

  test('the sitemap lists every published sheet once', () => {
    const map = read(root, 'sitemap.xml');
    for (const f of FIXTURES) assert.equal(map.split(`<loc>https://probnaya.work/observations/${f.number}</loc>`).length, 2);
  });
});

describe('preservation of the contributor’s text', () => {
  test('plain text is shown exactly: breaks, spacing, emoji, markup as text', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    const paras = between(indexEntry(root, 'fixture-text-only'), '<p>', '</p>').map(unescape);
    assert.deepEqual(paras, TEXT_PLAIN.split('\n\n'));
    const html = read(root, 'observations.html');
    assert.doesNotMatch(html, /<script>window|<img src=x|<b>not bold|<a href="https:\/\/example\.com/);
    assert.match(html, /&lt;script&gt;window\.__executed = true&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=&quot;window\.__executed = true&quot;&gt;/);
  });

  test('Markdown text keeps every word and character outside the three structures', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-interleaved');
    const li = indexEntry(root, 'fixture-interleaved');
    const shown = unescape(li.slice(li.indexOf('<div class="obs-text">'), li.lastIndexOf('</div>\n</div>')).replace(/<\/?(strong|em)>/g, '').replace(/<[^>]+>/g, '\u0000'));
    for (const line of TEXT_MD.split('\n').filter((l) => l && l !== '---')) {
      const words = line.replace(/^(#+|[-*]) /, '').replace(/\*/g, '');
      assert.ok(shown.includes(words), `"${words}" is shown`);
    }
  });

  test('CRLF files, a byte-order mark, and surrounding blank lines change nothing that is read', () => {
    assert.deepEqual(render.parseBody('\uFEFF\r\n\r\nOne\r\ntwo\r\n\r\n\r\nThree\r\n\r\n', 'txt'), [{ t: 'p', text: 'One\ntwo' }, { t: 'p', text: 'Three' }]);
  });

  test('publishing and rebuilding never modify the text or image files', () => {
    const root = tempSite();
    const src = tempDir();
    const f = FIXTURES.find((x) => x.name === 'fixture-interleaved');
    const spec = materialise(f, src);
    const before = spec.blocks.map((b) => sha(b.text || b.image));
    workflow.createDraft(root, spec);
    workflow.publish(root, f.number, { date: f.date, now: NOW });
    build(root, { now: NOW });
    const dir = path.join(root, 'observations', f.number);
    const after = ['body.md', `images/${f.number}-1.png`, 'body-2.txt', `images/${f.number}-2.png`, `images/${f.number}-3.png`].map((p) => sha(path.join(dir, p)));
    assert.deepEqual(after, before);
  });

  test('title, name, context, alt, and caption are escaped, not interpreted', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'a.png'), makePng(40, 30));
    workflow.createDraft(root, {
      number: '001', title: 'A <b>title</b> & “more”', author: 'O\'Brien <x>', context: 'a "context"',
      blocks: [{ image: path.join(src, 'a.png'), alt: 'alt "quoted" <img>', caption: 'cap & <i>tion</i>' }],
    });
    workflow.publish(root, '001', { date: '2026-01-01', now: NOW });
    const li = indexEntry(root, '001');
    assert.match(li, /A &lt;b&gt;title&lt;\/b&gt; &amp; “more”/);
    assert.match(li, /O&#39;Brien &lt;x&gt;/);
    assert.match(li, /alt="alt &quot;quoted&quot; &lt;img&gt;"/);
    assert.match(li, /cap &amp; &lt;i&gt;tion&lt;\/i&gt;/);
    assert.doesNotMatch(li, /<b>|<x>|<i>/);
  });
});

describe('drafts are never public', () => {
  test('a draft is absent from the index, the sitemap, and the generated pages', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    draftFixture(root, 'fixture-image-only');
    build(root, { now: NOW });
    const html = read(root, 'observations.html');
    assert.doesNotMatch(html, /902/);
    assert.doesNotMatch(read(root, 'sitemap.xml'), /902/);
    assert.ok(!fs.existsSync(path.join(root, 'observations/_drafts/902/index.html')));
    assert.ok(!fs.existsSync(path.join(root, 'observations/902')));
    assert.doesNotMatch(sheet(root, 'fixture-text-only'), /902/);
  });

  test('git and Vercel both ignore drafts; Vercel never deploys a record or its text file', () => {
    const gitignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    const vercelignore = fs.readFileSync(path.join(REPO, '.vercelignore'), 'utf8').split('\n');
    assert.match(gitignore, /^\/observations\/_drafts\/$/m);
    for (const line of ['observations/_drafts/', 'observations/*/*', '!observations/*/index.html', '!observations/*/images/']) {
      assert.ok(vercelignore.includes(line), `.vercelignore has ${line}`);
    }
  });

  test('a draft with status "published" and a published record with status "draft" are both refused', () => {
    const root = tempSite();
    draftFixture(root, 'fixture-text-only');
    const dir = path.join(root, 'observations/_drafts/901');
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'observation.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'observation.json'), JSON.stringify({ ...rec, status: 'published', published_at: '2027-01-01' }));
    const r = records.inspect(root, '901', 'draft', { now: NOW });
    assert.ok(r.errors.some((e) => /status is "published" but the record is in observations\/_drafts/.test(e)));
    assert.ok(r.errors.some((e) => /a draft has no published_at/.test(e)));

    const root2 = tempSite();
    publishFixture(root2, 'fixture-text-only');
    const pdir = path.join(root2, 'observations/901');
    const prec = JSON.parse(fs.readFileSync(path.join(pdir, 'observation.json'), 'utf8'));
    fs.writeFileSync(path.join(pdir, 'observation.json'), JSON.stringify({ ...prec, status: 'draft' }));
    assert.throws(() => build(root2, { now: NOW }), /status is "draft" but the record is in observations\//);
  });

  test('unpublishing withdraws the sheet, the index entry, and the sitemap entry', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    publishFixture(root, 'fixture-image-only');
    workflow.unpublish(root, '901', { now: NOW });
    assert.doesNotMatch(read(root, 'observations.html'), /901/);
    assert.doesNotMatch(read(root, 'sitemap.xml'), /901/);
    assert.ok(!fs.existsSync(path.join(root, 'observations/901')));
    const back = path.join(root, 'observations/_drafts/901');
    assert.ok(!fs.existsSync(path.join(back, 'index.html')));
    const rec = JSON.parse(fs.readFileSync(path.join(back, 'observation.json'), 'utf8'));
    assert.equal(rec.status, 'draft');
    assert.equal(rec.published_at, undefined);
    assert.deepEqual(records.inspect(root, '901', 'draft').errors, []);
  });
});

describe('deterministic output', () => {
  test('the index shows the newest first, whatever order they were published in', () => {
    const root = tempSite();
    seedAll(root, FIXTURES.map((f) => f.name).reverse());
    const html = read(root, 'observations.html');
    const order = [...html.matchAll(/<li class="observation" id="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(order, [
      '907', '906', '905', '904', '903',
      '902', '901',   // the same day: the later number first
    ]);
    assert.match(html, /aria-label="Published observations, newest first"/);
    // The extent still dates from the earliest publication.
    assert.match(html, /PUBLISHED SINCE OCT 2025/);
  });

  test('a publication instant orders pieces published on the same day', () => {
    assert.ok(records.parsePublishedAt('2027-01-01T09:00:00Z') < records.parsePublishedAt('2027-01-01T10:00:00Z'));
    const items = records.sortRecords([
      { number: '001', record: { published_at: '2027-01-01T10:00:00Z' } },
      { number: '002', record: { published_at: '2027-01-01T09:00:00Z' } },
    ]);
    assert.deepEqual(items.map((i) => i.number), ['002', '001']);
  });

  test('two sites built in different orders are byte-identical, and a rebuild changes nothing', () => {
    const a = tempSite();
    const b = tempSite();
    seedAll(a);
    seedAll(b, FIXTURES.map((f) => f.name).reverse());
    for (const file of ['observations.html', 'sitemap.xml', ...FIXTURES.map((f) => `observations/${f.number}/index.html`)]) {
      assert.equal(read(a, file), read(b, file), file);
    }
    assert.deepEqual(build(a, { now: NOW }).changed, []);
    assert.deepEqual(build(a, { check: true, now: NOW }).changed, []);
  });

  test('build --check notices a hand edit to a generated region and does not write', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    const file = path.join(root, 'observations.html');
    const edited = read(root, 'observations.html').replace('fixture context line', 'edited by hand');
    fs.writeFileSync(file, edited);
    assert.deepEqual(build(root, { check: true, now: NOW }).changed, ['observations.html']);
    assert.equal(read(root, 'observations.html'), edited);
    build(root, { now: NOW });
    assert.match(read(root, 'observations.html'), /fixture context line/);
  });

  test('the repository’s own generated pages are up to date', () => {
    assert.deepEqual(build(REPO, { check: true }).changed, []);
  });
});

describe('refusals and validation', () => {
  test('a number is never used twice: not by a new draft, not by publishing over it', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    assert.throws(() => draftFixture(root, 'fixture-text-only'), /already used by a published Observation/);
    draftFixture(root, 'fixture-image-only');
    assert.throws(() => draftFixture(root, 'fixture-image-only'), /already used by a draft/);

    // The same number in both places (for example restored by hand) is an error on both.
    fs.cpSync(path.join(root, 'observations/901'), path.join(root, 'observations/_drafts/901'), { recursive: true });
    const both = records.inspectAll(root).filter((r) => r.number === '901');
    assert.equal(both.length, 2);
    for (const r of both) assert.ok(r.errors.some((e) => /exists both as a draft and as a published/.test(e)));
    assert.throws(() => workflow.publish(root, '901', { now: NOW }), /exists both/);
  });

  test('an image is never overwritten: a second image gets the next name', () => {
    const root = tempSite();
    draftFixture(root, 'fixture-image-only');
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'more.png'), makePng(50, 50));
    const first = path.join(root, 'observations/_drafts/902/images/902-1.png');
    const before = sha(first);
    const { result } = workflow.addImage(root, '902', { source: path.join(src, 'more.png'), alt: 'FIXTURE: another card.' });
    assert.equal(sha(first), before);
    assert.deepEqual(result.record.blocks.map((b) => b.image), ['images/902-1.png', 'images/902-2.png']);
    assert.deepEqual(result.errors, []);
  });

  test('only a three-digit archival number is accepted', () => {
    const root = tempSite();
    for (const number of ['', '1', '01', '0001', '000', '1000', 'abc', '1a2', '../1', '_drafts', 'its-late-night-alexis', undefined, 1]) {
      assert.throws(() => workflow.createDraft(root, { number, blocks: [{ text: '/dev/null' }] }), /not an archival number/, String(number));
    }
    // A directory named any other way (for example a title) is refused by validation.
    fs.mkdirSync(path.join(root, 'observations/_drafts/its-late-night-alexis'), { recursive: true });
    const r = records.inspectAll(root).find((x) => x.number === 'its-late-night-alexis');
    assert.ok(r.errors.some((e) => /not an archival number/.test(e)));
  });

  test('a new draft needs text or an image, and alt text for every image', () => {
    const root = tempSite();
    assert.throws(() => workflow.createDraft(root, { number: '001' }), /needs a text file or at least one image/);
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'a.png'), makePng(10, 10));
    assert.throws(() => workflow.createDraft(root, { number: '002', blocks: [{ image: path.join(src, 'a.png'), alt: '  ' }] }), /needs alt text/);
    assert.throws(() => workflow.createDraft(root, { number: '003', blocks: [{ image: path.join(src, 'missing.png'), alt: 'x' }] }), /does not exist/);
    assert.ok(!fs.existsSync(path.join(root, 'observations/_drafts/003')), 'a failed draft leaves nothing behind');
  });

  function brokenDraft(mutate) {
    const root = tempSite();
    draftFixture(root, 'fixture-images-only');
    const dir = path.join(root, 'observations/_drafts/903');
    const file = path.join(dir, 'observation.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(rec, dir);
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    return { root, errors: records.inspect(root, '903', 'draft', { now: NOW }).errors };
  }

  test('a missing image file is an error, and publishing is refused', () => {
    const { root, errors } = brokenDraft((rec) => { rec.blocks[1].image = 'images/not-there.png'; });
    assert.ok(errors.some((e) => /block 2 image "images\/not-there\.png" does not exist/.test(e)), errors.join('\n'));
    assert.throws(() => workflow.publish(root, '903', { now: NOW }), /is not ready/);
    assert.ok(fs.existsSync(path.join(root, 'observations/_drafts/903')), 'the draft stays where it was');
  });

  test('missing or empty alt text is an error', () => {
    assert.ok(brokenDraft((rec) => { delete rec.blocks[0].alt; }).errors.some((e) => /block 1 .* has no alt text/.test(e)));
    assert.ok(brokenDraft((rec) => { rec.blocks[2].alt = ' '; }).errors.some((e) => /block 3 .* has no alt text/.test(e)));
  });

  test('unsafe paths are refused', () => {
    for (const bad of ['../../../etc/passwd', '/etc/passwd', 'images/../observation.json', 'images\\x.png', '.hidden.png', 'C:/x.png']) {
      const { errors } = brokenDraft((rec) => { rec.blocks[0].image = bad; });
      assert.ok(errors.some((e) => e.startsWith('block 1 image')), `${bad}: ${errors.join('; ')}`);
    }
    const { errors } = brokenDraft((rec, dir) => {
      fs.symlinkSync('/etc/hosts', path.join(dir, 'images', 'link.png'));
      rec.blocks[0].image = 'images/link.png';
    });
    assert.ok(errors.some((e) => /symbolic link/.test(e)));
    assert.ok(brokenDraft((rec) => { rec.blocks.unshift({ text: '../../../../README.md' }); }).errors.some((e) => /^block 1 text/.test(e)));
    // Text under any other name would be deployed, so it is refused.
    const renamed = brokenDraft((rec, dir) => { fs.writeFileSync(path.join(dir, 'notes.txt'), 'x'); rec.blocks.unshift({ text: 'notes.txt' }); });
    assert.ok(renamed.errors.some((e) => /must be named body\.txt, body\.md, body-2\.md/.test(e)));
    const outside = brokenDraft((rec, dir) => { fs.copyFileSync(path.join(dir, rec.blocks[0].image), path.join(dir, 'loose.png')); rec.blocks[0].image = 'loose.png'; });
    assert.ok(outside.errors.some((e) => /must be in images\//.test(e)));
  });

  test('unsupported and mislabelled formats are refused', () => {
    assert.ok(brokenDraft((rec, dir) => {
      fs.writeFileSync(path.join(dir, 'images/x.gif'), Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1'));
      rec.blocks[0].image = 'images/x.gif';
    }).errors.some((e) => /unsupported format "\.gif"/.test(e)));
    assert.ok(brokenDraft((rec, dir) => {
      fs.writeFileSync(path.join(dir, 'images/x.jpg'), makePng(10, 10));
      rec.blocks[0].image = 'images/x.jpg';
    }).errors.some((e) => /is PNG but is named \.jpg/.test(e)));
    assert.ok(brokenDraft((rec, dir) => {
      fs.writeFileSync(path.join(dir, 'images/x.png'), Buffer.from('%PDF-1.7\n'));
      rec.blocks[0].image = 'images/x.png';
    }).errors.some((e) => /PDF, which is not published/.test(e)));
  });

  test('identifying metadata blocks publication; orientation alone does not', () => {
    const gps = probeImage(makeJpegHeader(4000, 3000, { exifTags: [[0x0112, 1], [0x8825, 0], [0x0110, 0]] }));
    assert.deepEqual(gps.metadata, ['GPS position', 'camera model']);
    const turned = probeImage(makeJpegHeader(4000, 3000, { exifTags: [[0x0112, 6]] }));
    assert.deepEqual(turned.metadata, []);
    assert.deepEqual([turned.width, turned.height], [3000, 4000], 'orientation 6 is displayed upright');
    const png = probeImage(makePng(20, 10, { extraChunks: [['tEXt', Buffer.from('Author\0Someone')]] }));
    assert.deepEqual(png.metadata, ['text chunk "Author"']);

    const { errors } = brokenDraft((rec, dir) => {
      fs.writeFileSync(path.join(dir, 'images/gps.jpg'), makeJpegHeader(400, 300, { exifTags: [[0x8825, 0]] }));
      rec.blocks[0].image = 'images/gps.jpg';
    });
    assert.ok(errors.some((e) => /still carries metadata \(GPS position\).*exiftool -all=/.test(e)));
  });

  test('invalid dates, stray fields, and a role without a name are errors', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    const file = path.join(root, 'observations/901/observation.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const check = (patch) => {
      fs.writeFileSync(file, JSON.stringify({ ...rec, ...patch }));
      return records.inspect(root, '901', 'published', { now: NOW }).errors.join('\n');
    };
    assert.match(check({ published_at: '2027-02-30' }), /not a valid date/);
    assert.match(check({ published_at: '21/09/2027' }), /not a valid date/);
    assert.match(check({ published_at: '2030-01-01' }), /in the future/);
    assert.match(check({ published_at: undefined }), /published_at is required/);
    assert.match(check({ alt_text: 'x' }), /unknown field "alt_text"/);
    assert.match(check({ author: undefined, author_role: 'PRINCIPAL, PROBNAYA' }), /author_role needs an author/);
    assert.match(check({ title: 'two\nlines' }), /title must be a single line/);
    assert.match(check({ number: '902' }), /does not match its directory "901"; a number is never changed/);
    assert.throws(() => workflow.publish(tempSite(), 'x', { date: '2027-13-01' }), /no draft/);
  });

  test('a file the record does not name blocks a published directory (it would be deployed)', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    fs.writeFileSync(path.join(root, 'observations/901/original-name.png'), makePng(4, 4));
    const r = records.inspect(root, '901', 'published', { now: NOW });
    assert.ok(r.errors.some((e) => /original-name\.png is in the directory but not in the record; it would be deployed/.test(e)));
  });

  test('an email address or a mailbox reference anywhere in the material blocks publication', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 't.txt'), 'write to someone@example.com');
    const r = workflow.createDraft(root, { number: '001', blocks: [{ text: path.join(src, 't.txt') }] });
    assert.ok(r.errors.some((e) => /email address/.test(e)));
    assert.throws(() => workflow.publish(root, '001', { now: NOW }), /email address/);
    fs.writeFileSync(path.join(src, 'u.txt'), 'FIXTURE.');
    const ref = workflow.createDraft(root, { number: '002', context: 'see O–7K2Q9P', blocks: [{ text: path.join(src, 'u.txt') }] });
    assert.ok(ref.errors.some((e) => /mailbox reference/.test(e)));
  });

  test('hidden files in a published directory are refused, and .DS_Store is never committed', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-image-only');
    fs.writeFileSync(path.join(root, 'observations/902/images/.DS_Store'), 'Bud1 original-name.jpg');
    const r = records.inspect(root, '902', 'published', { now: NOW });
    assert.ok(r.errors.some((e) => /images\/\.DS_Store is in the directory but not in the record/.test(e)));
    assert.match(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8'), /^\.DS_Store$/m);
  });

  test('a record holds only public fields, with file names relative to its directory', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'words.txt'), 'FIXTURE.');
    fs.writeFileSync(path.join(src, 'IMG_4471 original.png'), makePng(20, 20));
    workflow.createDraft(root, { number: '001', blocks: [{ text: path.join(src, 'words.txt') }, { image: path.join(src, 'IMG_4471 original.png'), alt: 'FIXTURE.' }] });
    const raw = read(root, 'observations/_drafts/001/observation.json');
    assert.ok(!raw.includes(src) && !raw.includes('IMG_4471') && !raw.includes(os.tmpdir()), 'no source path or original name');
    assert.deepEqual(JSON.parse(raw).blocks, [{ text: 'body.txt' }, { image: 'images/001-1.png', alt: 'FIXTURE.' }]);
    for (const extra of [{ email: 'a@b.co' }, { notes: 'internal' }, { message_id: '<x@y>' }, { source: '/Users/x' }]) {
      fs.writeFileSync(path.join(root, 'observations/_drafts/001/observation.json'), JSON.stringify({ ...JSON.parse(raw), ...extra }));
      assert.ok(records.inspect(root, '001', 'draft').errors.some((e) => /unknown field/.test(e)), Object.keys(extra)[0]);
    }
  });

  test('a body file must be UTF-8 text', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x41, 0x00]));
    assert.throws(() => workflow.createDraft(root, { number: '001', blocks: [{ text: path.join(src, 'bad.txt') }] }), /not valid UTF-8/);
    fs.writeFileSync(path.join(src, 'note.rtf'), 'x');
    assert.throws(() => workflow.createDraft(root, { number: '002', blocks: [{ text: path.join(src, 'note.rtf') }] }), /\.txt or \.md/);
  });
});

describe('Markdown presentation', () => {
  // One text-only Observation from a Markdown (or plain) file, published.
  function publishText(label, { title, text, ext = '.md' }) {
    const number = '001';
    const root = tempSite();
    const src = tempDir();
    const file = path.join(src, `source${ext}`);
    fs.writeFileSync(file, text);
    workflow.createDraft(root, { number, title, author: 'F. S.', blocks: [{ text: file }] });
    workflow.publish(root, number, { date: '2026-01-01', now: NOW });
    return { root, file, li: indexEntry(root, number), page: sheet(root, number) };
  }
  const headings = (html) => [...html.slice(html.indexOf('<div class="obs-sheet">')).matchAll(/<h(\d) class="([^"]+)">([^<]*)<\/h\1>/g)]
    .map(([, level, cls, text]) => `h${level} ${cls}: ${unescape(text)}`);

  test('a first H1 that is exactly the title is not rendered; the title appears once', () => {
    const { li, page } = publishText('same-title', { title: 'It’s Late Night, Alexis', text: '# It’s Late Night, Alexis\n\nFirst.\n\n## 1. A section\n\nSecond.\n' });
    assert.deepEqual(headings(page), ['h1 obs-title: It’s Late Night, Alexis', 'h2 obs-h: 1. A section']);
    assert.deepEqual(headings(li), ['h2 obs-title: It’s Late Night, Alexis', 'h3 obs-h: 1. A section']);
    assert.equal(page.split('It’s Late Night, Alexis').length - 1, 4, '<title>, og:title, twitter:title, the page heading; nothing in the body');
    assert.match(page, /<meta name="description" content="An observation by F\. S\., published as sent by PROBNAYA\.">/);
  });

  test('a first H1 that differs from the title stays visible, and nothing is suppressed without a title', () => {
    const differs = publishText('other-title', { title: 'Another title', text: '# It’s Late Night, Alexis\n\nFirst.\n\n## A section\n' });
    assert.deepEqual(headings(differs.page), ['h1 obs-title: Another title', 'h2 obs-h: It’s Late Night, Alexis', 'h3 obs-h obs-h--sub: A section']);
    const untitled = publishText('no-title', { text: '# A heading\n\nFirst.\n' });
    assert.deepEqual(headings(untitled.page), ['h1 visually-hidden: From F. S., 1 Jan 2026', 'h2 obs-h: A heading']);
    // A .txt file is never interpreted, so its first line is shown as typed.
    const plainText = publishText('plain-title', { title: 'Same', text: '# Same\n\nFirst.\n', ext: '.txt' });
    assert.match(plainText.li, /<p># Same<\/p>/);
  });

  test('only the first H1 is considered, and only an exact match suppresses it', () => {
    const later = publishText('later-h1', { title: 'Same', text: '## Intro\n\n# Different\n\n# Same\n' });
    assert.deepEqual(headings(later.page), ['h1 obs-title: Same', 'h3 obs-h obs-h--sub: Intro', 'h2 obs-h: Different', 'h2 obs-h: Same']);
    const near = publishText('near-h1', { title: 'Same', text: '# Same.\n\nText.\n' });
    assert.deepEqual(headings(near.page), ['h1 obs-title: Same', 'h2 obs-h: Same.']);
  });

  test('**bold** and *italic* render in paragraphs, list items, and headings', () => {
    const { li } = publishText('emphasis', { text: '## A *quiet* heading\n\n**Lead:** and *aside*, and **[1]** mark.\n\n- **one** item\n- an *other*\n\n*See notes [1] and [2] below.*\n' });
    assert.match(li, /<h3 class="obs-h">A <em>quiet<\/em> heading<\/h3>/);
    assert.match(li, /<p><strong>Lead:<\/strong> and <em>aside<\/em>, and <strong>\[1\]<\/strong> mark\.<\/p>/);
    assert.match(li, /<li><strong>one<\/strong> item<\/li><li>an <em>other<\/em><\/li>/);
    assert.match(li, /<p><em>See notes \[1\] and \[2\] below\.<\/em><\/p>/);
  });

  test('asterisks that are not emphasis stay as typed', () => {
    const { li } = publishText('not-emphasis', { text: '5 * 3 * 2, a*b*c, ** spaced **, *unclosed, __double__ and _single_\n' });
    assert.match(li, /<p>5 \* 3 \* 2, a\*b\*c, \*\* spaced \*\*, \*unclosed, __double__ and _single_<\/p>/);
  });

  test('HTML stays escaped inside and around emphasis; only <strong> and <em> are ever produced', () => {
    const text = [
      '**<b onclick="alert(1)">bold</b>** *<script>alert(1)</script>* <em>raw</em> **x** <img src=x onerror=alert(1)>',
      '',
      '- *<a href="javascript:alert(1)">link</a>* and [md](javascript:alert(1))',
      '',
      '## <i>heading</i> **<svg onload=alert(1)>**',
    ].join('\n');
    const { li } = publishText('hostile', { text });
    const material = li.slice(li.indexOf('<div class="obs-text">'), li.lastIndexOf('</div>\n</div>'));
    const tags = [...new Set([...material.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]))].sort();
    assert.deepEqual(tags, ['div', 'em', 'h3', 'li', 'p', 'strong', 'ul']);
    // Every real tag is bare or carries only a class; the attribute-like text is escaped characters.
    for (const tag of material.match(/<[^>]+>/g)) assert.match(tag, /^<\/?[a-z0-9]+( class="[a-z- ]+")?>$/, tag);
    assert.match(material, /<strong>&lt;b onclick=&quot;alert\(1\)&quot;&gt;bold&lt;\/b&gt;<\/strong>/);
    assert.match(material, /<em>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/em>/);
    assert.match(material, /&lt;em&gt;raw&lt;\/em&gt;/);
    assert.match(material, /\[md\]\(javascript:alert\(1\)\)/);
  });

  test('submitted headings sit below the title and keep their relative levels', () => {
    const three = publishText('levels', { text: '# One\n\n## Two\n\n### Three\n' });
    assert.deepEqual(headings(three.page).slice(1), ['h2 obs-h: One', 'h3 obs-h obs-h--sub: Two', 'h4 obs-h obs-h--sub: Three']);
    assert.deepEqual(headings(three.li).slice(1), ['h3 obs-h: One', 'h4 obs-h obs-h--sub: Two', 'h5 obs-h obs-h--sub: Three']);
    // Starting at ## still starts directly below the title.
    const shallow = publishText('levels-from-two', { text: '## Two\n\n### Three\n' });
    assert.deepEqual(headings(shallow.page).slice(1), ['h2 obs-h: Two', 'h3 obs-h obs-h--sub: Three']);
    // Never deeper than h6.
    const deep = publishText('levels-deep', { text: '# One\n\n###### Six\n' });
    assert.deepEqual(headings(deep.li).slice(1), ['h3 obs-h: One', 'h6 obs-h obs-h--sub: Six']);
  });

  test('the stored source stays byte-identical through publication and rebuilds', () => {
    const { root, file } = publishText('bytes', { title: 'Same', text: '\uFEFF# Same\r\n\r\n**bold** *it* <b>x</b>\r\n' });
    build(root, { now: NOW });
    build(root, { now: NOW });
    assert.equal(sha(path.join(root, 'observations/001/body.md')), sha(file));
    assert.deepEqual(fs.readFileSync(path.join(root, 'observations/001/body.md')), fs.readFileSync(file));
    assert.deepEqual(headings(sheet(root, '001')), ['h1 obs-title: Same']);
  });
});

describe('archival numbers', () => {
  test('the first Observation is /observations/001 and the next draft is offered 002', () => {
    const root = tempSite();
    assert.equal(records.nextNumber(root), '001');
    const src = tempDir();
    fs.writeFileSync(path.join(src, 't.md'), '# It’s Late Night, Alexis\n\nText.\n');
    workflow.createDraft(root, { number: records.nextNumber(root), title: 'It’s Late Night, Alexis', author: 'Alexis', blocks: [{ text: path.join(src, 't.md') }] });
    assert.equal(records.nextNumber(root), '002', 'a draft holds its number');
    workflow.publish(root, '001', { date: '2026-09-21', now: NOW });
    assert.ok(fs.existsSync(path.join(root, 'observations/001/index.html')));
    const page = sheet(root, '001');
    assert.match(page, /<link rel="canonical" href="https:\/\/probnaya\.work\/observations\/001">/);
    assert.match(page, /<meta property="og:url" content="https:\/\/probnaya\.work\/observations\/001">/);
    assert.match(read(root, 'sitemap.xml'), /<loc>https:\/\/probnaya\.work\/observations\/001<\/loc>/);
    assert.match(read(root, 'observations.html'), /<a class="obs-date" href="\/observations\/001">/);
    assert.doesNotMatch(page + read(root, 'observations.html') + read(root, 'sitemap.xml'), /late-night|its-late/, 'no title-derived address');
    assert.equal(records.nextNumber(root), '002');
  });

  test('the number is an address only: never visible text on the sheet or in the index', () => {
    const root = tempSite();
    seedAll(root);
    const visible = (html) => html
      .replace(/<head>[\s\S]*?<\/head>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<[^>]*>/g, ' ');
    for (const f of FIXTURES) {
      const text = visible(sheet(root, f.name));
      for (const other of FIXTURES) assert.ok(!text.includes(other.number), `${f.name} page shows ${other.number}`);
      assert.doesNotMatch(text, /PROB–OBS|OBS–\d|№/);
      assert.doesNotMatch(sheet(root, f.name), /class="obs-address"/);
    }
    const index = visible(read(root, 'observations.html'));
    for (const f of FIXTURES) assert.ok(!index.includes(f.number), `the index shows ${f.number}`);
  });

  test('numbers stay fixed when others are added, withdrawn, or reordered', () => {
    const root = tempSite();
    seedAll(root);
    const before = FIXTURES.map((f) => JSON.parse(read(root, `observations/${f.number}/observation.json`)).number);
    workflow.unpublish(root, N('fixture-images-only'), { now: NOW });
    const src = tempDir();
    fs.writeFileSync(path.join(src, 't.txt'), 'FIXTURE later.');
    workflow.createDraft(root, { number: records.nextNumber(root), blocks: [{ text: path.join(src, 't.txt') }] });
    workflow.publish(root, '908', { date: '2025-01-01', now: NOW }); // dated earlier than all: it reads last (newest first), and keeps 908
    for (const f of FIXTURES.filter((x) => x.name !== 'fixture-images-only')) {
      assert.equal(JSON.parse(read(root, `observations/${f.number}/observation.json`)).number, f.number);
      assert.match(sheet(root, f.name), new RegExp(`<link rel="canonical" href="https://probnaya.work/observations/${f.number}">`));
    }
    assert.deepEqual(before, FIXTURES.map((f) => f.number));
    const order = [...read(root, 'observations.html').matchAll(/<li class="observation" id="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(order.at(-1), '908');
  });

  test('a withdrawn number is never given to another Observation, and returns only with --reissue', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    publishFixture(root, 'fixture-image-only');
    workflow.unpublish(root, '902', { now: NOW });
    const ledger = JSON.parse(read(root, 'observations/ledger.json'));
    assert.equal(ledger.numbers['902'].first_published_at, '2025-10-07');
    assert.match(ledger.numbers['902'].withdrawn_at, /^2026-09-21T/);
    assert.equal(ledger.numbers['901'].withdrawn_at, null);

    // The withdrawn draft is still 902; nothing else may take 902.
    fs.rmSync(path.join(root, 'observations/_drafts/902'), { recursive: true });
    assert.equal(records.nextNumber(root), '903', 'the next number skips a withdrawn one');
    const src = tempDir();
    fs.writeFileSync(path.join(src, 't.txt'), 'FIXTURE other.');
    assert.throws(() => workflow.createDraft(root, { number: '902', blocks: [{ text: path.join(src, 't.txt') }] }), /never reused/);
    assert.throws(() => draftFixture(root, 'fixture-image-only'), /never reused/, 'not even for the same material made again as a new draft');
  });

  test('publishing a withdrawn number needs reissue; the final collision check runs at publish', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-image-only');
    workflow.unpublish(root, '902', { now: NOW });
    assert.ok(records.inspect(root, '902', 'draft').warnings.some((w) => /--reissue/.test(w)));
    assert.throws(() => workflow.publish(root, '902', { now: NOW }), /withdrawn .* --reissue/);
    workflow.publish(root, '902', { date: '2026-09-01', reissue: true, now: NOW });
    const ledger = JSON.parse(read(root, 'observations/ledger.json'));
    assert.deepEqual(ledger.numbers['902'], { first_published_at: '2025-10-07', withdrawn_at: null });

    // A number the ledger already gives to a published Observation cannot be published again from a draft.
    fs.cpSync(path.join(root, 'observations/902'), path.join(root, 'observations/_drafts/902'), { recursive: true });
    assert.throws(() => workflow.publish(root, '902', { now: NOW }), /exists both|already issued/);
  });

  test('the ledger must agree with the published directories', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    fs.rmSync(path.join(root, 'observations/901'), { recursive: true });
    assert.ok(records.ledgerIssues(root).some((e) => /lists 901 as published, but observations\/901\/ does not exist/.test(e)));
    const root2 = tempSite();
    publishFixture(root2, 'fixture-text-only');
    fs.rmSync(path.join(root2, 'observations/ledger.json'));
    assert.throws(() => build(root2, { now: NOW }), /901 is not in observations\/ledger\.json/);
  });

  test('the ledger is committed but never deployed', () => {
    const vercelignore = fs.readFileSync(path.join(REPO, '.vercelignore'), 'utf8').split('\n');
    const gitignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    assert.ok(vercelignore.includes('observations/ledger.json'));
    assert.doesNotMatch(gitignore, /ledger/);
  });
});

describe('social sharing', () => {
  const meta = (html, attr, key) => (new RegExp(`<meta ${attr}="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)">`).exec(html) || [])[1];

  test('/observations carries complete section metadata with the shared image', () => {
    const html = fs.readFileSync(path.join(REPO, 'observations.html'), 'utf8');
    const description = meta(html, 'name', 'description');
    assert.equal(description, 'What other people noticed and sent to PROBNAYA, published in the order PROBNAYA published them.');
    assert.match(html, /<title>Observations — PROBNAYA<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/probnaya\.work\/observations">/);
    const expected = {
      'og:type': 'website', 'og:url': 'https://probnaya.work/observations', 'og:site_name': 'PROBNAYA',
      'og:title': 'Observations — PROBNAYA', 'og:description': description,
      'og:image': render.SHARE_IMAGE.src, 'og:image:type': 'image/png', 'og:image:width': '1200', 'og:image:height': '630',
      'og:image:alt': render.SHARE_IMAGE.alt,
    };
    for (const [k, v] of Object.entries(expected)) assert.equal(meta(html, 'property', k), v, k);
    for (const [k, v] of Object.entries({ 'twitter:card': 'summary_large_image', 'twitter:title': 'Observations — PROBNAYA',
      'twitter:description': description, 'twitter:image': render.SHARE_IMAGE.src, 'twitter:image:alt': render.SHARE_IMAGE.alt })) {
      assert.equal(meta(html, 'name', k), v, k);
    }
  });

  test('every Observation page uses the one shared image and keeps its own title, URL, and description', () => {
    const root = tempSite();
    seedAll(root);
    const titles = new Set();
    for (const f of FIXTURES) {
      const page = sheet(root, f.name);
      assert.equal(meta(page, 'property', 'og:image'), render.SHARE_IMAGE.src, f.name);
      assert.equal(meta(page, 'name', 'twitter:image'), render.SHARE_IMAGE.src, f.name);
      assert.equal(meta(page, 'property', 'og:image:alt'), render.SHARE_IMAGE.alt, f.name);
      assert.equal(meta(page, 'property', 'og:url'), `https://probnaya.work/observations/${f.number}`);
      assert.equal(meta(page, 'property', 'og:type'), 'article');
      assert.equal(meta(page, 'property', 'article:section'), 'Observations');
      titles.add(meta(page, 'property', 'og:title'));
    }
    assert.equal(titles.size, FIXTURES.length, 'each page has its own title');
    // No per-publication social images exist anywhere in the published tree.
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk : (p) => files.push(p))(path.join(d, e.name)); };
    walk(path.join(root, 'observations'));
    assert.deepEqual(files.filter((p) => /og|share|social/i.test(path.basename(p))), []);
  });

  test('descriptions are neutral: by the displayed author, or unsigned, and never the material', () => {
    const root = tempSite();
    seedAll(root);
    for (const f of FIXTURES) {
      const page = sheet(root, f.name);
      const expected = f.spec.author
        ? `An observation by ${f.spec.author}, published as sent by PROBNAYA.`
        : 'An unsigned observation, published as sent by PROBNAYA.';
      for (const [attr, key] of [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]) {
        assert.equal(meta(page, attr, key), expected, `${f.name} ${key}`);
      }
      // Nothing from the material reaches the metadata.
      const head = page.slice(0, page.indexOf('</head>'));
      assert.doesNotMatch(head, /FIXTURE\. |Not a real Observation|synthetic|…/, f.name);
    }
    // The displayed author is escaped like everywhere else.
    const src = tempDir();
    fs.writeFileSync(path.join(src, 't.txt'), 'FIXTURE.');
    workflow.createDraft(root, { number: '950', author: 'O\'Brien & <Co>', blocks: [{ text: path.join(src, 't.txt') }] });
    workflow.publish(root, '950', { date: '2026-01-01', now: NOW });
    assert.match(sheet(root, '950'), /<meta name="description" content="An observation by O&#39;Brien &amp; &lt;Co&gt;, published as sent by PROBNAYA\.">/);
  });

  test('the shared image is a 1200 × 630 PNG with no embedded metadata, and its source is kept', () => {
    const buf = fs.readFileSync(path.join(REPO, 'assets/og-observations-1200x630.png'));
    const probe = probeImage(buf);
    assert.deepEqual([probe.format, probe.width, probe.height, probe.metadata], ['png', 1200, 630, []]);
    assert.ok(fs.existsSync(path.join(REPO, 'scripts/og/observations-og.html')));
  });
});

describe('the command line and the preview', () => {
  const CLI = path.join(REPO, 'scripts/observations/cli.js');

  test('observation:new collects answers interactively (piped) and creates a draft', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'words.md'), 'FIXTURE words.\n');
    fs.writeFileSync(path.join(src, 'pic.png'), makePng(30, 20));
    const answers = ['', 'Fixture Sender', '', 'fixture context', 'words.md', 'pic.png', 'FIXTURE: a card.', '', '', '', ''].join('\n');
    const run = spawnSync(process.execPath, [CLI, 'new'], { input: answers, env: { ...process.env, OBSERVATIONS_ROOT: root, INIT_CWD: src }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const rec = JSON.parse(fs.readFileSync(path.join(root, 'observations/_drafts/001/observation.json'), 'utf8'));
    assert.deepEqual(rec, {
      number: '001', status: 'draft', author: 'Fixture Sender', context: 'fixture context',
      blocks: [{ text: 'body.md' }, { image: 'images/001-1.png', alt: 'FIXTURE: a card.' }],
    });
    assert.match(run.stdout, /Archival number, the permanent address \/observations\/<number> \[001\]/);
    assert.match(run.stdout, /npm run observation:publish -- 001/);
  });

  test('validate exits non-zero for a draft that is not ready, and publish refuses it', () => {
    const root = tempSite();
    draftFixture(root, 'fixture-image-only');
    const file = path.join(root, 'observations/_drafts/902/observation.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete rec.blocks[0].alt;
    fs.writeFileSync(file, JSON.stringify(rec));
    const env = { ...process.env, OBSERVATIONS_ROOT: root };
    const v = spawnSync(process.execPath, [CLI, 'validate', '902'], { env, encoding: 'utf8' });
    assert.equal(v.status, 1);
    assert.match(v.stdout, /NOT READY/);
    const p = spawnSync(process.execPath, [CLI, 'publish', '902'], { env, encoding: 'utf8' });
    assert.equal(p.status, 1);
    assert.match(p.stderr, /Refused: "902" is not ready/);
  });

  test('the workflow never runs git or any other program, and never uses the network', () => {
    const dir = path.join(REPO, 'scripts/observations');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(src, /child_process|require\(['"]node:https?['"]\)\.request|fetch\(/, f);
    }
  });

  test('the preview serves the draft with the real template, noindex, and hides the source files', async () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    draftFixture(root, 'fixture-image-then-text');
    const server = await startPreview(root, '904', { port: 0, log: () => {} });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await (await fetch(`${base}/observations/904`)).text();
      assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
      assert.match(page, /<h1 class="obs-title">FIXTURE — a title the sender gave<\/h1>/);
      assert.match(page, /rel="prev" href="\/observations\/901"/);
      const index = await (await fetch(`${base}/observations`)).text();
      assert.match(index, /noindex/);
      assert.match(index, /id="904"/);
      const img = await fetch(`${base}/observations/904/images/904-1.png`);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.equal((await fetch(`${base}/observations/901/observation.json`)).status, 404);
      assert.equal((await fetch(`${base}/observations/_drafts/904/observation.json`)).status, 404);
      // The preview wrote nothing.
      assert.doesNotMatch(read(root, 'observations.html'), /904/);
      assert.ok(!fs.existsSync(path.join(root, 'observations/_drafts/904/index.html')));
    } finally {
      server.close();
    }
  });
});

test('render: dates in the margin and in titles', () => {
  assert.equal(render.marginDate('2026-10-07'), '07 OCT 2026');
  assert.equal(render.marginDate('2027-03-02T09:15:00Z'), '02 MAR 2027');
  assert.equal(render.plainDate('2027-03-02'), '2 Mar 2027');
});

// ---------------------------------------------------------------------------
// Private ownership boundary (docs/observation-ownership.md). Ownership lives
// only in the Access database; the Git-backed record and everything built from
// it must never carry an address, lookup, account, or ownership state.
// ---------------------------------------------------------------------------

test('ownership: a record refuses private identity or ownership fields', () => {
  const root = tempSite();
  const f = FIXTURES[0];
  publishFixture(root, f.name);
  const file = path.join(root, 'observations', f.number, 'observation.json');
  const original = JSON.parse(read(root, `observations/${f.number}/observation.json`));
  for (const [key, value] of Object.entries({
    email: 'synthetic.sender@example.test',
    contributor_email: 'synthetic.sender@example.test',
    contact_lookup: 'hmac-sha256:contact-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    account: 'PROB–H–0001',
    owner: 'PROB–H–0001',
    ownership: 'awaiting_account',
    claim_token: 'x',
    reference: 'O–ABCDEF',
    notes: 'editorial',
  })) {
    fs.writeFileSync(file, JSON.stringify({ ...original, [key]: value }, null, 2));
    const result = records.inspect(root, f.number, 'published');
    assert.ok(result.errors.some((e) => e.includes(`unknown field "${key}"`)), key);
  }
});

test('ownership: the public build is independent of Access and emits no private identity data', () => {
  const root = tempSite();
  seedAll(root);
  build(root, { now: NOW });
  const outputs = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|json|xml|txt|md)$/.test(entry.name)) outputs.push(full);
    }
  };
  walk(path.join(root, 'observations'));
  outputs.push(path.join(root, 'observations.html'), path.join(root, 'sitemap.xml'));
  const text = outputs.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const needle of ['hmac-sha256', 'contact_lookup', 'contact-v1', 'awaiting_account', 'observation-owner', 'access.probnaya.work/api', 'PROB–H–', 'O–']) {
    assert.equal(text.includes(needle), false, `public output contains ${needle}`);
  }
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text.replace(/mail@probnaya\.work/gi, '')), false, 'no email address in public output');
  // The publishing scripts never reach the ownership system or a database.
  for (const name of fs.readdirSync(path.join(REPO, 'scripts', 'observations'))) {
    const source = fs.readFileSync(path.join(REPO, 'scripts', 'observations', name), 'utf8');
    for (const needle of ['postgres', 'DATABASE_URL', 'access/lib', 'OBSERVATION_CONTACT', 'fetch(']) {
      assert.equal(source.includes(needle), false, `${name} references ${needle}`);
    }
  }
});

test('ownership: private ownership files never reach the public site deployment', () => {
  const ignore = fs.readFileSync(path.join(REPO, '.vercelignore'), 'utf8').split(/\r?\n/).map((line) => line.trim());
  assert.ok(ignore.includes('/access/') || ignore.includes('access/') || ignore.includes('/access'), 'access/ is excluded from the public deployment');
});
