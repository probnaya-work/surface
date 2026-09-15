import { randomUUID } from 'node:crypto';
import { openOperatorStore } from '../lib/operator.js';

// Usage (with ACCESS_ENV and DATABASE_URL for the access_operator role):
//   node scripts/set-holder-condition.mjs PROB–H–... suspend|reactivate
const [publicId, action] = process.argv.slice(2);
if (!/^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$/.test(publicId || '') || !['suspend', 'reactivate'].includes(action)) {
  throw new Error('Usage: node scripts/set-holder-condition.mjs PROB–H–... suspend|reactivate');
}
const { store } = await openOperatorStore();
let result;
try {
  result = await store.setHolderCondition({ publicId, action, now: Date.now(), auditId: randomUUID() });
} finally {
  await store.close();
}
if (!result.changed) {
  process.stderr.write(`Unchanged: ${result.reason}${result.condition ? ` (${result.condition})` : ''}.\n`);
  process.exit(1);
}
process.stdout.write(`${publicId} is now ${result.condition}.\n`);
