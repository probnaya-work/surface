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
