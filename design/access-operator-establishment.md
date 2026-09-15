# Access — operator establishment from a clean machine

Status: investigation, 2026-09-15. Nothing implemented, nothing changed in Production. Written against `main` = `ed32778` (live on `access.probnaya.work`), `access/`, and the local role-setup scripts in `/Users/bogart/Dev/PROBNAYA/access-role-setup/` (not versioned). Request `R–N3X58X` is untouched.

---

## CURRENT FAILURE

The first real request arrived and its notification correctly said:

```
npm run create-enrollment -- --new 'PROB–H–…' 'R–N3X58X'
```

An operator starting from a clean, trusted checkout cannot run that command against Production:

1. `scripts/create-enrollment.mjs:24` calls `loadConfig()`. In the production profile this requires `SESSION_HASH_KEY`, `RECOVERY_HASH_KEY`, and `NETWORK_HASH_KEY` (`lib/config.js:122-124`), all present, distinct, and random-looking.
2. The grant is stored as `HMAC(SESSION_HASH_KEY, "enrollment:" + token)` (`scripts/create-enrollment.mjs:36` → `lib/service.js:45-46`). Runtime verification recomputes the same HMAC. A grant made with any other key produces a link that looks valid and can never work.
3. `SESSION_HASH_KEY` exists only as a Vercel **Secret** (sensitive) variable on `probnaya-access`. Vercel never returns it (verified 2026-09-15: `type: sensitive`, `decrypted: false`). The repository intentionally holds no Production secrets.

The documentation had recorded the dependency without recognising that it cannot be met. `docs/access-deployment-checklist.md:49` says: "`SESSION_HASH_KEY` also hashes enrollment grants, so the operator running `create-enrollment` needs it." Line 126 says: "Run from `access/` with the operator database role and production `SESSION_HASH_KEY`."

**The same failure affects every operator command that loads the application config:**

| Command | Needs | Uses | Operable from a clean machine today |
|---|---|---|---|
| `migrate` | `DATABASE_URL` only (`scripts/migrate.mjs:4`) | owner role | Yes (this is how 003 was applied) |
| `create-enrollment` | all three runtime keys + `ACCESS_ENV` + `DATABASE_URL` | `SESSION_HASH_KEY` (grant hash), `config.origin` | **No** |
| `holder-condition` (suspend/reactivate) | all three runtime keys (`scripts/set-holder-condition.mjs:10`) | none of them | **No**. Incident suspension is blocked by keys it never reads. |
| `prune-expired` | all three runtime keys (`scripts/prune-expired.mjs:10`) | none of them | **No** |

This is an operational design failure. The request flow, the grant primitive, and the runtime are working as built.

---

## CURRENT AUTHORITY PATH

**1. Token generation.** `randomToken()` = 32 bytes from `crypto.randomBytes`, base64url, 43 characters (`lib/crypto.js:3`, `scripts/create-enrollment.mjs:28`).

**2. Hashing.** `service.tokenHash('enrollment', token)` = `HMAC-SHA-256(SESSION_HASH_KEY, "enrollment:" + token)`, base64url (`lib/service.js:45-46`, `lib/crypto.js:7`).

**3. Storage.** In one transaction under the holder row lock, `PostgresStore.issueEnrollmentGrant` inserts `access_enrollment_grants(id, holder_id, token_hash, created_at, expires_at = now + 7 days, consumed_at = null, operator_note = 'R–…')` and an `enrollment-grant-issued` audit event (`lib/postgres-store.js:141-170`). `token_hash` is `text NOT NULL UNIQUE` with no format constraint (`migrations/001_access.sql:64`). The plaintext token exists only in the CLI process.

**4. Link construction.** stdout gets `${config.origin}/#establish=${token}` once (`scripts/create-enrollment.mjs:53`). `config.origin` is the compiled constant `https://access.probnaya.work` in production.

**5. Opening the link.** `public/app.js` copies the fragment into memory, replaces history, and sends nothing until CREATE PASSKEY.

**6. Establishment verification.** `enrollment-options` (`lib/service.js:200-216`):
- limits per network, and per network plus `tokenHash('enrollment', grant)`;
- runs `store.findGrant(tokenHash('enrollment', grant))`, where `token_hash` matches, `consumed_at IS NULL`, and `expires_at > now` (`lib/postgres-store.js:210-212`);
- requires the holder to be `pending`;
- creates a `first-registration` ceremony bound to the pre-auth cookie, with `referenceId = grant.id`.

**7. Consumption.** `enrollment-verify` consumes the ceremony and verifies the WebAuthn registration. It then runs `completeFirstRegistration`, which does all of the following in one transaction (`lib/postgres-store.js:246-262`):
- locks the holder as `pending`;
- `UPDATE access_enrollment_grants SET consumed_at … WHERE id = grantId AND holder_id … AND consumed_at IS NULL AND expires_at > now`;
- inserts the credential;
- sets the holder `active`;
- creates the session and recovery set;
- writes the audit events.

**Consumption uses `grant.id`, not the hash.** The hash is used in exactly one place: the lookup in step 6, plus the rate-limit dimension beside it.

**8. Suspension (migration 003).** The trigger sets `expires_at = LEAST(expires_at, created_at)` on unconsumed grants. It is independent of the hash.

**Database roles in Production** (from `access-role-setup/roles.sql`, verified by its `smoke.mjs`; not versioned in the repo):

| Role | Holders | Grants | Sessions |
|---|---|---|---|
| `access_runtime` (Vercel `DATABASE_URL`) | `SELECT`, `UPDATE (condition, updated_at)` | `SELECT`, `UPDATE (consumed_at)`, **no `INSERT`** | `SELECT/INSERT/UPDATE` |
| `access_operator` | `SELECT/INSERT`, `UPDATE (condition, updated_at)` | `SELECT/INSERT`, `UPDATE (expires_at)` | `SELECT`, `UPDATE (revoked_at)`, `DELETE`; **no `INSERT`** (smoke: "operator creates sessions" denied) |
| `neondb_owner` | all | all | all |

The database already enforces the intended split: only the operator role can create holders and grants, and only the runtime role can create sessions.

---

## 2. Is `SESSION_HASH_KEY` the right key for grants?

**No.**

*Cryptographically* the use is sound: `"enrollment:"`, `"session:"`, `"preauth:"`, `"recovery-session:"`, `"csrf:"` and `"csrf-token:"` are domain-separated inputs to one HMAC key.

*Operationally* it is a coupling error:
- **Custody.** Enrollment authority is minted off-platform by a human, but the key lives with the runtime, which the operator can never read. Session authority must never leave the runtime.
- **Rotation.** Rotating `SESSION_HASH_KEY` after a suspected session-key leak silently kills every outstanding establishment link, as the checklist itself notes. Rotating it to let an operator mint grants would end every session and open recovery.
- **What the key adds for grants: nothing that matters.**
  - A keyed hash (pepper) defends low-entropy secrets against offline guessing after a database read. A 256-bit random token cannot be guessed, and an unkeyed SHA-256 of it cannot be inverted.
  - The same reasoning is why password-reset and API tokens are commonly stored as plain SHA-256.
  - The one thing the key adds today is that a party with operator database write *but not the key* cannot mint grants. That party is exactly the operator, whose job is to mint them.

`SESSION_HASH_KEY` should remain the application's session authority: session token hashes, pre-auth bindings, recovery-session tokens, and CSRF derivation (`lib/service.js:60-78, 285-289, 475-507`). All of those are created and verified only inside the runtime. Once enrollment stops using it, the key never needs to leave Vercel, which is the correct state.

---

## OPTIONS CONSIDERED

**A. Keep the CLI; provision `SESSION_HASH_KEY` to operators.** The key is unreadable, so this means rotating it to a new value the operator stores (password manager) and sets in Vercel.
- **Works:** today, without code.
- **Costs:** rotation ends every live session, open recovery session, and outstanding grant. Passkeys and recovery codes are unaffected.
- **Leaves in place:** the coupling, and session authority on an operator machine.

**B. Separate `ENROLLMENT_GRANT_KEY` (HMAC pepper).** The operator generates it, keeps it in a password manager, and sets it in Vercel. The CLI and runtime use it for grants only.
- **Works.**
- **Costs:** another secret to provision, keep in two places, rotate (which kills pending links), and require in config.
- **Buys:** "operator database credential alone cannot mint", but the two credentials sit in the same password manager on the same machine.

**C. Unkeyed, domain-separated SHA-256 for grants.** Store `sha256:` + base64url(SHA-256(`"probnaya-access/enrollment-grant/v1:" + token`)). The runtime computes the same value.
- **Works:** no new secret. The operator needs only the `access_operator` database credential, which the database already scopes to "create holders and grants".
- **Old grants:** existing HMAC-format grants keep working through a transitional second lookup.
- **Schema:** no change (`token_hash` is free text).

**D. Database-side issuance.** A `SECURITY DEFINER` function with `pgcrypto` generates the token, stores its digest, and returns the token, callable only by the operator role.
- **Works.**
- **Costs:** a schema migration, an extension, and a function to review. Authority is still "can connect as the operator role", identical to C.
- **Risk:** the token passes through a SQL result, so statement or result logging needs care. More moving parts for the same boundary.

**E. Narrowly authenticated Production operator endpoint** (for example a new `/api/access` action).
- **Authentication would need one of:**
  - a static bearer secret in Vercel (reintroduces a secret the operator must hold, now reachable from the internet);
  - operator passkeys and an administrator role (schema change, a role model the threat model explicitly defers, CSRF and UI, a new privileged surface on the authentication origin).
- **Reject for v1.**

**F. Run the existing command where the secret already exists.**
- **Vercel has no one-off shell with sensitive variables.** `vercel env pull` and `vercel env run` return empty values for Secret variables, and Sandbox does not receive project secrets.
- **Other environments:** a Function or cron wrapper is option E. Copying the key into CI requires reading it first, which is impossible, so option A anyway.
- **Reject.**

**G. Operator-only configuration loader.** This is needed alongside any of A–D: operator commands should require only what they use. `holder-condition` and `prune-expired` need `DATABASE_URL` and nothing else; `create-enrollment` additionally needs the fixed origin. It closes the gap for the two commands that never touched the keys.

---

## THREAT MODEL

| | A. share session key | B. separate pepper | **C. SHA-256 + operator role** | D. DB function | E. endpoint |
|---|---|---|---|---|---|
| **Operator machine compromised** | Attacker gets session key + operator DB: can mint grants. Key + any runtime DB leak = forge sessions for any holder. | Can mint grants. Cannot forge sessions. | Can mint grants (intended operator authority). Cannot forge sessions: the operator role has no `INSERT` on sessions. | Same as C. | Stolen bearer token or operator passkey session can mint remotely. |
| **Runtime compromised** (Vercel env or Function) | Has key + runtime DB; cannot mint (no grant `INSERT`); can already forge sessions (unchanged baseline). | Has pepper + runtime DB; cannot mint. | Cannot mint: no holder or grant `INSERT` for `access_runtime`. Session powers unchanged. | Same as C unless the function is granted to runtime. | **Runtime becomes a minting authority.** |
| **Leak via shell history, argv, logs** | Hex/base64 session key typed or pasted into the operator shell: high value. | Pepper typed: medium value. | Only the DB URL (already required); read with a hidden prompt; the link prints once to stdout. | Same as C. | Bearer token in shell or request logs. |
| **Mint arbitrary establishment authority** | Operator DB + key | Operator DB + pepper | Operator DB | Operator DB | Endpoint credential |
| **Forge or invalidate sessions** | Possible with key + runtime DB; rotation invalidates all. | No | No | No | No |
| **Blast radius of the operator credential** | Every session (with DB), all pending grants | Pending grants and new pending holders | New pending holders and their first key only. Grants never reach `active` or `suspended` holders (`lib/service.js:209-210`, `postgres-store.js:249`). | Same | Same, but internet-reachable |
| **Revocation / rotation** | Rotation logs everyone out | Rotation kills pending links | Rotate the operator DB password (Neon). Runtime is unaffected; pending links survive. | Same as C | Rotate token; deploy |
| **Auditability** | `enrollment-grant-issued` audit event, `R–` note | same | same (unchanged) | same | could add request-level audit |
| **Duplicate holder creation** | `--new` / `--reissue` guard | same | same, plus a proposed same-reference guard | same | same |
| **Replay / expiry** | single use by `grant.id`; 7-day expiry; 003 suspension expiry | same | same (hash-independent) | same | same |

**What C gives up.** Today a party holding operator database write *without* `SESSION_HASH_KEY` cannot mint a working grant. After C, operator database write is enough. That party is the operator, and the role is intentionally limited to creating pending holders and grants. Every other property is equal or better. Session authority stops being a prerequisite for, and a casualty of, operator work.

**External check that C relies on:** Vercel `DATABASE_URL` for `probnaya-access` must be the `access_runtime` role, not the owner. The repository cannot show this. `access-role-setup/smoke.mjs` tested the grants, but the role setup is not versioned.

---

## RECOMMENDED DESIGN

**C + G, with two small operator guards.**

1. **Grant hash.** Add `enrollmentGrantHash(token)` = `"sha256:" + base64url(SHA-256("probnaya-access/enrollment-grant/v1:" + token))` in `lib/crypto.js` (Node `crypto.createHash`; no custom construction).
   - New grants are stored with it.
   - The `sha256:` prefix makes the format self-describing and cannot collide with 43-character HMAC values.
2. **Runtime lookup (transitional).** `enrollmentOptions` looks up `enrollmentGrantHash(token)` first, then the legacy `tokenHash('enrollment', token)`.
   - The rate-limit dimension uses the new hash.
   - Consumption is unchanged (`grant.id`).
   - Remove the legacy lookup in a follow-up once no unconsumed legacy grant can exist: any legacy grant expires at most 7 days after its creation, and none can have been created since the key became unavailable.
3. **Operator configuration.** Add `lib/operator-config.js` and use it in `create-enrollment`, `set-holder-condition`, and `prune-expired`.
   - It requires `ACCESS_ENV` (`production` | `development`) and `DATABASE_URL`, and reuses `requireVerifiedDatabaseTransport` in production.
   - It derives the origin from the same constants (`PRODUCTION_ORIGIN`, or `ACCESS_LOCAL_ORIGIN` in development).
   - It requires **no** hash keys and refuses the memory store.
4. **Operator role check.** On connect, operator commands read `current_user` and refuse `access_runtime`, printing the role name only.
5. **Same-request guard.** `create-enrollment --new … 'R–XXXXXX'` refuses if any grant already carries that `operator_note`. `--reissue` is the way to replace a link for the same request. It is enforced in the existing issuance transaction, with no schema change.
6. **Read-only allocation aid.** `npm run holders` lists `public_id`, `condition`, `created_at`, whether an unconsumed unexpired link exists, and the latest `R–` reference. It shows no personal data and allocates nothing; the operator still chooses the identifier.
7. **`SESSION_HASH_KEY` stays runtime-only session authority,** with its documented rotation effect narrowed: sessions, pre-auth, recovery sessions, and CSRF, but no longer establishment links.

**Deliberately not proposed:** no new secret, schema change, endpoint, admin role, DB function, or change to request, link, consumption, recovery, or suspension semantics.

---

## EFFECT ON EXISTING PRODUCTION STATE

| State | Effect |
|---|---|
| Sessions, pre-auth, CSRF, recovery sessions | None: `SESSION_HASH_KEY` unchanged and still used identically. |
| Passkeys | None. |
| Recovery codes | None (`RECOVERY_HASH_KEY`). |
| Rate-limit buckets | `enrollment` buckets keyed by the new hash start fresh; others unchanged. |
| Pending grants (legacy HMAC format) | Still valid through the transitional lookup until they expire or are consumed. |
| Migration 003 | Unchanged: acts on `expires_at` and is hash-independent. |
| Schema | Unchanged: no migration. `token_hash text UNIQUE` accepts the prefixed value. |
| `R–N3X58X` | Untouched; fulfilled only after the runtime change is live. |
| Database roles | Unchanged. `access_operator` already has every privilege the commands use. |

**Can this be fixed while the current release stays live and before fulfilling `R–N3X58X`?** Yes.
- The change is backward compatible and needs no migration.
- Nothing in Production must be altered first.
- Deploy the runtime before issuing any new-format grant: the live `ed32778` runtime accepts only HMAC-format grants.
- `R–N3X58X` simply waits, which the receipt allows ("PROBNAYA will write").

**Fallback if the request cannot wait:** option A (rotate `SESSION_HASH_KEY` to a value the operator keeps) works today with no code. It signs every holder out and ends open recovery sessions. Not recommended while C is a small change.

---

## MINIMAL IMPLEMENTATION PLAN

1. `lib/crypto.js`: `enrollmentGrantHash(token)` with the fixed domain string and prefix.
2. `lib/service.js`, `enrollmentOptions`: compute the new hash; `findGrant(new) ?? findGrant(legacy)`; rate-limit dimension on the new hash. Keep `tokenHash('enrollment', …)` only for the legacy lookup, marked for removal.
3. `lib/operator-config.js`: operator loader (profile, origin, verified `DATABASE_URL`, no keys).
4. `lib/postgres-store.js`:
   - `issueEnrollmentGrant(mode: 'new')` refuses an existing `operator_note` reference;
   - add `currentRole()` and a read-only `listHolders()`.
5. `scripts/create-enrollment.mjs`:
   - operator config instead of `loadConfig` and `AccessService`;
   - `enrollmentGrantHash`;
   - role check.
6. `scripts/set-holder-condition.mjs`, `scripts/prune-expired.mjs`: operator config and role check.
7. `scripts/list-holders.mjs` and an `npm run holders` script.
8. `lib/runtime.js` (dev seeding) and test helpers: the new hash.
9. Docs:
   - `docs/access-deployment-checklist.md`: operator credential is `access_operator` only; remove "production `SESSION_HASH_KEY`"; narrow the rotation note; document `holders`;
   - `docs/access-architecture.md`: grant representation, operator procedures;
   - `docs/access-threat-model.md`: minting authority equals the operator role; session key runtime-only; runtime role must be `access_runtime`;
   - `access/README.md`.
10. **Operational follow-up (separate, optional):** version the role grants (`roles.sql`) in the repository so the runtime/operator split this design relies on is reviewable.

---

## TESTS REQUIRED

- **Hash vector:** `enrollmentGrantHash` for a fixed token equals a committed expected value, starts with `sha256:`, and differs from the HMAC of the same token.
- **Establishment with a new-format grant:** options → WebAuthn → consumed → active; replay refused; expiry at 7 days refused.
- **Legacy compatibility:** a grant stored with `HMAC(SESSION_HASH_KEY, "enrollment:"+token)` still establishes; a legacy grant for a suspended holder is still refused.
- **Session key independence:** changing `SESSION_HASH_KEY` between issuance and establishment does not break a new-format grant, while existing sessions become invalid (documents the new rotation boundary).
- **Operator config:**
  - production loads with only `ACCESS_ENV=production` + verified `DATABASE_URL`;
  - refuses `sslmode=require` and libpq-only parameters;
  - refuses the memory store;
  - origin is the constant.
- **PostgreSQL, operator commands without any hash key in the environment:**
  - `create-enrollment --new` succeeds and prints a link that establishes through the production-profile handler;
  - `--new` with an already-used `R–` reference is refused and creates nothing;
  - `--reissue` still works;
  - `holder-condition suspend/reactivate` works (with 003 semantics);
  - `prune-expired` works.
- **Role check:** a connection as a role named `access_runtime` is refused before any write. Test with a disposable role in the test database.
- **`holders` output:** contains identifiers, conditions, dates, open-link flag, and `R–` references; no token hashes, no addresses.
- **Regression:** the full existing unit, handler, client, request, establishment, PostgreSQL lifecycle and concurrency suites, and migration 003 tests unchanged and passing.
- **Pre-release external check:** confirm Vercel `DATABASE_URL` connects as `access_runtime` (read-only `current_user`, through a one-off local check with the runtime URL the operator holds, or the role-setup smoke script).

---

## RELEASE / MIGRATION ORDER

1. Implement on a branch from `main` (`ed32778`), run all suites including PostgreSQL, and review.
2. No migration.
3. Merge to `main`. The Access deployment must reach READY before any new-format grant exists. Surface is unaffected (static files only).
4. Smoke test the runtime (anonymous `401`, PRESENT KEY with an existing key).
5. Operator, from a clean checkout of the deployed commit: `npm run holders`, then `create-enrollment --new … 'R–N3X58X'`, then send the link as a new message.
6. Requester establishes, which is the functional proof of the new hash path end to end.
7. After 7 days with no unconsumed legacy-format grants (check via `holders`, or a read-only query on the `sha256:` prefix), remove the legacy lookup in a small follow-up.

**Rollback:** reverting the runtime to `ed32778` would make new-format grants unverifiable. Before rolling back, reissue any outstanding links from an older CLI, which would again need the key, so in practice suspend and reissue after rolling forward. The window is small and involves one request.

---

## Operator experience after the fix

On a clean trusted machine with Node 24 and the password manager:

```bash
git clone git@github.com:probnaya-work/surface.git && cd surface/access
```

```bash
npm ci
```

Load the one operator credential, the Neon `access_operator` connection string with `sslmode=verify-full`, from the password manager at a hidden prompt:

```bash
read -rs "DATABASE_URL?access_operator URL: " && export DATABASE_URL ACCESS_ENV=production && echo
```

See what exists (read-only):

```bash
npm run holders
```

```
(illustrative output; Production contents not inspected)
connected as access_operator · https://access.probnaya.work
PROB–H–NNNN  active   2026-09-14  link: none   R–……
```

Choose the next identifier and establish the request:

```bash
npm run create-enrollment -- --new 'PROB–H–NNNN' 'R–N3X58X'
```

```
connected as access_operator
Created pending holder PROB–H–NNNN; the link closes 2026-09-22T…Z.
The next line is establishment authority. Send it once to the requester and keep no other copy.
https://access.probnaya.work/#establish=<43 characters>
```

Then:

```bash
unset DATABASE_URL
```

The operator writes a new plain message from `mail@probnaya.work` to the requester containing that one link. There is no Vercel secret to retrieve, no session key on the operator's machine, no dashboard, and no change to what the person sees.
