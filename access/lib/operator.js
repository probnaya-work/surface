import { loadOperatorConfig, requireOperatorRole } from './operator-config.js';
import { PostgresStore } from './postgres-store.js';

// Opens the database for an operator command and refuses the wrong role before any
// statement other than `SELECT current_user` runs. The caller closes the store.
export async function openOperatorStore(env = process.env) {
  const config = loadOperatorConfig(env);
  const store = new PostgresStore(config.databaseURL);
  try {
    const role = requireOperatorRole(await store.currentRole(), config);
    process.stderr.write(`Connected as ${role} (${config.profile}, ${config.origin}).\n`);
    return { config, store, role };
  } catch (error) {
    await store.close();
    throw error;
  }
}
