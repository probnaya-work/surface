import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMaskedLine } from '../lib/masked-prompt.js';
import { ask, readContactLookup } from '../lib/operator-input.js';
import { openOperatorStore } from '../lib/operator.js';

// Private ownership of published Observations (docs/observation-ownership.md).
// Run from access/ with the access_operator credential:
//
//   npm run observation-owner -- register 001 [--replace]
//   npm run observation-owner -- offer 001 'PROB–H–0003'
//   npm run observation-owner -- detach 001
//   npm run observation-owner -- list
//
// `register` reads the sender's address without echo (or from OBSERVATION_CONTACT_FD)
// and stores only its keyed lookup. No address is accepted as an argument, printed,
// or written to the repository. Nothing here changes the public Observation.

const USAGE = [
  'Usage: npm run observation-owner -- register <number> [--replace]',
  "       npm run observation-owner -- offer <number> 'PROB–H–…'",
  '       npm run observation-owner -- detach <number>',
  '       npm run observation-owner -- list',
].join('\n');

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NUMBER = /^[0-9]{3}$/;

function usage() {
  throw new Error(USAGE);
}

// The published record is the only source for the title and day the holder sees.
// It must be published and its number must never have been withdrawn.
export function publishedFacts(number, root = process.env.OBSERVATIONS_ROOT || REPO_ROOT) {
  let record;
  let ledger;
  try {
    record = JSON.parse(readFileSync(resolve(root, 'observations', number, 'observation.json'), 'utf8'));
    ledger = JSON.parse(readFileSync(resolve(root, 'observations', 'ledger.json'), 'utf8'));
  } catch {
    throw new Error(`Observation ${number} is not published in this checkout`);
  }
  const issued = ledger?.numbers?.[number];
  if (record?.number !== number || record.status !== 'published' || !issued || issued.withdrawn_at) {
    throw new Error(`Observation ${number} is not published in this checkout`);
  }
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(String(record.published_at || ''))?.[1];
  if (!day) throw new Error(`Observation ${number} has no publication date`);
  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 300) : null;
  return { title, publishedOn: day };
}

async function main() {
  const [command, number, ...rest] = process.argv.slice(2);
  if (!['register', 'offer', 'detach', 'list'].includes(command)) usage();
  if (command === 'list' ? number !== undefined : !NUMBER.test(number || '') || number === '000') usage();
  const replace = command === 'register' && rest.length === 1 && rest[0] === '--replace';
  if (command === 'register' && rest.length && !replace) usage();
  if (command === 'offer' && (rest.length !== 1 || !/^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$/.test(rest[0]))) usage();
  if ((command === 'detach' || command === 'list') && rest.length) usage();

  const profile = process.env.ACCESS_ENV || 'production';
  if (profile !== 'production' && profile !== 'development') throw new Error('ACCESS_ENV must be production or development');
  const facts = command === 'register' || command === 'offer' ? publishedFacts(number) : null;
  const env = profile === 'production'
    ? { ACCESS_ENV: 'production', DATABASE_URL: await readMaskedLine() }
    : process.env;
  const { store } = await openOperatorStore(env);
  const now = Date.now();
  try {
    if (command === 'list') {
      const rows = await store.listObservationOwnership();
      process.stdout.write(`${rows.length} Observation${rows.length === 1 ? '' : 's'} with private ownership\n`);
      for (const row of rows) {
        const who = row.owner ? `owner ${row.owner}` : row.offeredTo ? `offered to ${row.offeredTo}` : row.hasContact ? 'by sender address' : '—';
        process.stdout.write(`${row.number}  ${row.status.padEnd(16)} ${who}${row.declines ? `  (${row.declines} not mine)` : ''}\n`);
      }
      return;
    }

    if (command === 'detach') {
      const result = await store.detachObservation({ number, now, auditId: randomUUID() });
      if (!result.detached) {
        process.stderr.write(`Observation ${number} has no private ownership record. Nothing changed.\n`);
        process.exitCode = 1;
      } else {
        process.stdout.write(result.repeated
          ? `Observation ${number} was already detached. Nothing changed.\n`
          : `Observation ${number} is detached (was ${result.previous}). The public Observation is unchanged.\n`);
      }
      return;
    }

    if (command === 'offer') {
      process.stderr.write(`Offer Observation ${number} to ${rest[0]} only after verifying by correspondence that this holder sent it.\n`);
      if ((await ask('Verified? [y/N] ')).toLowerCase() !== 'y') {
        process.stderr.write('Nothing was offered.\n');
        return;
      }
      const result = await store.offerObservation({ number, publicId: rest[0], ...facts, now, auditId: randomUUID() });
      if (!result.offered) {
        const reasons = { 'unknown-holder': `${rest[0]} does not exist`, suspended: `${rest[0]} is suspended`, claimed: `Observation ${number} is claimed by another holder; detach it first` };
        process.stderr.write(`Nothing was offered: ${reasons[result.reason]}.\n`);
        process.exitCode = 1;
      } else {
        process.stdout.write(result.repeated
          ? `${rest[0]} already holds Observation ${number}. Nothing changed.\n`
          : `Observation ${number} is offered to ${rest[0]}. It is added only if they accept.\n`);
      }
      return;
    }

    // register
    process.stderr.write(`Observation ${number}: ${facts.title ? `"${facts.title}"` : 'untitled'}, published ${facts.publishedOn}.\n`);
    process.stderr.write('Register only an address PROBNAYA has corresponded with about this Observation (a reply was received from it).\n');
    if ((await ask('Confirmed by correspondence? [y/N] ')).toLowerCase() !== 'y') {
      process.stderr.write('Nothing was recorded.\n');
      return;
    }
    const lookup = await readContactLookup({ profile, env: process.env, prompt: 'Sender address (not shown): ' });
    const result = await store.registerObservationContact({ number, contactLookup: lookup, ...facts, replace, now, auditId: randomUUID() });
    if (!result.registered) {
      const reasons = {
        'different-contact': `Observation ${number} is already registered to a different address (${result.status}). Use --replace only to correct a mistaken address.`,
        claimed: `Observation ${number} is claimed. Detach it before registering another address.`,
      };
      process.stderr.write(`Nothing was recorded: ${reasons[result.reason]}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(result.created
      ? `Observation ${number} is registered: awaiting account.\n`
      : result.replaced
        ? `Observation ${number}: the address was replaced; awaiting account.\n`
        : `Observation ${number} was already registered to this address (${result.status}). Nothing changed.\n`);
  } finally {
    await store.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const safe = error.message === USAGE || /^(ACCESS_ENV|A terminal|Credential input|Refusing to run|Production operator commands|Production DATABASE_URL|DATABASE_URL|OBSERVATION_CONTACT|Observation \d{3} |The address could not|The two addresses|No address was given)/.test(error.message);
    process.stderr.write(`${safe ? error.message : 'The command failed. Check the operator credential and database availability.'}\n`);
    process.exitCode = 1;
  }
}
