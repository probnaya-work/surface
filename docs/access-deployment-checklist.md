# PROBNAYA Access — production deployment checklist

Status: repository implementation complete, production-completion pass 2026-09-14; request-based establishment 2026-09-15. No item below changes DNS, Vercel production configuration, production secrets, or production data without explicit approval.

## Permanent identity boundary

- [ ] Reconfirm the permanent production origin is exactly `https://access.probnaya.work`.
- [ ] Reconfirm the permanent WebAuthn RP ID is exactly `access.probnaya.work`.
- [ ] Record ownership and renewal responsibility for the hostname. Credentials issued for this RP ID are not casually or transparently migratable to another RP ID. Preserve DNS continuity.
- [ ] Confirm no wildcard origin, parent origin, sibling subdomain, Vercel alias, or preview URL is accepted.

## Human approvals before infrastructure work

- [ ] Approve a PostgreSQL provider, region, version, TLS posture, connection limits, backup retention, and point-in-time recovery policy.
- [ ] Approve the v1 establishment procedure: requests arrive at `mail@probnaya.work`; the operator replies from that mailbox with a one-time establishment link; there is no identity-proofing beyond control of the address when the link is used (see *Request mail* and *Establishing access*).
- [ ] Approve audit retention, access, alerting, incident-response owner, and secret-rotation owner.
- [ ] Approve creation/configuration of the separate Vercel project with repository root directory `access/`.
- [ ] Approve the DNS record and custom-domain attachment for `access.probnaya.work`.
- [ ] Reconcile `feat/access-production` with the security-hardening commit on `main` before merge without discarding either history.

## Database review and provisioning

- [ ] Review `access/migrations/001_access.sql`, `002_holder_authority.sql`, and `003_suspension_expires_grants.sql`, including indexes, foreign keys, the partial unique recovery-set constraint, the holder suspension trigger, forward cleanup, idempotence, and rollback comments.
- [ ] Create a least-privilege runtime role and a separate migration role.
- [ ] Require encrypted database transport with certificate validation. The runtime refuses a production `DATABASE_URL` without `sslmode=verify-full` (postgres.js skips validation for `require`). The provider's server certificate must chain to a CA in Node's default trust store; a private-CA provider needs an explicit decision before deployment.
- [ ] Use a connection path compatible with postgres.js prepared statements and interactive transactions: a direct/session-mode connection, or a pooler that supports protocol-level prepared statements. Remove libpq-only URL parameters such as `channel_binding` (the runtime rejects them).
- [ ] Grant the runtime role `SELECT, INSERT, UPDATE` on the Access tables and `DELETE` only where `prune-expired` runs; run migrations with the separate migration role.
- [ ] Test restore from backup in a non-production database.
- [ ] Apply the migrations in numeric order only after review. Migration 002 may invalidate live authority for non-active holders and cannot safely resurrect it on rollback. Migration 003 expires outstanding enrollment grants of suspended holders and cannot revive them on rollback. The migration runner skips an already-installed 001 schema and applies forward migrations idempotently.
- [ ] Verify transaction isolation and row-lock behavior with the selected provider under concurrent challenge, recovery, and revocation requests.
- [ ] Schedule `npm run prune-expired -- <days>` (or an equivalent job) for expired ceremonies, sessions, recovery sessions, and stale rate-limit buckets; it keeps audit events, which follow the approved audit policy.

## Production configuration

Set only server-side, encrypted environment values:

- [ ] `ACCESS_ENV=production`
- [ ] `DATABASE_URL` — `postgres://…?sslmode=verify-full`
- [ ] `SESSION_HASH_KEY` — `openssl rand -base64 32`
- [ ] `RECOVERY_HASH_KEY` — a different `openssl rand -base64 32`
- [ ] `NETWORK_HASH_KEY` — a third different `openssl rand -base64 32`
- [ ] Request mail (below): `ACCESS_REQUEST_SMTP_USER`, `ACCESS_REQUEST_SMTP_PASS`, `ACCESS_REQUEST_SMTP_FROM`.
- [ ] Scope all of them to the Vercel **Production** environment only. The runtime refuses to start when `VERCEL_ENV` is not `production`, and refuses any non-production profile on Vercel.

Startup fails closed for: missing or shared keys; keys shorter than 43 characters or with fewer than 10 distinct characters; `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID`, `ACCESS_LOCAL_ORIGIN`, `ACCESS_PUBLIC_ORIGIN`, `ACCESS_USE_MEMORY_STORE`, `ACCESS_DEV_ENROLLMENT_TOKEN`, `ACCESS_DEV_PUBLIC_ID`, or `ACCESS_DEV_REQUEST_OUTBOX`; partial request-mail settings, a request sender user or From address equal to `mail@probnaya.work`, or a request password shorter than an app password; a database URL without `sslmode=verify-full` or with libpq-only parameters. Production origin/RP ID are compiled constants.

Absent request-mail settings do not stop Access: only REQUEST ACCESS answers `REQUESTS CANNOT BE SENT FROM HERE AT THE MOMENT. WRITE TO MAIL@PROBNAYA.WORK.`

`SESSION_HASH_KEY` is runtime session authority only (session, pre-authentication, and recovery-session token hashes, and CSRF derivation). It never leaves the Access Production environment and operators never need it: enrollment grants are stored as an unkeyed digest. Rotating it invalidates every session and open recovery, and establishment links issued with the digest survive it (legacy HMAC-format links, during the transition, do not); rotating `RECOVERY_HASH_KEY` invalidates every unused recovery code; rotating `NETWORK_HASH_KEY` resets rate-limit buckets.

## Request mail

v1 sends access requests through the same Google Workspace SMTP account as the public intake handler (`api/intake.js`), sending as `mail@probnaya.work`. That account authenticates with an app password (`.env.example`). A Google app password is not scoped to sending: it can also read the account's mail over IMAP/POP unless an administrator disables those protocols. Anyone who obtains the credential from the public-site or Access Production environment could therefore read `mail@probnaya.work`, including requests and unconsumed establishment links. This trust boundary is **accepted for v1** at the current scale (decision 2026-09-15; see `docs/access-threat-model.md`).

- [ ] In the Access project's Production environment only, set `ACCESS_REQUEST_SMTP_USER`, `ACCESS_REQUEST_SMTP_PASS`, and `ACCESS_REQUEST_SMTP_FROM` to the same values as the public site's `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` (`mail@probnaya.work`). Do not copy them into Preview or Development.
- [ ] Send one test request from `https://access.probnaya.work/` and confirm it arrives at `mail@probnaya.work` with `Reply-To` equal to the entered address, and that no message reaches the entered address.
- [ ] Optionally open that message with *Show original*: it should match the confirmed result for `mail@probnaya.work` (SPF, DKIM with `d=probnaya.work`, and DMARC all PASS; see *Mail authentication*), since Access uses the same account and sending path.
- [ ] Confirm Function logs for request failures contain only `request_unavailable`, `request_ceiling`, `request_delivery_failed`, `invalid_email`, or `rate_limited`, never an address. Alert on `request_delivery_failed` and `request_ceiling`.
- [ ] Rotating the app password must update both projects at once; a stale value surfaces as `request_delivery_failed` in Access and as intake submission failures.

Future hardening, not a production requirement for v1: move request sending to a dedicated send-only Workspace user with IMAP/POP disabled, and disable IMAP/POP for the account behind `mail@probnaya.work` if no mail client needs them, so no deployed credential can read the mailbox that holds establishment links. Revisit when request volume grows or before anything is ever issued to a pending holder.

## Mail authentication (probnaya.work)

Status: **confirmed healthy on 2026-09-15.** No DNS or Google Workspace authentication change is required for launch.

Public DNS (authoritative `ns1.vercel-dns.com`, 2026-09-15):

| Record | Value | State |
|---|---|---|
| `MX probnaya.work` | `1 smtp.google.com.` | Correct for Google Workspace. |
| `TXT probnaya.work` (SPF) | `v=spf1 include:_spf.google.com ~all` | One SPF record authorizing Google. Correct. |
| `TXT google._domainkey.probnaya.work` | `v=DKIM1; k=rsa; p=…` (2048-bit) | Published and in use (below). |
| `TXT _dmarc.probnaya.work` | `v=DMARC1; p=none` | Valid. Kept unchanged for now. |

Confirmed outside the repository:

- Google Admin console → Gmail → Authenticate email, `probnaya.work`: **Authenticating email with DKIM.**
- A real message delivered from `mail@probnaya.work`, inspected with *Show original*: **SPF PASS, DKIM PASS (`d=probnaya.work`), DMARC PASS.** Alignment holds end to end for the existing Workspace SMTP path, the same path intake and Access requests use.
- Message construction (`api/intake.js`, `access/lib/notify.js`): `From` and the envelope sender are both `mail@probnaya.work`, and the message is plain text with standard `Message-ID`, `Date`, and MIME headers. Nothing in it is expected to affect authentication.

An earlier report of PROBNAYA mail landing in spam is therefore treated as a **deliverability/reputation issue, not a demonstrated authentication or configuration failure.** The leading remaining explanation, given this evidence, is sender reputation: `probnaya.work` was registered on 2026-08-31 on the `.work` TLD and has very little sending history. Content that looks like first contact with a link from a new domain can add to it. None of this is established as the definitive cause.

Operational practice, not launch requirements:

- [ ] Send the operator's establishment reply as a new message to the requester, not as a reply to the `ACCESS / REQUEST` notification. A reply quotes the internal notification, including the operator command, and carries the subject `Re: ACCESS / REQUEST …`.
- [ ] Keep establishment replies plain, personal, and one-to-one. Ask early recipients to mark the message *Not spam* if it lands there; replies and rescues build reputation for a new domain.
- [ ] Optionally add `probnaya.work` to Google Postmaster Tools (the domain already carries Google verification records) to watch reputation once volume allows.
- [ ] If spam placement persists as volume grows, revisit DMARC reporting (`rua`) and policy then. No change is planned now.

## Vercel project and edge policy — approval required

- [ ] Create a separate Vercel project rooted at `access/`; do not mount Access inside the public-site project. Leave Framework Preset, Build Command, and Output Directory to `access/vercel.json` (`framework: null`, output `public`, `npm ci`); with the “Other” preset Vercel serves `public/` as the static root, so no `/public/…` paths exist in production.
- [ ] Pin Node to `24.x` and confirm the deployed runtime reports the expected major.
- [ ] Confirm only the intended repository/branch may produce production deployments.
- [ ] Attach only `access.probnaya.work` as the production custom domain. Do not treat generated aliases as accepted authentication origins.
- [ ] Verify TLS issuance, HTTP→HTTPS redirect, and HSTS before any establishment link is issued.
- [ ] Confirm the deployed CSP and all headers from `access/vercel.json` on HTML, scripts, and API errors.
- [ ] Configure WAF/rate-limit rules as an outer layer for `/api/access`, without replacing database-backed limits.
- [ ] Configure alerts from Function logs: each rejected or failed request writes one JSON line `{"event":"access.request","method","action","outcome","status","code"}`. Alert on `outcome:"error"` (database/connectivity codes such as `ECONNREFUSED`, `CONNECT_TIMEOUT`, `57P01`, `53300`), on any `request_delivery_failed` or `request_ceiling`, and on elevated `authentication_failed`, `enrollment_failed`, `recovery_failed`, `rate_limited`, `invalid_origin`, and `invalid_host` counts. Failed attempts are not written to `access_audit_events`.
- [ ] Verify function and database regions, latency, connection capacity, and failure behavior.

## Pre-enrollment verification

- [ ] Confirm `https://access.probnaya.work/` renders the Access surface and the browser console is clean.
- [ ] Confirm the API rejects `Origin: https://probnaya.work`, sibling subdomains, wildcard assumptions, missing Origin on POST, preview hosts, and mismatched Host.
- [ ] Confirm a preview deployment of the Access project returns `ACCESS SERVICE UNAVAILABLE` (no production variables) and never reaches the production database.
- [ ] Send a request with a forged `X-Forwarded-For` and `X-Vercel-Forwarded-For` to the production hostname and confirm the rate-limit identity follows the real client address (Vercel documents overwriting `X-Forwarded-For`; the runtime trusts only that header).
- [ ] Confirm a `GET /api/access` with `Sec-Fetch-Site: same-site` returns 403.
- [ ] Confirm `GET /api/relation` from `https://probnaya.work` with the session cookie returns 200 with `Access-Control-Allow-Origin: https://probnaya.work` and `Access-Control-Allow-Credentials: true`, returns a readable 401 without a session, and returns 403 without CORS headers for `https://www.probnaya.work`, sibling subdomains, preview hosts, and a missing Origin.
- [ ] From the deployed public site, confirm the credentialed relation fetch succeeds in Safari, Firefox, and Chromium (same-site cookie, no third-party-cookie blocking), and that the deployed `Cross-Origin-Resource-Policy` header does not block it.
- [ ] Confirm session cookies use `__Host-probnaya_session; Path=/; Secure; HttpOnly; SameSite=Strict` with no `Domain`.
- [ ] Confirm API and HTML responses use `Cache-Control: no-store`.
- [ ] Run `npm ci`, `npm run check`, and `npm audit --omit=dev` from `access/` using the committed lockfile.
- [ ] Set `ACCESS_TEST_DATABASE_URL` to an isolated, disposable database on the exact provider, version, and connection path (direct or pooled) production will use, and run `npm run test:postgres`. The suites create and drop only their own randomized schemas.
- [ ] Deploy the public site with `/interior/` and confirm `interior/fixtures.js` is absent from the deployment (it is in `.vercelignore`) and `/interior/` responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- [ ] Walk public → ENTER → PRESENT KEY → Interior, public ↔ Interior while recognized, RELATION → END SESSION → public → PRESENT KEY again, and REQUEST ACCESS → operator link → CREATE PASSKEY → Interior on production hosts.
- [ ] Open a real establishment link from Gmail (web and iOS app), Outlook (including Safe Links rewriting if available), and Apple Mail on iOS and macOS. Confirm each opens Access with *Issue the first key.*, the address bar shows `https://access.probnaya.work/` with no fragment, and the link preview/scanner fetch did not consume the grant.
- [ ] Exercise registration, usernameless authentication, cross-device authentication, hardware security keys, add/revoke, recovery, logout, and expiry on the supported browser/device matrix.
- [ ] Perform a second independent application-security review of the remediation and resolve every HIGH/MEDIUM finding before release.

## Operator environment

The only credential an operator needs is the Neon connection string for the `access_operator` role (branch `main`, database `neondb`, `sslmode=verify-full`, no `channel_binding`), kept in the password manager. Operators never need `SESSION_HASH_KEY` or any other Vercel application secret. Access Production's own `DATABASE_URL` is the `access_runtime` role (set 2026-09-15), which cannot create holders or grants and which operator commands refuse.

- [ ] Clean trusted checkout of the deployed `main` commit, then `npm ci` in `access/`.
- [ ] Save the `access_operator` URL in the password manager once. For normal approval, paste it into the CLI's masked prompt per operation. Do not export it in the shell, pass it as an argument, or store it in the checkout.
- [ ] Every operator command prints `Connected as access_operator (production, https://access.probnaya.work)` before acting; anything else is refused.
- [ ] Keep the database role grants (`access_runtime`, `access_operator`) under review; they are the boundary that makes grant creation an operator-only authority.

## Observation ownership

- [ ] Apply `004_observation_ownership.sql` before deploying a runtime that reads it; confirm `access_runtime` cannot update `contact_lookup` or `offered_holder_id`.
- [ ] Create `OBSERVATION_CONTACT_KEY` (32 random bytes) in the password manager only. It is operator-only, never a Vercel variable, and must differ from every runtime key. It is a long-lived, recovery-critical secret: losing or changing it silently breaks matching for every earlier lookup, so it is never rotated casually. See `docs/observation-ownership.md` §2.

## Establishing access

For each request in `mail@probnaya.work` (subject `ACCESS / REQUEST R–XXXXXX`), in the operator environment:

- [ ] In the prepared, trusted Access checkout, run `npm run approve-request -- 'R–XXXXXX'`. Paste the saved `access_operator` URL into the silent terminal prompt. Verify the connected role and the request notification, then answer `y` to approve. The command atomically assigns the next four-digit `PROB–H` identifier and prints a delimited message containing the link once. A used reference issues nothing and names its holder; reissue is a separate explicit operation.
- [ ] The link in the `MESSAGE` block is establishment authority. Copy only that block's subject and body into a new plain message to the address in the original notification; do not reply to the notification. Do not keep terminal scrollback or notes containing the link. This is operational mail, not Correspondence.
- [ ] Never put the address in the operator note, audit data, tickets, analytics, or URL query parameters. The request reference is the only join between the mailbox and Access.
- [ ] A lapsed or lost link: `npm run create-enrollment -- --reissue 'PROB–H–NNNN' 'R–XXXXXX'`, then send the new link. The earlier link stops working.
- [ ] A link sent to the wrong address or suspected of exposure: `npm run holder-condition -- 'PROB–H–NNNN' suspend` (expires every outstanding link), then `reactivate` and `--reissue` when appropriate. If a stranger established the relation first, suspend that holder and establish the person under a new identifier.
- [ ] Never issue a link to an identifier that is active or suspended (the CLI refuses), and never issue objects or correspondence to a pending holder.
- [ ] A person who has lost every key and recovery code cannot regain an established relation by requesting again. Only a new relation under a new identifier is possible.
- [ ] For the first production establishment: observe registration, recovery-code issuance, normal logout, and a separate normal `PRESENT KEY` login; confirm a second viable key or safely stored recovery set; inspect logs to confirm no challenge, assertion, cookie, recovery code, grant, address, raw credential ID, public key, or database URL appears.

## Rollback and incident posture

- [ ] Keep `access.probnaya.work` under control during application rollback or provider migration. Do not solve an outage by changing the RP ID.
- [ ] Prepare a backward-compatible application rollback before schema evolution.
- [ ] After the runtime carrying the enrollment-grant digest has been deployed for seven days, remove the legacy HMAC grant lookup (`AccessService.legacyEnrollmentGrantHash`).
- [ ] Document session invalidation, credential suspension (`npm run holder-condition -- 'PROB–H–…' suspend|reactivate`, operator environment only), secret rotation, database compromise, and recovery-code exposure procedures. Recovery adds a key but retains existing keys: after a compromise-driven recovery the holder must revoke exposed keys from the Access record.
- [ ] Treat combined database plus runtime-secret compromise as a credential/session/recovery incident, even though private passkey keys remain outside PROBNAYA.
