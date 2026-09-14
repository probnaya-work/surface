# Independent adversarial review of PROBNAYA Access

Review date: 2026-09-14. Branch: `feat/access-production`. HEAD: `5da2825ea6fe7dd29542a2e274024092ea01183f`.

**Decision: do not release this implementation unchanged. Two HIGH findings undermine recovery's security boundary.** The review also identified two MEDIUM authorization issues, one LOW availability/CSRF issue, and three HARDENING findings. No CRITICAL vulnerability was established. These are application findings, independent of dependency advisory counts.

The reviewed `access/` directory and the five supplied security documents were **untracked working-tree files**, not content committed at the HEAD above. Existing modifications elsewhere in the working tree were present before this review. Only this report was added to the repository by the reviewer; the implementation, migrations, configuration, and tests were not edited.

## Scope and evidence

I first read the implementation, migration, route dispatcher, runtime configuration, client, and operator scripts, and reconstructed the state transitions below. I then compared that reconstruction with all five requested documents. I also inspected the installed pinned WebAuthn verifier and PostgreSQL driver's transaction/TLS behavior rather than assuming the wrappers guaranteed those properties.

Verification performed:

- Ran the existing Access suite on Node `v24.14.0`: **25/25 passed**.
- Applied the actual migration to a disposable, loopback-only PostgreSQL **17.6** database, using synthetic holders, grants, credentials, sessions, and recovery codes. Verified its isolation level was **READ COMMITTED**.
- Executed the actual `AccessService`, `PostgresStore`, and real SimpleWebAuthn verifier against that database. The existing virtual authenticator generated registration data and signed assertions. Twelve additional SQL/service probes completed, including both successful attacks and controls that resisted them.
- For races, an external harness paused calls between actual SQL statements; it did not change query text, constraints, verifier outcomes, or implementation files. Separate pools represented concurrent function invocations. These are deterministic demonstrations of possible interleavings, not measurements of production exploitation probability.
- Invoked the real API handler with synthetic requests to verify the omitted-CSRF behavior, foreign-Origin GET mutation, and rejection of foreign-Origin POSTs.
- Confirmed the shipped browser asset is byte-identical to the installed pinned browser bundle.

The temporary evidence is in `/private/tmp/access-independent-review/`: `probe.mjs`, `probe-results.txt`, `http-probe.mjs`, and `reviewed-files.sha256`. The sorted SHA-256 manifest covers 36 Access/document files, excluding `node_modules`; its SHA-256 is `add07f25c516b8dfca73fd7e37933ad1e75ac606ce5783c358185d0791e346c6`. These temporary files are not repository changes. The essential schedules and results are recorded below so the report does not depend on temporary-file retention.

No production database, DNS, Vercel settings, real account, or real recovery material was accessed or changed. Provider-specific pooler behavior, production routing/headers, and physical-browser/authenticator compatibility remain unverified.

## Architecture reconstructed from the implementation

### Boundary, authority, and storage

`access/vercel.json` defines a separate static project with a single API dispatcher, `/api/access` → `/api/access.js`, and public HTML/CSS/JS assets. The handler checks exact Host for every request and exact Origin for POST. Production configuration fixes origin to `https://access.probnaya.work` and RP ID to `access.probnaya.work`; it does not derive them from requests. Development/test fixes RP ID to `localhost` and requires an explicit HTTP localhost origin.

There are three distinct browser authorities: preauthentication binding, ordinary session, and recovery session. Each has a separate token-hashing purpose and cookie name. Production cookies have `__Host-`, `Path=/`, `Secure`, `HttpOnly`, and `SameSite=Strict`, without `Domain`. Ordinary and recovery CSRF values are returned in JSON and kept in client memory. Ordinary tokens themselves are only put into cookies by the handler.

The operator script creates a pending holder, random stable WebAuthn user handle, and a 256-bit, 24-hour enrollment grant. The grant's hash is stored; the raw grant prints to the operator's stdout. Possession of that grant is the entire first-enrollment authority. There is no public identifier-based enrollment, password, email login, role-management endpoint, or arbitrary redirect destination.

The migration creates holders, credentials, ceremonies, ordinary sessions, grants, recovery sets/codes/sessions, rate-limit buckets, and audit events. Global credential-ID uniqueness prevents inserting the same canonical credential into another holder. A partial unique index permits at most one unreplaced recovery set per holder. Foreign keys enforce references, but do not enforce all cross-table holder consistency or authorization conditions. Audit writes are coupled to successful mutation transactions; the schema does not itself enforce append-only audit access.

### Every API endpoint and authentication-state transition

All action names below are POSTs to `/api/access`, except GET status. All POSTs also require the exact Origin and JSON envelope `{action,data}`. References are to the reviewed source line numbers.

| Endpoint/action | Authority and verification | Durable transition / review result |
|---|---|---|
| GET status | Ordinary cookie; active holder; idle/absolute expiry (`service.js:243–291`) | Refreshes idle expiry and replaces CSRF on every call; after 15 minutes revokes predecessor and inserts successor. No Origin/CSRF check. IR-02, IR-05. |
| `authentication-options` | No identity input; network/binding limits (`111–117`) | Creates five-minute `authentication` challenge bound to preauth cookie; discoverable login. |
| `authentication-verify` | Preauth binding, purpose, challenge, active credential/holder, exact user handle, signature/UP/UV/origin/RP (`119–159`) | Consumes ceremony first; then counter compare/update, fresh ordinary session, audit in one transaction. Existing ordinary sessions are not automatically logged out. |
| `enrollment-options` | Valid unconsumed grant, pending holder; network/grant limits (`161–177`) | Creates `first-registration` ceremony referencing grant and holder; returns holder-specific registration options. |
| `enrollment-verify` | Bound `first-registration`, registration verifier (`179–217`) | Consumes ceremony; transaction consumes still-valid grant, inserts credential, changes pending→active, issues session and ten recovery codes, audits. Duplicate/condition conflicts roll back the transaction. |
| `presence-options` | Ordinary session; supplied CSRF checked; network/holder limit (`293–299`) | Creates `verify-presence` ceremony bound to current session hash, with that holder's active credential allowlist. |
| `presence-verify` | Current session, bound ceremony, active credential owned by session holder, signature/UP/UV/origin/RP (`301–342`) | Consumes ceremony; transaction revokes old session, compares/updates credential counter, inserts successor with fresh verification time and audit. |
| `add-key-options` | Ordinary session with verification within five minutes (`345–352`) | Creates `add-key` ceremony. No application rate limit here. |
| `add-key-verify` | Recent session, bound `add-key`, valid registration (`354–373`) | Consumes ceremony; transaction revokes predecessor, inserts globally unique credential and successor session, audit. No application rate limit. |
| `revoke-key` | Recent session; opaque management ref (`375–382`) | Locks holder's active credentials, refuses last-credential removal, revokes target and all visible ordinary sessions, audits. Does not pass authorizing session to transaction. IR-03. |
| `replace-recovery-codes` | Recent session (`384–392`) | Transaction revokes predecessor, replaces active recovery set, consumes outstanding recovery sessions, issues successor ordinary session, audit. No application rate limit. |
| `recovery-begin` | One unused code; network limit (`401–420`) | Transaction marks code used, creates ten-minute recovery-only session, audits. No active-holder check. No ordinary session is issued. IR-04. |
| `recovery-registration-options` | Unexpired/unconsumed recovery session and required CSRF (`422–438`) | Creates bound `recovery-registration`. Does not check holder condition or whether issuing set is still active; no rate limit. |
| `recovery-registration-verify` | Recovery session+CSRF; bound purpose/challenge; valid registration (`440–463`) | Consumes ceremony; transaction consumes recovery session if its set appears active, inserts key, replaces whole code set, invalidates visible ordinary sessions, audits. Issues no ordinary session. IR-01, IR-02, IR-04. |
| `logout` | Ordinary session (`394–399`) | Transaction revokes that token and audits; response expires cookie. It does not revoke all the holder's sessions or cancel recovery sessions. |

Ordinary mutation CSRF checks are **optional when the header is omitted**, despite the intended contract. Recovery-session CSRF checks are mandatory. Neither a client-supplied holder ID nor a credential management ref alone authorizes a mutation.

Ordinary sessions have 30-minute idle and eight-hour absolute expiry; successors preserve the original absolute deadline. Only GET status refreshes idle time and performs periodic rotation. The browser does not periodically call status, and other API activity does not update `lastActiveAt`. A five-minute recent-auth window is shared by privileged operations; normal login and enrollment also open that window. It is not a separate, action-bound verification grant.

### Full recovery state machine and interruption behavior

1. **Unused code in active set:** any bearer can submit it. Codes contain 160 random bits; no public holder ID is required. A successful transaction marks this code used and creates one recovery session. Simultaneous submissions of the same code have one winner, as verified on PostgreSQL.
2. **Recovery session issued:** token is in an HttpOnly cookie; its CSRF is only in the JSON response and the local `recover()` call. Ordinary access is unavailable through this token. Other ordinary sessions and all old credentials remain valid at this stage.
3. **Registration options:** the session can create multiple distinct challenges until expiry. Each is five minutes, purpose-bound, and tied to the recovery token hash. Repeated options calls do not consume the recovery session.
4. **Registration attempt:** structurally valid verification consumes the challenge before cryptography. Invalid verification cannot reuse that challenge but can request another while the recovery session is valid. Validation errors occurring before `consumeCeremony` do not consume it.
5. **Commit:** new credential, recovery-session consumption, replacement code set, ordinary-session invalidation, and audits commit together. The originating code remains used independently of this later transaction. A duplicate-credential conflict rolls back this transaction, leaving the recovery session usable with a fresh ceremony; this was tested.
6. **After success:** old credentials are deliberately retained; normal login is required. The client clears ordinary/recovery cookies and displays new codes. Other recovery sessions from the old set are not marked consumed by `completeRecovery`. Sequential completion using one of them is rejected by the set check, but it can still obtain options, and concurrent completion can bypass the intended set transition (IR-01).
7. **Authenticated code replacement:** unlike recovery completion, `replaceRecoverySetAndRotate` explicitly consumes outstanding recovery sessions. Set replacement and competing recovery statements use inconsistent lock order and may deadlock or conflict; they do not constitute a general serialization protocol.

Interruption matters at each boundary. Losing the `recovery-begin` response burns a code without delivering usable authority. Cancelling the authenticator after begin also burns the code; the UI starts over with `recovery-begin` on retry and does not retain/resume the existing recovery CSRF. Reloading loses that CSRF. Losing the final response leaves the newly committed key usable, but the newly issued plaintext recovery codes unavailable. None of these failures safely permits replaying the consumed code or challenge. See the architectural risks below for the availability consequence.

## Verified vulnerabilities

### IR-01 — HIGH: stale recovery authority can complete after another recovery and replace its new codes

**Exact path:** `AccessService.recoveryRegistrationVerify`, `access/lib/service.js:440–462`; `PostgresStore.completeRecovery`, `access/lib/postgres-store.js:288–308`, particularly the unlocked `EXISTS` set check at 295–298 followed by the holder-wide set update at 304. The unique active-set index is `access/migrations/001_access.sql:77`.

**Prerequisites:** attacker obtained a valid code from the victim's old recovery set and began recovery before the legitimate recovery completed. Attacker can supply their own valid registration. The legitimate holder completes recovery with another code from that same set. No database access is required by the attack; the test harness only controls scheduling to reproduce the race deterministically.

**Concrete sequence:**

| Order | Attacker request A | Legitimate request B |
|---|---|---|
| 1 | Consumes recovery session A at SQL 291–300; `EXISTS` observes old set S active. Pause before inserting credential/updating sets. | |
| 2 | | Consumes session B, inserts legitimate key, replaces S with S1, invalidates ordinary sessions, commits; returns S1 codes. |
| 3 | Resumes; inserts attacker key. SQL 304 starts with a fresh snapshot, finds **S1**, and replaces it. Inserts S2 and commits. | |
| 4 | Authenticates with attacker key and holds S2 codes. | The newly returned S1 codes no longer work. |

**Impact:** recovery does not extinguish in-flight authority from the compromised set. An attacker can obtain persistent account control after the holder's recovery reports success and silently invalidate the replacement codes just issued to the holder. This is not reuse of the same plaintext code: two different codes and recovery sessions from one generation are involved.

**Evidence / existing tests:** reproduced with actual PostgreSQL methods; both completion calls succeeded, both keys persisted, a code returned by B failed, and attacker-key normal authentication succeeded. The partial unique index does not stop the sequence: A explicitly replaces S1 before inserting S2. The existing recovery tests use one session at a time and MemoryStore; none should be expected to detect this SQL interleaving. They do not justify concurrency assurance.

**Minimal remediation:** serialize recovery begin/completion and set replacement on a stable per-holder database lock, acquired before reading or modifying recovery authority; recheck holder condition and the exact source set under that lock. Replace only the verified source set and require one affected row. Consume/invalidate all outstanding recovery sessions when completing recovery. Every competing path must obey the same lock protocol; a lone extra `SELECT` is insufficient. Alternatively use serializable transactions with bounded, whole-operation retry and explicit authority revalidation.

### IR-02 — HIGH: concurrent rotation preserves a stolen session across recovery's all-session invalidation

**Exact path:** GET handler `access/api/access.js:31–40`; `AccessService.status`, `access/lib/service.js:255–269`; `PostgresStore.rotateSession`, `access/lib/postgres-store.js:215–220`; recovery invalidation at `postgres-store.js:306`; session lookup at 197–203.

**Prerequisites:** attacker possesses an ordinary session cookie; its session is due for rotation and is otherwise valid. Holder performs recovery to invalidate existing sessions. The attacker needs no authenticator or recovery code for this attack.

**Concrete sequence:**

1. Attacker's GET status enters `rotateSession`, marks old session T revoked, and holds its row lock before inserting the successor.
2. Holder's recovery transaction reaches `UPDATE access_sessions ... WHERE holder_id = H AND revoked_at IS NULL`. Its statement snapshot sees T, and it waits on T's row lock.
3. Rotation inserts T2 and commits. Recovery resumes, sees T now revoked and skips it. T2 was not visible when the invalidation statement began and is not added to that statement's target rows.
4. Recovery commits successfully. Attacker retains the returned T2 cookie and GET status accepts it afterward.

**Impact:** successful recovery fails to remove a stolen ordinary session. Existing access survives until subsequent invalidation or the preserved eight-hour absolute deadline. The surviving token does not become newly recent-authenticated through rotation, so this reproduction alone does not demonstrate credential addition from an already stale session.

**Evidence / existing tests:** reproduced while observing the actual recovery SQL blocked on a PostgreSQL lock. After both calls succeeded, a new status call using T2 succeeded. The existing test checks that one preexisting token fails after sequential recovery; it does not race creation of a successor. The rotation test is also sequential.

**Minimal remediation:** serialize all ordinary-session creation/rotation and holder-wide invalidation using the same stable holder lock. Include login, presence, add-key, recovery-set replacement, and recovery in the protocol. A durable holder authentication/session epoch checked on every request can also make invalidation reject all prior-generation successors. Adding another bulk UPDATE without synchronization does not close the race. Do not assume credential-revocation locking and recovery locking are equivalent.

### IR-03 — MEDIUM: credential revocation can commit using authority already invalidated by logout

**Exact path:** `access/lib/service.js:375–380` validates the session before calling the store, but `PostgresStore.revokeCredentialAndSessions`, `access/lib/postgres-store.js:250–260`, receives no session token/hash and cannot revalidate it.

**Prerequisites:** attacker can send a revocation request from a recently authenticated session before it is invalidated; the holder has at least two active credentials when the eventual mutation runs. The attacker knows a management ref, available from authenticated status.

**Concrete sequence:** send a valid `revoke-key` request; let its `authenticated()` check complete; pause/delay it before the store transaction. Logout successfully revokes its session. Resume revocation: the transaction checks only target ownership and remaining credential count and revokes the key successfully. An already queued request can similarly outlive other session-invalidating operations.

**Impact:** logout/invalidation is not a reliable boundary for stopping pending destructive credential actions. This attack does not bypass the last-credential guard or establish arbitrary account takeover; its demonstrated impact is unauthorized removal of an additional access path after authority was revoked.

**Evidence / existing tests:** reproduced against PostgreSQL by delaying the store call, completing logout, then allowing revocation to commit. The existing logout test checks only a later status lookup. The revocation test does not invalidate its authorizing session between check and commit.

**Minimal remediation:** pass the authorizing session hash into the mutation transaction and revalidate live session, holder condition, expiry, and recent-auth authority under the common holder/session lock order. Couple that authority check with target revocation and invalidation. Use database/current transaction time when enforcing the commit-time authority cutoff.

### IR-04 — MEDIUM: recovery can add credentials to a suspended holder

**Exact path:** `access/lib/service.js:401–462`; `PostgresStore.beginRecovery` at `access/lib/postgres-store.js:268–280`, `getRecoverySession` at 283–285, and `completeRecovery` at 288–308. None requires `access_holders.condition = 'active'`. In contrast, ordinary authentication explicitly checks active condition at `service.js:133`, and ordinary session lookup joins active holders at `postgres-store.js:199–201`.

**Prerequisites:** operator suspends a holder; attacker possesses one of that holder's unused recovery codes, or an already issued recovery session. Later reactivation is needed for ordinary access. No public suspension/reactivation endpoint exists in this implementation.

**Concrete sequence:** suspend the holder; attacker begins recovery, obtains options, and completes registration with an attacker-controlled key. Recovery rotates codes and returns success even while the holder is suspended. When an operator later restores `active`, attacker authenticates with that key.

**Impact:** suspension blocks ordinary login but does not freeze the authentication configuration. A credential and replacement recovery set can be planted during suspension. It does **not** immediately override suspended status or permit access while suspension remains in effect. Severity assumes suspension is an incident-containment state, consistent with the ordinary-login controls; if credential changes during suspension are intentional, that exceptional policy needs explicit approval and documentation.

**Evidence / existing tests:** reproduced credential insertion during suspension, rejection of immediate login, and successful attacker login after synthetic reactivation. No existing test exercises a suspended holder or transition into/out of suspension.

**Minimal remediation:** require active holder condition under the same holder lock in recovery begin, options authorization, and completion. Suspension should invalidate outstanding ordinary/recovery authority and specify how reactivation handles credentials changed during the incident.

### IR-05 — LOW: same-site cross-origin GETs can invalidate the legitimate UI's CSRF state

**Exact path:** `access/api/access.js:31–40` reaches status before the POST-only Origin check at 48; `access/lib/service.js:267–269` replaces CSRF on every GET; `access/lib/postgres-store.js:206–211` also extends idle expiry.

**Prerequisites:** victim is logged in and visits an attacker-controlled HTTPS page on `probnaya.work` or a sibling subdomain. The attacker need not read or set the host-only Access cookie. Different subdomains can be same-site while still being different origins; `SameSite=Strict` does not mean same-origin. [Cookie semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

**Concrete sequence:** sibling-page script sends a simple GET, for example `fetch('https://access.probnaya.work/api/access', {mode:'no-cors', credentials:'include'})`. The browser may attach the destination's host-only cookie. The handler rotates the server CSRF hash without checking the initiating origin. The legitimate tab retains its prior CSRF value and its next authenticated mutation fails. Repetition can continue disrupting privileged UI actions and refreshing idle activity. CORS/CORP can deny response access but do not undo the server-side update.

**Impact:** CSRF against session bookkeeping, producing availability disruption; no response disclosure or account takeover was established. Legitimate concurrent tabs can trigger the same CSRF desynchronization without an attacker.

**Evidence / existing tests:** the real handler accepted a foreign-Origin GET and replaced CSRF; a POST with the formerly valid CSRF then returned 403. This verifies server behavior; the production sibling-origin browser sequence was not exercised against deployed hosts. Existing tests cover only the standalone POST-Origin helper and do not call the GET dispatcher.

**Minimal remediation:** make GET status read-only with stable CSRF state. Perform renewal/activity mutation through a protected POST, or enforce same-origin fetch metadata and an appropriate request token for mutation. Preserve a defined concurrent-tab/response-order policy.

## HARDENING findings: verified gaps without a demonstrated independent takeover

### IR-06 — HARDENING: omitted ordinary-session CSRF header disables its check

1. **Path:** `access/api/access.js:52`; `access/lib/service.js:243–250`, especially `csrf !== undefined && ...`.
2. **Prerequisites:** request already satisfies session and exact-Origin requirements; recent verification is also required for privileged mutations.
3. **Sequence:** send `replace-recovery-codes` with a recent cookie and the expected Origin, but omit `X-PROBNAYA-CSRF`. It returns ten new codes and rotates the session. A wrong supplied value fails, whereas no value succeeds.
4. **Impact:** the documented synchronizer-token defense is absent on omission. Exact Origin plus JSON enforcement still blocks ordinary cross-origin POST attacks, and XSS or a stolen cookie can obtain CSRF via GET anyway. Therefore this is not presented as a standalone cross-site takeover.
5. **Tests:** reproduced through both service and real handler. The test titled “credential enrollment and revocation require session, CSRF, and recent presence” only tries a wrong token, not an absent one. It should have tested both. Foreign-Origin POST rejection was independently confirmed.
6. **Minimal remediation:** distinguish read-only session lookup from mutation authentication; require a bounded string CSRF value on every ordinary authenticated POST, including presence and logout. Keep exact-Origin checking.

### IR-07 — HARDENING: several credential/recovery paths have no application rate limit

1. **Path:** `access/lib/service.js:345–391` and `430–462`; limit key construction at 82–90; handler GET at `access/api/access.js:31`.
2. **Prerequisites:** recent ordinary session for repeated add-key options, or a valid recovery session for repeated recovery-registration options. GET status needs only a live ordinary cookie.
3. **Sequence:** repeatedly request add-key/recovery-registration options with a valid token. Every call creates another persisted ceremony. Neither path calls `limit`; GETs also create repeated database activity without an application limit. A recovery token whose set was replaced by another recovery can still obtain options until it expires.
4. **Impact:** missing documented abuse controls and unbounded challenge creation within the authority window. Capacity exhaustion was not load-tested, so no proven production DoS or brute-force takeover is claimed. Network+binding/holder keys are composite, not independent cross-network holder limits; IPv6/source distribution can obtain additional buckets. Code entropy still makes guessing infeasible.
5. **Tests:** existing rate-limit coverage exercises sequential recovery-begin failures only. It cannot verify credential-mutation limits that do not exist. Direct source inspection establishes the gap.
6. **Minimal remediation:** bound options/verification and mutation rates per holder/session as well as network; cap outstanding ceremonies and configure bounded retention. Test each dispatcher action and shared limits across independent PostgreSQL connections. Define recovery-token invalidation before allocating more options.

### IR-08 — HARDENING: claimed signature-counter anomaly auditing is unreachable with the pinned verifier

1. **Path:** `access/lib/service.js:138–154` and `309–325`; `access/lib/webauthn.js:57–70`; installed `@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.js:186–192`.
2. **Prerequisites:** stored positive counter and a signed assertion with an equal/lower counter, such as a clone or problematic authenticator state.
3. **Sequence:** the library throws for non-increasing counters before returning. The service converts it into generic failure, never reaching its positive-counter anomaly calculation or audit insertion.
4. **Impact:** no authentication bypass; the implementation rejects more strictly than the architecture describes and provides no claimed anomaly event. Detection/compatibility assumptions and deployment alerting based on that event are misleading.
5. **Tests:** reproduced rejection and zero anomaly events. The suite tests a synthetic stale counter write after verification, not a real positive counter regression through the library.
6. **Minimal remediation:** document the actual pinned-library policy and add a real regression-counter test. If an observation-only policy is deliberately chosen, design signature-verified anomaly handling explicitly; do not simply suppress verifier errors or treat an unverified assertion as evidence of a clone.

## SQL atomicity, locking, and serverless conclusions

Transactions are real: `postgres` `sql.begin` reserves a connection and rolls back thrown errors. Parameterized templates are used for request-derived values. The migration script's single-connection SQL execution handles its explicit BEGIN/COMMIT. Serverless process memory is not used for production authorities or rate limits.

However, **transactional all-or-nothing writes do not serialize competing authorization decisions**. No transaction isolation override or shared holder lock is used in the application. PostgreSQL's default READ COMMITTED gives each statement a new snapshot; a locking UPDATE does not automatically acquire locks on unrelated rows examined by its subquery or protect future matching inserts. The concrete failures here were reproduced, not inferred solely from the documentation. [PostgreSQL isolation reference](https://www.postgresql.org/docs/18/transaction-iso.html), [explicit locking reference](https://www.postgresql.org/docs/17/explicit-locking.html).

| Property | Result |
|---|---|
| One-shot challenge consumption | Atomic conditional UPDATE binds id+purpose+browser/session hash+expiry. Concurrent same-challenge probe had one winner; wrong binding/purpose did not consume the correct authority. |
| First-enrollment transaction | Conditional grant consumption, globally unique credential insertion, conditional pending→active update, session/recovery/audit writes are coupled. Failures throw for rollback. No unauthorized grantless first enrollment established. Multi-grant and interrupted enrollment still need full integration regression coverage. |
| Same-code recovery race | Conditional update of the code row permits one winner. Verified with separate pools. |
| Duplicate recovery credential | Conflict returns no inserted row, throws, and rolls back recovery-session consumption and set mutation. Verified. Challenge remains consumed separately by design. |
| One active recovery set | Partial unique index enforces row-level uniqueness, but does not prove that the winning transaction had authority over the generation it replaced. IR-01. |
| Last-credential guard | PostgreSQL locks the active credential rows in stable ID order. Parallel two-key revocation produced one winner and one remaining credential. Do not extrapolate MemoryStore behavior to this SQL lock protocol. |
| Counter update | Compare-and-update rejects a changed expected counter and revoked credential. Zero→zero counters do not serialize all successful assertions, nor should they substitute for challenge replay protection. |
| Successor sessions vs invalidation | No universal generation/holder lock. Recovery bulk invalidation misses concurrent successor rows. IR-02. |
| Mutation authority after precheck | Some transactions CAS the authorizing session's `revoked_at`, but revoke-key does not. None is a comprehensive commit-time active-holder/recent-auth protocol. IR-03/IR-04. |
| Recovery replacement lock order | Replacement touches ordinary session→set→recovery sessions; recovery completion touches recovery session→set→ordinary sessions. Opposite order can deadlock. Abort rolls back, but there is no bounded deadlock/serialization retry policy, and previously consumed ceremonies remain consumed. |
| Rate-limit row | PostgreSQL inserts bucket if absent, locks it, checks block, updates counter in one transaction. Multiple function processes share it. Host/proxy trust and distributed identity are separate questions. |

The tests used a local database, not the eventual hosted provider. Five connections **per runtime instance** is not a global connection cap. `prepare: true`, pooler mode, transaction affinity, TLS, latency, statement/lock timeouts, and failure handling must be verified for that provider. Merely enabling a database product with “transactions” does not repair these query schedules.

## Architectural risks and deployment assumptions, not additional proven vulnerabilities

### Recovery retries can exhaust the remaining access path

`access/public/app.js:114–133` begins a new recovery on every submit and keeps the recovery CSRF only inside that call. If the last available code is accepted and the authenticator is cancelled, a response is lost, or the page reloads, the user may have neither a usable authenticator nor resumable recovery authority. An intermediary able only to interrupt traffic can cause availability loss without decrypting it; ordinary cancellation is sufficient too. Existing tests establish single-use, not successful resumption. This is a recovery availability/design risk, not evidence of an attacker guessing/reusing a code. Retain resumable, same-browser limited authority with a defined secure CSRF restoration path; never restore the consumed plaintext code to reusable status. Document response-loss semantics for every one-time issuance.

### Recovery retains potentially compromised credentials

`completeRecovery` inserts a credential but revokes no old credential. The UI says “Replace a lost path,” but the database operation adds a path. If an old credential was compromised rather than lost, its owner can authenticate again after recovery, independent of IR-02. This behavior is documented in the architecture's last-path policy and is therefore an architectural incident-response limitation, not an undisclosed verifier bypass. Recovery instructions must distinguish lost-device recovery from compromise containment and provide a deliberate way to retire compromised credentials without removing the final viable path.

### Recent authentication is reusable authority; XSS can exploit that window

The client always invokes `verifyPresence()` before add/revoke/replace, but the server only requires `lastVerifiedAt` within five minutes. A stolen recently verified cookie or same-origin script execution can call recovery-code replacement immediately; a script can also request attacker-controlled registration without repeating an existing-key assertion for that particular change. WebAuthn UV on a newly supplied credential does not prove the victim approved adding it. This is within the implemented recent-auth policy, and the threat model acknowledges compromised-browser risk. No injection sink was found in the Access client: holder/label/code rendering uses `textContent`, scripts are static, and no client-controlled redirect exists. For stronger containment, use short-lived, one-operation authorization bound to the intended mutation and an existing credential, and keep it independent of general login freshness.

### Production database TLS is an operational gate, not enforced fail-closed in code

`access/lib/config.js:53–55` requires a database URL but does not validate transport policy; `postgres-store.js:100` does not set `ssl`. The pinned driver defaults to plaintext when no TLS option is supplied, and its `sslmode=require` path disables certificate verification (`node_modules/postgres/src/connection.js:283–284`). A network attacker would need access to the database transport path and an insecure deployment before this becomes exploitable; no deployed transport was inspected. The checklist correctly requires encrypted transport **and certificate validation**. Do not equate an arbitrary supplied URL or `sslmode=require` with that requirement. Verify a certificate-validating provider configuration and reject incompatible production settings.

### Proxy identity, environment scoping, and deployment surface remain assumptions

`clientNetwork` trusts `x-vercel-forwarded-for`, then `x-forwarded-for`, then the socket. Vercel documents forwarded-header sanitization, so an attacker-supplied header in a synthetic request is not proof of a production Vercel bypass. Outside that edge boundary, or behind incorrectly configured proxies, choosing the header can create arbitrary rate-limit buckets. Verify this on the actual ingress and remove untrusted fallbacks for production. [Vercel request-header contract](https://vercel.com/docs/headers/request-headers).

Production's origin/RP constants and memory-store rejection are sound. Selecting development/test on a publicly reachable server would accept only localhost Host/Origin and use development cookies; it does not broaden production to arbitrary origins. It still must not share the production database or secrets: an attacker using a raw HTTP client can supply localhost headers and construct registrations for the development RP. No `VERCEL_ENV`/`NODE_ENV` guard enforces environment/data separation. This is a deployment assumption, not a demonstrated failure of the intended production profile.

The reviewed root project has no `.vercelignore` deployment allowlist, and root `vercel.json` is separate from `access/vercel.json`. The access project root, published file set, direct function aliases, security headers, HSTS, custom domain, preview protection, and reconciliation with `main` must be checked before deployment. The branch divergence remains four commits on this branch and five on `main`. I did not assume the older audit's live public-site header observations describe current Access production.

### Enumeration and logging limits

Usernameless login exposes no identifier lookup form. Valid grant/recovery authority intentionally discloses holder-specific registration options. Unknown credential and invalid signature paths have different database/cryptographic work, but no practical remote credential enumeration oracle was established; credential IDs and handles are not short public usernames. Malformed input does not always receive the identical message claimed in the architecture: validation can return `REQUEST COULD NOT BE PROCESSED`. That is input-shape differentiation, not proof of user enumeration.

Successful operations write safe audit metadata, and the handler suppresses caught internal errors. Failed authentication/recovery attempts do not write corresponding durable audit events. Thus failure-rate alerting cannot be assumed to come from this audit table. The operator's raw enrollment token is intentionally printed once; whether terminals, CI output, support tools, or request logging retain it remains an operational concern. No actual committed secret or secret-bearing application log statement was identified in the reviewed Access source. Code display/input values remain in the live DOM until cleared/reloaded; later same-origin script compromise can read that DOM, consistent with the XSS trust boundary.

## Comparison with the supplied documents

| Document | Verified agreement | Corrections or limits |
|---|---|---|
| `docs/access-system-audit.md` | Describes the pre-Access static site and the need for durable authentication storage; branch divergence is still observable. | Its “no auth/database/schema” statements are historical baseline claims, not descriptions of the new untracked Access directory. Live public-site headers/deployment observations were not re-certified. |
| `docs/access-threat-model.md` | Correct exact origin/RP, host-only cookies, random one-use challenges/codes, no email/password root, text rendering, and explicit XSS/operator/provider assumptions. | “No GET mutation” is false. Mandatory synchronizer CSRF is false on omission. Atomicity does not guarantee recovery/set/session serialization. Suspension recovery is omitted. |
| `docs/access-architecture.md` | Broad data model, separate project, grant bootstrap, real verifier, timings, recovery-only token and later normal login match code. | Counter-observation policy differs from pinned verifier; mutation limits are missing; rotation is only performed on GET; presence uses a holder credential allowlist rather than being fully usernameless; labels are required, not optional; an in-flight predecessor-authorized revoke does not invariably fail closed. |
| `docs/access-security-review.md` | Corrected rollback handling and last-credential refusal are real; sequential rotation/invalidation and the stated 25 tests reproduce. Its warning about absent live PostgreSQL testing was accurate before this review. | Its concurrency, coupled-mutation, CSRF, and anomaly conclusions overreach the exercised evidence. Real SQL probes demonstrate two HIGH races despite all existing tests passing. Dependency audit results do not strengthen those guarantees. |
| `docs/access-deployment-checklist.md` | Appropriately requires exact boundary, provider validation, TLS, production isolation, concurrency testing, independent review, and resolving HIGH/CRITICAL findings. | The provider concurrency suite it calls for is not in the repository. Header/proxy sanitization, certificate verification, app/root published files, failure telemetry, and recovery resumption need explicit verification. The independent-review gate is performed here; remediation and production gates remain open. |

## Test-suite false confidence and missing adversarial cases

All existing service tests instantiate **MemoryStore**. There are no repository PostgreSQL integration tests. Async method signatures do not make a Map an MVCC/locking simulator. Its semantics also differ from production: `completeFirstRegistration` does not recheck pending holder condition or grant holder ownership; memory rate limits reset an expired window before honoring a longer block, unlike SQL; memory revocation awaits an unlocked credential list; and whole-set replacement in a Map cannot model READ COMMITTED snapshots or SQL uniqueness/deadlocks.

The following regression work is needed before security claims can be relied upon:

| Claimed property | What existing tests actually exercise | Missing adversarial cases |
|---|---|---|
| CSRF required | Wrong token passed to one service call; standalone Origin helper | Header absent/null/array; real handler for every mutation; GET from sibling; concurrent tabs and reversed response order. |
| Recovery is single-use / replaces old authority | One code used twice sequentially; one successful recovery | Same-code parallelism, different codes in same set, two completions, begin vs replacement, completion vs replacement, stale options, both transaction orderings. |
| All sessions invalidated | One previously created token checked after recovery/revocation | Rotation/login/presence/add-key in flight; successor rows; authorizing session revoked between lookup and mutation. |
| Transactional rollback | Primarily Map final states; injected expected-counter change | Duplicate IDs, failed inserts/audits, mid-transaction database errors, lost commit acknowledgment, deadlocks, unique-index conflict, retry with consumed ceremony. |
| Last credential cannot be removed | One-key sequential refusal | Two simultaneous revocations, revocation vs add/recovery, suspended holder and ownership changes. Local SQL two-key probe passed, but needs a committed regression. |
| Exact WebAuthn boundary | Mostly localhost assertion rejection; production constant equality | Registration-side wrong origin/RP/challenge/type/UP/UV; production-origin cryptographic fixtures; cross-purpose/binding swaps; revoked credential during verification; malformed CBOR/extension payloads; cross-origin client-data cases. |
| Cross-user safety | Unknown credential; changing owner in a Map before presence verification | Two real enrolled holders, cross-holder management refs, user-handle mismatch at login, duplicate registration IDs across holders, holder condition changes during transactions. |
| Session expiry/rotation | Renewal after 15 minutes and recent-auth timeout | Idle and absolute expiry independently, preserved absolute bound through all rotations, crossing expiry while a request waits, concurrent renewal, response loss and predecessor cookie recovery. |
| Recovery usable after interruption | No cancellation/response-loss/browser tests | Last-code cancellation, begin response lost before/after Set-Cookie, reload, retry same ceremony, final response lost, conflicting parallel browser submissions. |
| Counters and anomalies | Stale counter injected between verify and complete | Real equal/lower positive counter, zero/synced counters, backup flag transitions, verified anomaly events vs unauthenticated noise. |
| Rate limits/abuse | Sequential recovery failures from one string network | PostgreSQL shared buckets, longer block across window boundary, changing binding/IP, trusted ingress sanitization, every action's limits, pending ceremony/storage bounds. |
| Suspension / incident response | Not exercised | Recovery begun or completed during suspension; suspend mid-request; reactivation with pending attacker key; recovery with compromised old credential. |

The independent SQL probes establish the reported local behaviors; they are not a substitute for maintaining these tests in the repository or rerunning them against the selected provider. No implementation fixes are included in this report.

## Post-review remediation

Remediation date: 2026-09-14. This section records later repository changes; it does not alter the independent review's original evidence or release decision for the reviewed snapshot.

| Finding | Remediation | Repository regression coverage |
|---|---|---|
| IR-01 (HIGH) | Holder-scoped authority mutations now serialize on `access_holders ... FOR UPDATE`. Recovery completion conditionally consumes its exact session/source-set pair, replaces that exact set once, and consumes all other outstanding recovery sessions. | `access/test/postgres-concurrency.test.js` — `IR-01: concurrent recovery completion has exactly one valid winner`. |
| IR-02 (HIGH) | Session rotation and recovery completion use the same holder-first lock order. Rotation revalidates and revokes its predecessor inside that transaction; recovery invalidates every ordinary session before commit. | `access/test/postgres-concurrency.test.js` — `IR-02: recovery invalidation defeats concurrent session rotation`. |
| IR-03 (MEDIUM) | Credential revocation receives the exact authorizing session hash and revalidates that session's live, unrevoked, recent state inside the holder-locked transaction. Logout uses the same holder-first order. | `access/test/postgres-concurrency.test.js` — `IR-03: logout invalidation prevents a queued credential revocation`. |
| IR-04 (MEDIUM) | Recovery begin, lookup/options, and completion require an active holder. Migration `002_holder_authority.sql` invalidates ordinary and recovery sessions on suspension; invalid authority is not resurrected by reactivation. | `access/test/postgres-concurrency.test.js` — both IR-04 tests, covering suspension before begin and between options and completion. |

The migration is idempotence-tested and performs forward cleanup for live authority already associated with non-active holders. The same remediation pass requires omitted ordinary-session CSRF values to fail (IR-06) and adds a real-verifier positive counter-regression test documenting that the pinned verifier rejects before service-level anomaly auditing (IR-08). IR-05 (LOW) and IR-07 (HARDENING) remain open and are not release-blocking HIGH/MEDIUM findings from this review.
