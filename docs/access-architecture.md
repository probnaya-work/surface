# PROBNAYA access — production architecture

Status: implementation decision record, 2026-09-14
Scope ends at the authenticated boundary. Earlier account-interior exploration has been removed and is not a production dependency.

## Summary

Keep the public site untouched. Add a self-contained static Access page and Vercel Node.js API under the repository's `access/` project root, deployed only at the isolated authentication origin and backed by PostgreSQL. Use maintained SimpleWebAuthn packages for ceremony generation and cryptographic verification. Use server-managed sessions with opaque cookies. Do not add an identity provider, framework, password, SMS, security question, browser token store, or account interior.

## Permanent relying-party boundary

The production boundary is approved and permanent:

```text
RP name       PROBNAYA
RP ID         access.probnaya.work
origin        https://access.probnaya.work
access route  https://access.probnaya.work/
```

This keeps authenticated cookies and executable code away from the public site's origin. Production origin validation is exact: only `https://access.probnaya.work` is accepted. `*.probnaya.work`, `https://probnaya.work`, Vercel aliases, and preview URLs are not production alternatives.

WebAuthn credentials are scoped to their RP ID. Credentials issued for `access.probnaya.work` will not be casually or transparently migratable to another RP ID later. A future hostname change would require a deliberately planned credential-transition ceremony while the old RP remains available, or re-enrollment/recovery. DNS continuity for `access.probnaya.work` is therefore part of the authentication system's long-term availability.

The implementation lives in the repository's self-contained `access/` directory, intended to be configured as a separate Vercel project root. No DNS or production Vercel configuration is changed by repository work; those actions remain an explicit deployment approval gate.

Local development:

```text
RP ID         localhost
origin        http://localhost:<explicit port>
```

The server has two fail-closed profiles. Production uses compiled constants for `access.probnaya.work` and `https://access.probnaya.work`; environment variables cannot broaden them. Local development requires an explicit localhost origin such as `http://localhost:4174` and fixes the RP ID to `localhost`. It never derives either value from `Host`, `Origin`, `Referer`, or forwarded headers. Preview deployments are not authentication environments and must never receive production database credentials or accept production credentials. Multiple-origin arrays, runtime hostname inference, and wildcard subdomains are deliberately rejected.

## Dependencies

- `@simplewebauthn/server` `14.0.2`: server option generation and response verification. No WebAuthn CBOR, COSE, signature, attestation, or client-data cryptography is implemented locally.
- `@simplewebauthn/browser` `14.0.0`: browser serialization and standards-compliant calls to `navigator.credentials.create/get`, including browser-owned cross-device behavior.
- `postgres` `3.4.9`: small PostgreSQL driver with parameterized queries and transaction support; no ORM or vendor-specific SDK.

The implementation pins exact versions and commits `package-lock.json`. Node is pinned to `24.x`, which is supported by the selected SimpleWebAuthn release and current Vercel runtime.

The browser package is copied from the pinned installed package into a committed/static access asset by a deterministic script. Runtime CDN imports are not used.

## Data model

All primary keys are random UUIDs and are never exposed as holder identity.

### `access_holders`

- internal UUID primary key
- public `PROB–H` identifier, unique and explicitly non-secret
- random stable WebAuthn user ID bytes, unique and unrelated to the public identifier
- condition (`pending`, `active`, `suspended`)
- created/updated timestamps

### `access_credentials`

- unique credential ID (base64url text or bytes with canonical conversion)
- holder foreign key
- credential public key bytes
- signature counter (`BIGINT`)
- device type and backup state returned by verification
- transports from the browser, validated against the WebAuthn vocabulary
- holder-supplied safe label, plain text and length bounded
- issued, last-used, and revoked timestamps
- last counter-anomaly timestamp for audit, not automatic lockout

Raw public keys and credential IDs never appear in UI or ordinary logs.

### `access_ceremonies`

- random ceremony ID and hash of opaque pre-auth/browser binding
- purpose: `first-registration`, `authentication`, `verify-presence`, `add-key`, or `recovery-registration`
- optional holder and enrollment/recovery references
- exact challenge
- expiry, consumed timestamp, and creation timestamp

A ceremony is atomically consumed before verification is completed, including failed verification. This makes every response one-shot. TTL: five minutes, matching common WebAuthn ceremony guidance.

### `access_sessions`

- HMAC/SHA-256 representation of a 32-byte opaque session token
- holder and authenticating credential foreign keys
- issued, last-active, renewal, idle-expiry, absolute-expiry, revoked timestamps
- last WebAuthn verification timestamp
- HMAC/hash of the session's derived CSRF token (retained for schema compatibility; validation recomputes the token)

No authorization state lives in the cookie. No token is stored in `localStorage` or `sessionStorage`.

### `access_enrollment_grants`

- holder foreign key, one-way token representation, created/expiry/consumed timestamps
- created-by operator reference or note suitable for audit

This bootstraps the first passkey for a pre-authorized holder. Tokens are 32 random bytes, single-use, expire after 24 hours, and are delivered out of band by an operator. The code deliberately does not choose that delivery channel. Enabling production enrollment requires a human-approved delivery/identity-proofing procedure.

### `access_recovery_sets` and `access_recovery_codes`

- set belongs to a holder and has issued/replaced timestamps
- each code stores only `HMAC-SHA-256(pepper, normalized random code)` plus used timestamp
- codes are 20 random bytes (160 bits), Crockford/base32 encoded for transcription, ten per set
- plaintext is returned once only during issuance/replacement

### `access_rate_limits`

- privacy-preserving HMAC of network address, action scope, optional binding/grant/holder dimension, window, count, blocked-until
- no raw IP in this table; retention cleanup is an explicit deployment operation

### `access_audit_events`

- append-only event ID, holder, event type, outcome, safe credential reference, coarse network hash, and timestamp
- no challenge, assertion, cookie, recovery code, raw credential ID, public key, or secret

## Ceremony lifecycle

### First passkey / ESTABLISH ACCESS

1. Operator creates a pending holder and one-time enrollment grant outside the public UI.
2. Person presents the grant through the Access enrollment surface; the server binds the ceremony to a short-lived pre-authentication cookie without creating an authenticated session.
3. Registration options use a random stable WebAuthn user ID, `residentKey: required`, `userVerification: required`, attestation `none`, no authenticator attachment restriction, and existing IDs in `excludeCredentials`.
4. The challenge is stored server-side for five minutes and tied to holder, browser binding, and `first-registration`.
5. Verification requires exact challenge, origin, RP ID, user presence, and user verification.
6. The challenge is atomically consumed before cryptographic verification, so every verification attempt is one-shot. After successful verification, grant consumption, credential insertion, holder activation, first session and recovery-set creation, and audit events occur in one transaction.
7. A recovery set is created and returned once after the first credential is established. The UI requires an explicit “stored” acknowledgement before continuing, but this is a user assertion rather than cryptographic proof that the plaintext was retained.

Attestation remains `none`: PROBNAYA learns no unnecessary manufacturer identity and does not claim hardware provenance.

### Returning / PRESENT KEY

1. Page requests authentication options without an identifier.
2. Server creates a pre-auth browser binding cookie and five-minute challenge.
3. Options omit/empty `allowCredentials` to permit discoverable credentials and cross-device choices owned by the browser/OS; `userVerification: required`.
4. Browser invokes native WebAuthn.
5. Server atomically consumes the challenge, finds the credential by canonical ID, checks it is active, verifies exact origin/RP/challenge/UV/signature, and checks returned user handle against the credential’s holder.
6. In one transaction, update counter/backup metadata, create a fresh session, and record authentication.
7. Respond with generic success and render the fixed minimal authenticated boundary.

Unknown credential, invalid signature, wrong owner, expired/reused challenge, and malformed response return the same public failure.

### Signature counters

Counters are stored as `BIGINT` and updated with a compare-and-update guard. The pinned verifier rejects a positive non-increasing counter before returning a verified result, so the application does not claim to emit an anomaly audit for that case. Zero-valued counters remain valid for authenticators that do not implement a monotonic counter; challenge replay protection remains independent and mandatory.

## Transaction serialization invariant

`access_holders` is the stable lock row for holder security state. Every PostgreSQL transaction that creates or rotates an ordinary session, invalidates holder sessions, consumes or completes recovery, replaces recovery codes, adds or revokes a credential, or logs out acquires that holder row first. It then revalidates the relevant live session, recovery session, holder condition, expiry, and recent-auth requirement inside the same transaction before mutating state.

Recovery completion replaces only the exact recovery set that issued its session and requires one affected row. While holding the holder lock it consumes every other outstanding recovery session before installing the successor set. This provides exactly one valid completion winner for a recovery-set generation under PostgreSQL `READ COMMITTED`.

Changing an active holder to a non-active condition invokes the database trigger installed by `002_holder_authority.sql`, which revokes ordinary sessions and consumes recovery sessions. Recovery begin, options authorization, and completion also require `condition = 'active'`; reactivation cannot revive pre-suspension recovery authority.

## Sessions

Production cookie:

```text
__Host-probnaya_session=<32 random bytes, base64url>
Path=/; Secure; HttpOnly; SameSite=Strict
```

No `Domain`; no persistent browser storage. Local development uses an explicitly named development cookie and never shares production secrets/data.

Defensible defaults for the initially small private surface:

- idle lifetime: 30 minutes;
- absolute lifetime: 8 hours;
- opaque ID renewal/rotation: every 15 minutes and on any authentication-state or privilege change;
- recent authentication / VERIFY PRESENCE: 5 minutes;
- browser session cookie: no long-lived `Expires`; database expiry remains authoritative.

Every authenticated request enforces idle and absolute expiry server-side. Renewal atomically creates a successor and immediately revokes the predecessor under the holder lock. Recovery or credential revocation taking that lock afterward invalidates the successor; taking it first makes rotation fail its commit-time session check. Logout and credential revocation use the same holder→session lock order, so revocation cannot commit after logout has invalidated its authorizing session. Credential revocation invalidates all holder sessions; the person authenticates again with a remaining credential.

## CSRF and request validation

- Every action request is POST with `Content-Type: application/json` and a small byte limit.
- GET status is refused unless `Sec-Fetch-Site` is absent, `same-origin`, or `none`, so a same-site sibling origin cannot drive session bookkeeping. It refreshes idle expiry and performs the fifteen-minute rotation, but never changes the CSRF token of a live session (IR-05 closed).
- Exact request schema; reject unknown fields, arrays where objects are expected, oversized strings, and malformed base64url.
- Exact `Origin` required for all POSTs, including login and recovery; missing origin is rejected outside explicit test harnesses.
- Authenticated mutations require the synchronizer token in `X-PROBNAYA-CSRF`. The token is `HMAC(SESSION_HASH_KEY, "csrf-token:session:" + session cookie token)`: stable for one session token, shared by concurrent tabs, replaced whenever the session rotates, compared in constant time, and never derivable without the server key. Recovery sessions use the same construction under a distinct purpose label.
- SameSite Strict is defense in depth, not the only CSRF control.
- No client-controlled redirect destination.
- API responses set `Cache-Control: no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, and content-type explicitly.

## Credential management and VERIFY PRESENCE

`VERIFY PRESENCE` is a fresh usernameless WebAuthn authentication ceremony tied to the current holder and purpose. A UI button can start it but cannot satisfy it.

- Add key: authenticated session + CSRF + recent verification; registration ceremony tied to `add-key`; duplicate/other-holder credential rejected; new credential does not inherit the current label or metadata.
- Revoke key: authenticated session + CSRF + recent verification; target is scoped through current holder; row is revoked, never physically deleted by the request.
- Last-path rule: always reject revoking the final active credential. An issued recovery set is not proof that the holder retained its plaintext. Recovery adds a replacement credential first; the old credential can then be revoked. Revocation invalidates all holder sessions.
- Labels: required, plain text, length bounded, rendered with `textContent`, and not treated as authenticator truth. The application may classify a credential as `PASSKEY` or `SECURITY KEY` only from safe browser-provided context without claiming hardware identity.

## Recovery decision

Normal order remains:

1. another existing discoverable passkey;
2. browser/OS cross-device WebAuthn;
3. registered hardware security key;
4. recovery code.

No email link, SMS, question, `PROB–H` identifier, or operator-known fact authenticates a person.

A recovery code is rate-limited and atomically consumed only while its holder is active. Success does not open the authenticated boundary. It creates a ten-minute, one-purpose, HttpOnly recovery session that may complete exactly one `recovery-registration` ceremony. The browser can recover its CSRF token for an open recovery session through `recovery-resume` (exact Origin, HttpOnly recovery cookie, rate-limited), so a cancelled authenticator prompt, a reload, or a lost options response never spends another code. Completing that ceremony under the holder lock adds a passkey, replaces its exact source code set, consumes competing recovery sessions, invalidates all ordinary sessions, records audit events, and then requires normal passkey authentication. Replacing a recovery set while authenticated follows the same holder lock protocol and requires recent VERIFY PRESENCE.

## Migrations

`001_access.sql` creates the base schema. `002_holder_authority.sql` is an idempotent forward migration that installs the suspension invalidation trigger and invalidates any live ordinary/recovery sessions already associated with non-active holders. It does not delete credentials or recovery codes. Its invalidations are intentionally not reversible. The migration runner skips `001` when the base schema already exists and safely reapplies the idempotent remediation migration.

## Rate limits

Durable database limits are required even if Vercel WAF is configured:

- authentication options/verification: per network and per pre-auth binding;
- enrollment: per network and grant;
- recovery: per network, with a longer fixed block after the threshold;
- VERIFY PRESENCE, add-key options, and recovery-code replacement: per holder and network;
- recovery-registration options and recovery-resume: per recovery session and network.

Defaults live next to each call in `access/lib/service.js` and are exercised in `access/test/handler.test.js`. The production network identity is the first `X-Forwarded-For` address, which Vercel overwrites; `X-Vercel-Forwarded-For` is not trusted. Production WAF thresholds, database connection capacity, and alert thresholds remain operational review items. Public responses are generic `429` with `Retry-After`; audit data does not expose raw IP.

## Security headers for `/access` and `/api/access`

The isolated Access project avoids inline script/style so its whole origin can use a restrictive policy:

```text
default-src 'none'; script-src 'self'; style-src 'self';
img-src 'self'; font-src 'self'; connect-src 'self';
base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
```

Also: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and `Cache-Control: no-store` for access HTML/API. HSTS remains a deployment requirement. The public production site is untouched.

## Minimal authenticated destination

After authentication, the server returns only:

- `AUTHENTICATED`;
- public holder identifier;
- last verification time;
- actions to view the security-facing Access record or close the session.

It contains no correspondence, objects, account taxonomy, or speculative interior.

## Operator procedures

`access/scripts/` provides the only operator paths: `migrate`, `create-enrollment` (new pending holder, or replacement grant for a still-pending holder; refuses active/suspended holders), `set-holder-condition` (suspend/reactivate under the holder row lock with an audit event; reactivation without an active credential returns the holder to `pending`), and `prune-expired` (bounded retention that never touches audit events, holders, credentials, grants, or codes).

## Operational logging

The handler writes one JSON line per rejected or failed request: event, method, known action name, outcome, status, and a bounded code (application code, SQLSTATE, or Node/driver code). It never logs bodies, cookies, CSRF values, challenges, credentials, recovery codes, grants, database URLs, or driver messages. Anonymous status reads (the signed-out page load) are not logged.

## Deployment and operational decisions still requiring human review

- Select/provision PostgreSQL provider, region, backup retention, point-in-time recovery, and connection limits.
- Approve the operator identity-proofing and out-of-band delivery procedure for first-enrollment grants.
- Configure the separate Vercel project root, exact production hostname, DNS, TLS/HSTS, and deployment protection only after explicit approval. Do not issue credentials until the canonical hostname is verified end to end.
- Reconcile this feature branch with `main` security-hardening history before merge.
- Configure and review Vercel WAF limits/alerts; repository code cannot prove dashboard state.
- Define operational audit retention, incident response, and secret-rotation ownership.

None of those external actions is performed by this implementation.
