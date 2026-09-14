import { randomUUID } from 'node:crypto';
import { loadConfig } from '../lib/config.js';
import { ENROLLMENT_GRANT_MS } from '../lib/constants.js';
import { randomToken } from '../lib/crypto.js';
import { PostgresStore } from '../lib/postgres-store.js';
import { AccessService } from '../lib/service.js';

const publicId = process.argv[2];
if (!/^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$/.test(publicId || '')) {
  throw new Error('Usage: node scripts/create-enrollment.mjs PROB–H–...');
}
const config = loadConfig();
if (config.memory) throw new Error('Enrollment creation requires PostgreSQL');
const store = new PostgresStore(config.databaseURL);
const service = new AccessService({ config, store, webauthn: {} });
const token = randomToken();
const now = Date.now();
const holder = { id: randomUUID(), publicId, webauthnUserId: randomToken(), condition: 'pending', createdAt: now, updatedAt: now };
try {
  await store.seedHolder(holder, {
    id: randomUUID(),
    holderId: holder.id,
    tokenHash: service.tokenHash('enrollment', token),
    createdAt: now,
    expiresAt: now + ENROLLMENT_GRANT_MS,
    consumedAt: null,
  });
} finally {
  await store.close();
}
process.stdout.write(`${token}\n`);
