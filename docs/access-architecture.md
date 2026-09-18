# PROBNAYA access — production architecture

Status: implementation decision record, 2026-09-14
Scope ends at the authenticated boundary. The PROBNAYA Interior lives on the public origin (`https://probnaya.work/interior/`) and reads the holder relation through the one cross-origin read described in *Relation read for public PROBNAYA*; it is not part of Access.

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
- `nodemailer` `10.0.1`: sends an access request to the PROBNAYA mailbox over TLS-verified SMTP. Loaded only when a request is sent; the same pinned version as the public intake handler.

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
- operator note: the request reference (`R–XXXXXX`) only, never an address or other personal detail

The grant is the internal authority that lets one pending holder issue its first passkey. It is never a user-facing concept: a person receives it inside an establishment link and never sees, copies, or types it. Tokens are 32 random bytes, stored only as `sha256:` + base64url(SHA-256(`"probnaya-access/enrollment-grant/v1:" + token`)) (`enrollmentGrantHash`, `lib/crypto.js`). The digest is unkeyed on purpose: a 256-bit random token cannot be guessed or recovered from its digest, so grants need no application secret. The authority to create one is the `access_operator` database role, the only role granted `INSERT` on holders and grants. Tokens are single-use, consumed only when a verified first registration commits, and expire after seven days (`ENROLLMENT_GRANT_MS`). Suspending the holder expires every outstanding grant (migration 003); reactivation never revives one.

*Transitional compatibility.* Grants issued before this digest were stored as `HMAC(SESSION_HASH_KEY, "enrollment:" + token)`. `enrollment-options` looks up the digest first and, only if nothing matches, the legacy HMAC (`AccessService.legacyEnrollmentGrantHash`). No new grant is stored in the legacy form. The legacy lookup may be removed once `ENROLLMENT_GRANT_MS` (seven days) has elapsed after the runtime carrying the digest is deployed.

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

### Request and establishment / ESTABLISH ACCESS

Access is established on request. The distinctions are deliberate:

- a request is not authorization;
- an email address is not identity;
- a grant is not a user-facing concept;
- opening a link does not consume a grant;
- a successful, user-verified first registration is establishment.

**Request (`request-access`).**
1. ESTABLISH ACCESS without a link shows one field, `EMAIL`, and `REQUEST ACCESS`.
2. The action takes exactly `{ email }` under the ordinary exact-Origin POST guard. The address must be a plain ASCII `local@host.tld` of at most 254 characters, with no display name, quoting, whitespace, separator, or control character, so it can never add a recipient or break a header.
3. Limits: 3 per network per 10 minutes with a 30-minute block, and a global ceiling of 100 per day (`REQUEST_NETWORK_LIMIT`, `REQUEST_DAILY_LIMIT`).
4. One plain-text message goes to `mail@probnaya.work` only, with `Reply-To` set to the address and a constant subject `ACCESS / REQUEST R–XXXXXX`. Nothing is ever sent to the requester by the runtime.
5. Access stores nothing: no holder, grant, ceremony, session, audit event, or address. The only durable write is the keyed-hash rate-limit buckets. The response is `{ ok, received }` and echoes nothing.
6. Without request mail configuration, or past the ceiling, or on delivery failure, the action returns `503` with `REQUESTS CANNOT BE SENT FROM HERE AT THE MOMENT. WRITE TO MAIL@PROBNAYA.WORK.`. Key authentication does not depend on mail.

**Authorization (operator).**
1. From a trusted, prepared Access checkout, the operator reads the mailbox notification and runs `npm run approve-request -- 'R–…'`. The command asks for the password-manager-held `access_operator` database URL at a masked terminal prompt, verifies the production role and transport, then asks for explicit approval. A single transaction allocates the next four-digit `PROB–H` identifier and creates its pending holder and grant. After commit, it prints a delimited ready-to-send message containing `https://access.probnaya.work/#establish=<grant>` once. No runtime application secret is involved.
2. The operator sends that message to the requester from the PROBNAYA mailbox as a new message.
3. `--reissue` replaces the link of a still-pending holder and expires earlier ones. `--new` never touches an existing identifier, never reuses a request reference that already produced a grant, and `--reissue` never creates one.

**Establishment link.**
1. The grant travels in the URL fragment. Browsers never send fragments in HTTP requests, so it cannot reach Vercel request logs, the Function, or `Referer`. The Access page also sends `Referrer-Policy: no-referrer` and loads no analytics or third-party script.
2. On load, or on a `hashchange` in an already-open tab, `app.js`:
   - copies the grant into closure memory only;
   - calls `history.replaceState` to remove the fragment before any request;
   - shows *Issue the first key.* with `KEY LABEL` and `CREATE PASSKEY`.
3. It does not contact the server with the grant, start WebAuthn, or write the grant to the DOM or storage. A reload after that shows the request view; re-opening the link restores it.
4. Only `CREATE PASSKEY` sends `enrollment-options { grant, label }`. Preview bots receive the plain page. A JavaScript-executing scanner cannot complete a user-verified registration, and options never consume a grant.
5. A grant refused before any ceremony (expired, used, replaced, suspended, malformed) produces one message: `THIS LINK IS NO LONGER OPEN. IF A KEY WAS ALREADY CREATED WITH IT, PRESENT KEY. OTHERWISE REQUEST ACCESS AGAIN.`
6. A browser that already holds a session is told `THIS BROWSER HOLDS PROB–H–…. THIS LINK ESTABLISHES A SEPARATE RELATION.`

**First registration (unchanged).**
1. `enrollment-options` requires an unconsumed, unexpired grant whose holder is `pending`, and binds a `first-registration` ceremony to a short-lived pre-authentication cookie without creating an authenticated session.
2. Registration options use a random stable WebAuthn user ID, `residentKey: required`, `userVerification: required`, attestation `none`, no authenticator attachment restriction, and existing IDs in `excludeCredentials`.
3. The challenge is stored server-side for five minutes and tied to holder, browser binding, and `first-registration`.
4. Verification requires exact challenge, origin, RP ID, user presence, and user verification.
5. The challenge is atomically consumed before cryptographic verification, so every verification attempt is one-shot. After successful verification, one transaction under the holder lock does all of the following: grant consumption, credential insertion, holder activation, first session and recovery-set creation, and audit events.
6. A recovery set is created and returned once after the first credential is established. The UI requires an explicit "stored" acknowledgement before continuing to the Interior, but this is a user assertion rather than cryptographic proof that the plaintext was retained.

A holder established this way is identical to any other: the same rows, audit events (`enrollment-grant-issued`, `first-credential-enrolled`, `recovery-set-issued`), relation read, and Interior. The request leaves no trace in Access or the Interior, and the establishment email is operational mail, not Correspondence.

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

Neither a request nor an establishment link is a recovery path. A grant can only reach a `pending` holder, so a person who loses every key and recovery code cannot regain an established relation by requesting access again; the operator can only establish a new relation under a new identifier.

A recovery code is rate-limited and atomically consumed only while its holder is active. Success does not open the authenticated boundary. It creates a ten-minute, one-purpose, HttpOnly recovery session that may complete exactly one `recovery-registration` ceremony. The browser can recover its CSRF token for an open recovery session through `recovery-resume` (exact Origin, HttpOnly recovery cookie, rate-limited), so a cancelled authenticator prompt, a reload, or a lost options response never spends another code. Completing that ceremony under the holder lock adds a passkey, replaces its exact source code set, consumes competing recovery sessions, invalidates all ordinary sessions, records audit events, and then requires normal passkey authentication. Replacing a recovery set while authenticated follows the same holder lock protocol and requires recent VERIFY PRESENCE.

## Migrations

`001_access.sql` creates the base schema. `002_holder_authority.sql` is an idempotent forward migration that installs the suspension invalidation trigger and invalidates any live ordinary/recovery sessions already associated with non-active holders. It does not delete credentials or recovery codes. Its invalidations are intentionally not reversible. `003_suspension_expires_grants.sql` extends the same trigger function: a holder becoming `suspended` also expires every unconsumed enrollment grant (to its creation time, so no application/database clock skew can leave it usable). It brings grants of already-suspended holders into the same invariant. Reactivation returns a credential-less holder to `pending` without a usable grant; a new link must be issued deliberately. The migration runner skips `001` when the base schema already exists and safely reapplies the idempotent forward migrations in order.

## Rate limits

Durable database limits are required even if Vercel WAF is configured:

- authentication options/verification: per network and per pre-auth binding;
- access requests: per network (3 per 10 minutes, 30-minute block) and one global daily ceiling (100);
- enrollment: per network and grant;
- recovery: per network, with a longer fixed block after the threshold;
- VERIFY PRESENCE, add-key options, and recovery-code replacement: per holder and network;
- recovery-registration options and recovery-resume: per recovery session and network.

Defaults live next to each call in `access/lib/service.js` (request limits in `access/lib/constants.js`) and are exercised in `access/test/handler.test.js` and `access/test/request.test.js`. The production network identity is the first `X-Forwarded-For` address, which Vercel overwrites; `X-Vercel-Forwarded-For` is not trusted. Production WAF thresholds, database connection capacity, and alert thresholds remain operational review items. Public responses are generic `429` with `Retry-After`; audit data does not expose raw IP.

## Security headers for `/access` and `/api/access`

The isolated Access project avoids inline script/style so its whole origin can use a restrictive policy:

```text
default-src 'none'; script-src 'self'; style-src 'self';
img-src 'self'; font-src 'self'; connect-src 'self';
base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
```

Also: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and `Cache-Control: no-store` for access HTML/API. HSTS remains a deployment requirement. The public production site is untouched.

## Authenticated boundary and fixed destinations

After PRESENT KEY, and after the first-establishment recovery codes are acknowledged, the Access page replaces itself with the fixed Interior URL `https://probnaya.work/interior/`. After logout it replaces itself with `https://probnaya.work/`. Both come from the `probnaya-public-origin` meta element written into `public/index.html` (the local dev server substitutes `ACCESS_PUBLIC_ORIGIN`); the client accepts only `https://probnaya.work` or an explicit localhost origin. No request, query, or fragment can choose a destination.

The Access page itself still contains only:

- `AUTHENTICATED`, the public holder identifier, and last verification time, with `INTERIOR →`, `ACCESS RECORD`, and `END SESSION`;
- `#record` — opens the Access record directly (linked from Interior / RELATION / OPEN ACCESS);
- `#end` — a deliberate END SESSION confirmation (linked from Interior / RELATION / END SESSION); the logout POST is unchanged;
- `#expired` — the ordinary entry, with `SESSION ENDED. PRESENT KEY TO CONTINUE.`

- `#establish=<grant>` — the establishment link; captured and cleared as described in *Request and establishment*.

Fragments only select a view. Without a live session every other fragment shows the entry.

It contains no correspondence, objects, account taxonomy, or interior.

## Relation read for public PROBNAYA

`GET /api/relation` (`api/relation.js`) is the only Access response a sibling origin may read. It exists so the Interior and recognized public pages can know, from Access and nothing else, whether this browser holds a session.

- Exact `Origin` equal to `publicOrigin`: the compiled constant `https://probnaya.work` in production; in local development only an explicit, different `http://localhost:<port>` from `ACCESS_PUBLIC_ORIGIN`, otherwise closed. Production refuses `ACCESS_PUBLIC_ORIGIN`.
- `Sec-Fetch-Site` must be absent or `same-site`. `same-origin`, `cross-site`, and `none` are refused. Host is checked first, as for `/api/access`.
- GET only, no body, credentialed CORS: `Access-Control-Allow-Origin: https://probnaya.work`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, `Cache-Control: no-store`. A refused origin receives no CORS headers.
- Response: `{ holder: { publicId }, establishedAt, lastVerifiedAt, keys, recovery }`. `establishedAt` is the issue time of the holder's first credential, including revoked ones. It never returns a CSRF token, credential label, management reference, or any session value, so it cannot authorize or drive a mutation; every mutation still requires the Access origin and the synchronizer token.
- Session bookkeeping is the same as the Access page's own status read (`AccessService.currentSession`): idle refresh and fifteen-minute rotation, never an extension of the absolute lifetime. Moving through public PROBNAYA therefore keeps an active holder's session alive. `/api/access` GET keeps refusing `same-site` (IR-05); the relation read is a separate, narrower endpoint.
- An anonymous `401` is normal and not logged; other refusals log one `access.request` line with `action: "relation"`.

`Cross-Origin-Resource-Policy: same-origin` from `vercel.json` still applies; browsers do not enforce CORP on CORS-mode requests, and the credentialed fetch is CORS-mode.

## Operator procedures

`access/scripts/` provides the only operator paths. Except `migrate` (owner role, `DATABASE_URL` only), they load `lib/operator-config.js`: `ACCESS_ENV` (`production` | `development`) and `DATABASE_URL`, certificate-verified in production, and no runtime secrets (`SESSION_HASH_KEY`, `RECOVERY_HASH_KEY`, `NETWORK_HASH_KEY` are neither read nor required). On connect they refuse `access_runtime` and, in production, any role other than `access_operator` (`lib/operator.js`).

- `migrate`;
- `holders` (`list-holders.mjs`): read-only transaction listing identifiers, condition, creation date, whether a link is open, and the latest request reference. It allocates nothing;
- `approve-request`: normal reference-driven approval. Production always prompts for the `access_operator` URL even if a URL is exported in the shell; no production credential is persisted by the CLI. The transaction serializes automatic allocation and shares the existing per-reference lock with manual `--new`. A concurrent manual identifier collision is retried; an already-used reference creates no new authority. Four-digit identifiers are never reused, and exhaustion fails closed;
- `create-enrollment` with explicit intent. `--new` creates a pending holder under an unused identifier and refuses a request reference that already produced a grant (serialized with a transaction advisory lock); `--reissue` replaces the link of a still-pending holder. Neither can do the other's job, and active and suspended holders are refused. The grant is stored only as its digest; the establishment link prints once to standard output and is sensitive material;
- `set-holder-condition`: suspend/reactivate under the holder row lock with an audit event. Suspension also expires outstanding grants, and reactivation without an active credential returns the holder to `pending` with no usable link;
- `prune-expired`: bounded retention that never touches audit events, holders, credentials, grants, or codes.

## Operational logging

The handler writes one JSON line per rejected or failed request: event, method, known action name, outcome, status, and a bounded code (application code, SQLSTATE, or Node/driver code). It never logs bodies, cookies, CSRF values, challenges, credentials, recovery codes, grants, request addresses or references, database URLs, or driver or mail-provider messages. Request failures log only `request_unavailable`, `request_ceiling`, `request_delivery_failed`, `invalid_email`, or `rate_limited`. Anonymous status reads (the signed-out page load) are not logged.

## Deployment and operational decisions still requiring human review

- Select/provision PostgreSQL provider, region, backup retention, point-in-time recovery, and connection limits.
- Configure request mail with the existing `mail@probnaya.work` Workspace SMTP credential (see the deployment checklist). SPF, DKIM (`d=probnaya.work`), and DMARC alignment for that path were confirmed on a real delivered message on 2026-09-15. The credential's ability to read that mailbox is an accepted v1 boundary; a dedicated send-only sender is future hardening. v1 performs no identity-proofing beyond control of the address when the link is used; that is the intended product model, not an omission.
- Configure the separate Vercel project root, exact production hostname, DNS, TLS/HSTS, and deployment protection only after explicit approval. Do not issue credentials until the canonical hostname is verified end to end.
- Reconcile this feature branch with `main` security-hardening history before merge.
- Configure and review Vercel WAF limits/alerts; repository code cannot prove dashboard state.
- Define operational audit retention, incident response, and secret-rotation ownership.

None of those external actions is performed by this implementation.
