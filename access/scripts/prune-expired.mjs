import { openOperatorStore } from '../lib/operator.js';

// Deletes ceremonies, rate-limit buckets, sessions, and recovery sessions that
// stopped being usable more than the retention period ago (default 30 days).
// Audit events, holders, credentials, grants, and recovery codes are kept.
// Scheduling this command is a deployment decision. Needs ACCESS_ENV and
// DATABASE_URL for the access_operator role.
const days = Number(process.argv[2] ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Usage: node scripts/prune-expired.mjs [retention days, 1-3650]');
const { store } = await openOperatorStore();
try {
  const result = await store.pruneExpired({ now: Date.now(), retentionMs: days * 86_400_000 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await store.close();
}
