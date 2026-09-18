import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { ENROLLMENT_GRANT_MS, ESTABLISHMENT_FRAGMENT } from '../lib/constants.js';
import { enrollmentGrantHash, randomToken } from '../lib/crypto.js';
import { readMaskedLine } from '../lib/masked-prompt.js';
import { openOperatorStore } from '../lib/operator.js';

const [reference, ...extra] = process.argv.slice(2);
if (extra.length || !/^R–[0-9A-HJKMNP-TV-Z]{6}$/.test(reference || '')) {
  throw new Error("Usage: npm run approve-request -- 'R–XXXXXX'");
}

async function main() {
  const profile = process.env.ACCESS_ENV || 'production';
  if (profile !== 'production' && profile !== 'development') throw new Error('ACCESS_ENV must be production or development');
  // Production always prompts, even when DATABASE_URL happens to be exported in
  // the parent shell. In development a disposable test database may be supplied
  // through the established operator configuration.
  const env = profile === 'production'
    ? { ACCESS_ENV: 'production', DATABASE_URL: await readMaskedLine() }
    : process.env;
  const { config, store } = await openOperatorStore(env);
  try {
    const usedPublicId = await store.holderForRequestReference(reference);
    if (usedPublicId) {
      process.stderr.write(`${reference} already produced a grant for ${usedPublicId}. No new authority issued. Reissue is a separate explicit operation for a pending holder.\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`Reference ${reference} is not yet attached to a grant. Verify the request and address in mail@probnaya.work.\n`);
    const terminal = createInterface({ input: process.stdin, output: process.stderr });
    let answer;
    try {
      answer = await terminal.question('Approve this request? [y/N] ');
    } finally {
      terminal.close();
    }
    if (answer.trim().toLowerCase() !== 'y') {
      process.stderr.write('No holder or link created.\n');
      return;
    }

    const token = randomToken();
    const now = Date.now();
    const expiresAt = now + ENROLLMENT_GRANT_MS;
    const result = await store.approveRequest({
      holder: { id: randomUUID(), webauthnUserId: randomToken() },
      grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: enrollmentGrantHash(token), expiresAt, operatorNote: reference },
      now,
    });
    if (!result.issued) {
      if (result.reason === 'reference-used') {
        process.stderr.write(`${reference} already produced a grant for ${result.publicId}. No new authority issued. Reissue is a separate explicit operation for a pending holder.\n`);
      } else {
        process.stderr.write('Four-digit holder identifiers are exhausted. No new authority issued.\n');
      }
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`Allocated ${result.publicId}; the establishment link closes ${new Date(expiresAt).toISOString()}.\n`);
    process.stderr.write('Send the next line once, in a new message to the address in the request notification. Keep no other copy.\n');
    process.stdout.write(`${config.origin}/#${ESTABLISHMENT_FRAGMENT}=${token}\n`);
  } finally {
    await store.close();
  }
}

try {
  await main();
} catch (error) {
  const safe = /^(ACCESS_ENV|A terminal is required|Credential input|Refusing to run|Production operator commands|Production DATABASE_URL|DATABASE_URL must)/.test(error.message);
  process.stderr.write(`${safe ? error.message : 'Approval failed. Check the operator credential and database availability.'}\n`);
  process.exitCode = 1;
}
