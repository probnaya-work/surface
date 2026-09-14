import { loadConfig } from '../lib/config.js';
import { PostgresStore } from '../lib/postgres-store.js';

// Deletes ceremonies, rate-limit buckets, sessions, and recovery sessions that
// stopped being usable more than the retention period ago (default 30 days).
// Audit events, holders, credentials, grants, and recovery codes are kept.
// Scheduling this command is a deployment decision.
const days = Number(process.argv[2] ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Usage: node scripts/prune-expired.mjs [retention days, 1-3650]');
const config = loadConfig();
if (config.memory) throw new Error('Pruning requires PostgreSQL');
const store = new PostgresStore(config.databaseURL);
try {
  const result = await store.pruneExpired({ now: Date.now(), retentionMs: days * 86_400_000 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await store.close();
}
