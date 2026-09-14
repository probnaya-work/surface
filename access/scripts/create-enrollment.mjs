import { randomUUID } from 'node:crypto';
import { loadConfig } from '../lib/config.js';
import { ENROLLMENT_GRANT_MS } from '../lib/constants.js';
import { randomToken } from '../lib/crypto.js';
import { PostgresStore } from '../lib/postgres-store.js';
import { AccessService } from '../lib/service.js';

// Usage: node scripts/create-enrollment.mjs PROB–H–... [operator note]
// Creates a pending holder, or issues a replacement grant to a holder that is
// still pending. The grant prints once to standard output.
const [publicId, operatorNote] = process.argv.slice(2);
if (!/^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$/.test(publicId || '')) {
  throw new Error('Usage: node scripts/create-enrollment.mjs PROB–H–... [operator note]');
}
if (operatorNote !== undefined && (operatorNote.length > 200 || /[\u0000-\u001F\u007F]/.test(operatorNote))) {
  throw new Error('Operator note must be plain text of at most 200 characters');
}
const config = loadConfig();
if (config.memory) throw new Error('Enrollment creation requires PostgreSQL');
const store = new PostgresStore(config.databaseURL);
const service = new AccessService({ config, store, webauthn: {} });
const token = randomToken();
const now = Date.now();
let result;
try {
  result = await store.issueEnrollmentGrant({
    holder: { id: randomUUID(), publicId, webauthnUserId: randomToken() },
    grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: service.tokenHash('enrollment', token), expiresAt: now + ENROLLMENT_GRANT_MS, operatorNote },
    now,
  });
} finally {
  await store.close();
}
if (!result.issued) {
  process.stderr.write(`No grant issued: ${publicId} is ${result.condition}. Grants only establish a first key for a pending holder.\n`);
  process.exit(1);
}
process.stderr.write(`${result.created ? 'Created pending holder' : 'Replaced outstanding grant for pending holder'} ${publicId}; grant expires ${new Date(now + ENROLLMENT_GRANT_MS).toISOString()}.\n`);
process.stdout.write(`${token}\n`);
