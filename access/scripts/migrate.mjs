import postgres from 'postgres';
import { applyMigrations } from '../lib/migrations.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const applied = await applyMigrations(sql);
  process.stdout.write(`Applied: ${applied.join(', ') || 'none'}\n`);
} finally {
  await sql.end();
}
