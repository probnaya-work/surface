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

`SESSION_HASH_KEY` also hashes enrollment grants, so the operator running `create-enrollment` needs it. Rotating it invalidates every session, every outstanding establishment link, and open recovery; rotating `RECOVERY_HASH_KEY` invalidates every unused recovery code; rotating `NETWORK_HASH_KEY` resets rate-limit buckets.

## Request mail — must be completed before REQUEST ACCESS is enabled

The public intake handler (`api/intake.js`) signs in to Google Workspace SMTP with an **app password for the primary Workspace account** (`.env.example`), sending as `mail@probnaya.work`. A Google app password is not scoped to sending: it can also read that account's mail over IMAP/POP unless an administrator disables those protocols. The repository cannot show which account `SMTP_USER` is in production or whether IMAP/POP are disabled. Access therefore does **not** reuse that credential.

- [ ] Create a dedicated Workspace user (for example `access-requests@probnaya.work`) used only to send access requests. Do not make it an alias of, or delegate it to, the account that receives `mail@probnaya.work`, and do not grant it delegated access to any other mailbox.
- [ ] Enable 2-Step Verification on it, generate one app password, and set `ACCESS_REQUEST_SMTP_USER` / `ACCESS_REQUEST_SMTP_FROM` to its own address and `ACCESS_REQUEST_SMTP_PASS` to the app password, in the Access project's Production environment only.
- [ ] Disable IMAP and POP for the sender account (Admin console → Apps → Google Workspace → Gmail → End User Access), so its credential can send but not read.
- [ ] Confirm the account that owns `mail@probnaya.work` — where establishment links are sent from and retained — is not reachable by **any** deployed credential. If the public intake `SMTP_USER` is that account, either move intake to its own sender account or disable IMAP/POP for the `mail@probnaya.work` account before the first establishment link is sent. Otherwise a compromised public-site Function could read unconsumed links.
- [ ] Send one test request from `https://access.probnaya.work/` and confirm it arrives at `mail@probnaya.work` from the sender address, with `Reply-To` equal to the entered address, and that no message reaches the entered address.
- [ ] Confirm Function logs for request failures contain only `request_unavailable`, `request_ceiling`, `request_delivery_failed`, `invalid_email`, or `rate_limited`, never an address. Alert on `request_delivery_failed` and `request_ceiling`.

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

## Establishing access

For each request in `mail@probnaya.work` (subject `ACCESS / REQUEST R–XXXXXX`):

- [ ] Choose the next unused `PROB–H` identifier. Run from `access/` with the operator database role and production `SESSION_HASH_KEY`:
  `npm run create-enrollment -- --new 'PROB–H–NNNN' 'R–XXXXXX'`
  The link on standard output is establishment authority. Do not paste it anywhere except the reply, and do not keep terminal scrollback or notes containing it.
- [ ] Reply to the request from `mail@probnaya.work` with the link in a plain operational message (not Correspondence). State that Access will ask the device to create a passkey, that no password or account is created, when the link closes (seven days), and that nothing happens if it is ignored.
- [ ] Never put the address in the operator note, audit data, tickets, analytics, or URL query parameters. The request reference is the only join between the mailbox and Access.
- [ ] A lapsed or lost link: `npm run create-enrollment -- --reissue 'PROB–H–NNNN' 'R–XXXXXX'`, then reply again. The earlier link stops working.
- [ ] A link sent to the wrong address or suspected of exposure: `npm run holder-condition -- 'PROB–H–NNNN' suspend` (expires every outstanding link), then `reactivate` and `--reissue` when appropriate. If a stranger established the relation first, suspend that holder and establish the person under a new identifier.
- [ ] Never issue a link to an identifier that is active or suspended (the CLI refuses), and never issue objects or correspondence to a pending holder.
- [ ] A person who has lost every key and recovery code cannot regain an established relation by requesting again. Only a new relation under a new identifier is possible.
- [ ] For the first production establishment: observe registration, recovery-code issuance, normal logout, and a separate normal `PRESENT KEY` login; confirm a second viable key or safely stored recovery set; inspect logs to confirm no challenge, assertion, cookie, recovery code, grant, address, raw credential ID, public key, or database URL appears.

## Rollback and incident posture

- [ ] Keep `access.probnaya.work` under control during application rollback or provider migration. Do not solve an outage by changing the RP ID.
- [ ] Prepare a backward-compatible application rollback before schema evolution.
- [ ] Document session invalidation, credential suspension (`npm run holder-condition -- 'PROB–H–…' suspend|reactivate`), secret rotation, database compromise, and recovery-code exposure procedures. Recovery adds a key but retains existing keys: after a compromise-driven recovery the holder must revoke exposed keys from the Access record.
- [ ] Treat combined database plus runtime-secret compromise as a credential/session/recovery incident, even though private passkey keys remain outside PROBNAYA.
