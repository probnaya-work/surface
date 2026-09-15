import { openOperatorStore } from '../lib/operator.js';

// Usage (with ACCESS_ENV and DATABASE_URL for the access_operator role):
//   node scripts/list-holders.mjs
// Read-only: existing PROB–H identifiers, their condition, whether an unconsumed
// establishment link is open, and the latest request reference. It allocates
// nothing; the operator chooses the next identifier.
if (process.argv.length > 2) throw new Error('Usage: node scripts/list-holders.mjs');
const { store } = await openOperatorStore();
let result;
try {
  result = await store.listHolders({ now: Date.now() });
} finally {
  await store.close();
}
const lines = result.holders.map((holder) => [
  holder.publicId.padEnd(16),
  holder.condition.padEnd(9),
  new Date(holder.createdAt).toISOString().slice(0, 10),
  `link ${holder.openLink ? 'open' : 'none'}`.padEnd(10),
  holder.reference || '—',
].join('  '));
process.stdout.write(`${result.holders.length} ${result.holders.length === 1 ? 'holder' : 'holders'} (read-only transaction: ${result.readOnly ? 'yes' : 'no'})\n`);
if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
