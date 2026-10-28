'use strict';

// Every public page carries the same grouped Index and two header controls.
// A family heading marks context; only an exact destination marks a current page.
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

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map((match) => [match[1], match[2] ?? match[3]]));
}
function elements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g'))]
    .map((match) => ({ attrs: attributes(match[1]), opening: match[1], content: match[2] }));
}
function hasClass(element, name) { return (element.attrs.class || '').split(/\s+/).includes(name); }
function text(html) { return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }

const GROUPS = [
  ['instruments', 'Instruments', ['/instrument-0x2f', '/instrument-057']],
  ['investigations', 'Investigations', ['/#investigations']],
  ['human', 'Human', ['https://getchinotto.app/', 'https://heard.probnaya.work/', 'https://fieldwork.probnaya.work/tras-os-montes/']],
  ['objects', 'Objects', ['/instrument-mpa-01', '/objects/001']],
];
const ROUTES = ['/lab', '/observations', '/intake'];
const DESTINATIONS = [...GROUPS.flatMap(([, , hrefs]) => hrefs), ...ROUTES];

function context(file) {
  if (file === 'index.html') return { group: null, link: null };
  if (file === 'instruments.html') return { group: 'instruments', link: null };
  if (/^instrument-(0x2f|057)\.html$/.test(file)) return { group: 'instruments', link: [`/${file.slice(0, -5)}`, 'page'] };
  if (/^instrument-(chinotto|heard)\.html$/.test(file)) return { group: 'human', link: null };
  if (file === 'instrument-mpa-01.html') return { group: 'objects', link: ['/instrument-mpa-01', 'page'] };
  if (file === 'investigations.html' || file === 'record.html') return { group: 'investigations', link: null };
  if (file === 'objects/index.html') return { group: 'objects', link: null };
  if (file === 'objects/001/index.html') return { group: 'objects', link: ['/objects/001', 'page'] };
  if (file === 'lab/index.html') return { group: null, link: ['/lab', 'page'] };
  if (file.startsWith('lab/')) return { group: null, link: ['/lab', 'true'] };
  if (file === 'observations.html') return { group: null, link: ['/observations', 'page'] };
  if (/^observations\/\d{3}\/index\.html$/.test(file)) return { group: null, link: ['/observations', 'true'] };
  if (file === 'intake.html') return { group: null, link: ['/intake', 'page'] };
  throw new Error(`No Index context known for ${file}`);
}

test('every public page is covered', () => {
  assert.ok(pages.length >= 17, `${pages.length} pages`);
});

for (const { file, html } of pages) {
  test(`${file} carries the grouped Index and no bottom bar`, () => {
    assert.doesNotMatch(html, /class="bottom-nav|class="nav-link|class="mobile-lab-link|class="crumb"|data-standing/);
    assert.match(html, /<span class="brand-tag">INDEPENDENT COMPUTATIONAL LABORATORY<\/span>/);
    const toggles = elements(html, 'button').filter(button => hasClass(button, 'index-toggle'));
    assert.equal(toggles.length, 2, 'one control in each header');
    for (const toggle of toggles) {
      assert.equal(toggle.attrs.type, 'button');
      assert.equal(toggle.attrs['aria-expanded'], 'false');
      assert.equal(toggle.attrs['aria-controls'], 'site-index');
    }

    const panels = elements(html, 'nav').filter(nav => nav.attrs.id === 'site-index');
    assert.equal(panels.length, 1, 'one Index panel');
    const panel = panels[0];
    assert.ok(hasClass(panel, 'site-index'));
    assert.equal(panel.attrs['aria-label'], 'Index');
    assert.match(panel.opening, /\bhidden(?:\s|$)/);
    const links = elements(panel.content, 'a');
    assert.deepEqual(links.map(link => link.attrs.href), DESTINATIONS, 'all direct destinations in reading order');
    assert.deepEqual(links.filter(link => hasClass(link, 'index-route')).map(link => link.attrs.href), ROUTES);
    assert.ok(hasClass(links.find(link => link.attrs.href === '/intake'), 'action'));
    assert.doesNotMatch(panel.content, /Naturalista|index-space/, 'no unrelated credit or superseded split layout');

    const groupLabels = elements(panel.content, 'span').filter(span => hasClass(span, 'index-group')).map(span => text(span.content));
    assert.deepEqual(groupLabels, ["THE LABORATORY'S OWN WORK", 'ARRIVES FROM OUTSIDE']);
    const groups = elements(panel.content, 'section').filter(section => hasClass(section, 'index-section'));
    assert.equal(groups.length, GROUPS.length);
    groups.forEach((group, index) => {
      const [family, title, hrefs] = GROUPS[index];
      const titleId = `index-${family}-title`;
      assert.equal(group.attrs['aria-labelledby'], titleId, 'each group has an accessible name');
      const headings = elements(group.content, 'h2');
      assert.equal(headings.length, 1);
      assert.equal(headings[0].attrs.id, titleId);
      assert.equal(text(headings[0].content), title);
      assert.equal(elements(headings[0].content, 'a').length, 0, 'a group is a label, not an invented destination');
      assert.deepEqual(elements(group.content, 'a').map(link => link.attrs.href), hrefs, `${title} contains its own works`);
    });

    const current = context(file);
    const markedGroups = groups.filter(group => group.attrs['aria-current']);
    assert.deepEqual(markedGroups.map(group => [group.attrs['aria-labelledby'], group.attrs['aria-current']]),
      current.group ? [[`index-${current.group}-title`, 'true']] : []);
    const markedLinks = links.filter(link => link.attrs['aria-current']);
    assert.deepEqual(markedLinks.map(link => [link.attrs.href, link.attrs['aria-current']]), current.link ? [current.link] : []);

    const positions = elements(html, 'span').filter(span => hasClass(span, 'pos'));
    assert.equal(positions.length, file === 'index.html' ? 0 : 2, 'both headers state context, except at home');
    assert.match(html, /<a href="mailto:mail@probnaya\.work">mail@probnaya\.work<\/a>/);
  });
}

test('the shared Investigations route resolves to explicitly proposed homepage questions', () => {
  const home = pages.find(page => page.file === 'index.html').html;
  const questions = elements(home, 'section').find(section => section.attrs.id === 'investigations');
  assert.ok(questions, 'the root anchor has a destination');
  assert.match(questions.content, /PROPOSED QUESTIONS/);
  assert.doesNotMatch(questions.content, /\b(?:DISCLOSED|ON RECORD)\b/);
});

test('an Observation sheet never shows its archival number as a position', () => {
  for (const { file, html } of pages.filter(page => /^observations\/\d{3}\//.test(page.file))) {
    const positions = elements(html, 'span').filter(span => hasClass(span, 'pos'));
    for (const position of positions) assert.doesNotMatch(text(position.content), /\d/, file);
  }
});
