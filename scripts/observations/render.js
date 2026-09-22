'use strict';

// The publication template. One function renders an Observation; the index and
// each Observation's own sheet both use it, and so does the local preview.
//
// Two voices never share a ground. PROBNAYA speaks in mono capitals in the
// margin and the frame. The contributor's material sits on its own sheet
// (--sheet, inside a hairline), in sentence case. Who it is from (name, role,
// context) is stated once, in the margin; the sheet carries no signature line
// (an editorial decision of 2026-09-21 that departs from the design's signature).
//
// The archival number (item.number, "001") is used only in addresses: the URL,
// the canonical and Open Graph URLs, the sitemap, image paths, and the fragment
// that returns to the piece in the index. It never appears as visible text: not
// as a badge, a title prefix, margin metadata, an address line, or a PROB– mark.
// (For that reason the design's printed address under the sheet is not rendered.)
//
// The approved visual source is the first design pass, the Claude Design file
// "PROBNAYA - Observations Published (sheets, superseded).dc.html" in project
// d02780a6-b7fa-4b59-89ac-64f60f27f3b1. It is approved despite "superseded" in
// its name; do not take another file in that project as the source without an
// explicit editorial decision (docs/observations-publishing.md §0).
//
// Contributor text is never rewritten: it is escaped, split into paragraphs at
// blank lines, and set with its own line breaks and spacing (white-space:
// pre-wrap). A body.md file may also use these structures, and nothing else:
//   a line starting "# " (up to six #) on its own   → a heading
//   a block where every line starts "- ", "* ", "+" → a list
//   a line of three or more -, * or _               → a rule
//   **bold** and *italic* within a line             → strong and em
// Everything else, including links, _underscores_, and numbered lines, is shown
// exactly as typed. Emphasis is applied to text that has already been escaped,
// so the only markup it can ever produce is <strong> and <em>.
//
// Two rules concern the page rather than the words, and never touch the file:
// when the first H1 in the material is exactly the publication's title, that
// heading is not rendered (the title already heads the piece); and submitted
// headings are set below the title, keeping their relative levels.

const SITE = 'https://probnaya.work';

// The one social-sharing image for the Observations section: /observations and
// every /observations/<number> use it. It shows the section's frame and nothing
// sent by anyone. There are no per-publication images (source:
// scripts/og/observations-og.html). observations.html carries the same values.
const SHARE_IMAGE = {
  src: `${SITE}/assets/og-observations-1200x630.png`, type: 'image/png', width: 1200, height: 630,
  alt: 'Observations, PROBNAYA: the section name above a field of short strokes.',
};
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isoDay(publishedAt) { return publishedAt.slice(0, 10); }

// 07 OCT 2026 — the margin form.
function marginDate(publishedAt) {
  const [y, m, d] = isoDay(publishedAt).split('-');
  return `${d} ${MONTHS[+m - 1]} ${y}`;
}

// 7 Oct 2026 — the form used in titles and descriptions.
function plainDate(publishedAt) {
  const [y, m, d] = isoDay(publishedAt).split('-');
  const mon = MONTHS[+m - 1];
  return `${+d} ${mon[0]}${mon.slice(1).toLowerCase()} ${y}`;
}

function url(number) { return `/observations/${number}`; }
function imageUrl(number, file) { return `/observations/${number}/${file}`; }

// --- the contributor's text -------------------------------------------------

function parseBody(text, kind) {
  const normal = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
  if (!normal.trim()) return [];
  const chunks = normal.split(/\n(?:[ \t]*\n)+/);
  if (kind !== 'md') return chunks.map((text) => ({ t: 'p', text }));
  return chunks.map((chunk) => {
    const lines = chunk.split('\n');
    const heading = /^#{1,6}[ \t]+(\S.*)$/.exec(chunk);
    if (lines.length === 1 && heading) return { t: 'h', level: /^#+/.exec(chunk)[0].length, text: heading[1] };
    if (lines.length === 1 && /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(chunk)) return { t: 'rule' };
    if (lines.every((l) => /^[-*+][ \t]+\S/.test(l))) return { t: 'list', items: lines.map((l) => l.replace(/^[-*+][ \t]+/, '')) };
    return { t: 'p', text: chunk };
  });
}

// Escapes first, then turns **x** into <strong>x</strong> and *x* into <em>x</em>.
// A marker must hug its words (no space inside it) and stays within one line; an
// asterisk inside a word (a*b*c) or with spaces around it (5 * 3) stays as typed.
function inline(text, kind) {
  const safe = esc(text);
  if (kind !== 'md') return safe;
  return safe
    .replace(/\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![*\w])/g, (m, pre, rest) => `${pre}<em>${m.slice(pre.length + 1, -1)}</em>`);
}

// The contributor's text blocks, parsed, with the title-repeating H1 removed and
// the offset that sets the highest remaining heading directly below the title.
function textPlan(item) {
  const title = item.record.title;
  const parsed = new Map();
  for (const t of item.texts) parsed.set(t, parseBody(t.text, t.kind));
  let suppressed = null;
  find: for (const t of item.texts) {
    if (t.kind !== 'md') continue;
    for (const [j, b] of parsed.get(t).entries()) {
      if (b.t !== 'h' || b.level !== 1) continue;
      if (title && b.text.trimEnd() === title) { suppressed = b; parsed.get(t).splice(j, 1); }
      break find;
    }
  }
  const levels = [...parsed.values()].flat().filter((b) => b.t === 'h').map((b) => b.level);
  return { parsed, suppressed, top: levels.length ? Math.min(...levels) : 1 };
}

// `base` is the level of the piece's own heading; submitted headings start one
// below it and keep their distance from each other, never deeper than h6.
function renderBlocks(blocks, { base, top, kind }) {
  return blocks.map((b) => {
    if (b.t === 'h') {
      const level = Math.min(6, base + 1 + (b.level - top));
      return `<h${level} class="obs-h${level > base + 1 ? ' obs-h--sub' : ''}">${inline(b.text, kind)}</h${level}>`;
    }
    if (b.t === 'rule') return '<hr class="obs-rule">';
    if (b.t === 'list') return `<ul class="obs-list">${b.items.map((i) => `<li>${inline(i, kind)}</li>`).join('')}</ul>`;
    return `<p>${inline(b.text, kind)}</p>`;
  }).join('\n');
}

// --- attribution ------------------------------------------------------------

function signedName(record) { return record.author || 'Unsigned'; }

// The words a heading or a title uses for an Observation that has no title.
function lead(record) {
  if (record.title) return record.title;
  return record.author ? `From ${record.author}, ${plainDate(record.published_at)}` : `Unsigned, ${plainDate(record.published_at)}`;
}

// --- the material, in the order it was declared ----------------------------

// A run of consecutive images. One wide original takes the column; one upright
// or square original stands at a photograph's width; several share rows at a
// small basis. None is cropped or enlarged past its own pixels, and the
// original opens at full size. `number` counts images across the whole piece.
function renderImages(item, run, { lazy, number }) {
  const total = item.images.length;
  const layout = run.length > 1 ? 'several' : (run[0].width > run[0].height * 1.1 ? 'wide' : 'upright');
  const figures = run.map((im, i) => {
    const src = imageUrl(item.number, im.file);
    const which = total > 1 ? `image ${number + i} of ${total}` : 'image';
    const ratio = +(im.width / im.height).toFixed(4);
    return `<figure class="obs-thing" style="--w: ${im.width}px; --r: ${ratio}">
  <img src="${esc(src)}" width="${im.width}" height="${im.height}" alt="${esc(im.alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async">
  <figcaption>${im.caption ? `<span class="obs-caption">${esc(im.caption)}</span>` : ''}<a class="obs-open" href="${esc(src)}" target="_blank" rel="noopener">OPEN ORIGINAL <span aria-hidden="true">↗</span><span class="visually-hidden"> (${which}, opens in a new tab)</span></a></figcaption>
</figure>`;
  });
  return `<div class="obs-things obs-things--${layout}">\n${figures.join('\n')}\n</div>`;
}

function renderMaterial(item, { base, lazy }) {
  const out = [];
  const plan = textPlan(item);
  let number = 1;
  for (let i = 0; i < item.blocks.length;) {
    const block = item.blocks[i];
    if (block.type === 'text') {
      const blocks = plan.parsed.get(block);
      if (blocks.length) out.push(`<div class="obs-text">\n${renderBlocks(blocks, { base, top: plan.top, kind: block.kind })}\n</div>`);
      i++;
      continue;
    }
    const run = [];
    while (i < item.blocks.length && item.blocks[i].type === 'image') run.push(item.blocks[i++]);
    out.push(renderImages(item, run, { lazy, number }));
    number += run.length;
  }
  return out.join('\n');
}

// --- one Observation --------------------------------------------------------

// `on`: 'index' (the date opens the sheet; the heading is h2) or 'sheet' (the
// date is plain; the heading is the page's h1).
function renderObservation(item, { on }) {
  const r = item.record;
  const h = on === 'sheet' ? 1 : 2;
  const date = marginDate(r.published_at);
  const time = `<time datetime="${esc(isoDay(r.published_at))}">${date}</time>`;
  const dateMark = on === 'index'
    ? `<a class="obs-date" href="${url(item.number)}">${time}<span class="visually-hidden">, open on its own sheet</span></a>`
    : `<p class="obs-date">${time}</p>`;

  const from = `<p class="obs-from"><span>FROM</span><span class="obs-from-name">${r.author ? esc(r.author) : 'UNSIGNED'}</span>${
    r.author_role ? `<span class="visually-hidden">, </span><span class="obs-role">${esc(r.author_role)}</span>` : ''}${
    r.context ? `<span class="visually-hidden">, </span><span class="obs-context">${esc(r.context)}</span>` : ''}</p>`;

  const heading = r.title
    ? `<h${h} class="obs-title">${esc(r.title)}</h${h}>`
    : `<h${h} class="visually-hidden">${esc(lead(r))}</h${h}>`;


  const tag = on === 'index' ? 'li' : 'article';
  return `<${tag} class="observation" id="${esc(item.number)}">
<div class="obs-margin">
${dateMark}
${from}
</div>
<div class="obs-body">
<div class="obs-sheet">
${[heading, renderMaterial(item, { base: h, lazy: on === 'index' })].filter(Boolean).join('\n')}
</div>
</div>
</${tag}>`;
}

// --- the index ------------------------------------------------------------

// `items` arrive in publication order, earliest first. The index shows them
// newest first; the extent and each sheet's before/after links keep publication
// order (docs/observations-publishing.md §6).
function renderSequence(items) {
  return items.slice().reverse().map((item) => renderObservation(item, { on: 'index' })).join('\n');
}

// The extent of the sequence, stated before it is read: since when, taken from
// the earliest published Observation. The total number of publications is never
// shown here or anywhere else (docs/observations-publishing.md §6).
function renderExtent(items) {
  const by = 'SENT BY OTHERS · PUBLISHED BY PROBNAYA';
  if (!items.length) return `<p>${by}</p>`;
  const first = marginDate(items[0].record.published_at).slice(3);
  return `<p>${by} · PUBLISHED SINCE ${first}</p>\n<p>NOTHING IS WITHHELD HERE. EACH DATE OPENS ITS PIECE ON ITS OWN SHEET.</p>`;
}

// --- one Observation on its own sheet ----------------------------------------

// The metadata description is a neutral statement in PROBNAYA's voice. It never
// extracts, truncates, summarises, or quotes the contributor's material.
function describe(item) {
  const author = item.record.author;
  return author
    ? `An observation by ${author}, published as sent by PROBNAYA.`
    : 'An unsigned observation, published as sent by PROBNAYA.';
}

function neighbour(item, rel) {
  if (!item) return '';
  const label = rel === 'prev' ? '<span aria-hidden="true">← </span>PUBLISHED BEFORE' : 'PUBLISHED AFTER<span aria-hidden="true"> →</span>';
  return `<a class="obs-neighbour obs-neighbour--${rel}" rel="${rel}" href="${url(item.number)}">
<span class="obs-neighbour-dir">${label}</span>
<span class="obs-neighbour-name">${esc(signedName(item.record))}</span>
<span class="obs-neighbour-date">${marginDate(item.record.published_at)}</span>
</a>`;
}

// `chrome` holds the site header, mobile header, footer, and tab bar, taken from
// observations.html so every page keeps the same frame without a second copy.
function renderSheetPage(item, { prev, next, chrome, robots = null }) {
  const r = item.record;
  const canonical = SITE + url(item.number);
  const title = `${lead(r)} — Observations — PROBNAYA`;
  const description = describe(item);
  const image = SHARE_IMAGE;
  const published = r.published_at;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Generated by \`npm run observations:build\` from observations/${esc(item.number)}/observation.json. Do not edit by hand. -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${r.author ? `<meta name="author" content="${esc(r.author)}">\n` : ''}${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ''}<link rel="icon" type="image/svg+xml" href="/assets/probnaya-mark.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">
<link rel="apple-touch-icon" href="/assets/favicon-180.png">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="PROBNAYA">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image.src)}">
<meta property="og:image:type" content="${image.type}">
<meta property="og:image:width" content="${image.width}">
<meta property="og:image:height" content="${image.height}">
<meta property="og:image:alt" content="${esc(image.alt)}">
<meta property="article:published_time" content="${esc(published)}">
<meta property="article:section" content="Observations">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image.src)}">
<meta name="twitter:image:alt" content="${esc(image.alt)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<script>try{if(localStorage.getItem('probnaya:recognized')==='1')document.documentElement.dataset.relation='pending'}catch(e){}</script>
</head>
<body>

${chrome.header}

${chrome.mobileHeader}

<main class="main">
  <div class="page observations-page observations-page--sheet">

    <nav class="obs-sheet-bar" aria-label="Observations">
      <a class="obs-back" href="/observations#${esc(item.number)}"><span aria-hidden="true">← </span>OBSERVATIONS</a>
      <p>ONE OBSERVATION, ON ITS OWN SHEET</p>
    </nav>

    <div class="obs-reading">
${renderObservation(item, { on: 'sheet' })}
    </div>

    <div class="obs-sheet-foot">
      <p>PUBLISHED BY PROBNAYA AS SENT · NOT EDITED · NOT SHORTENED · NOT RETITLED</p>
    </div>
${prev || next ? `
    <nav class="obs-neighbours" aria-label="Published before and after">
${[neighbour(prev, 'prev'), prev && next ? '<span class="obs-neighbours-rule" aria-hidden="true"></span>' : '', neighbour(next, 'next')].filter(Boolean).join('\n')}
    </nav>
` : ''}
  </div>
</main>

${chrome.footer}

${chrome.bottomNav}

<script src="/js/apparatus.js"></script>
<script src="/js/records.js"></script>
<script src="/js/register.js"></script>
<script src="/js/site.js"></script>
</body>
</html>
`;
}

// The shared frame of the public pages, read from observations.html. On an
// Observation's own sheet the OBSERVATIONS link marks the section, not the page.
function extractChrome(indexHtml) {
  const take = (re, name) => {
    const m = re.exec(indexHtml);
    if (!m) throw new Error(`observations.html has no ${name}; the sheet pages take their frame from it`);
    return m[0];
  };
  const section = (s) => s.replace(/aria-current="page"/g, 'aria-current="true"');
  return {
    header: section(take(/<header class="site-header">[\s\S]*?<\/header>/, 'site header')),
    mobileHeader: take(/<header class="mobile-header">[\s\S]*?<\/header>/, 'mobile header'),
    footer: take(/<footer class="site-footer">[\s\S]*?<\/footer>/, 'site footer'),
    bottomNav: section(take(/<nav class="bottom-nav[^"]*">[\s\S]*?<\/nav>/, 'bottom navigation')),
  };
}

module.exports = {
  SITE, SHARE_IMAGE, esc, inline, textPlan, marginDate, plainDate, parseBody, renderObservation, renderSequence, renderExtent,
  renderSheetPage, extractChrome, describe, lead, url,
};
