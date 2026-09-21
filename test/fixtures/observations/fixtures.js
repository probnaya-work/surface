'use strict';

// FIXTURES — NOT REAL OBSERVATIONS. Synthetic material for tests and for local
// browser checks of the Observations template. Every name, text, and image here
// was made up for that purpose; none of it may be published on probnaya.work.
//
// Images are drawn in code (a frame, a cross, and a corner mark) so that any
// cropping, stretching, or enlargement is visible at a glance.
//
//   node test/fixtures/observations/fixtures.js <empty-directory-copy-of-the-site>
// seeds a COPY of the site with every fixture published. It refuses to run
// against this repository itself.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- images ---------------------------------------------------------------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// A plain RGB PNG: pale ground, a blue frame at the edge, an ink cross through
// the centre, and an ink square in the top-left corner (so a rotation shows).
function makePng(w, h, { extraChunks = [] } = {}) {
  const t = Math.max(2, Math.round(Math.min(w, h) / 60));
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      let rgb = [0xfa, 0xfa, 0xf9];
      const edge = x < t || y < t || x >= w - t || y >= h - t;
      const cross = Math.abs(x * h - y * w) < t * Math.max(w, h) || Math.abs((w - x) * h - y * w) < t * Math.max(w, h);
      const corner = x > 3 * t && x < 9 * t && y > 3 * t && y < 9 * t;
      if (edge) rgb = [0x22, 0x33, 0xcc];
      else if (corner || cross) rgb = [0x16, 0x18, 0x1c];
      row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extraChunks.map(([type, data]) => chunk(type, data)),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A minimal JPEG header (SOI, optional APP1 Exif, SOF0, EOI). It is not a
// decodable picture; it exercises the format and metadata checks only.
function makeJpegHeader(w, h, { exifTags = [] } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (exifTags.length) {
    const entries = Buffer.alloc(2 + exifTags.length * 12 + 4);
    entries.writeUInt16LE(exifTags.length, 0);
    exifTags.forEach(([tag, value], i) => {
      const at = 2 + i * 12;
      entries.writeUInt16LE(tag, at); entries.writeUInt16LE(3, at + 2); entries.writeUInt32LE(1, at + 4); entries.writeUInt16LE(value, at + 8);
    });
    const tiff = Buffer.concat([Buffer.from('II'), Buffer.from([0x2a, 0, 8, 0, 0, 0]), entries]);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const len = Buffer.alloc(2); len.writeUInt16BE(payload.length + 2);
    parts.push(Buffer.from([0xff, 0xe1]), len, payload);
  }
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

// --- material ---------------------------------------------------------------

const TEXT_PLAIN = [
  'FIXTURE. Not a real Observation.',
  '',
  'The kiosk at the station now says “Take your time.” Nobody did.',
  'This line follows a single line break, which is kept.',
  '',
  'Spacing  is  kept  too, and so is  <script>window.__executed = true</script> as text — and & and "quotes".',
  '<img src=x onerror="window.__executed = true"> <b>not bold</b> <a href="https://example.com">not a link</a>',
  '',
  'Emoji stay: 🫖 ❤️ 👩🏽‍💻. So does Кириллица, and a last line without a full stop',
].join('\n');

const TEXT_MD = [
  'FIXTURE. Not a real Observation.',
  '',
  '# 1. A heading the sender wrote',
  '',
  'A paragraph with *asterisks* and _underscores_ that stay exactly as typed.',
  '',
  '- a first item',
  '- a second item, with an emoji 💤',
  '* a third item',
  '',
  '---',
  '',
  '1. Numbered lines stay as typed',
  '2. with their own numbers',
].join('\n');

// Each fixture: the files to write, the draft spec (blocks in reading order,
// with paths relative to the fixture directory), and its publication date.
const FIXTURES = [
  {
    slug: 'fixture-text-only', date: '2025-10-07',
    files: { 'text.txt': TEXT_PLAIN },
    spec: { author: 'Fixture Sender', context: 'fixture context line', blocks: [{ text: 'text.txt' }] },
  },
  {
    slug: 'fixture-image-only', date: '2025-10-07',
    images: { 'portrait.png': [900, 1600] },
    spec: { blocks: [{ image: 'portrait.png', alt: 'FIXTURE: a synthetic portrait-format test card, a blue frame and a dark cross.' }] },
  },
  {
    slug: 'fixture-images-only', date: '2025-11-10',
    images: { 'landscape.png': [1600, 1000], 'square.png': [1000, 1000], 'tall.png': [600, 2400] },
    spec: {
      author: 'F. S.',
      blocks: [
        { image: 'landscape.png', alt: 'FIXTURE: a synthetic landscape test card.', caption: 'FIXTURE caption for the first image only.' },
        { image: 'square.png', alt: 'FIXTURE: a synthetic square test card.' },
        { image: 'tall.png', alt: 'FIXTURE: a synthetic very tall test card.' },
      ],
    },
  },
  {
    slug: 'fixture-image-then-text', date: '2025-12-02',
    files: { 'text.txt': 'FIXTURE. Not a real Observation.\n\nOne paragraph under one wide image, written inside PROBNAYA.' },
    images: { 'wide.png': [1440, 860] },
    spec: {
      title: 'FIXTURE — a title the sender gave', author: 'Fixture Principal', author_role: 'PRINCIPAL, PROBNAYA',
      blocks: [{ image: 'wide.png', alt: 'FIXTURE: a synthetic wide test card like a screenshot.' }, { text: 'text.txt' }],
    },
  },
  {
    slug: 'fixture-text-then-image', date: '2025-12-20',
    files: { 'text.txt': 'FIXTURE. Not a real Observation.\n\nThis text was declared first, so it stands above the image.' },
    images: { 'square.png': [1000, 1000] },
    spec: { author: 'F. S.', blocks: [{ text: 'text.txt' }, { image: 'square.png', alt: 'FIXTURE: a synthetic square test card below the text.' }] },
  },
  {
    slug: 'fixture-interleaved', date: '2026-01-29',
    files: { 'intro.md': TEXT_MD, 'after.txt': 'FIXTURE. A second text block, between the images.' },
    images: { 'a.png': [1600, 1200], 'b.png': [1200, 1600], 'c.png': [1200, 800] },
    spec: {
      author: 'F. S.', context: 'fixture, somewhere',
      blocks: [
        { text: 'intro.md' },
        { image: 'a.png', alt: 'FIXTURE: synthetic test card A.', caption: 'FIXTURE caption A.' },
        { text: 'after.txt' },
        { image: 'b.png', alt: 'FIXTURE: synthetic test card B.', caption: 'FIXTURE caption B.' },
        { image: 'c.png', alt: 'FIXTURE: synthetic test card C.' },
      ],
    },
  },
  {
    slug: 'fixture-small-original', date: '2026-02-19',
    files: { 'text.txt': 'FIXTURE. Not a real Observation.\n\nThe image below is 240 × 160 pixels and must not be enlarged.' },
    images: { 'small.png': [240, 160] },
    spec: { blocks: [{ text: 'text.txt' }, { image: 'small.png', alt: 'FIXTURE: a very small synthetic test card.' }] },
  },
];

// Writes one fixture's source files into `dir` and returns its spec with
// absolute paths, ready for createDraft.
function materialise(fixture, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(fixture.files || {})) fs.writeFileSync(path.join(dir, name), text);
  for (const [name, [w, h]] of Object.entries(fixture.images || {})) fs.writeFileSync(path.join(dir, name), makePng(w, h));
  return {
    ...fixture.spec, slug: fixture.slug,
    blocks: fixture.spec.blocks.map((b) => (b.text ? { text: path.join(dir, b.text) } : { ...b, image: path.join(dir, b.image) })),
  };
}

module.exports = { FIXTURES, TEXT_PLAIN, TEXT_MD, makePng, makeJpegHeader, materialise };

if (require.main === module) {
  const target = path.resolve(process.argv[2] || '');
  const repo = path.resolve(__dirname, '..', '..', '..');
  if (!process.argv[2] || target === repo || !fs.existsSync(path.join(target, 'observations.html'))) {
    console.error('usage: node test/fixtures/observations/fixtures.js <a copy of the site, not this repository>');
    process.exit(2);
  }
  const workflow = require(path.join(repo, 'scripts/observations/workflow.js'));
  const sources = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'obs-fixture-src-'));
  for (const f of FIXTURES) {
    workflow.createDraft(target, materialise(f, path.join(sources, f.slug)));
    workflow.publish(target, f.slug, { date: f.date });
  }
  console.log(`Seeded ${FIXTURES.length} FIXTURE Observations into ${target}.`);
}
