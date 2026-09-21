'use strict';

// The publication template. One function renders an Observation; the index and
// each Observation's own sheet both use it, and so does the local preview.
//
// Two voices never share a ground. PROBNAYA speaks in mono capitals in the
// margin and the frame. The contributor's material sits on its own sheet
// (--sheet, inside a hairline), in sentence case, and is signed at the end.
//
// The approved visual source is the first design pass, the Claude Design file
// "PROBNAYA - Observations Published (sheets, superseded).dc.html" in project
// d02780a6-b7fa-4b59-89ac-64f60f27f3b1. It is approved despite "superseded" in
// its name; do not take another file in that project as the source without an
// explicit editorial decision (docs/observations-publishing.md §0).
//
// Contributor text is never rewritten: it is escaped, split into paragraphs at
// blank lines, and set with its own line breaks and spacing (white-space:
// pre-wrap). A body.md file may also use three structures, and nothing else:
//   a line starting "# " (up to six #) on its own   → a heading
//   a block where every line starts "- ", "* ", "+" → a list
//   a line of three or more -, * or _               → a rule
// Everything else, including *emphasis*, links, and numbered lines, is shown
// exactly as typed.

const SITE = 'https://probnaya.work';
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

function url(slug) { return `/observations/${slug}`; }
function imageUrl(slug, file) { return `/observations/${slug}/${file}`; }

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
    if (lines.length === 1 && heading) return { t: 'h', text: heading[1] };
    if (lines.length === 1 && /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(chunk)) return { t: 'rule' };
    if (lines.every((l) => /^[-*+][ \t]+\S/.test(l))) return { t: 'list', items: lines.map((l) => l.replace(/^[-*+][ \t]+/, '')) };
    return { t: 'p', text: chunk };
  });
}

function renderBlocks(blocks, headingLevel) {
  return blocks.map((b) => {
    if (b.t === 'h') return `<h${headingLevel} class="obs-h">${esc(b.text)}</h${headingLevel}>`;
    if (b.t === 'rule') return '<hr class="obs-rule">';
    if (b.t === 'list') return `<ul class="obs-list">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    return `<p>${esc(b.text)}</p>`;
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
    const src = imageUrl(item.slug, im.file);
    const which = total > 1 ? `image ${number + i} of ${total}` : 'image';
    const ratio = +(im.width / im.height).toFixed(4);
    return `<figure class="obs-thing" style="--w: ${im.width}px; --r: ${ratio}">
  <img src="${esc(src)}" width="${im.width}" height="${im.height}" alt="${esc(im.alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async">
  <figcaption>${im.caption ? `<span class="obs-caption">${esc(im.caption)}</span>` : ''}<a class="obs-open" href="${esc(src)}" target="_blank" rel="noopener">OPEN ORIGINAL <span aria-hidden="true">↗</span><span class="visually-hidden"> (${which}, opens in a new tab)</span></a></figcaption>
</figure>`;
  });
  return `<div class="obs-things obs-things--${layout}">\n${figures.join('\n')}\n</div>`;
}

function renderMaterial(item, { headingLevel, lazy }) {
  const out = [];
  let number = 1;
  for (let i = 0; i < item.blocks.length;) {
    const block = item.blocks[i];
    if (block.type === 'text') {
      const blocks = parseBody(block.text, block.kind);
      if (blocks.length) out.push(`<div class="obs-text">\n${renderBlocks(blocks, headingLevel)}\n</div>`);
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
    ? `<a class="obs-date" href="${url(item.slug)}">${time}<span class="visually-hidden">, open on its own sheet</span></a>`
    : `<p class="obs-date">${time}</p>`;

  const from = `<p class="obs-from"><span>FROM</span><span class="obs-from-name">${r.author ? esc(r.author) : 'UNSIGNED'}</span>${
    r.author_role ? `<span class="obs-role">${esc(r.author_role)}</span>` : ''}</p>`;

  const heading = r.title
    ? `<h${h} class="obs-title">${esc(r.title)}</h${h}>`
    : `<h${h} class="visually-hidden">${esc(lead(r))}</h${h}>`;


  const signature = `<p class="obs-sender${r.author ? '' : ' is-unsigned'}"><span class="obs-name">${esc(signedName(r))}</span>${
    r.context ? `<span class="visually-hidden">, </span><span class="obs-context">${esc(r.context)}</span>` : ''}</p>`;

  const tag = on === 'index' ? 'li' : 'article';
  return `<${tag} class="observation" id="${esc(item.slug)}">
<div class="obs-margin">
${dateMark}
${from}
</div>
<div class="obs-body">
<div class="obs-sheet">
${[heading, renderMaterial(item, { headingLevel: h + 1, lazy: on === 'index' }), signature].filter(Boolean).join('\n')}
</div>
</div>
</${tag}>`;
}

// --- the index ------------------------------------------------------------

function renderSequence(items) {
  return items.map((item) => renderObservation(item, { on: 'index' })).join('\n');
}

// The extent of the sequence, stated before it is read. An archive says how
// much of it there is; it does not count views.
function renderExtent(items) {
  const by = 'SENT BY OTHERS · PUBLISHED BY PROBNAYA';
  if (!items.length) return `<p>${by}</p>`;
  const first = marginDate(items[0].record.published_at).slice(3);
  return `<p>${by} · ${items.length} SINCE ${first}</p>\n<p>NOTHING IS WITHHELD HERE. EACH DATE OPENS ITS PIECE ON ITS OWN SHEET.</p>`;
}

// --- one Observation on its own sheet ----------------------------------------

function firstWords(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if ([...flat].length <= max) return flat;
  const cut = [...flat].slice(0, max).join('');
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:.–—-]+$/, '') + '…';
}

function describe(item) {
  const r = item.record;
  const words = item.texts
    .flatMap((t) => parseBody(t.text, t.kind))
    .map((b) => b.text || (b.items || []).join(' ')).filter(Boolean).join(' ');
  if (words) return firstWords(words, 155);
  const what = item.images.length > 1 ? `${item.images.length} images` : 'An image';
  return `${what} sent to PROBNAYA${r.author ? ` by ${r.author}` : ''}, published ${plainDate(r.published_at)}.`;
}

function neighbour(item, rel) {
  if (!item) return '';
  const label = rel === 'prev' ? '<span aria-hidden="true">← </span>PUBLISHED BEFORE' : 'PUBLISHED AFTER<span aria-hidden="true"> →</span>';
  return `<a class="obs-neighbour obs-neighbour--${rel}" rel="${rel}" href="${url(item.slug)}">
<span class="obs-neighbour-dir">${label}</span>
<span class="obs-neighbour-name">${esc(signedName(item.record))}</span>
<span class="obs-neighbour-date">${marginDate(item.record.published_at)}</span>
</a>`;
}

// `chrome` holds the site header, mobile header, footer, and tab bar, taken from
// observations.html so every page keeps the same frame without a second copy.
function renderSheetPage(item, { prev, next, chrome, robots = null }) {
  const r = item.record;
  const canonical = SITE + url(item.slug);
  const title = `${lead(r)} — Observations — PROBNAYA`;
  const description = describe(item);
  const first = item.images[0];
  const image = first
    ? { src: SITE + imageUrl(item.slug, first.file), width: first.width, height: first.height, alt: first.alt }
    : { src: `${SITE}/assets/og-1200x630.png`, width: 1200, height: 630, alt: null };
  const published = r.published_at;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Generated by \`npm run observations:build\` from observations/${esc(item.slug)}/observation.json. Do not edit by hand. -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ''}<link rel="icon" type="image/svg+xml" href="/assets/probnaya-mark.svg">
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
<meta property="og:image:width" content="${image.width}">
<meta property="og:image:height" content="${image.height}">
${image.alt ? `<meta property="og:image:alt" content="${esc(image.alt)}">\n` : ''}<meta property="article:published_time" content="${esc(published)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image.src)}">
${image.alt ? `<meta name="twitter:image:alt" content="${esc(image.alt)}">\n` : ''}<link rel="preconnect" href="https://fonts.googleapis.com">
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
      <a class="obs-back" href="/observations#${esc(item.slug)}"><span aria-hidden="true">← </span>OBSERVATIONS</a>
      <p>ONE OBSERVATION, ON ITS OWN SHEET</p>
    </nav>

    <div class="obs-reading">
${renderObservation(item, { on: 'sheet' })}
    </div>

    <div class="obs-sheet-foot">
      <p>PUBLISHED BY PROBNAYA AS SENT · NOT EDITED · NOT SHORTENED · NOT RETITLED</p>
      <p class="obs-address">probnaya.work/observations/${esc(item.slug)}</p>
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
  SITE, esc, marginDate, plainDate, parseBody, renderObservation, renderSequence, renderExtent,
  renderSheetPage, extractChrome, describe, lead, url,
};
