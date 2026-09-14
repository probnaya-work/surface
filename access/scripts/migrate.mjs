import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationRoot = resolve(root, 'migrations');
const migrations = (await readdir(migrationRoot)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [{ exists }] = await sql`SELECT to_regclass('access_holders') IS NOT NULL AS exists`;
  for (const name of migrations) {
    if (name.startsWith('001_') && exists) continue;
    await sql.unsafe(await readFile(resolve(migrationRoot, name), 'utf8'));
  }
} finally {
  await sql.end();
}
