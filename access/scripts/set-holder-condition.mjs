import { randomUUID } from 'node:crypto';
import { loadConfig } from '../lib/config.js';
import { PostgresStore } from '../lib/postgres-store.js';

// Usage: node scripts/set-holder-condition.mjs PROB–H–... suspend|reactivate
const [publicId, action] = process.argv.slice(2);
if (!/^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$/.test(publicId || '') || !['suspend', 'reactivate'].includes(action)) {
  throw new Error('Usage: node scripts/set-holder-condition.mjs PROB–H–... suspend|reactivate');
}
const config = loadConfig();
if (config.memory) throw new Error('Holder condition changes require PostgreSQL');
const store = new PostgresStore(config.databaseURL);
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
