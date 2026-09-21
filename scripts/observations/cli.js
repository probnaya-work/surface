#!/usr/bin/env node
'use strict';

// Observations from the terminal. See docs/observations-publishing.md.
//
//   npm run observation:new
//   npm run observation:image     -- <number> <file> --alt "…" [--caption "…"]
//   npm run observation:validate  -- [<number>]
//   npm run observation:preview   -- <number> [--port 4177]
//   npm run observation:publish   -- <number> [--date YYYY-MM-DD] [--reissue]
//   npm run observation:unpublish -- <number>
//   npm run observations:build    [-- --check]
//
// Nothing here commits, pushes, deploys, or sends anything.

const path = require('node:path');
const readline = require('node:readline');
const records = require('./records');
const workflow = require('./workflow');
const { build } = require('./build');
const { startPreview, previewItem } = require('./preview');

const ROOT = path.resolve(process.env.OBSERVATIONS_ROOT || path.join(__dirname, '..', '..'));
// npm runs scripts from the package root; paths the editor types are relative to
// where they typed them.
const CWD = process.env.INIT_CWD || process.cwd();

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function report(result, { quiet = false } = {}) {
  const where = result.where === 'published' ? records.PUBLISHED_DIR : records.DRAFTS_DIR;
  const status = result.errors.length ? 'NOT READY' : 'OK';
  console.log(`${status}  ${result.number}  (${where}/${result.number})`);
  for (const e of result.errors) console.log(`  error    ${e}`);
  for (const w of result.warnings) console.log(`  warning  ${w}`);
  if (!quiet && !result.errors.length && result.record) {
    const r = result.record;
    const parts = [r.title ? 'title' : null, ...result.blocks.map((b) => (b.type === 'text' ? 'text' : 'image'))];
    console.log(`  ${parts.filter(Boolean).join(' + ')} · ${r.author ? `from ${r.author}` : 'unsigned'}${r.published_at ? ` · published ${r.published_at}` : ''}`);
  }
}

// A line reader that also works when answers are piped in.
function prompter() {
  const rl = readline.createInterface({ input: process.stdin, terminal: process.stdin.isTTY && process.stdout.isTTY });
  const queue = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queue.push(line)));
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null); });
  return {
    ask(question) {
      process.stdout.write(question);
      if (queue.length) { const line = queue.shift(); if (!process.stdin.isTTY) process.stdout.write(line + '\n'); return Promise.resolve(line); }
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push((line) => { if (!process.stdin.isTTY && line !== null) process.stdout.write(line + '\n'); resolve(line); }));
    },
    close() { rl.close(); },
  };
}

function resolveInput(p) {
  const v = (p || '').trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\\ /g, ' ');
  if (!v) return '';
  return path.resolve(CWD, v.replace(/^~(?=\/)/, process.env.HOME || '~'));
}

async function cmdNew() {
  const io = prompter();
  const ask = async (q) => {
    const a = await io.ask(q);
    if (a === null) throw new workflow.WorkflowError('input ended before the draft was complete; nothing was created');
    return a;
  };
  try {
    console.log('New Observation. It is created as a draft in observations/_drafts/, which git and Vercel ignore.');
    console.log('Type exactly what the sender gave. Leave optional answers blank.\n');
    const title = await ask('Title, only if the sender gave one: ');
    const author = await ask('Name or initials (blank: unsigned): ');
    const role = author.trim() ? await ask('Role, optional (for example PRINCIPAL, PROBNAYA): ') : '';
    const context = await ask('Context line, optional (for example "legal translator, Vienna"): ');
    // The material, in the order it is read: each answer is a text file
    // (.txt or .md) or an image, and the page keeps that order.
    console.log('\nThe material, in reading order. Give one file per line: a text file (.txt or .md) or an image.');
    const blocks = [];
    for (;;) {
      const source = resolveInput(await ask(`Block ${blocks.length + 1}: text or image file (blank when done): `));
      if (!source) break;
      if (records.TEXT_EXTENSIONS.includes(path.extname(source).toLowerCase())) { blocks.push({ text: source }); continue; }
      let alt = '';
      while (!alt.trim()) alt = await ask('  Alt text, what the image shows (required): ');
      const caption = await ask('  Caption, only if the sender gave one: ');
      blocks.push({ image: source, alt, caption });
    }
    // The archival number is the permanent address, /observations/<number>. It
    // is proposed as the next unused number and never shown on the page.
    const suggested = records.nextNumber(ROOT);
    const number = (await ask(`Archival number, the permanent address /observations/<number> [${suggested}]: `)).trim() || suggested;

    const result = workflow.createDraft(ROOT, {
      number, title, author, author_role: role, context, blocks,
    });
    console.log('');
    report(result);
    console.log(`\nCreated ${path.relative(ROOT, result.dir)}/. Next:`);
    console.log(`  npm run observation:validate -- ${number}`);
    console.log(`  npm run observation:preview -- ${number}`);
    console.log(`  npm run observation:publish -- ${number}`);
  } finally {
    io.close();
  }
}

function cmdImage({ positional: [number, file], flags }) {
  if (!number || !file) throw new workflow.WorkflowError('usage: npm run observation:image -- <number> <file> --alt "…" [--caption "…"]');
  const { result, where, built } = workflow.addImage(ROOT, number, {
    source: resolveInput(file), alt: typeof flags.alt === 'string' ? flags.alt : '', caption: typeof flags.caption === 'string' ? flags.caption : undefined,
  });
  report(result);
  if (where === 'published') printBuilt(built);
}

function cmdValidate({ positional: [number] }) {
  let results;
  if (number) {
    const where = records.locate(ROOT, number);
    if (!where) throw new workflow.WorkflowError(`no Observation "${number}"`);
    results = where === 'both'
      ? records.inspectAll(ROOT).filter((r) => r.number === number)
      : [records.inspect(ROOT, number, where)];
  } else {
    results = records.inspectAll(ROOT);
    if (!results.length) console.log('No Observations yet.');
  }
  for (const r of results) report(r);
  if (!number) {
    for (const issue of records.ledgerIssues(ROOT)) { console.log(`NOT READY  ledger\n  error    ${issue}`); process.exitCode = 1; }
    const check = build(ROOT, { check: true });
    if (check.changed.length) {
      console.log(`\nThe generated pages are out of date: ${check.changed.join(', ')}. Run npm run observations:build.`);
      process.exitCode = 1;
    }
  }
  if (results.some((r) => r.errors.length)) process.exitCode = 1;
}

async function cmdPreview({ positional: [number], flags }) {
  if (!number) throw new workflow.WorkflowError('usage: npm run observation:preview -- <number> [--port 4177]');
  const { item, problems, published } = previewItem(ROOT, number);
  if (!item && !published) throw new workflow.WorkflowError(`cannot preview "${number}":\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  for (const p of problems) console.log(`  note     ${p}`);
  if (problems.length) console.log('  (the preview renders anyway; these must be resolved before publishing)\n');
  await startPreview(ROOT, number, { port: Number(flags.port) || 4177 });
}

function printBuilt(built) {
  if (!built) return;
  console.log(built.changed.length ? `Rebuilt: ${built.changed.join(', ')}` : 'Pages already up to date.');
}

function cmdPublish({ positional: [number], flags }) {
  if (!number) throw new workflow.WorkflowError('usage: npm run observation:publish -- <number> [--date YYYY-MM-DD] [--reissue]');
  const { result, built } = workflow.publish(ROOT, number, { date: typeof flags.date === 'string' ? flags.date : undefined, reissue: flags.reissue === true });
  report(result);
  printBuilt(built);
  console.log(`\nPublished locally at /observations/${number}. Nothing was committed, pushed, or deployed.`);
  console.log('Check it, then commit these paths:');
  console.log(`  observations/${number}/  observations/ledger.json  observations.html  sitemap.xml`);
  console.log('After a deploy, the canonical address is https://probnaya.work/observations/' + number);
}

function cmdUnpublish({ positional: [number] }) {
  if (!number) throw new workflow.WorkflowError('usage: npm run observation:unpublish -- <number>');
  const { built } = workflow.unpublish(ROOT, number);
  printBuilt(built);
  console.log(`\n"${number}" is a draft again in ${records.DRAFTS_DIR}/${number}/ and is no longer in the pages.`);
  console.log(`Commit the removal of observations/${number}/ with observations/ledger.json, observations.html, and sitemap.xml.`);
  console.log(`Number ${number} is marked withdrawn and will not be given to another Observation.`);
  console.log('Its earlier version stays in the public repository history and in any copies made while it was public.');
}

function cmdBuild({ flags }) {
  const out = build(ROOT, { check: Boolean(flags.check) });
  if (flags.check) {
    if (out.changed.length) {
      console.log(`Out of date: ${out.changed.join(', ')}. Run npm run observations:build.`);
      process.exitCode = 1;
    } else console.log(`Up to date (${out.published} published).`);
    return;
  }
  console.log(`${out.published} published. ${out.changed.length ? `Wrote ${out.changed.join(', ')}.` : 'Nothing changed.'}`);
}

const COMMANDS = { new: cmdNew, image: cmdImage, validate: cmdValidate, preview: cmdPreview, publish: cmdPublish, unpublish: cmdUnpublish, build: cmdBuild };

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  const command = COMMANDS[name];
  if (!command) {
    console.error(`usage: node scripts/observations/cli.js <${Object.keys(COMMANDS).join('|')}> …`);
    process.exitCode = 2;
    return;
  }
  try {
    await command(parseArgs(rest));
  } catch (err) {
    if (err instanceof workflow.WorkflowError) {
      console.error(`Refused: ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error(err.message || err);
      process.exitCode = 1;
    }
  }
}

main();
