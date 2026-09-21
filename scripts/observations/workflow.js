'use strict';

// The steps an editor takes: create a draft, attach an image, publish, withdraw.
// Each refuses rather than overwrite, and none of them touches git, the network,
// or a deployment.

const fs = require('node:fs');
const path = require('node:path');
const records = require('./records');
const { probeImage, SUPPORTED } = require('./images');
const { build } = require('./build');

class WorkflowError extends Error {}

function fail(message) { throw new WorkflowError(message); }

// Writes a record with its fields in a fixed order, so a diff shows only what changed.
function writeRecord(dir, record, { exclusive = false } = {}) {
  const order = ['slug', 'status', 'published_at', 'title', 'author', 'author_role', 'context', 'blocks'];
  const out = {};
  for (const key of order) if (record[key] !== undefined && record[key] !== null) out[key] = record[key];
  for (const key of Object.keys(record)) if (!(key in out) && record[key] !== undefined && record[key] !== null) out[key] = record[key];
  fs.writeFileSync(path.join(dir, records.RECORD_FILE), JSON.stringify(out, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
}

function readRecord(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, records.RECORD_FILE), 'utf8'));
}

function optional(value) {
  if (value === undefined || value === null) return undefined;
  const v = String(value).trim();
  return v ? v : undefined;
}

function checkSourceFile(source, what) {
  if (!source) fail(`${what}: no file given`);
  let st;
  try { st = fs.statSync(source); } catch { fail(`${what}: ${source} does not exist`); }
  if (!st.isFile()) fail(`${what}: ${source} is not a file`);
}

// Copies one image into the record's images/ directory under a predictable
// name, <slug>-<n>.<ext>, and returns the record-relative path. Never replaces.
function copyImage(dir, slug, source, taken) {
  checkSourceFile(source, 'image');
  const probe = probeImage(fs.readFileSync(source));
  if (probe.error) fail(`image ${source} ${probe.error}`);
  const ext = SUPPORTED[probe.format][0];
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  let n = 1;
  while (taken.has(n) || fs.readdirSync(path.join(dir, 'images')).some((f) => f.startsWith(`${slug}-${n}.`))) n++;
  taken.add(n);
  const rel = `images/${slug}-${n}${ext}`;
  fs.copyFileSync(source, path.join(dir, rel), fs.constants.COPYFILE_EXCL);
  return rel;
}

// spec: { slug, title?, author?, author_role?, context?,
//         blocks: [{ text: <file> } | { image: <file>, alt, caption? }] }  — in reading order
function createDraft(root, spec) {
  const slug = spec.slug;
  if (!records.isSlug(slug)) fail(`"${slug}" is not a valid slug: lowercase letters, digits, and single hyphens`);
  const where = records.locate(root, slug);
  if (where) fail(`the slug "${slug}" is already used by a ${where === 'draft' ? 'draft' : 'published Observation'}; choose another`);
  const author = optional(spec.author);
  const role = optional(spec.author_role);
  if (role && !author) fail('a role needs a name; an unsigned Observation has no role');
  const blocks = spec.blocks || [];
  if (!blocks.length) fail('an Observation needs a text file or at least one image');
  for (const b of blocks) {
    if (b.text) {
      checkSourceFile(b.text, 'text');
      const ext = path.extname(b.text).toLowerCase();
      if (!records.TEXT_EXTENSIONS.includes(ext)) fail(`text ${b.text} must be a .txt or .md file`);
      const read = records.readText(b.text);
      if (read.error) fail(`text ${b.text} ${read.error}`);
      if (!read.text.trim()) fail(`text ${b.text} is empty`);
    } else if (b.image) {
      if (!optional(b.alt)) fail(`image ${b.image} needs alt text`);
    } else fail('each block is a text file or an image');
  }

  const dir = records.recordDir(root, slug, 'draft');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.mkdirSync(dir); // throws if something appeared in the meantime
  try {
    const record = {
      slug, status: 'draft',
      title: optional(spec.title), author, author_role: role, context: optional(spec.context),
    };
    const taken = new Set();
    let texts = 0;
    record.blocks = blocks.map((b) => {
      if (b.text) {
        texts += 1;
        const name = `body${texts > 1 ? `-${texts}` : ''}${path.extname(b.text).toLowerCase()}`;
        fs.copyFileSync(b.text, path.join(dir, name), fs.constants.COPYFILE_EXCL);
        return { text: name };
      }
      const entry = { image: copyImage(dir, slug, b.image, taken), alt: optional(b.alt) };
      if (optional(b.caption)) entry.caption = optional(b.caption);
      return entry;
    });
    writeRecord(dir, record, { exclusive: true });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return records.inspect(root, slug, 'draft');
}

function addImage(root, slug, { source, alt, caption }) {
  const where = records.locate(root, slug);
  if (!where) fail(`no Observation "${slug}"`);
  if (where === 'both') fail(`"${slug}" exists both as a draft and as published; resolve that first`);
  if (!optional(alt)) fail('an image needs alt text');
  const dir = records.recordDir(root, slug, where);
  const record = readRecord(dir);
  const entry = { image: copyImage(dir, slug, source, new Set()), alt: optional(alt) };
  if (optional(caption)) entry.caption = optional(caption);
  record.blocks = [...(Array.isArray(record.blocks) ? record.blocks : []), entry];
  writeRecord(dir, record);
  const built = where === 'published' ? build(root) : null;
  return { result: records.inspect(root, slug, where), where, built };
}

function isoNow(now) {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Publishes a valid draft: sets status and published_at, moves the directory
// into observations/, and rebuilds the pages. `date` (YYYY-MM-DD) backdates it.
function publish(root, slug, { date, now = Date.now() } = {}) {
  const where = records.locate(root, slug);
  if (where === 'published') fail(`"${slug}" is already published`);
  if (where === 'both') fail(`"${slug}" exists both as a draft and as published; resolve that first`);
  if (!where) fail(`no draft "${slug}" in ${records.DRAFTS_DIR}/`);

  const draft = records.inspect(root, slug, 'draft', { now });
  if (draft.errors.length) fail(`"${slug}" is not ready:\n${draft.errors.map((e) => `  - ${e}`).join('\n')}`);

  let publishedAt = isoNow(now);
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || records.parsePublishedAt(date) === null) fail(`--date ${date} is not a valid date (YYYY-MM-DD)`);
    if (records.parsePublishedAt(date) > now + 36 * 3600 * 1000) fail(`--date ${date} is in the future`);
    publishedAt = date;
  }

  const from = draft.dir;
  const to = records.recordDir(root, slug, 'published');
  if (fs.existsSync(to)) fail(`${path.relative(root, to)} already exists`);
  const before = fs.readFileSync(path.join(from, records.RECORD_FILE), 'utf8');

  writeRecord(from, { ...draft.record, status: 'published', published_at: publishedAt });
  fs.renameSync(from, to);
  const check = records.inspect(root, slug, 'published', { now });
  if (check.errors.length) {
    fs.renameSync(to, from);
    fs.writeFileSync(path.join(from, records.RECORD_FILE), before);
    fail(`"${slug}" could not be published:\n${check.errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  try {
    return { result: check, built: build(root, { now }) };
  } catch (err) {
    fs.renameSync(to, from);
    fs.writeFileSync(path.join(from, records.RECORD_FILE), before);
    build(root, { now });
    throw err;
  }
}

// Withdraws a published Observation: it becomes a draft again (out of git and
// out of the deployment), its sheet page is removed, and the pages are rebuilt.
function unpublish(root, slug, { now = Date.now() } = {}) {
  const where = records.locate(root, slug);
  if (where !== 'published') fail(where === 'both' ? `"${slug}" exists both as a draft and as published; resolve that first` : `"${slug}" is not published`);
  const from = records.recordDir(root, slug, 'published');
  const to = records.recordDir(root, slug, 'draft');
  const page = path.join(from, records.GENERATED_FILE);
  if (fs.existsSync(page)) fs.rmSync(page);
  const record = readRecord(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  writeRecord(to, { ...record, status: 'draft', published_at: undefined });
  return { built: build(root, { now }) };
}

function suggestSlug({ title, author, bodyText }) {
  const words = (title || (bodyText || '').split(/\s+/).slice(0, 6).join(' ') || author || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return words.split('-').slice(0, 7).join('-').slice(0, 60).replace(/-+$/, '') || 'observation';
}

module.exports = { WorkflowError, createDraft, addImage, publish, unpublish, suggestSlug, writeRecord };
