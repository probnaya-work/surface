# Access remediation — targeted adversarial re-review

Review date: 2026-09-14. Branch: `feat/access-production`. HEAD: `5da2825ea6fe7dd29542a2e274024092ea01183f`.

**IR-01, IR-02, IR-03, and IR-04 are closed for the PostgreSQL implementation with migration 002 installed, for the original exploit conditions.** The protection comes from database locks and transactional revalidation, not the regression tests' sleeps. However, this review found a separate **MEDIUM** gap in expiry enforcement after a lock wait, plus two **HARDENING** findings. This is not an unconditional release clearance.

The reviewed implementation is still untracked working-tree content; the HEAD alone does not identify it. This is a fresh adversarial validation in the existing task, not an assertion of organizational independence from the remediation author. The conclusions below come from inspecting the actual queries and running new probes, rather than accepting the remediation notes or earlier passing results.

## Evidence and scope

Inspected the six requested implementation/test files first, then migration 001, the migration runner, runtime/configuration, and the updated architecture, threat model, self-review, deployment checklist, and original independent review. Scope is the four reported races, their remediation, migration behavior, and directly related stale-authority/test-parity issues.

Executed the unchanged Access suite using `ACCESS_TEST_DATABASE_URL` against the existing disposable loopback PostgreSQL instance: **32/32 passed**, including all six PostgreSQL tests. Independently confirmed PostgreSQL **17.6**, **READ COMMITTED**. No production database or external deployment configuration was accessed.

A separate temporary harness executed 15 probes using the actual service, PostgreSQL store, and pinned WebAuthn verifier. It generated synthetic credentials with the existing virtual authenticator. For competing database transactions it observed `pg_blocking_pids`, rather than treating an elapsed sleep as evidence that a contender had reached its lock. It also exercised the memory store independently. Temporary SQL fixtures deliberately positioned authority near expiry; application queries, production durations, and verifier outcomes were not changed.

The harness is `/private/tmp/access-remediation-rereview.fCju9v/probe.mjs`. It created and dropped its own randomized schemas. Its final run verified SHA-256 equality for all 32 non-hidden Access files outside `node_modules` before and after execution. Only this report was added to the repository; no implementation, migration, existing test, configuration, or earlier review document was edited. The findings below retain the essential evidence without depending on the temporary harness remaining available.

## Prior finding verdicts

### IR-01 — HIGH: concurrent recovery completions

**Original exploit.** Two distinct codes from source set S create recovery sessions A and B. A consumes its session while its unlocked set check sees S active, then pauses. B commits a credential and replacement set S1. A resumes, updates the holder's currently active set rather than its original source, replaces S1, and commits a second credential and S2. Both callers report success.

**Remediation.** `postgres-store.js:49` implements `lockHolder` with `SELECT ... FOR UPDATE`. `completeRecovery` at line 342 acquires this lock before consuming recovery authority. It checks the exact session's `set_id` against an active set for that holder, returns that source ID, conditionally replaces only that source at line 359, requires exactly one affected row, consumes all outstanding holder recovery sessions, inserts the successor set, invalidates ordinary sessions, and audits within one transaction. A conflict throws and rolls back those mutations.

**Why it holds.** Both contenders must acquire the same holder lock. After the winner commits, the loser's subsequent statement receives a fresh READ COMMITTED snapshot and sees consumed recovery authority and a replaced source. The loser cannot silently target the successor set. If the first transaction rolls back, another valid contender can win; the invariant is one successful completion per source generation, not guaranteed success despite arbitrary database failures.

**Alternate schedules tested.** Two completions with an observed database lock wait produced one success, one failure, and exactly one added credential. Winner-key normal login succeeded; loser-key login failed; the winner's returned recovery codes worked; all old outstanding recovery sessions were consumed. Recovery versus authenticated set replacement was exercised in both lock orderings: the first operation succeeded and the later one failed its now-invalid authority. A recovery-begin request paused after its initial candidate lookup failed after another recovery replaced that candidate's source set. The initial lookup does not authorize consumption: the code/source check runs again after taking the holder lock.

**Regression quality.** `postgres-concurrency.test.js:191` asserts one success and two total credentials including the original. The original double-success schedule would violate both assertions if reached. It does not check winner-code usability or loser-key login, and its second contender is only given 100 ms to advance; see RR-03. The invariant itself does not depend on that timing.

**Verdict: CLOSED in PostgreSQL.**

### IR-02 — HIGH: rotation surviving recovery invalidation

**Original exploit.** Rotation locks/revokes predecessor T before inserting T2. Recovery's session UPDATE takes a snapshot before T2 exists and waits on T. Rotation commits T2; recovery skips now-revoked T, cannot discover T2 in that statement's old snapshot, and commits with T2 still usable.

**Remediation.** `rotateSession` at `postgres-store.js:245` acquires the holder lock before touching T. Recovery acquires that same lock before its invalidation statement. Session-creating authentication, presence, enrollment, key addition, and authenticated recovery-set replacement also use the holder lock; holder-wide revocation uses it as well.

**Why it holds.** If rotation owns the holder lock first, recovery cannot start the problematic session UPDATE until rotation commits; that later statement sees and revokes T2. If recovery owns the lock first, rotation subsequently finds its predecessor revoked and creates nothing. PostgreSQL gives each new READ COMMITTED statement a fresh snapshot; waiting on the holder is a separate statement from examining session authority. [PostgreSQL isolation semantics](https://www.postgresql.org/docs/17/transaction-iso.html).

**Alternate schedules tested/inspected.** The repository test passed with rotation first. The separate probe forced recovery first, observed rotation waiting on the database lock, then confirmed rotation returned `unauthorized`. Presence, add-key, and recovery-code replacement cannot preserve their predecessor session after recovery: each checks/revokes that exact predecessor under the same holder lock. `setSessionCsrf` does not acquire a holder row lock, but only updates an existing unrevoked session and never clears `revoked_at` or inserts a successor; it cannot restore a session revoked while its UPDATE waits. The previously reported GET availability issue is unchanged.

A new, independently verified login can serialize after recovery and create a session using a retained credential. That requires WebAuthn credential authority and is the already documented retained-credential policy, not survival of the stolen cookie in IR-02.

**Regression quality.** `postgres-concurrency.test.js:210` checks that the returned successor is rejected after recovery. Restoring the original race would make that assertion fail if recovery reaches invalidation before the pause is released. The fixed 100 ms wait does not guarantee that schedule. Also, recovery may legitimately revoke T2 before the first status call's separate CSRF update, causing the initial status call itself to reject; the test currently expects it to succeed. See RR-03.

**Verdict: CLOSED in PostgreSQL.** Expiry after a lock wait is a separate issue, RR-01.

### IR-03 — MEDIUM: credential revocation after logout

**Original exploit.** A revoke request passes service authorization, then stalls before the store call. Logout invalidates the session. Revocation resumes with only a holder/credential reference and commits without checking its authorizing session again.

**Remediation.** `service.js:377` now passes `authorizingSessionHash`. `revokeCredentialAndSessions` at `postgres-store.js:288` locks the active holder and calls `lockLiveSession` on that exact holder/token before locking active credentials, applying the last-key guard, changing the credential, invalidating sessions, and auditing. `completeLogout` at line 255 takes the holder lock before invalidating its exact session.

**Why it holds.** A logout that commits first leaves a revoked token that the later transaction cannot authorize. If revocation obtains the holder lock first, logout cannot invalidate its authorizing session until revocation commits or rolls back. Thus revocation cannot commit after logout has already invalidated that session. Request arrival order and response delivery order are not the serialization order.

**Alternate schedules tested/inspected.** The repository's explicit barrier after service authorization reproduces logout-first and rejects the queued revoke without removing a credential. The independent probe forced revoke-first, observed logout waiting, and confirmed revoke succeeded before logout was rejected because its session was already invalidated. Other holder/session invalidations and session rotations are ordered by the same lock. Recent-auth and expiry predicates exist, but use transaction-start time; RR-01 limits the broader claim of current authority at mutation time.

**Regression quality.** `postgres-concurrency.test.js:226` is a meaningful deterministic reproduction: it waits for the store-call barrier, awaits completed logout, then releases revocation. Removing the transactional session recheck while retaining other changes would make it fail. The equivalent invariant is not maintained by MemoryStore; see RR-02.

**Verdict: CLOSED in PostgreSQL for logout/revocation ordering.**

### IR-04 — MEDIUM: credential addition during suspension

**Original exploit.** Recovery begin/options/completion did not require an active holder. A code bearer could insert a credential while suspended and use it after reactivation.

**Remediation.** `beginRecovery` at `postgres-store.js:308` requires active condition under the holder lock. `getRecoverySession` at line 331 joins active holder and exact active source set. `service.js:432` checks active condition for options. `completeRecovery` rechecks active condition under the lock. Migration 002's trigger invalidates ordinary and recovery sessions when an active holder becomes non-active.

**Why it holds.** Suspension and completion contend on the holder row. Suspension-first forces completion to observe non-active condition; completion-first commits before suspension can take effect. The trigger's invalidation prevents old recovery sessions from becoming usable again after a committed suspend/reactivate cycle, even if the later completion sees an active holder. An options request racing suspension may still finish allocating a challenge, but that challenge cannot restore the invalidated recovery session or authorize credential insertion.

**Alternate schedules tested.** Repository tests rejected begin while suspended and completion contending with an uncommitted suspension. A separate probe paused after verification but before `completeRecovery`, committed suspended→active transitions in one transaction, and confirmed completion still failed with the original credential count unchanged. The populated-migration probe confirmed old recovery sessions remain invalid after reactivation, and rollback of a suspension transaction rolls back its invalidation as well.

**Regression quality.** `postgres-concurrency.test.js:246` detects the original suspended-begin acceptance. The test at line 255 covers concurrent suspension and reactivation, including loss of trigger invalidation; its failure cleanup has a hang risk described in RR-03. It does not independently test populated migration backfill.

**Verdict: CLOSED in PostgreSQL with migration 002 installed.** Unused recovery codes and existing credentials deliberately survive suspension; they may be used after reactivation. This differs from resurrection of a consumed recovery session and is not expanded into a new finding here.

## Additional findings

### RR-01 — MEDIUM: lock waits can outlive authority deadlines

**Affected code:** `postgres-store.js:55–71`, `212`, `248`, `276`, `349`, and `377`; request-time capture in `service.js:243` and `443`.

The new session checks compare expiry and recent verification with `CURRENT_TIMESTAMP`. In PostgreSQL this is the start of the transaction, including when that transaction then spends time waiting for the holder lock. It is not the time of the later session query. Recovery completion is weaker in this respect: `expires_at > date(now)` uses a value captured in the service before verification/store execution. [PostgreSQL time-function semantics](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

**Verified sequence:** prepare a valid recent session with two credentials and position one relevant cutoff one second in the future. Hold the holder row in a separate transaction without changing authority state. Start a real service revocation request and observe its PostgreSQL backend blocked on that lock. Wait past the cutoff, release the holder, and observe successful committed revocation. Repeat separately for idle expiry, absolute expiry, and the five-minute recent-auth deadline. All three accepted the mutation after the cutoff. A fourth probe positioned the recovery-session expiry one second ahead and used a valid registration: recovery similarly committed a new credential after the recovery session had expired.

This models a request made during the final valid second; the fixture changes only synthetic timestamps to avoid waiting through full production lifetimes. The waiting transaction does not edit/revoke the token, so the original IR-03 logout check is not bypassed. A token already expired when service authorization starts still fails. Exploitation requires previously valid authority and a sufficiently delayed request/contended database; this review does not claim a remote caller can arbitrarily hold a SQL lock or obtain an indefinitely reusable expired cookie.

**Impact:** expiry and recent-verification deadlines do not bound when a queued destructive credential operation or recovery insertion may be authorized. The newly introduced holder queue makes the distinction between transaction-start time and post-lock time material. This is a residual defect in the remediation's stated commit-time authorization guarantee, not reopening the four original state-invalidation exploits. No reviewed repository test crosses an authority deadline while waiting on the holder lock. The four separate probes establish the gap despite the 32 passing tests.

**Required property for closure:** re-evaluate the relevant authority deadline against current time after acquiring the necessary authorization locks. Merely adding another `CURRENT_TIMESTAMP` comparison inside the same long-running transaction does not accomplish that. No fix was made in this review.

### RR-02 — HARDENING: memory-store parity claims exceed its behavior

**Affected code:** `memory-store.js:153–167`, `186–210`; production prohibition at `config.js:26–29`.

Two independent service probes establish differences relevant to the remediation:

- Revocation validates its authorizing session, then awaits `listCredentials`. Pausing at that await, completing logout, and resuming allows revocation to succeed. The PostgreSQL IR-03 protection is therefore not reproduced by the memory implementation.
- MemoryStore has no equivalent suspension trigger or condition-transition API. Changing its holder to suspended makes lookups fail, but changing it back to active restores an unconsumed recovery session and an existing ordinary session. The probe demonstrated recovery-session resurrection followed by successful credential insertion after reactivation.

These observations qualify testing/development parity, not production exploitation: production configuration expressly rejects MemoryStore. Additional source differences remain: first enrollment does not recheck pending condition or grant-holder ownership; successful memory recovery leaves competing sessions unconsumed but ineffective through the source-set mismatch; its rate-limit window/block ordering differs. Several of these were already noted in the first review. There is no basis to promote them to a production HIGH/MEDIUM finding.

**Consequence:** close IR-03 and IR-04 specifically for PostgreSQL, not for every store implementation. Memory-based unit tests cannot substantiate the database concurrency claims.

### RR-03 — HARDENING: concurrency tests do not fully establish their intended schedules

**Affected code:** `postgres-concurrency.test.js:104–123`, `191–223`, `255–275`.

The suite genuinely runs PostgreSQL and its assertions are useful, but calling all schedules deterministic is too strong:

- IR-01/IR-02 release their first transaction after 100 ms without proving that the other backend reached the vulnerable statement or relevant lock. A slow contender can run sequentially and let a reintroduced race pass. In IR-01 the `secondState` value is only assertion-message text, not an asserted synchronization condition.
- IR-02 assumes initial status must return a successor, although recovery can correctly invalidate that successor before status's later CSRF write. This can make a secure ordering fail the test.
- IR-04 asserts the contender is blocked before releasing the suspension barrier. If a regression makes it settle early, that assertion throws without releasing the transaction; teardown waits for open stores. The hooks have no bounded timeout/finally release. Likewise, changing the SQL text used by a pause predicate can leave `pause.hit` waiting forever.
- Migration idempotence is tested on empty tables and by trigger count, not by preservation/invalidation of populated authority. The extra populated-state and actual-lock-wait checks in this re-review are temporary probes, not maintained repository regression tests.

These weaknesses affect detection and reproducibility; they do not replace or weaken the actual holder-lock invariant. Test sensitivity above is based on source/interleaving analysis and the independent probes. No implementation mutants were installed or claimed to have been tested.

## Migration 002 and locking assessment

The migration wraps function replacement, trigger installation, and both backfills in one transaction. It adds no tables or columns and does not delete credentials or codes. With the existing 001 schema, populated-database probes verified:

| Case | Observed result |
|---|---|
| Already-suspended holder with ordinary/recovery sessions | Both invalidated on migration application |
| Active holder with ordinary/recovery sessions | Both preserved |
| Reapply migration | Succeeds; prior invalidation timestamp unchanged |
| Reactivate migrated suspended holder | Old ordinary/recovery sessions remain invalid |
| Roll back active→suspended transaction | Holder condition and session invalidation both roll back |
| Commit active→suspended→active in one transaction | Recovery authority remains consumed |
| Concurrent condition update while migration is open | Blocks behind the migration's holder-table lock |

An observed `AccessExclusiveLock` on `access_holders` is held by this migration until commit. This prevents condition changes from racing the backfills, but also blocks holder-table access while potentially large scans/updates run. It is not a nonblocking online migration. No statement or lock timeout is set by the migration runner. Reapplication is data-idempotent, not operationally free. Trigger errors roll back the triggering condition update rather than silently leaving a suspended holder with partially invalidated authority.

The trigger executes in its caller's transaction and acquires holder→ordinary sessions→recovery sessions. Application authority mutations first lock the holder. Their differing orders for subordinate recovery/session rows therefore cannot form the original same-holder deadlock cycle: only one holds subordinate authority locks at a time. `setSessionCsrf` can hold a session row without the holder row, but it does not subsequently acquire a holder row lock, so it does not supply the reverse edge. Ceremony consumption and rate-limit transactions finish before the authority transaction. No new application-path deadlock was established by inspection or these probes. Arbitrary operator SQL with an opposite lock order, mixed old/new runtimes, or unrelated cross-holder administrative transactions are not covered by that conclusion. [PostgreSQL locking rules](https://www.postgresql.org/docs/17/explicit-locking.html).

Serialization does increase contention for one holder. WebAuthn verification happens before the holder transaction, so it does not hold that lock while waiting for user verification or doing cryptographic work. However, there is no configured lock/statement timeout, and recovery-session invalidation lacks a holder index in migration 001. Large retained tables or a stalled transaction can delay other authority changes and suspension. No practical starvation exploit or materially greater impact for IR-07 was established; this remains a capacity/retention limit, not an additional release-blocking finding.

Migration 002 cannot identify or remove a credential already planted under the old IR-04 bug, and deliberately does not invalidate unused codes. An existing database exposed to the vulnerable version therefore needs its historical credential state assessed before reactivation; invalidating sessions alone is not forensic repair. This is a limitation of the migration's scope, not evidence that it inserts or resurrects credentials. Reverting to an old runtime that ignores holder locks is not safe merely because the schema remains compatible.

## Documentation and final disposition

The updated self-review and architecture correctly describe exact-source recovery replacement, holder-first state serialization, transactional logout ordering, and suspension invalidation. Their broader claims of current expiry/recent-auth authority inside the transaction need the qualification in RR-01. Their unqualified deterministic-test wording needs RR-03, and any store-parity implication needs RR-02. The new recovery-session source-set lookup also removes the previously noted ability of replaced recovery authority to keep obtaining options; it does not implement IR-07's missing rate limits.

The permanent RP ID/origin and existing IR-05, IR-07, and deployment risks were not changed or reclassified. No new CRITICAL or HIGH finding was established. The four original PostgreSQL exploits are closed, but **RR-01 remains a new MEDIUM finding**; RR-02 and RR-03 are HARDENING. An unconditional statement that no MEDIUM issue remains would be inaccurate. Implementation remains frozen; this review stops at findings.

## RR-01 implementation follow-up

Follow-up date: 2026-09-14.

RR-01 is now corrected in the PostgreSQL implementation. After acquiring the existing holder row lock, presence completion, session rotation, key addition, key revocation, recovery completion, and authenticated recovery-set replacement evaluate idle-session expiry, absolute-session expiry, recent-auth expiry, or recovery-session expiry with PostgreSQL `clock_timestamp()`. Request-captured timestamps remain in use for the records and audit events created by the operation. The holder-first lock order and existing serialization boundaries are unchanged.

The permanent PostgreSQL regression tests position each of the four authority deadlines, observe the protected operation waiting on the holder lock through `pg_blocking_pids`, cross the deadline, release the lock, and assert that the queued mutation is rejected without changing credential state.

Final verification against the existing disposable loopback PostgreSQL 17.6 instance:

- PostgreSQL Access tests: **11/11 passed** (including the three session-deadline subtests).
- Full Access suite: **37/37 passed**.
- Repository test suite: **96/96 passed**.
- JavaScript syntax checks: **43/43 files passed**.
- `git diff --check`: passed.
