# PROBNAYA Access

This directory is a self-contained Vercel project for the permanent authentication origin `https://access.probnaya.work`. Configure `access/` as its own Vercel project root; do not deploy it as a route of the public-site project. `vercel.json` serves `public/` as the static output and `api/access.js` as the only Function.

WebAuthn credentials issued for RP ID `access.probnaya.work` are not casually migratable to another RP ID. Preserve the hostname as long-lived authentication infrastructure.

See `../docs/access-architecture.md`, `../docs/access-threat-model.md`, and `../docs/access-deployment-checklist.md` before operating this service.

## Local development

1. Run `npm ci`.
2. Copy `.env.example` values into your shell or an untracked local environment file. Generate three different secrets with `openssl rand -base64 32`.
3. For disposable UI/ceremony development, set `ACCESS_ENV=development`, `ACCESS_LOCAL_ORIGIN=http://localhost:4174`, and `ACCESS_USE_MEMORY_STORE=true`. Set an explicit base64url `ACCESS_DEV_ENROLLMENT_TOKEN` if the local enrollment screen is needed.
4. Run `npm run prepare:browser` and `npm run dev`, then open `http://localhost:4174/`.
5. Run `npm test` or `npm run check`.

The in-memory store loses all state on restart and is rejected by production configuration. Its concurrency behavior is not representative of PostgreSQL; use the PostgreSQL suites for any authority or race claim.

Localhost is a separate WebAuthn RP (`localhost`). Local credentials cannot authenticate production, and local configuration never changes or infers the production RP/origin.

## Operator commands (PostgreSQL)

All commands load the same configuration as the service. Review every migration before running it.

| Command | Effect |
|---|---|
| `npm run migrate` | Applies `001_access.sql` only when the base schema is absent, then re-applies every idempotent forward migration. |
| `npm run create-enrollment -- 'PROB–H–…' ['note']` | Creates a pending holder and prints a 24-hour first-enrollment grant once. For a holder that is still pending it issues a replacement grant and expires the earlier one. Refuses active and suspended holders. Handle the grant as authentication material. |
| `npm run holder-condition -- 'PROB–H–…' suspend` | Suspends a holder; migration 002's trigger invalidates its ordinary and recovery sessions in the same transaction. |
| `npm run holder-condition -- 'PROB–H–…' reactivate` | Restores `active` when an active credential remains, otherwise `pending`. Invalidated sessions are never restored. |
| `npm run prune-expired -- [days]` | Deletes ceremonies, rate-limit buckets, sessions, and recovery sessions unusable for longer than the retention period (default 30 days). Keeps audit events, holders, credentials, grants, and codes. |

`002_holder_authority.sql` invalidates live ordinary and recovery sessions for non-active holders and installs the same invalidation for future suspension transitions; it does not delete credentials or recovery codes.

## PostgreSQL tests

Set `ACCESS_TEST_DATABASE_URL` to a disposable PostgreSQL database and run `npm run test:postgres`. The suites create random schemas, apply every numbered migration, use independent connection pools for race schedules, drive every ceremony through the production-profile handler, and drop only their generated schemas afterward. Never point this variable at a production database.

## Database connection string

Production requires `sslmode=verify-full`; postgres.js disables certificate validation for `require`, `prefer`, and `allow`. The server certificate must chain to a CA in Node's default trust store. postgres.js forwards unknown query parameters to the server, so libpq-only parameters such as `channel_binding` or `sslrootcert` (present in some provider-generated URLs) are rejected at startup instead of failing every request.
