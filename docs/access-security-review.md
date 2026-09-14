# PROBNAYA Access — implementation security review

Review date: 2026-09-14
Reviewed scope: `access/` implementation against `docs/access-threat-model.md`, including the remediation of `docs/access-independent-security-review.md`. This is a self-review, not an independent penetration test or production certification.

## Independent-review remediation

All verified HIGH and MEDIUM findings from the independent review are remediated in the repository implementation:

| Finding | Enforced invariant | Regression evidence |
|---|---|---|
| IR-01 — concurrent recovery completion | Every holder authority mutation takes the same holder row lock first. Recovery completion then conditionally consumes one session from its exact still-active source set, replaces that exact set once, and consumes every outstanding recovery session for the holder. | `IR-01: concurrent recovery completion has exactly one valid winner` deterministically pauses the first completion while a second pool competes; exactly one succeeds and only one new credential commits. |
| IR-02 — recovery versus session rotation | Ordinary rotation takes the holder lock before revoking/inserting its successor. Recovery completion takes that same lock and invalidates all ordinary sessions before commit, so a rotation can only serialize before recovery and be revoked, or after recovery and fail its predecessor check. | `IR-02: recovery invalidation defeats concurrent session rotation` reproduces the reviewed ordering and proves the would-be successor is unauthorized after recovery. |
| IR-03 — revoke after logout | Credential revocation takes the holder lock and revalidates the exact authorizing session—including revocation, expiry, and recent verification—inside the mutation transaction before locking credentials or committing revocation. Logout uses the same holder-first order. | `IR-03: logout invalidation prevents a queued credential revocation` pauses after service-layer authorization, commits logout through another pool, and proves the queued revoke fails without changing credential state. |
| IR-04 — recovery while suspended | Recovery begin, lookup, options, and completion require an active holder; begin/completion make the condition check under the holder lock. Migration `002_holder_authority.sql` also invalidates live ordinary and recovery sessions on an active-to-non-active transition. | Two IR-04 PostgreSQL tests cover suspension before begin and suspension after options but before insertion, including reactivation without resurrection of the old recovery authority. |

The same pass also made ordinary mutation CSRF mandatory when omitted (IR-06) and corrected the counter claim (IR-08): the pinned verifier rejects a positive non-increasing counter before the service can create an anomaly audit event. IR-05 and IR-07 remain documented below as lower-priority work.

## Controls reviewed

- Authentication and registration route authorization and exact request schemas.
- Exact Host, Origin, RP ID, challenge, ceremony purpose, browser binding, user-handle, user-verification, signature, and credential-owner checks.
- One-shot challenge consumption on verification attempts.
- Session creation, renewal rotation, idle/absolute expiry, logout, holder-wide invalidation, HttpOnly cookie attributes, and CSRF tokens.
- Fresh WebAuthn VERIFY PRESENCE for enrollment, revocation, and recovery-set replacement.
- Single-use recovery code consumption, one-purpose recovery sessions, mandatory replacement registration, recovery-set rotation, and ordinary-session invalidation.
- Output encoding and CSP: all holder labels/metadata are inserted with `textContent`; no inline script/style or runtime CDN exists.
- Generic public authentication/recovery errors and absence of secret-bearing application logs.
- Database constraints, row locking, conditional updates, and transaction boundaries.
- Rate-limit dimensions and fail-closed production/development configuration.

## Findings corrected during review

1. **Authority consumption on transactional conflict.** The initial PostgreSQL methods could have committed grant/recovery-session consumption when a later credential insert conflicted. The implementation now throws inside the transaction so every prior mutation rolls back, then maps that conflict to a generic failure.
2. **Last-path recovery claim.** The initial revocation guard treated an issued recovery set as a viable last path, but the server cannot prove that its plaintext was retained. Revocation now always refuses to remove the final active credential. Recovery must add a replacement credential first.
3. **Session rotation after credential state changes.** Adding a key and replacing recovery codes now rotate the opaque session ID and CSRF token; the predecessor is revoked atomically.
4. **Counter anomaly handling.** The pinned verifier rejects a positive non-increasing signature counter before returning a successful result. A real-verifier regression test now preserves that behavior and asserts that the service does not claim an unreachable anomaly audit event. Zero-counter authenticators remain supported.
5. **Duplicate class method shadowing.** A dead duplicate `logout` method at the end of the service class silently overrode the primary method. It still revoked the session, but made the reviewed method body non-authoritative. The duplicate methods were removed and logout closure/revocation now has a regression test.
6. **Partial state transitions.** Credential authentication, presence verification, first enrollment, key addition/revocation, recovery-code acceptance/completion/replacement, and logout now commit their coupled durable mutations and audit records transactionally. Challenges remain deliberately consumed before cryptographic verification, making failed verification attempts non-replayable.
7. **Concurrent credential/recovery changes.** Signature-counter writes compare against the value used during verification; credential revocation locks the holder’s full active set before enforcing the last-path rule; and every holder authority mutation now follows one holder-first serialization protocol. Recovery completion binds authority to the exact active source set, consumes competing recovery sessions, and invalidates ordinary sessions in the same transaction.

## Automated adversarial verification

The test authenticator generates an EC P-256 key pair, standards-shaped CBOR registration data, and signed assertions. Production verification still runs exclusively through pinned `@simplewebauthn/server`; the fixture does not implement verification.

Tests cover valid UV registration/authentication, invalid origin, invalid RP ID, invalid challenge, expired/reused challenge, invalid signature, missing UV, unknown credential, wrong owner, malformed payload, unauthorized enrollment/revocation, wrong and omitted CSRF, recent-auth expiry, session rotation/invalidation, positive counter regression, stale counter state, recovery-code reuse, recovery rate limiting, recovery replacement, outstanding recovery-session invalidation, last-credential refusal, credential add/revoke, and the reviewed PostgreSQL interleavings.

Verification snapshot:

- `npm ci --offline` completed from the lockfile and reported 28 audited packages with zero known vulnerabilities; a separate `npm audit --omit=dev --audit-level=low` also reported zero.
- `npm run check` passed all 32 Access tests when `ACCESS_TEST_DATABASE_URL` was set: 26 non-PostgreSQL tests and 6 PostgreSQL tests.
- `npm run test:postgres` separately passed all 6 tests against disposable loopback-only PostgreSQL 17.6: migration idempotence plus deterministic IR-01, IR-02, IR-03, and two IR-04 schedules.
- The repository-wide run passed 94 of 95 tests. Its only failure is the unrelated pre-existing machine-portrait artifact pin mismatch (`c9aec45…` present versus `c348a91…` expected); all 32 Access tests passed in the same run.
- JavaScript syntax checks and `git diff --check` passed.
- Local HTTP checks confirmed restrictive headers, exact-origin acceptance for `http://localhost:4174`, and generic rejection of sibling `http://localhost:4173`.

## Remaining risks and incomplete assurance

- The remediated SQL and deterministic interleavings passed on disposable PostgreSQL 17.6 with separate pools. No selected production provider exists, so provider-specific pooler, timeout, retry, TLS, and cross-function behavior remains unverified.
- Vercel rewrite behavior, generated aliases, WAF, environment scoping, function region, headers, TLS, HSTS, and custom-domain routing cannot be proven by repository tests.
- The WebAuthn suite uses a virtual standards-shaped authenticator. Real platform passkeys, synced passkeys, cross-device QR flows, roaming security keys, cancellation UX, and browser/device compatibility require a physical-device matrix.
- A compromised Access origin/script can act through an authenticated browser despite HttpOnly cookies and CSRF. Origin isolation, a small code surface, output encoding, and CSP reduce but do not eliminate this risk.
- A compromised unlocked device or passkey-provider account may authenticate. WebAuthn does not establish device cleanliness or hardware binding because attestation is deliberately `none`.
- Theft of an unused plaintext recovery code enables the limited recovery flow and eventual account takeover. Safe offline storage is an operational/user responsibility.
- A response interruption during one-time recovery-code issuance can leave an active server-side set that the holder never received. The record therefore reports only `CODES ACTIVE`, not that recovery is established or safely stored; replacement remains available after normal authentication.
- Database compromise exposes public keys, credential IDs, holder associations, and audit metadata. Combined database and runtime-secret compromise also threatens active sessions and recovery hashes.
- Database-backed rate limits reduce simple abuse but do not eliminate distributed denial of service. WAF, capacity, monitoring, and incident response are deployment controls.
- Audit events exist but alert routing, retention, review cadence, and administrator access control are not yet operationalized.
- Expired ceremony/session/rate-limit cleanup is not scheduled by repository code; deployment must provide and verify bounded retention jobs.
- **IR-05 (LOW) remains:** GET status still mutates CSRF/idle state without an Origin/CSRF gate, permitting same-site cross-origin availability disruption and concurrent-tab desynchronization.
- **IR-07 (HARDENING) remains:** add-key and recovery-registration option/verify paths still lack dedicated application rate limits and bounded pending-state controls.

The implementation should be described as having passed the documented repository tests under the stated assumptions—not as categorically “secure.”

## Production-completion pass

Date: 2026-09-14. Branch: `design/interior-access-integration` (contains all of `feat/access-production` and `main`'s deployment hardening); only `access/` and the Access documents were changed. Verified against fresh PostgreSQL 17.6 databases, the real handler under the production configuration profile, and a real Chromium page driving the shipped `app.js` and SimpleWebAuthn browser bundle through an in-page WebCrypto authenticator.

### Defects found and corrected

| ID | Defect | Correction | Evidence |
|---|---|---|---|
| PC-01 | `access/vercel.json` rewrote `/`, `/app.js`, `/access.css`, and `/assets/*` to `/public/…`. With the “Other” preset Vercel serves `public/` itself as the static root, so those destinations do not exist and the deployed page would not load. | Explicit `framework: null`, `outputDirectory: "public"`, `installCommand: "npm ci"`; rewrites removed. | Vercel build documentation; must be confirmed on the first deployment. |
| PC-02 | Every form handler disabled its inputs before reading `FormData`; browsers omit disabled controls, so ESTABLISH ACCESS, RECOVER ACCESS, and ADD ANOTHER KEY always sent `null` and failed with `REQUEST COULD NOT BE PROCESSED`. Unit tests never exercised the browser form path. | Forms are read before they are disabled. | Reproduced in a real browser; full enrollment → logout → usernameless login → add key → cancelled presence → code replacement → revocation → recovery (cancel, reload, resume, complete) → login with the new key then passed in the same browser. |
| PC-03 | Production accepted any `DATABASE_URL`; postgres.js uses plaintext without `sslmode` and skips certificate validation for `sslmode=require`. | Production requires `sslmode=verify-full` and rejects libpq-only parameters (`channel_binding`, `sslrootcert`, …) that postgres.js would forward as invalid startup settings. | `config.test.js`; against a TLS-enabled local server, `require` connected to a self-signed certificate and `verify-full` refused it (`DEPTH_ZERO_SELF_SIGNED_CERT`); `channel_binding=require` failed every connection with SQLSTATE `42704`. |
| PC-04 | Recovery CSRF lived only in page memory. A cancelled authenticator prompt, reload, or lost options response left no usable authority, and the client's retry spent another single-use code. | Recovery CSRF is derived from the HttpOnly recovery token; `recovery-resume` returns it to the same browser; the client keeps an open recovery and never re-submits a code while it is valid. | `handler.test.js` and `postgres-lifecycle.test.js` recovery cases; real-browser cancel + reload flow. |
| PC-05 | Rate-limit identity trusted `X-Vercel-Forwarded-For` before `X-Forwarded-For`. Vercel documents overwriting only the latter. | Production uses only the first `X-Forwarded-For` address; local profiles use the socket. | `handler.test.js`; mutation check. Deployed spoofing check is in the checklist. |
| PC-06 | Nothing prevented a preview deployment, or a development/test profile, from running on Vercel with production data. | On Vercel, only `ACCESS_ENV=production` with `VERCEL_ENV=production` starts. Production also rejects development enrollment variables and `ACCESS_LOCAL_ORIGIN`, and requires encoded-random-looking keys. | `config.test.js`. |
| PC-07 | Unexpected errors (including database outages) were swallowed without any log line, and failed attempts were not observable anywhere. | One bounded JSON log line per rejected or failed request; no secrets, bodies, driver messages, or URLs. | `handler.test.js` log-content assertions; `postgres-lifecycle.test.js` unreachable-database case. |
| PC-08 | An expired or undelivered first-enrollment grant stranded its pending holder (the script could only create new holders), and suspension existed only as raw SQL. | `create-enrollment` issues a replacement grant to a still-pending holder and expires earlier grants; `set-holder-condition` suspends/reactivates under the holder lock with audit events; `prune-expired` provides bounded retention; `lib/migrations.js` makes the runner testable. | `postgres-lifecycle.test.js`; CLI runs against a fresh database. |
| PC-09 | Native WebAuthn and session failures showed raw platform text or left the holder on a stale view. | Cancel/timeout, already-registered, unsupported authenticator, expired session, stale CSRF, rate limit, unreachable service, unconfirmed enrollment, and closed recovery each map to a fixed, non-enumerating message. | Real-browser checks for cancel and ended session. |

### Disposition of previously documented items

| Item | Decision | Reason |
|---|---|---|
| IR-05 GET status mutates CSRF | **Implemented before production** | A frontend integration depends on concurrent tabs and repeated status reads not invalidating each other. CSRF is now derived per session token and status reads refuse same-site/cross-site fetch metadata. |
| IR-07 missing mutation limits | **Implemented where cheap; remainder safe to defer** | Add-key options, recovery-code replacement, recovery-registration options, and recovery-resume are limited. Verify steps are bounded by one-shot ceremonies; GET status remains unlimited in the application and relies on WAF. |
| RR-01 lock waits outliving deadlines | **No longer applicable** | Closed by `clock_timestamp()` rechecks; all four regressions preserved and passing. |
| RR-02 MemoryStore parity | **Safe to defer** | Production rejects MemoryStore. Every ceremony now also runs through the production-profile handler on PostgreSQL. |
| RR-03 schedule determinism | **Implemented** | IR-01, IR-02, and IR-04 now prove the competitor is blocked on the paused transaction via `pg_blocking_pids` and always release barriers; IR-02 accepts both secure orderings; IR-01 also checks winner codes and loser-key login. Removing the rotation holder lock or reinstating the original IR-01 query shape fails the suite. |
| Recovery final-response loss | **Safe to defer** | The committed key authenticates; the client explains this and the holder replaces codes from the record. Losing the `recovery-begin` response *and* its cookie still spends that code by design. |
| First-enrollment response loss | **Safe to defer** | Same shape: the key authenticates; the record still shows `CODES ACTIVE` for codes never seen, so the holder must replace them. |
| Retained old credentials after recovery | **Safe to defer (policy)** | Automatic revocation could remove a still-legitimate path. The client now instructs the holder to revoke lost or exposed keys after recovery. |
| Provider TLS / pooler | **Code enforced; provider choice is infrastructure** | TLS verification is fail-closed. Prepared-statement/pooler compatibility, CA trust, region, and connection limits depend on the provider decision. |
| Proxy/header validation | **Implemented; deployment verification required** | See PC-05. |
| Audit/operational gaps | **Logging implemented; alert routing is infrastructure** | Failed attempts are logged, not audited in the database. |
| Lock/statement timeouts | **Safe to defer** | No `lock_timeout` is set; a stalled holder lock delays requests up to the Function duration, and `clock_timestamp()` rechecks still refuse expired authority afterward. |
| Rotation response loss / concurrent rotation | **Safe to defer** | Fails closed: the affected tab returns to PRESENT KEY. |
| Branch reconciliation with `main` | **No longer applicable on this branch** | `2e77470 fix(security): harden deployment boundary` is an ancestor. This branch also carries Interior prototype work that is outside Access and must be separated before any production merge. |

### Verification snapshot

- Access suite with PostgreSQL: **70/70** (`npm run check`); PostgreSQL suites: **27/27**, stable across five consecutive runs.
- Repository suite: **138/138**. JavaScript syntax: **50/50** files. `git diff --check`: clean.
- `npm audit`: 0 vulnerabilities in `access/` (all and production dependencies) and at the repository root. The shipped browser bundle is byte-identical to the pinned package.
- Mutation checks: ten introduced regressions (CSRF rotation on GET, fetch-metadata guard removed, trusting `X-Vercel-Forwarded-For`, accepting `sslmode=require`, allowing preview environments, non-derived recovery CSRF, stale grant retention, reactivation without credentials, logging driver messages, removed add-key limit) are each caught by a failing test.
