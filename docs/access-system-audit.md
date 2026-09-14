# PROBNAYA access — existing-system audit

Audit date: 2026-09-14
Audited branch: `feat/access-production`, created from `feat/register-of-condition`

## System boundary

The repository is the public `probnaya-work/surface` site. It is a static, multi-page HTML/CSS/JavaScript site deployed by Vercel. There is no application framework, client router, template layer, or build step. Files under `api/` become Vercel Node.js Functions.

The current branch diverges from local `main` (`4` commits only on this branch, `5` only on `main`). In particular, `main` contains `fix(security): harden deployment boundary`, which is not an ancestor of this branch. Production integration must reconcile that history rather than silently replacing either line.

## Runtime and deployment

- Host: Vercel, confirmed from the live `Server` and `x-vercel-*` response headers.
- Canonical production origin in page metadata: `https://probnaya.work`.
- `http://probnaya.work/` redirects permanently to HTTPS.
- `https://www.probnaya.work/` redirects permanently to `https://probnaya.work/`.
- Current `vercel.json` enables clean URLs and redirects `/index` and `/index.html` to `/`.
- No Node engine is pinned on this branch. Vercel currently defaults new projects to its latest supported Node LTS; this is mutable deployment behavior and should be pinned for authentication.
- The local `.claude/dev-server.js` emulates clean URLs and Vercel-style API handlers. The README’s Python server cannot exercise API routes and is not sufficient for authentication development.

## Existing API architecture

Two CommonJS handlers exist:

- `api/intake.js`: accepts public problem/collaboration submissions and sends email through Google Workspace SMTP via Nodemailer.
- `api/machine-portrait.js`: creates and verifies hosted Stripe Checkout Sessions for MPA–01 issuance.

Handlers use Vercel’s `req`/`res` conveniences, exact or bounded payload validation in important places, generic provider-failure responses, and environment variables. There is no shared server library or middleware layer.

## Persistence and identity

- No database, key-value store, durable object store, or cache is configured.
- No user, holder, identity, credential, session, challenge, recovery, or audit-event schema exists.
- No authentication/identity dependency exists.
- No cookie or authenticated-session handling exists.
- MPA–01 deliberately retains its pending draft in browser `localStorage`; that state is not an authenticated session and cannot support access control.

Production WebAuthn therefore requires new durable, transactional persistence. Serverless process memory is not a valid store for challenges, sessions, credentials, recovery material, or rate limits.

## Environment variables and secrets

`.env*` is ignored except for `.env.example`; `.vercel` and `node_modules` are ignored. Existing documented secrets are SMTP and Stripe credentials. Handlers read them only server-side. No real credentials appear in tests.

Weaknesses on the audited branch:

- `package.json` has only `nodemailer: ^6.9.0`; there is no lockfile, package name, private flag, or Node engine constraint.
- Exact deployed dependency resolution is therefore not reproducible from this branch.
- Secret presence is validated at request time, but there is no central configuration validation.

`main` already improves some of this with an engine declaration, exact Nodemailer version, lockfile, and deployment allowlisting. That work should be reconciled before merge.

## Headers and browser policy

The live static site currently returns:

- HSTS: `max-age=63072000`.
- `Access-Control-Allow-Origin: *` on sampled static HTML.
- No observed Content Security Policy.
- No observed `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or clickjacking policy on sampled static HTML.
- Public cache semantics on static HTML.

The sampled API `OPTIONS /api/intake` response returned `405`, `Allow: POST`, HSTS, and no permissive CORS header. Current APIs are intended for same-origin use but do not explicitly validate `Origin`.

There is no CSP. Existing pages contain inline scripts, inline styles, remote Google Fonts, and the same-origin Vercel Insights script, so a strict site-wide policy cannot be introduced casually. The approved separate `access.probnaya.work` origin can and should have a restrictive origin-wide policy and no inline executable code.

## CSRF and CORS posture

- There is no authenticated state today, hence no authenticated CSRF control.
- Existing APIs set no CORS allowance themselves and are called same-origin.
- Existing state-changing POST handlers do not validate `Origin` or use CSRF tokens.
- MPA checkout creation has abuse/cost implications even without authentication. Intake has spam/email implications. Those are pre-existing concerns, outside this change unless shared infrastructure touches them.
- Authentication will use ambient cookies, so `SameSite` alone is insufficient: exact `Origin` validation plus synchronizer CSRF tokens are required for authenticated state changes.

## Rate limiting and denial of service

No application rate limiting exists on this branch. No Vercel Firewall rules are represented in the repository, and external project settings were not inspected or changed. Authentication and recovery need durable application limits; edge/WAF limits are additional defense, not the only control.

## Logging and errors

- Server handlers avoid returning caught provider error details.
- `api/intake.js` catches mail failures without logging details.
- `api/machine-portrait.js` returns bounded error codes for expected issuance failures.
- The local development server logs thrown handler errors, including stack objects; production logging behavior is not centrally defined.
- There is no structured audit/security-event log.
- There is no redaction helper preventing challenges, assertions, cookies, or recovery codes from entering logs.

## Tests and CI

- Tests use Node’s built-in test runner with mocked SMTP and Stripe; 59 current tests pass.
- No test database or browser/WebAuthn test harness exists.
- No repository-local CI workflow exists in the audited tree.
- No dependency audit can be reproduced reliably from this branch because it has no lockfile.

## Existing security positives

- Production traffic is redirected to HTTPS and receives HSTS.
- Stripe secrets and SMTP credentials stay server-side.
- The payment endpoint validates server-owned amount, currency, Price, environment, payment state, and a client-draft commitment.
- Tests use non-production values and mocked external services.
- MPA image processing remains local to the browser.

## Authentication infrastructure required

1. A transactional PostgreSQL database reachable from Vercel Functions.
2. Schema and migration review for holders, credentials, ceremonies, sessions, enrollment grants, recovery codes, rate-limit buckets, and audit events.
3. Exact allowed-origin and RP-ID configuration: permanent production constants for `https://access.probnaya.work` / `access.probnaya.work`, and a separate explicit localhost-only development profile.
4. New server secrets for recovery-code hashing and privacy-preserving network-address hashing.
5. Pinned WebAuthn and PostgreSQL dependencies plus a committed lockfile.
6. A production enrollment process for issuing the first passkey to a pre-authorized holder.
7. Operational decisions for backup, database region, retention, alerting, WAF limits, and incident response.

## References checked

- [Vercel Node.js runtimes](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel Postgres integrations](https://vercel.com/docs/postgres)
- [Vercel request headers](https://examples.vercel.com/docs/headers/request-headers)
- [Vercel response-header configuration](https://vercel.com/docs/project-configuration/vercel-json#headers)
