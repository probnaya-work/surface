import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrationFiles(root = MIGRATION_ROOT) {
  return (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
}

// `001` creates the base schema and is not re-runnable; it is skipped once
// `access_holders` exists. Every later migration must be idempotent and is
// re-applied on each run. Each file carries its own BEGIN/COMMIT, so the files
// run on one reserved connection with the simple query protocol.
export async function applyMigrations(sql, root = MIGRATION_ROOT) {
  const connection = await sql.reserve();
  const applied = [];
  try {
    const [{ exists }] = await connection`SELECT to_regclass('access_holders') IS NOT NULL AS exists`;
    for (const name of await migrationFiles(root)) {
      if (name.startsWith('001_') && exists) continue;
      await connection.unsafe(await readFile(resolve(root, name), 'utf8'));
      applied.push(name);
    }
  } finally {
    connection.release();
  }
  return applied;
}
