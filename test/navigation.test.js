'use strict';

// Every public page carries the same index: one control in each header that
// states where the visitor is, one panel listing every section once, and no
// bottom bar. The current section is marked in the panel.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const surface = path.resolve(__dirname, '..');
const pages = execFileSync('git', ['ls-files', '*.html'], { cwd: surface, encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .map((file) => ({ file, html: fs.readFileSync(path.join(surface, file), 'utf8') }))
  .filter(({ html }) => html.includes('<header class="site-header">'));

const SECTIONS = ['/instruments', '/investigations', '/objects', '/lab', '/observations', '/intake'];

function section(file) {
  if (file === 'index.html') return null;
  if (/^instrument/.test(file)) return '/instruments';
  if (file === 'investigations.html' || file === 'record.html') return '/investigations';
  if (file.startsWith('objects/')) return '/objects';
  if (file.startsWith('lab/')) return '/lab';
  if (file.startsWith('observations')) return '/observations';
  if (file === 'intake.html') return '/intake';
  throw new Error(`No section known for ${file}`);
}

test('every public page is covered', () => {
  assert.ok(pages.length >= 17, `${pages.length} pages`);
});

for (const { file, html } of pages) {
  test(`${file} carries the index and no bottom bar`, () => {
    assert.doesNotMatch(html, /class="bottom-nav|class="nav-link|class="mobile-lab-link|class="crumb"|data-standing/);
    assert.match(html, /<span class="brand-tag">INDEPENDENT COMPUTATIONAL LABORATORY<\/span>/);
    const toggles = html.match(/<button type="button" class="index-toggle" aria-expanded="false" aria-controls="site-index">/g) || [];
    assert.equal(toggles.length, 2, 'one control in each header');

    const panel = html.match(/<nav class="site-index" id="site-index" aria-label="Index" hidden>([\s\S]*?)<\/nav>/);
    assert.ok(panel, 'the index panel');
    const hrefs = [...panel[1].matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, SECTIONS);
    assert.match(panel[1], /<a href="\/intake" class="action"/);

    const marked = [...panel[1].matchAll(/<a href="([^"]+)"[^>]*aria-current="(page|true)"/g)].map((m) => m[1]);
    const current = section(file);
    assert.deepEqual(marked, current ? [current] : []);

    const positions = [...html.matchAll(/<span class="pos">([^<]*)<\/span>/g)].map((m) => m[1]);
    assert.equal(positions.length, current ? 2 : 0, 'the position is stated in both headers, except at home');
    assert.match(html, /<a href="mailto:mail@probnaya\.work">mail@probnaya\.work<\/a>/);
  });
}

test('an Observation sheet never shows its archival number as a position', () => {
  for (const { file, html } of pages.filter((p) => /^observations\/\d{3}\//.test(p.file))) {
    const positions = [...html.matchAll(/<span class="pos">([^<]*)<\/span>/g)].map((m) => m[1]);
    for (const pos of positions) assert.doesNotMatch(pos, /\d/, file);
  }
});
