# PROBNAYA Access — production deployment checklist

Status: repository implementation complete, production-completion pass 2026-09-14. No item below changes DNS, Vercel production configuration, production secrets, or production data without explicit approval.

## Permanent identity boundary

- [ ] Reconfirm the permanent production origin is exactly `https://access.probnaya.work`.
- [ ] Reconfirm the permanent WebAuthn RP ID is exactly `access.probnaya.work`.
- [ ] Record ownership and renewal responsibility for the hostname. Credentials issued for this RP ID are not casually or transparently migratable to another RP ID. Preserve DNS continuity.
- [ ] Confirm no wildcard origin, parent origin, sibling subdomain, Vercel alias, or preview URL is accepted.

## Human approvals before infrastructure work

- [ ] Approve a PostgreSQL provider, region, version, TLS posture, connection limits, backup retention, and point-in-time recovery policy.
- [ ] Approve the operator identity-proofing and out-of-band delivery procedure for first-enrollment grants.
- [ ] Approve audit retention, access, alerting, incident-response owner, and secret-rotation owner.
- [ ] Approve creation/configuration of the separate Vercel project with repository root directory `access/`.
- [ ] Approve the DNS record and custom-domain attachment for `access.probnaya.work`.
- [ ] Reconcile `feat/access-production` with the security-hardening commit on `main` before merge without discarding either history.

## Database review and provisioning

- [ ] Review `access/migrations/001_access.sql` and `access/migrations/002_holder_authority.sql`, including indexes, foreign keys, the partial unique recovery-set constraint, the holder suspension trigger, forward cleanup, idempotence, and rollback comments.
- [ ] Create a least-privilege runtime role and a separate migration role.
- [ ] Require encrypted database transport with certificate validation. The runtime refuses a production `DATABASE_URL` without `sslmode=verify-full` (postgres.js skips validation for `require`). The provider's server certificate must chain to a CA in Node's default trust store; a private-CA provider needs an explicit decision before deployment.
- [ ] Use a connection path compatible with postgres.js prepared statements and interactive transactions: a direct/session-mode connection, or a pooler that supports protocol-level prepared statements. Remove libpq-only URL parameters such as `channel_binding` (the runtime rejects them).
- [ ] Grant the runtime role `SELECT, INSERT, UPDATE` on the Access tables and `DELETE` only where `prune-expired` runs; run migrations with the separate migration role.
- [ ] Test restore from backup in a non-production database.
- [ ] Apply the migrations in numeric order only after review. Migration 002 may invalidate live authority for non-active holders and cannot safely resurrect it on rollback. The migration runner skips an already-installed 001 schema and applies forward migrations idempotently.
- [ ] Verify transaction isolation and row-lock behavior with the selected provider under concurrent challenge, recovery, and revocation requests.
- [ ] Schedule `npm run prune-expired -- <days>` (or an equivalent job) for expired ceremonies, sessions, recovery sessions, and stale rate-limit buckets; it keeps audit events, which follow the approved audit policy.

## Production configuration

Set only server-side, encrypted environment values:

- [ ] `ACCESS_ENV=production`
- [ ] `DATABASE_URL` — `postgres://…?sslmode=verify-full`
- [ ] `SESSION_HASH_KEY` — `openssl rand -base64 32`
- [ ] `RECOVERY_HASH_KEY` — a different `openssl rand -base64 32`
- [ ] `NETWORK_HASH_KEY` — a third different `openssl rand -base64 32`
- [ ] Scope all five to the Vercel **Production** environment only. The runtime refuses to start when `VERCEL_ENV` is not `production`, and refuses any non-production profile on Vercel.

Startup fails closed for: missing or shared keys; keys shorter than 43 characters or with fewer than 10 distinct characters; `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID`, `ACCESS_LOCAL_ORIGIN`, `ACCESS_USE_MEMORY_STORE`, `ACCESS_DEV_ENROLLMENT_TOKEN`, or `ACCESS_DEV_PUBLIC_ID`; a database URL without `sslmode=verify-full` or with libpq-only parameters. Production origin/RP ID are compiled constants.

`SESSION_HASH_KEY` also hashes enrollment grants, so the operator running `create-enrollment` needs it. Rotating it invalidates every session, pending grant, and open recovery; rotating `RECOVERY_HASH_KEY` invalidates every unused recovery code; rotating `NETWORK_HASH_KEY` resets rate-limit buckets.

## Vercel project and edge policy — approval required

- [ ] Create a separate Vercel project rooted at `access/`; do not mount Access inside the public-site project. Leave Framework Preset, Build Command, and Output Directory to `access/vercel.json` (`framework: null`, output `public`, `npm ci`); with the “Other” preset Vercel serves `public/` as the static root, so no `/public/…` paths exist in production.
- [ ] Pin Node to `24.x` and confirm the deployed runtime reports the expected major.
- [ ] Confirm only the intended repository/branch may produce production deployments.
- [ ] Attach only `access.probnaya.work` as the production custom domain. Do not treat generated aliases as accepted authentication origins.
- [ ] Verify TLS issuance, HTTP→HTTPS redirect, and HSTS before any enrollment grant is created.
- [ ] Confirm the deployed CSP and all headers from `access/vercel.json` on HTML, scripts, and API errors.
- [ ] Configure WAF/rate-limit rules as an outer layer for `/api/access`, without replacing database-backed limits.
- [ ] Configure alerts from Function logs: each rejected or failed request writes one JSON line `{"event":"access.request","method","action","outcome","status","code"}`. Alert on `outcome:"error"` (database/connectivity codes such as `ECONNREFUSED`, `CONNECT_TIMEOUT`, `57P01`, `53300`) and on elevated `authentication_failed`, `recovery_failed`, `rate_limited`, `invalid_origin`, and `invalid_host` counts. Failed attempts are not written to `access_audit_events`.
- [ ] Verify function and database regions, latency, connection capacity, and failure behavior.

## Pre-enrollment verification

- [ ] Confirm `https://access.probnaya.work/` renders the Access surface and the browser console is clean.
- [ ] Confirm the API rejects `Origin: https://probnaya.work`, sibling subdomains, wildcard assumptions, missing Origin on POST, preview hosts, and mismatched Host.
- [ ] Confirm a preview deployment of the Access project returns `ACCESS SERVICE UNAVAILABLE` (no production variables) and never reaches the production database.
- [ ] Send a request with a forged `X-Forwarded-For` and `X-Vercel-Forwarded-For` to the production hostname and confirm the rate-limit identity follows the real client address (Vercel documents overwriting `X-Forwarded-For`; the runtime trusts only that header).
- [ ] Confirm a `GET /api/access` with `Sec-Fetch-Site: same-site` returns 403.
- [ ] Confirm session cookies use `__Host-probnaya_session; Path=/; Secure; HttpOnly; SameSite=Strict` with no `Domain`.
- [ ] Confirm API and HTML responses use `Cache-Control: no-store`.
- [ ] Run `npm ci`, `npm run check`, and `npm audit --omit=dev` from `access/` using the committed lockfile.
- [ ] Set `ACCESS_TEST_DATABASE_URL` to an isolated, disposable database on the exact provider, version, and connection path (direct or pooled) production will use, and run `npm run test:postgres`. The suites create and drop only their own randomized schemas.
- [ ] Exercise registration, usernameless authentication, cross-device authentication, hardware security keys, add/revoke, recovery, logout, and expiry on the supported browser/device matrix.
- [ ] Perform a second independent application-security review of the remediation and resolve every HIGH/MEDIUM finding before release.

## Controlled first enrollment

- [ ] Create the intended holder and one-time grant with `npm run create-enrollment -- 'PROB–H–…'` under the approved operator procedure. An expired or undelivered grant is replaced by running the same command again while the holder is pending.
- [ ] Deliver the grant through the approved independent channel; never place it in email/platform logs, analytics, ticket text, or URL query parameters.
- [ ] Observe first registration, recovery-code issuance, normal logout, and a separate normal `PRESENT KEY` login.
- [ ] Confirm a second viable passkey/security key or safely stored recovery set before relying on the record.
- [ ] Record only safe audit metadata; inspect logs to confirm no challenge, assertion, cookie, recovery code, enrollment token, raw credential ID, public key, or database URL appears.

## Rollback and incident posture

- [ ] Keep `access.probnaya.work` under control during application rollback or provider migration. Do not solve an outage by changing the RP ID.
- [ ] Prepare a backward-compatible application rollback before schema evolution.
- [ ] Document session invalidation, credential suspension (`npm run holder-condition -- 'PROB–H–…' suspend|reactivate`), secret rotation, database compromise, and recovery-code exposure procedures. Recovery adds a key but retains existing keys: after a compromise-driven recovery the holder must revoke exposed keys from the Access record.
- [ ] Treat combined database plus runtime-secret compromise as a credential/session/recovery incident, even though private passkey keys remain outside PROBNAYA.
