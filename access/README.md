# PROBNAYA Access

This directory is a self-contained Vercel project for the permanent authentication origin `https://access.probnaya.work`. Configure `access/` as its own Vercel project root; do not deploy it as a route of the public-site project. `vercel.json` serves `public/` as the static output and `api/access.js` as the only Function.

WebAuthn credentials issued for RP ID `access.probnaya.work` are not casually migratable to another RP ID. Preserve the hostname as long-lived authentication infrastructure.

See `../docs/access-architecture.md`, `../docs/access-threat-model.md`, and `../docs/access-deployment-checklist.md` before operating this service.

## Local development

1. Run `npm ci`.
2. Copy `.env.example` values into your shell or an untracked local environment file. Generate three different secrets with `openssl rand -base64 32`.
3. For disposable UI/ceremony development, set `ACCESS_ENV=development`, `ACCESS_LOCAL_ORIGIN=http://localhost:4174`, and `ACCESS_USE_MEMORY_STORE=true`. Set `ACCESS_PUBLIC_ORIGIN=http://localhost:4173` to let the locally served public site and Interior read the relation (`GET /api/relation`) and to point Access's fixed Interior and logout destinations at it. To exercise establishment, set an explicit base64url `ACCESS_DEV_ENROLLMENT_TOKEN` (and optionally `ACCESS_DEV_PUBLIC_ID`) and open `http://localhost:4174/#establish=<that token>`. To exercise REQUEST ACCESS without sending mail, set `ACCESS_DEV_REQUEST_OUTBOX=console`; request messages are printed to the dev server's output.
4. Run `npm run prepare:browser` and `npm run dev`, then open `http://localhost:4174/`.
5. Run `npm test` or `npm run check`.

The in-memory store loses all state on restart and is rejected by production configuration. Its concurrency behavior is not representative of PostgreSQL; use the PostgreSQL suites for any authority or race claim.

Localhost is a separate WebAuthn RP (`localhost`). Local credentials cannot authenticate production, and local configuration never changes or infers the production RP/origin.

## Operator commands (PostgreSQL)

`migrate` needs only `DATABASE_URL` (owner role). Every other operator command needs only `ACCESS_ENV` (`production` or `development`) and `DATABASE_URL` for the `access_operator` role (`sslmode=verify-full` in production); no application secrets. They refuse `access_runtime`, and in production any role other than `access_operator`. For local development add `ACCESS_LOCAL_ORIGIN`. Review every migration before running it.

| Command | Effect |
|---|---|
| `npm run migrate` | Applies `001_access.sql` only when the base schema is absent, then re-applies every idempotent forward migration. |
| `npm run holders` | Read-only: identifiers, condition, creation date, open link, latest request reference. Allocates nothing. |
| `npm run approve-request -- 'R–XXXXXX'` | Normal request path. Prompts silently for the saved `access_operator` URL in production, checks the connected role, then asks for explicit approval. Atomically allocates the next four-digit `PROB–H` identifier and prints a ready-to-send message containing one establishment link. Refuses a reference that already produced a grant; never reissues. No requester address is read or stored. |
| `npm run create-enrollment -- --new 'PROB–H–…' ['R–XXXXXX']` | Creates a pending holder under an unused identifier and prints its establishment link (`…/#establish=<grant>`, valid seven days) once to standard output. Stores only the grant digest. Refuses an identifier that already exists and a request reference that already produced a grant. The optional note is the request reference from the `ACCESS / REQUEST` message, never an address. |
| `npm run create-enrollment -- --reissue 'PROB–H–…' ['R–XXXXXX']` | Replaces the link of a holder that is still pending and expires every earlier link. Refuses unknown, active, and suspended holders. |
| `npm run holder-condition -- 'PROB–H–…' suspend` | Suspends a holder; the migration 002/003 trigger invalidates its ordinary and recovery sessions and expires its outstanding establishment links in the same transaction. |
| `npm run holder-condition -- 'PROB–H–…' reactivate` | Restores `active` when an active credential remains, otherwise `pending` with no usable link. Invalidated sessions and links are never restored. |
| `npm run prune-expired -- [days]` | Deletes ceremonies, rate-limit buckets, sessions, and recovery sessions unusable for longer than the retention period (default 30 days). Keeps audit events, holders, credentials, grants, and codes. |

`002_holder_authority.sql` invalidates live ordinary and recovery sessions for non-active holders and installs the same invalidation for future suspension transitions; it does not delete credentials or recovery codes. `003_suspension_expires_grants.sql` extends that trigger so suspension also expires outstanding enrollment grants.

An establishment link is bearer authority for one pending holder's first key. Deliver it once, as a new message to the requester, and keep no other copy. See `../docs/access-deployment-checklist.md` (*Request mail*, *Establishing access*).

## Access requests

`REQUEST ACCESS` sends one message to `mail@probnaya.work` through the same Google Workspace SMTP account as public intake (`ACCESS_REQUEST_SMTP_USER`, `ACCESS_REQUEST_SMTP_PASS`, `ACCESS_REQUEST_SMTP_FROM=mail@probnaya.work`; Production only). Access stores nothing about a request and never writes to the requester. Without these settings only the request action is unavailable.

For a normal approval, inspect the notification in the mailbox and run `npm run approve-request -- 'R–XXXXXX'` in a trusted, prepared operator checkout. Save the `access_operator` connection URL in your password manager once; paste it into the silent terminal prompt for each operation. The command does not use an exported production `DATABASE_URL`, put it in shell history, or store it locally. Compare the reference and recipient with the notification before confirming. Copy only the delimited `MESSAGE` block into a new message to the notified address; never reply to the internal notification. The bearer link appears once in that block and is not copied to the clipboard or stored by the CLI. The mailbox remains the only request queue; Access has no pending-request rows, and the CLI has no mail authority. Use `--reissue` separately only for a pending holder whose link needs replacement.

## PostgreSQL tests

Set `ACCESS_TEST_DATABASE_URL` to a disposable PostgreSQL database and run `npm run test:postgres`. The operator suite runs the scripts as child processes with no application secrets and, if no `access_runtime` role exists, creates a temporary `NOLOGIN` one to prove the refusal, dropping it afterwards. The suites create random schemas, apply every numbered migration, use independent connection pools for race schedules, drive every ceremony through the production-profile handler, and drop only their generated schemas afterward. Never point this variable at a production database.

## Database connection string

Production requires `sslmode=verify-full`; postgres.js disables certificate validation for `require`, `prefer`, and `allow`. The server certificate must chain to a CA in Node's default trust store. postgres.js forwards unknown query parameters to the server, so libpq-only parameters such as `channel_binding` or `sslrootcert` (present in some provider-generated URLs) are rejected at startup instead of failing every request.
