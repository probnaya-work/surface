# PROBNAYA Access

This directory is a self-contained Vercel project for the permanent authentication origin `https://access.probnaya.work`. Configure `access/` as its own Vercel project root; do not deploy it as a route of the public-site project.

WebAuthn credentials issued for RP ID `access.probnaya.work` are not casually migratable to another RP ID. Preserve the hostname as long-lived authentication infrastructure.

See `../docs/access-architecture.md`, `../docs/access-threat-model.md`, and `../docs/access-deployment-checklist.md` before operating this service.

## Local development

1. Run `npm ci`.
2. Copy `.env.example` values into your shell or an untracked local environment file. Generate three different random secrets of at least 32 bytes each.
3. For disposable UI/ceremony development, set `ACCESS_ENV=development`, `ACCESS_LOCAL_ORIGIN=http://localhost:4174`, and `ACCESS_USE_MEMORY_STORE=true`. Set an explicit base64url `ACCESS_DEV_ENROLLMENT_TOKEN` if the local enrollment screen is needed.
4. Run `npm run prepare:browser` and `npm run dev`, then open `http://localhost:4174/`.
5. Run `npm test` or `npm run check`.

The in-memory store loses all state on restart and is rejected by production configuration. To test PostgreSQL, omit `ACCESS_USE_MEMORY_STORE`, set a non-production `DATABASE_URL`, review then run `npm run migrate`, and create a holder grant with `npm run create-enrollment -- 'PROB–H–LOCAL01'`. The grant prints once to standard output; handle it as authentication material.

Localhost is a separate WebAuthn RP (`localhost`). Local credentials cannot authenticate production, and local configuration never changes or infers the production RP/origin.

## PostgreSQL concurrency tests

Set `ACCESS_TEST_DATABASE_URL` to a disposable PostgreSQL database and run `npm run test:postgres`. The suite creates a random schema, applies every numbered migration, uses independent connection pools for race schedules, and drops only that generated schema afterward. Never point this variable at a production database.

`npm run migrate` applies `001_access.sql` only when the base schema is absent, then applies the idempotent forward migrations. Review every migration before running it. `002_holder_authority.sql` invalidates live ordinary and recovery sessions for non-active holders and installs the same invalidation for future suspension transitions; it does not delete credentials or recovery codes.
