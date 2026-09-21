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

function draftFixture(root, slug) {
  const f = FIXTURES.find((x) => x.slug === slug);
  return workflow.createDraft(root, materialise(f, path.join(tempDir(), f.slug)));
}

function publishFixture(root, slug) {
  const f = FIXTURES.find((x) => x.slug === slug);
  draftFixture(root, slug);
  return workflow.publish(root, slug, { date: f.date, now: NOW });
}

function seedAll(root, order = FIXTURES.map((f) => f.slug)) {
  for (const slug of order) publishFixture(root, slug);
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sheet = (root, slug) => read(root, `observations/${slug}/index.html`);
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
// The <li> for one slug in observations.html.
function indexEntry(root, slug) {
  const html = read(root, 'observations.html');
  const a = html.indexOf(`<li class="observation" id="${slug}">`);
  assert.ok(a >= 0, `${slug} is in the index`);
  const next = html.indexOf('\n<li class="observation"', a + 1);
  return html.slice(a, next > 0 ? next : html.indexOf('<!-- END GENERATED: observations-sequence', a));
}

// ---------------------------------------------------------------------------

describe('content combinations', () => {
  const root = tempSite();
  seedAll(root);

  test('text only: paragraphs and a signature, no figure', () => {
    const li = indexEntry(root, 'fixture-text-only');
    assert.match(li, /<div class="obs-text">/);
    assert.doesNotMatch(li, /<figure|obs-things/);
    assert.match(li, /<p class="obs-sender"><span class="obs-name">Fixture Sender<\/span><span class="visually-hidden">, <\/span><span class="obs-context">fixture context line<\/span><\/p>/);
    assert.doesNotMatch(li, /class="obs-title"/, 'no visible title when none was given');
    assert.match(li, /<h2 class="visually-hidden">From Fixture Sender, 7 Oct 2025<\/h2>/);
  });

  test('one image only, unsigned: a figure, no text block, no caption, no context', () => {
    const li = indexEntry(root, 'fixture-image-only');
    assert.equal((li.match(/<figure/g) || []).length, 1);
    assert.match(li, /obs-things--upright/);
    assert.doesNotMatch(li, /obs-text|obs-caption|obs-context|obs-role/);
    assert.match(li, /<span class="obs-from-name">UNSIGNED<\/span>/);
    assert.match(li, /<p class="obs-sender is-unsigned"><span class="obs-name">Unsigned<\/span><\/p>/);
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
    assert.match(li, /<span class="obs-from-name">Fixture Principal<\/span><span class="obs-role">PRINCIPAL, PROBNAYA<\/span>/);
    assert.doesNotMatch(li, /obs-context/);
    // The role is in the margin only: the signature is the same as anyone's.
    assert.match(li, /<p class="obs-sender"><span class="obs-name">Fixture Principal<\/span><\/p>/);
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
    assert.match(li, /<p>A paragraph with \*asterisks\* and _underscores_ that stay exactly as typed\.<\/p>/);
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
    assert.match(page, /<link rel="canonical" href="https:\/\/probnaya\.work\/observations\/fixture-image-then-text">/);
    assert.match(page, /<title>FIXTURE — a title the sender gave — Observations — PROBNAYA<\/title>/);
    assert.match(page, /<meta property="og:type" content="article">/);
    assert.match(page, /<meta property="og:image" content="https:\/\/probnaya\.work\/observations\/fixture-image-then-text\/images\/fixture-image-then-text-1\.png">/);
    assert.match(page, /<meta name="twitter:image:alt" content="FIXTURE: a synthetic wide test card like a screenshot\.">/);
    assert.match(page, /<meta name="description" content="FIXTURE\. Not a real Observation\. One paragraph under one wide image, written inside PROBNAYA\.">/);
    assert.match(page, /<h1 class="obs-title">/);
    assert.doesNotMatch(page, /name="robots"/);
    assert.match(page, /<a class="nav-link nav-divided" href="\/observations" aria-current="true">/);
    assert.match(page, /href="\/css\/style\.css"/, 'assets are addressed from the root');

    const textOnly = sheet(root, 'fixture-text-only');
    assert.match(textOnly, /<meta property="og:image" content="https:\/\/probnaya\.work\/assets\/og-1200x630\.png">/);
    assert.match(textOnly, /<h1 class="visually-hidden">From Fixture Sender, 7 Oct 2025<\/h1>/);
    assert.match(sheet(root, 'fixture-image-only'), /<meta name="description" content="An image sent to PROBNAYA, published 7 Oct 2025\.">/);
  });

  test('sheets link to the pieces published before and after', () => {
    const first = sheet(root, 'fixture-image-only');
    const middle = sheet(root, 'fixture-images-only');
    const last = sheet(root, 'fixture-small-original');
    assert.doesNotMatch(first, /rel="prev"/);
    assert.match(first, /rel="next" href="\/observations\/fixture-text-only"/);
    assert.match(middle, /rel="prev" href="\/observations\/fixture-text-only"/);
    assert.match(middle, /rel="next" href="\/observations\/fixture-image-then-text"/);
    assert.doesNotMatch(last, /rel="next"/);
  });

  test('the index states its extent and links every date to its sheet', () => {
    const html = read(root, 'observations.html');
    assert.match(html, /<p>SENT BY OTHERS · PUBLISHED BY PROBNAYA · 7 SINCE OCT 2025<\/p>/);
    for (const f of FIXTURES) assert.match(html, new RegExp(`<a class="obs-date" href="/observations/${f.slug}">`));
  });

  test('the sitemap lists every published sheet once', () => {
    const map = read(root, 'sitemap.xml');
    for (const f of FIXTURES) assert.equal(map.split(`<loc>https://probnaya.work/observations/${f.slug}</loc>`).length, 2);
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
    const shown = unescape(li.slice(li.indexOf('<div class="obs-text">'), li.indexOf('<p class="obs-sender"')).replace(/<[^>]+>/g, '\u0000'));
    for (const line of TEXT_MD.split('\n').filter((l) => l && l !== '---')) {
      const words = line.replace(/^(#+|[-*]) /, '');
      assert.ok(shown.includes(words), `"${words}" is shown`);
    }
  });

  test('CRLF files, a byte-order mark, and surrounding blank lines change nothing that is read', () => {
    assert.deepEqual(render.parseBody('\uFEFF\r\n\r\nOne\r\ntwo\r\n\r\n\r\nThree\r\n\r\n', 'txt'), [{ t: 'p', text: 'One\ntwo' }, { t: 'p', text: 'Three' }]);
  });

  test('publishing and rebuilding never modify the text or image files', () => {
    const root = tempSite();
    const src = tempDir();
    const f = FIXTURES.find((x) => x.slug === 'fixture-interleaved');
    const spec = materialise(f, src);
    const before = spec.blocks.map((b) => sha(b.text || b.image));
    workflow.createDraft(root, spec);
    workflow.publish(root, f.slug, { date: f.date, now: NOW });
    build(root, { now: NOW });
    const dir = path.join(root, 'observations', f.slug);
    const after = ['body.md', `images/${f.slug}-1.png`, 'body-2.txt', `images/${f.slug}-2.png`, `images/${f.slug}-3.png`].map((p) => sha(path.join(dir, p)));
    assert.deepEqual(after, before);
  });

  test('title, name, context, alt, and caption are escaped, not interpreted', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'a.png'), makePng(40, 30));
    workflow.createDraft(root, {
      slug: 'escaping', title: 'A <b>title</b> & “more”', author: 'O\'Brien <x>', context: 'a "context"',
      blocks: [{ image: path.join(src, 'a.png'), alt: 'alt "quoted" <img>', caption: 'cap & <i>tion</i>' }],
    });
    workflow.publish(root, 'escaping', { date: '2026-01-01', now: NOW });
    const li = indexEntry(root, 'escaping');
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
    assert.doesNotMatch(html, /fixture-image-only/);
    assert.doesNotMatch(read(root, 'sitemap.xml'), /fixture-image-only/);
    assert.ok(!fs.existsSync(path.join(root, 'observations/_drafts/fixture-image-only/index.html')));
    assert.ok(!fs.existsSync(path.join(root, 'observations/fixture-image-only')));
    assert.doesNotMatch(sheet(root, 'fixture-text-only'), /fixture-image-only/);
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
    const dir = path.join(root, 'observations/_drafts/fixture-text-only');
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'observation.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'observation.json'), JSON.stringify({ ...rec, status: 'published', published_at: '2027-01-01' }));
    const r = records.inspect(root, 'fixture-text-only', 'draft', { now: NOW });
    assert.ok(r.errors.some((e) => /status is "published" but the record is in observations\/_drafts/.test(e)));
    assert.ok(r.errors.some((e) => /a draft has no published_at/.test(e)));

    const root2 = tempSite();
    publishFixture(root2, 'fixture-text-only');
    const pdir = path.join(root2, 'observations/fixture-text-only');
    const prec = JSON.parse(fs.readFileSync(path.join(pdir, 'observation.json'), 'utf8'));
    fs.writeFileSync(path.join(pdir, 'observation.json'), JSON.stringify({ ...prec, status: 'draft' }));
    assert.throws(() => build(root2, { now: NOW }), /status is "draft" but the record is in observations\//);
  });

  test('unpublishing withdraws the sheet, the index entry, and the sitemap entry', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    publishFixture(root, 'fixture-image-only');
    workflow.unpublish(root, 'fixture-text-only', { now: NOW });
    assert.doesNotMatch(read(root, 'observations.html'), /fixture-text-only/);
    assert.doesNotMatch(read(root, 'sitemap.xml'), /fixture-text-only/);
    assert.ok(!fs.existsSync(path.join(root, 'observations/fixture-text-only')));
    const back = path.join(root, 'observations/_drafts/fixture-text-only');
    assert.ok(!fs.existsSync(path.join(back, 'index.html')));
    const rec = JSON.parse(fs.readFileSync(path.join(back, 'observation.json'), 'utf8'));
    assert.equal(rec.status, 'draft');
    assert.equal(rec.published_at, undefined);
    assert.deepEqual(records.inspect(root, 'fixture-text-only', 'draft').errors, []);
  });
});

describe('deterministic output', () => {
  test('earliest first, then by slug, whatever order they were published in', () => {
    const root = tempSite();
    seedAll(root, FIXTURES.map((f) => f.slug).reverse());
    const html = read(root, 'observations.html');
    const order = [...html.matchAll(/<li class="observation" id="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(order, [
      'fixture-image-only', 'fixture-text-only',   // same day: by slug
      'fixture-images-only', 'fixture-image-then-text', 'fixture-text-then-image', 'fixture-interleaved', 'fixture-small-original',
    ]);
  });

  test('a publication instant orders pieces published on the same day', () => {
    assert.ok(records.parsePublishedAt('2027-01-01T09:00:00Z') < records.parsePublishedAt('2027-01-01T10:00:00Z'));
    const items = records.sortRecords([
      { slug: 'a', record: { published_at: '2027-01-01T10:00:00Z' } },
      { slug: 'b', record: { published_at: '2027-01-01T09:00:00Z' } },
    ]);
    assert.deepEqual(items.map((i) => i.slug), ['b', 'a']);
  });

  test('two sites built in different orders are byte-identical, and a rebuild changes nothing', () => {
    const a = tempSite();
    const b = tempSite();
    seedAll(a);
    seedAll(b, FIXTURES.map((f) => f.slug).reverse());
    for (const file of ['observations.html', 'sitemap.xml', ...FIXTURES.map((f) => `observations/${f.slug}/index.html`)]) {
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
  test('a slug is never reused: not by a new draft, not by publishing over it', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    assert.throws(() => draftFixture(root, 'fixture-text-only'), /already used by a published Observation/);
    draftFixture(root, 'fixture-image-only');
    assert.throws(() => draftFixture(root, 'fixture-image-only'), /already used by a draft/);

    // The same slug in both places (for example restored by hand) is an error on both.
    fs.cpSync(path.join(root, 'observations/fixture-text-only'), path.join(root, 'observations/_drafts/fixture-text-only'), { recursive: true });
    const both = records.inspectAll(root).filter((r) => r.slug === 'fixture-text-only');
    assert.equal(both.length, 2);
    for (const r of both) assert.ok(r.errors.some((e) => /exists both as a draft and as a published/.test(e)));
    assert.throws(() => workflow.publish(root, 'fixture-text-only', { now: NOW }), /exists both/);
  });

  test('an image is never overwritten: a second image gets the next name', () => {
    const root = tempSite();
    draftFixture(root, 'fixture-image-only');
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'more.png'), makePng(50, 50));
    const first = path.join(root, 'observations/_drafts/fixture-image-only/images/fixture-image-only-1.png');
    const before = sha(first);
    const { result } = workflow.addImage(root, 'fixture-image-only', { source: path.join(src, 'more.png'), alt: 'FIXTURE: another card.' });
    assert.equal(sha(first), before);
    assert.deepEqual(result.record.blocks.map((b) => b.image), ['images/fixture-image-only-1.png', 'images/fixture-image-only-2.png']);
    assert.deepEqual(result.errors, []);
  });

  test('invalid slugs are refused', () => {
    const root = tempSite();
    for (const slug of ['', 'Has-Caps', '../escape', 'a--b', '-lead', '_drafts', 'a b', 'x'.repeat(81)]) {
      assert.throws(() => workflow.createDraft(root, { slug, blocks: [{ text: '/dev/null' }] }), /not a valid slug/, slug);
    }
  });

  test('a new draft needs text or an image, and alt text for every image', () => {
    const root = tempSite();
    assert.throws(() => workflow.createDraft(root, { slug: 'empty' }), /needs a text file or at least one image/);
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'a.png'), makePng(10, 10));
    assert.throws(() => workflow.createDraft(root, { slug: 'noalt', blocks: [{ image: path.join(src, 'a.png'), alt: '  ' }] }), /needs alt text/);
    assert.throws(() => workflow.createDraft(root, { slug: 'nofile', blocks: [{ image: path.join(src, 'missing.png'), alt: 'x' }] }), /does not exist/);
    assert.ok(!fs.existsSync(path.join(root, 'observations/_drafts/nofile')), 'a failed draft leaves nothing behind');
  });

  function brokenDraft(mutate) {
    const root = tempSite();
    draftFixture(root, 'fixture-images-only');
    const dir = path.join(root, 'observations/_drafts/fixture-images-only');
    const file = path.join(dir, 'observation.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(rec, dir);
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    return { root, errors: records.inspect(root, 'fixture-images-only', 'draft', { now: NOW }).errors };
  }

  test('a missing image file is an error, and publishing is refused', () => {
    const { root, errors } = brokenDraft((rec) => { rec.blocks[1].image = 'images/not-there.png'; });
    assert.ok(errors.some((e) => /block 2 image "images\/not-there\.png" does not exist/.test(e)), errors.join('\n'));
    assert.throws(() => workflow.publish(root, 'fixture-images-only', { now: NOW }), /is not ready/);
    assert.ok(fs.existsSync(path.join(root, 'observations/_drafts/fixture-images-only')), 'the draft stays where it was');
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
    const file = path.join(root, 'observations/fixture-text-only/observation.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const check = (patch) => {
      fs.writeFileSync(file, JSON.stringify({ ...rec, ...patch }));
      return records.inspect(root, 'fixture-text-only', 'published', { now: NOW }).errors.join('\n');
    };
    assert.match(check({ published_at: '2027-02-30' }), /not a valid date/);
    assert.match(check({ published_at: '21/09/2027' }), /not a valid date/);
    assert.match(check({ published_at: '2030-01-01' }), /in the future/);
    assert.match(check({ published_at: undefined }), /published_at is required/);
    assert.match(check({ alt_text: 'x' }), /unknown field "alt_text"/);
    assert.match(check({ author: undefined, author_role: 'PRINCIPAL, PROBNAYA' }), /author_role needs an author/);
    assert.match(check({ title: 'two\nlines' }), /title must be a single line/);
    assert.match(check({ slug: 'another' }), /does not match its directory/);
    assert.throws(() => workflow.publish(tempSite(), 'x', { date: '2027-13-01' }), /no draft/);
  });

  test('a file the record does not name blocks a published directory (it would be deployed)', () => {
    const root = tempSite();
    publishFixture(root, 'fixture-text-only');
    fs.writeFileSync(path.join(root, 'observations/fixture-text-only/original-name.png'), makePng(4, 4));
    const r = records.inspect(root, 'fixture-text-only', 'published', { now: NOW });
    assert.ok(r.errors.some((e) => /original-name\.png is in the directory but not in the record; it would be deployed/.test(e)));
  });

  test('an email-like string in the material is flagged for a second look', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 't.txt'), 'write to someone@example.com');
    const r = workflow.createDraft(root, { slug: 'mail-like', blocks: [{ text: path.join(src, 't.txt') }] });
    assert.ok(r.warnings.some((w) => /email address/.test(w)));
    assert.deepEqual(r.errors, []);
  });

  test('a body file must be UTF-8 text', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x41, 0x00]));
    assert.throws(() => workflow.createDraft(root, { slug: 'bad-text', blocks: [{ text: path.join(src, 'bad.txt') }] }), /not valid UTF-8/);
    fs.writeFileSync(path.join(src, 'note.rtf'), 'x');
    assert.throws(() => workflow.createDraft(root, { slug: 'bad-ext', blocks: [{ text: path.join(src, 'note.rtf') }] }), /\.txt or \.md/);
  });
});

describe('the command line and the preview', () => {
  const CLI = path.join(REPO, 'scripts/observations/cli.js');

  test('observation:new collects answers interactively (piped) and creates a draft', () => {
    const root = tempSite();
    const src = tempDir();
    fs.writeFileSync(path.join(src, 'words.md'), 'FIXTURE words.\n');
    fs.writeFileSync(path.join(src, 'pic.png'), makePng(30, 20));
    const answers = ['', 'Fixture Sender', '', 'fixture context', 'words.md', 'pic.png', 'FIXTURE: a card.', '', '', 'cli-fixture', ''].join('\n');
    const run = spawnSync(process.execPath, [CLI, 'new'], { input: answers, env: { ...process.env, OBSERVATIONS_ROOT: root, INIT_CWD: src }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const rec = JSON.parse(fs.readFileSync(path.join(root, 'observations/_drafts/cli-fixture/observation.json'), 'utf8'));
    assert.deepEqual(rec, {
      slug: 'cli-fixture', status: 'draft', author: 'Fixture Sender', context: 'fixture context',
      blocks: [{ text: 'body.md' }, { image: 'images/cli-fixture-1.png', alt: 'FIXTURE: a card.' }],
    });
    assert.match(run.stdout, /npm run observation:publish -- cli-fixture/);
  });

  test('validate exits non-zero for a draft that is not ready, and publish refuses it', () => {
    const root = tempSite();
    draftFixture(root, 'fixture-image-only');
    const file = path.join(root, 'observations/_drafts/fixture-image-only/observation.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete rec.blocks[0].alt;
    fs.writeFileSync(file, JSON.stringify(rec));
    const env = { ...process.env, OBSERVATIONS_ROOT: root };
    const v = spawnSync(process.execPath, [CLI, 'validate', 'fixture-image-only'], { env, encoding: 'utf8' });
    assert.equal(v.status, 1);
    assert.match(v.stdout, /NOT READY/);
    const p = spawnSync(process.execPath, [CLI, 'publish', 'fixture-image-only'], { env, encoding: 'utf8' });
    assert.equal(p.status, 1);
    assert.match(p.stderr, /Refused: "fixture-image-only" is not ready/);
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
    const server = await startPreview(root, 'fixture-image-then-text', { port: 0, log: () => {} });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await (await fetch(`${base}/observations/fixture-image-then-text`)).text();
      assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
      assert.match(page, /<h1 class="obs-title">FIXTURE — a title the sender gave<\/h1>/);
      assert.match(page, /rel="prev" href="\/observations\/fixture-text-only"/);
      const index = await (await fetch(`${base}/observations`)).text();
      assert.match(index, /noindex/);
      assert.match(index, /id="fixture-image-then-text"/);
      const img = await fetch(`${base}/observations/fixture-image-then-text/images/fixture-image-then-text-1.png`);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.equal((await fetch(`${base}/observations/fixture-text-only/observation.json`)).status, 404);
      assert.equal((await fetch(`${base}/observations/_drafts/fixture-image-then-text/observation.json`)).status, 404);
      // The preview wrote nothing.
      assert.doesNotMatch(read(root, 'observations.html'), /fixture-image-then-text/);
      assert.ok(!fs.existsSync(path.join(root, 'observations/_drafts/fixture-image-then-text/index.html')));
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
