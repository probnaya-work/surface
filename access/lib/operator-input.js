import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { contactLookup, normalizeContactAddress, requireContactKey } from './contact.js';
import { readMaskedLine } from './masked-prompt.js';

// Private operator input for Observation ownership. An address is never accepted as
// a command-line argument, never echoed, never printed back, and never written
// anywhere: it is read, reduced to a keyed lookup in memory, and dropped.
//
// Two sources only:
//   - a real terminal, without echo (the normal path);
//   - a file descriptor named by OBSERVATION_CONTACT_FD (3 or higher), for
//     scripted use such as `3< <(op read …)`. Never `3<<<address`, which a shell
//     keeps in its history.

export async function ask(question, { input = process.stdin, output = process.stderr } = {}) {
  const terminal = createInterface({ input, output });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

function descriptor(env) {
  const raw = env.OBSERVATION_CONTACT_FD;
  if (raw === undefined || raw === '') return null;
  if (!/^[3-9]$/.test(raw)) throw new Error('OBSERVATION_CONTACT_FD must be a single file descriptor from 3 to 9');
  return Number(raw);
}

// The dedicated HMAC key. Production always prompts, even if the key happens to be
// exported; development may take it from the environment.
export async function readContactKey({ profile, env = process.env }) {
  if (profile === 'production') {
    return requireContactKey(await readMaskedLine({ prompt: 'OBSERVATION_CONTACT_KEY: ' }), env);
  }
  return requireContactKey(env.OBSERVATION_CONTACT_KEY, env);
}

// Returns null when the operator leaves the address blank and `optional` is set.
export async function readContactAddress({ env = process.env, optional = false, prompt = 'Address (not shown): ' } = {}) {
  const fd = descriptor(env);
  let value;
  if (fd !== null) {
    value = readFileSync(fd, 'utf8').split(/\r?\n/, 1)[0].trim();
  } else if (process.stdin.isTTY && process.stderr.isTTY) {
    value = (await readMaskedLine({ prompt })).trim();
    if (value) {
      const again = (await readMaskedLine({ prompt: 'Same address again (not shown): ' })).trim();
      if (normalizeContactAddress(again) !== normalizeContactAddress(value)) throw new Error('The two addresses differ. Nothing was recorded.');
    }
  } else if (optional) {
    return null;
  } else {
    throw new Error('A terminal or OBSERVATION_CONTACT_FD is required to read the address');
  }
  if (!value) {
    if (optional) return null;
    throw new Error('No address was given. Nothing was recorded.');
  }
  normalizeContactAddress(value);
  return value;
}

// Reads the address and key and returns only the lookup.
export async function readContactLookup({ profile, env = process.env, optional = false, prompt } = {}) {
  const address = await readContactAddress({ env, optional, prompt });
  if (address === null) return null;
  return contactLookup(await readContactKey({ profile, env }), address);
}
