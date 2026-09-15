import { randomUUID } from 'node:crypto';
import { ENROLLMENT_GRANT_MS, ESTABLISHMENT_FRAGMENT } from '../lib/constants.js';
import { enrollmentGrantHash, randomToken } from '../lib/crypto.js';
import { openOperatorStore } from '../lib/operator.js';

// Usage (from access/, with ACCESS_ENV and DATABASE_URL for the access_operator role):
//   node scripts/create-enrollment.mjs --new 'PROB–H–…' ['R–XXXXXX']
//   node scripts/create-enrollment.mjs --reissue 'PROB–H–…' ['R–XXXXXX']
// --new creates a pending holder under an unused identifier, and refuses a request
// reference that already produced a grant. --reissue replaces the link of a holder
// that is still pending and expires its earlier links.
// The establishment link prints once to standard output. It is bearer authority
// for that holder's first key: deliver it once, to the requester only, and keep
// no other copy. Only its SHA-256 digest is stored. The optional note is the
// request reference, never an address or other personal detail.
const USAGE = "Usage: node scripts/create-enrollment.mjs --new|--reissue 'PROB–H–…' ['R–XXXXXX']";
const [flag, publicId, reference, ...extra] = process.argv.slice(2);
const mode = { '--new': 'new', '--reissue': 'reissue' }[flag];
if (!mode || extra.length || !/^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$/.test(publicId || '')) throw new Error(USAGE);
if (reference !== undefined && !/^R–[0-9A-HJKMNP-TV-Z]{6}$/.test(reference)) {
  throw new Error('The note must be a request reference such as R–4QX7NC');
}
const { config, store } = await openOperatorStore();
const token = randomToken();
const now = Date.now();
const expiresAt = now + ENROLLMENT_GRANT_MS;
let result;
try {
  result = await store.issueEnrollmentGrant({
    mode,
    holder: { id: randomUUID(), publicId, webauthnUserId: randomToken() },
    grant: { id: randomUUID(), auditId: randomUUID(), tokenHash: enrollmentGrantHash(token), expiresAt, operatorNote: reference },
    now,
  });
} finally {
  await store.close();
}
if (!result.issued) {
  const reasons = {
    exists: `${publicId} already exists${result.condition ? ` (${result.condition})` : ''}. Use --reissue only for a pending holder, or choose an unused identifier.`,
    unknown: `${publicId} does not exist. Use --new to create it.`,
    'not-pending': `${publicId} is ${result.condition}. Links only establish the first key of a pending holder.`,
    'reference-used': `${reference} already produced a grant for ${result.publicId}. Use --reissue '${result.publicId}' to replace that link.`,
  };
  process.stderr.write(`No link issued: ${reasons[result.reason]}\n`);
  process.exit(1);
}
process.stderr.write(`${result.created ? 'Created pending holder' : 'Replaced the outstanding link for pending holder'} ${publicId}; the link closes ${new Date(expiresAt).toISOString()}.\n`);
process.stderr.write('The next line is establishment authority. Send it once to the requester and keep no other copy.\n');
process.stdout.write(`${config.origin}/#${ESTABLISHMENT_FRAGMENT}=${token}\n`);
