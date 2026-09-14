# PROBNAYA Access — production deployment checklist

Status: repository implementation only, 2026-09-14. No item below changes DNS, Vercel production configuration, production secrets, or production data without explicit approval.

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
- [ ] Require encrypted database transport and verify server certificate validation.
- [ ] Test restore from backup in a non-production database.
- [ ] Apply the migrations in numeric order only after review. Migration 002 may invalidate live authority for non-active holders and cannot safely resurrect it on rollback. The migration runner skips an already-installed 001 schema and applies forward migrations idempotently.
- [ ] Verify transaction isolation and row-lock behavior with the selected provider under concurrent challenge, recovery, and revocation requests.
- [ ] Configure and verify bounded retention cleanup for expired ceremonies, sessions, recovery sessions, and stale rate-limit buckets; preserve audit events according to the approved audit policy.

## Production configuration

Set only server-side, encrypted environment values:

- [ ] `ACCESS_ENV=production`
- [ ] `DATABASE_URL`
- [ ] `SESSION_HASH_KEY` — at least 32 random bytes
- [ ] `RECOVERY_HASH_KEY` — a different value, at least 32 random bytes
- [ ] `NETWORK_HASH_KEY` — a third different value, at least 32 random bytes

Do not set or infer a production origin/RP ID. They are compiled constants. Do not set `ACCESS_USE_MEMORY_STORE`, `ACCESS_LOCAL_ORIGIN`, `ACCESS_DEV_ENROLLMENT_TOKEN`, or `ACCESS_DEV_PUBLIC_ID` in production.

## Vercel project and edge policy — approval required

- [ ] Create a separate Vercel project rooted at `access/`; do not mount Access inside the public-site project.
- [ ] Pin Node to `24.x` and confirm the deployed runtime reports the expected major.
- [ ] Confirm only the intended repository/branch may produce production deployments.
- [ ] Attach only `access.probnaya.work` as the production custom domain. Do not treat generated aliases as accepted authentication origins.
- [ ] Verify TLS issuance, HTTP→HTTPS redirect, and HSTS before any enrollment grant is created.
- [ ] Confirm the deployed CSP and all headers from `access/vercel.json` on HTML, scripts, and API errors.
- [ ] Configure WAF/rate-limit rules as an outer layer for `/api/access`, without replacing database-backed limits.
- [ ] Configure alerts for elevated authentication/recovery failure rates, database exhaustion, function errors, and counter anomalies.
- [ ] Verify function and database regions, latency, connection capacity, and failure behavior.

## Pre-enrollment verification

- [ ] Confirm `https://access.probnaya.work/` renders the Access surface and the browser console is clean.
- [ ] Confirm the API rejects `Origin: https://probnaya.work`, sibling subdomains, wildcard assumptions, missing Origin on POST, preview hosts, and mismatched Host.
- [ ] Confirm session cookies use `__Host-probnaya_session; Path=/; Secure; HttpOnly; SameSite=Strict` with no `Domain`.
- [ ] Confirm API and HTML responses use `Cache-Control: no-store`.
- [ ] Run `npm ci`, `npm run check`, and `npm audit --omit=dev` from `access/` using the committed lockfile.
- [ ] Set `ACCESS_TEST_DATABASE_URL` to an isolated, disposable database and run `npm run test:postgres` against the exact provider/version. The suite creates and drops only its own randomized schema.
- [ ] Exercise registration, usernameless authentication, cross-device authentication, hardware security keys, add/revoke, recovery, logout, and expiry on the supported browser/device matrix.
- [ ] Perform a second independent application-security review of the remediation and resolve every HIGH/MEDIUM finding before release.

## Controlled first enrollment

- [ ] Create the intended holder and one-time grant with the approved operator procedure.
- [ ] Deliver the grant through the approved independent channel; never place it in email/platform logs, analytics, ticket text, or URL query parameters.
- [ ] Observe first registration, recovery-code issuance, normal logout, and a separate normal `PRESENT KEY` login.
- [ ] Confirm a second viable passkey/security key or safely stored recovery set before relying on the record.
- [ ] Record only safe audit metadata; inspect logs to confirm no challenge, assertion, cookie, recovery code, enrollment token, raw credential ID, public key, or database URL appears.

## Rollback and incident posture

- [ ] Keep `access.probnaya.work` under control during application rollback or provider migration. Do not solve an outage by changing the RP ID.
- [ ] Prepare a backward-compatible application rollback before schema evolution.
- [ ] Document session invalidation, credential suspension, secret rotation, database compromise, and recovery-code exposure procedures.
- [ ] Treat combined database plus runtime-secret compromise as a credential/session/recovery incident, even though private passkey keys remain outside PROBNAYA.
