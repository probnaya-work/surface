# Access enrollment — forensic investigation

Status: investigation only. No code, configuration, or data was changed. Nothing is committed.
Examined: branch `design/interior-access-integration` at `e50eaf4` (the integrated Access + Interior release), its git history, the untracked `design/observation.md` and `design/participatory-publishing.md`, `laboratory/ROADMAP.md`, and the local Claude Code session transcripts that mention Access. The production database was not inspected, so whether any grant has ever been issued in production is unknown.

Trigger: on a device with no PROBNAYA passkey, `access.probnaya.work` → PRESENT KEY → ESTABLISH ACCESS shows *Issue the first key.*, the text "An operator-issued enrollment grant is required.", an ENROLLMENT GRANT field, KEY LABEL, and CREATE PASSKEY. The screenshot matches `access/public/index.html:33-45` exactly.

---

## Short answers

| # | Question | Answer |
|---|---|---|
| 1 | First-time flow | An operator runs a CLI against the production database. It creates a `pending` holder and prints a grant. The grant reaches the person by some channel the repository does not define. The person pastes it into ESTABLISH ACCESS and registers a passkey. The holder becomes `active`, gets a session and recovery codes, and lands in the Interior. |
| 2 | Enrollment grant | A 256-bit random bearer token. Only its HMAC is stored, in `access_enrollment_grants`. It is created only by `scripts/create-enrollment.mjs`, is single-use, expires after 24 h, and can register the *first* credential of *one specific pending* holder. It is the sole authority for creating a relation. |
| 3 | Holder creation | Only `PostgresStore.issueEnrollmentGrant` (`access/lib/postgres-store.js:141`), reached only from the operator CLI. No HTTP route creates a holder. |
| 4 | Can an ordinary person establish access without an operator grant? | **No.** |
| 5 | Invite-only: requirement or emergent? | No explicit product requirement to gate enrollment exists anywhere in the repository or in the available transcripts. It first appears as an assumed prerequisite ("a pre-authorized holder") in the pre-implementation audit. It was then built as a security mechanism and carried forward into every later document. Later design documents treat it as settled product fact. |
| 6 | Why "ENROLLMENT GRANT" is in the UI | It was placed there deliberately, with wording copied from the implementation. No product-level decision about user-facing terminology or how a person gets a grant was ever made. In practice, an internal bootstrap primitive is showing up in the interface. |
| 7 | Test assumptions | Every test that reaches an authenticated holder starts from a holder and grant inserted directly into the store. No test starts from a person with nothing. |
| 8 | Holder model elsewhere | The sources disagree. Access docs say "pre-authorized holder". The roadmap's RECORD V1 and membership direction imply that a person can *enter* PROBNAYA and receive issued objects. Recent untracked design work assumes invitation. |
| 9 | Dependent invariants | Holder creation authority, identifier allocation, Sybil/abuse control, the pending→active transaction, per-grant rate limiting, the "failures don't reveal existence" objective, the reactivation path, and the entire local/dev and test harness. Details below. |
| 10 | Assessment | Production is consistent with the Access documents but not with any recorded product decision. We have built a gated registration system without deciding, as a product matter, that PROBNAYA is invitation-only. The deployment checklist also says the operator procedure that would make that gate workable was never approved. |

---

## 1. The complete first-time enrollment flow as implemented

### 1a. Off-product: the operator (the only way a holder comes into existence)

1. An operator with production `DATABASE_URL` and `SESSION_HASH_KEY` runs
   `npm run create-enrollment -- 'PROB–H–…' ['note']` (`access/scripts/create-enrollment.mjs`).
   - The operator **chooses the public identifier**. It must match `^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$` (script line 12, schema check `001_access.sql:5`).
   - The script refuses the in-memory store (line 19), so it only runs against PostgreSQL.
2. The script generates `randomToken()` = 32 random bytes, base64url (`lib/crypto.js:3`). It computes `HMAC-SHA256(SESSION_HASH_KEY, "enrollment:" + token)` (`service.tokenHash`, `lib/service.js:32`) and calls `store.issueEnrollmentGrant` (`lib/postgres-store.js:141-160`), which runs one transaction:
   - `SELECT … FROM access_holders WHERE public_id = … FOR UPDATE`.
   - If no holder exists, it inserts one with `condition = 'pending'` and a fresh random `webauthn_user_id`.
   - If the holder exists and is `active` or `suspended`, it refuses (`issued: false`).
   - If the holder exists and is `pending`, it force-expires every unconsumed grant for that holder.
   - It inserts the grant row (hash, `expires_at = now + 24h`, optional `operator_note`) and an `enrollment-grant-issued` audit event with outcome `operator`.
3. The plaintext grant is printed **once** to stdout. The holder and grant exist only in the database.
4. **Delivery to the person is undefined.** The architecture says: "delivered out of band by an operator. The code deliberately does not choose that delivery channel. Enabling production enrollment requires a human-approved delivery/identity-proofing procedure." (`docs/access-architecture.md:97`). The deployment checklist item "Approve the operator identity-proofing and out-of-band delivery procedure for first-enrollment grants" (`docs/access-deployment-checklist.md:15`) is unchecked, as is every item in that file.

### 1b. In-product: the person

5. Public PROBNAYA → header **ENTER** (`js/site.js`, `enter()`) → `https://access.probnaya.work/`.
6. Entry view: **PRESENT KEY**, with quiet links **ESTABLISH ACCESS** and **RECOVER ACCESS** (`access/public/index.html:22-30`).
7. ESTABLISH ACCESS → view `establish` (`app.js:391`): *Issue the first key.*, "An operator-issued enrollment grant is required.", inputs `grant` and `label` (default `PRIMARY PASSKEY`) (`index.html:33-45`). Nothing on the page says where a grant comes from, and nothing links to intake or any request path.
8. Submit → `establish(form)` (`app.js:196-221`) → `POST /api/access` action `enrollment-options` with `{ grant, label }`.
9. Server `AccessService.enrollmentOptions` (`lib/service.js:168-184`):
   - Checks the payload is exactly `{grant, label}`. The grant must be base64url ≤ 256 characters, otherwise a generic 400.
   - Rate limits: `enrollment-network` 20 per window per network (10-minute block), and `enrollment` 8 per window per grant-hash + network.
   - `store.findGrant(hash, now)`: unconsumed and unexpired, otherwise `enrollment_failed` / "ACCESS COULD NOT BE VERIFIED".
   - Holder must exist and be `pending`, otherwise the same generic failure.
   - Builds WebAuthn registration options for that holder (`lib/webauthn.js:11-30`): `userName = userDisplayName = PROB–H–…`, `residentKey: required`, `userVerification: required`, attestation `none`.
   - Creates a `first-registration` ceremony (5-minute TTL) bound to a fresh pre-auth cookie, with `holderId` and `referenceId = grant.id`.
   - The handler sets `__Host-probnaya_preauth` (max-age 300) and returns `{ceremonyId, options}` (`api/access.js:96-100`).
10. The browser/OS passkey sheet creates a discoverable credential named `PROB–H–…` under RP `access.probnaya.work`.
11. `enrollment-verify` → `AccessService.enrollmentVerify` (`lib/service.js:186-224`):
    - Requires the pre-auth cookie. Consumes the ceremony atomically before cryptographic verification (one-shot).
    - Verifies the registration (challenge, origin, RP ID, UV).
    - `store.completeFirstRegistration` (`postgres-store.js:235-252`), in one transaction:
      - lock holder where `pending`;
      - consume the grant (`id` and `holder_id` match, unconsumed, unexpired);
      - insert credential;
      - `pending → active`;
      - insert session;
      - insert recovery set of 10 codes;
      - audit `first-credential-enrolled` and `recovery-set-issued`.
    - Any conflict rolls the whole transaction back to a generic failure.
12. The handler sets the session cookie and expires the pre-auth cookie. It returns `holder.publicId`, `csrf`, and plaintext recovery codes (`api/access.js:101-108`).
13. The client shows **RECOVERY CODES / Store these once.** The person clicks I HAVE STORED THESE, and Access replaces itself with `https://probnaya.work/interior/` (`app.js:375`; `docs/access-architecture.md:238`).
14. Interior reads `GET /api/relation` and renders the first-entry state (`design/interior-integration.md`, *First-entry state*).

If the confirmation response is lost after the key was created, the grant is already consumed. The person must PRESENT KEY and then replace their recovery codes (`app.js:36,214-216`; tested in `postgres-lifecycle.test.js:147-162`).

---

## 2. What an enrollment grant is, technically

| Property | Evidence |
|---|---|
| **Form** | 32 random bytes, base64url, 43 chars (`crypto.js:3`, `create-enrollment.mjs:22`). A pure bearer token: it is not bound to a browser, email, device, or network. |
| **Created by** | `scripts/create-enrollment.mjs` → `PostgresStore.issueEnrollmentGrant`. Test/dev only: `store.seedHolder` via `lib/runtime.js:17-36` when the memory store and `ACCESS_DEV_ENROLLMENT_TOKEN` are set, and directly in tests. |
| **Who can create it** | Whoever can run Node against the production database with production `SESSION_HASH_KEY` (`docs/access-deployment-checklist.md:46`). There is no HTTP route, admin UI, or role. `api/access.js:17-33` lists every action, and none issues grants. Production startup rejects the dev token variables (`lib/config.js:91-93`) and the memory store (`config.js:64-65`). |
| **Stored** | `access_enrollment_grants(id, holder_id, token_hash UNIQUE, created_at, expires_at, consumed_at, operator_note)` (`migrations/001_access.sql:61-69`). Only the keyed hash is stored. `prune-expired` never deletes grants (`postgres-store.js:186-196`). |
| **Authority conferred** | Exactly one thing: the right to start and complete a `first-registration` ceremony for the one `pending` holder the grant references. It cannot open an `active` or `suspended` holder: `service.js:178` and `issueEnrollmentGrant` refuse ("a grant is never a way into an established record", `postgres-store.js:137-140`). It carries no role, content, or permission beyond that. A successful use yields a full session and recovery codes. |
| **Single-use** | Yes. Consumed in the commit transaction (`postgres-store.js:239-240`). Reuse returns 400 (`handler.test.js:82`; `postgres-lifecycle.test.js:161`). Issuing a new grant for the same pending holder expires older ones (`postgres-store.js:153`; `postgres-lifecycle.test.js:131-145`). |
| **Expiry** | `ENROLLMENT_GRANT_MS = 24h` (`lib/constants.js:13`). Checked when options are requested and again at commit. Rotating `SESSION_HASH_KEY` invalidates every outstanding grant. |
| **Security property it provides** | Stated in `docs/access-architecture.md:97`: "bootstraps the first passkey for a pre-authorized holder". In effect it provides: (a) holder creation is not a public write; (b) the link between a real person and a `PROB–H` record is established by an operator out of band, which the docs call identity-proofing; (c) the first credential cannot be attached to an existing record by anyone holding only public information. The independent review summarises it: "Possession of that grant is the entire first-enrollment authority. There is no public identifier-based enrollment…" (`docs/access-independent-security-review.md:34`). |

---

## 3. How a new holder is created

There is exactly one production path:

```
operator shell
  └─ node access/scripts/create-enrollment.mjs 'PROB–H–XXXX' [note]
       └─ PostgresStore.issueEnrollmentGrant()        access/lib/postgres-store.js:141
            └─ INSERT INTO access_holders (… 'pending' …)   line 147
```

Prerequisites:
- production database credentials and `SESSION_HASH_KEY`;
- an operator-chosen, unused `PROB–H–` identifier;
- PostgreSQL (the script refuses memory).

Every other `INSERT INTO access_holders` is `PostgresStore.seedHolder` (`postgres-store.js:130-135`). It is called only from tests and from `lib/runtime.js` under `config.memory`, which production forbids. `MemoryStore.seedHolder` and `holders.set` in `service.test.js:134` are test-only.

A holder created this way is `pending` and has no credential. It becomes `active` only through `completeFirstRegistration`.

---

## 4. Can an ordinary person establish access without an operator-created grant?

**No.**

- The only public route that can produce a first credential, `enrollment-options`, fails unless `findGrant` returns an unconsumed, unexpired grant whose holder is `pending` (`lib/service.js:175-178`).
- `enrollment-verify` cannot be reached without a `first-registration` ceremony, which only `enrollment-options` creates. Its commit also requires the grant row (`postgres-store.js:238-240`).
- No action in `api/access.js:17-33` creates a holder. `add-key-*` requires an authenticated session plus recent presence. `recovery-*` requires a recovery code for an already `active` holder (`service.js:484`).
- Production configuration refuses `ACCESS_DEV_ENROLLMENT_TOKEN` / `ACCESS_DEV_PUBLIC_ID` and the memory store (`config.js:64-65, 91-93`; `config.test.js:24-35`).
- The independent review found "No unauthorized grantless first enrollment established." (`docs/access-independent-security-review.md:198`).

Test evidence is indirect. Negative grant cases cover a consumed grant (`handler.test.js:82`, `postgres-lifecycle.test.js:161`), a replaced grant (`postgres-lifecycle.test.js:136`), and a grant for a suspended holder (`postgres-lifecycle.test.js:291`). **No test submits a never-issued or empty grant.** The "no" rests on code inspection of the single route, not on a dedicated test.

Separately from the code, the grant cannot be obtained from inside the product either. No page links to a request path, and the delivery procedure is unapproved (checklist line 15).

---

## 5. Was operator-mediated enrollment an explicit product requirement?

### Chronology

| When | Source | What it says | Classification |
|---|---|---|---|
| 2026-09-06 | `laboratory/ROADMAP.md` (`4afaea1`), *LATER — PROB–H / LABORATORY RECORD* | "Goal: give a person a permanent identity and record inside PROBNAYA." "ability to recover previously issued/purchased objects". *RECORD V1*: "a person can enter PROBNAYA, receive an issued object, retain it…". *Membership*: "membership opens more of the laboratory rather than closing the laboratory". | **Product direction.** It says nothing about who may become a holder. If anything it implies purchase/issue-driven entry, not invitation. It is not a requirement either way. |
| 2026-09-14 | `surface-auth-presence` `7c0ffd6`, `design/authenticated-presence.md` | "as though the laboratory has registered a holder at its edge". Visual only; no enrollment model. | Neither. |
| 2026-09-14 (pre-implementation) | `docs/access-system-audit.md:106,110` (landed in `03af401`) | Under *Authentication infrastructure required*: "Schema … for … enrollment grants" and "6. A production enrollment process for issuing the first passkey to a **pre-authorized holder**." | **Assumption.** This is the earliest appearance. It is stated as an infrastructure need, not traced to any product source. The audit found no identity schema of any kind (line 34), so "pre-authorized" was not derived from existing product behaviour. |
| 2026-09-14 22:10 | `03af401 feat(access): add production passkey boundary`: code, migration, `create-enrollment.mjs`, UI, and all Access docs in one commit | Architecture §`access_enrollment_grants` and *First passkey / ESTABLISH ACCESS* step 1: "Operator creates a pending holder and one-time enrollment grant outside the public UI." Threat model: "laboratory operator → first-enrollment grant delivery" as a trust boundary (`:42`), and assumption "The operator has a safe out-of-band way to deliver a first-enrollment grant" (`:106`). UI string "An operator-issued enrollment grant is required." | **Security design decision.** A deliberate, well-reasoned bootstrap. It keeps holder creation off the public attack surface and puts identity-proofing with a human. The documents explicitly defer the human half: "Enabling production enrollment requires a human-approved delivery/identity-proofing procedure." |
| 2026-09-14 | `76b772f feat(access): add holder operator commands`; `docs/access-security-review.md` PC-08 | Fixes a stranded pending holder after an expired grant; adds replacement grants and suspension tooling. | **Implementation consequence.** Operational hardening of the grant model, treating it as given. |
| 2026-09-14 22:10 | `f6b3b15 feat(interior): prototype recognized holder journey`, `design/interior-integration.md` | "ENTER … does not presume whether a relation already exists." "**ESTABLISH ACCESS** for a person holding an operator-issued enrollment grant". "SIGN UP, REGISTER, and CREATE ACCOUNT would describe a generic software account rather than the PROBNAYA relation; ESTABLISH ACCESS remains visible where its grant and first passkey can be understood." | **Vocabulary decision plus inherited assumption.** It rejects *sign-up language*, which is a tone decision. It does not decide *who may enter*. It takes the grant from Access as given. |
| 2026-09-15 00:18 | `834346e docs(interior): record the integrated Access and Interior journey` | Drops the "person holding an operator-issued grant" bullet and the SIGN UP rationale. First entry becomes "Access / ESTABLISH ACCESS / enrollment grant / CREATE PASSKEY", and ENTER is "for anyone Access does not recognize". | **Implementation consequence.** The integrated journey sends *anyone* to a screen only grant holders can use. The one sentence that named the precondition was removed. |
| 2026-09-15 (untracked) | `design/participatory-publishing.md:184`; `design/observation.md:392,533` | "**Five, invited.** An invitation is an enrolment grant". "Still by invitation". "If enrolment ever opens … Access both change character." | **Assumption promoted to premise.** These documents read the implementation back as institutional policy. |

### Transcripts (outside the repository, for completeness)

Searches of local Claude Code session transcripts for "enrollment grant", "pre-authorized holder", "ESTABLISH ACCESS", "PRESENT KEY", and "invite-only" return only three sessions: *WebAuthn Access production completion*, *Authenticated PROBNAYA release candidate*, and *Participatory publishing form*. All of them started after the Access design and documents already existed. They quote the documents rather than originate the requirement. Whatever brief originally produced the Access design is not in the repository or in these transcripts.

### Conclusion for Q5

- **Explicit product requirement:** none found.
- **Security design decision:** yes. Operator-issued, single-use grant bootstrap with out-of-band identity-proofing, `03af401`.
- **Implementation consequence:** the public UI exposes the grant field. ENTER routes every unrecognised visitor to it, and the integration docs dropped the precondition.
- **Assumption:** "pre-authorized holder" in `docs/access-system-audit.md:110`, never traced to a product source. Later design work assumes invitation because the system already behaves that way.

---

## 6. Why ENROLLMENT GRANT is exposed in the production UI

It was put there on purpose by the security design, and it is correct *for that design's intended user*: a person who has already been handed a grant by an operator. The architecture writes "Person presents the grant through the Access enrollment surface" (`access-architecture.md:121`). `f6b3b15` explicitly kept ESTABLISH ACCESS "visible where its grant and first passkey can be understood."

It was never designed as product terminology for a general audience:
- The label is the database/API noun (`access_enrollment_grants`, payload key `grant`, action `enrollment-options`).
- The page gives no source for a grant, no request path, and no explanation of "operator".
- The ENTER path presents ESTABLISH ACCESS to "anyone Access does not recognize" (`interior-integration.md`), a population the grant model never assumed.
- An empty submission fails validation, and an unknown grant returns the generic "ACCESS COULD NOT BE VERIFIED". A person without a grant cannot tell whether they typed it wrong or were never meant to be here.

Assessment: the wording is an **internal bootstrap primitive surfacing unmediated**. It became user-facing because the security layer's operator-to-person handoff was never given a product layer (an invitation, a letter, a link, a request path). The grant is visible and nothing surrounds it.

---

## 7. What the tests assume about first-time users

Every suite constructs the same world:

> "A holder `PROB–H–TEST` already exists in `pending`. A grant string is already known to the test. A browser with a virtual authenticator posts that grant with label PRIMARY PASSKEY, registers, receives ten recovery codes and a session."

- `test/service.test.js:19-31`: `fixture()` + `seed()` insert holder and grant directly; `enroll()` calls `enrollmentOptions({grant})` → `enrollmentVerify`.
- `test/handler.test.js:12-27`: the same through the production-profile handler (`enrolledBrowser()`).
- `test/relation.test.js:14-26`: the same, for `PROB–H–0142`, to exercise the Interior read.
- `test/postgres-concurrency.test.js:77-100`: `seedHolder` then enroll.
- `test/postgres-lifecycle.test.js:65-75, 113-162, 282-294`: the only suite that uses the real operator path, `store.issueEnrollmentGrant`. It covers creation, replacement, refusal for active/suspended holders, response loss, and reactivation to pending.
- `test/browser-harness.js:120-124`: `enroll(authenticator, grant)`, where the grant is a required argument.
- Local verification in `design/interior-integration.md` (*Local run*, *Rendered verification*) and the dev launch configs use `ACCESS_DEV_ENROLLMENT_TOKEN` / `ACCESS_DEV_PUBLIC_ID` to seed a named holder.

In plain language, the tested journey is: **an operator has already decided this person is `PROB–H–XXXX` and handed them a code.** No test models a person arriving at ENTER with nothing, and none checks what such a person sees. The production journey in the deployment checklist ("first enrollment → Interior on production hosts", line 74; "Create the intended holder and one-time grant … under the approved operator procedure", line 80) also starts from an operator.

---

## 8. Relation to the holder model and the Interior

**Indicating holders are pre-authorized, invited, or issued by PROBNAYA:**
- `docs/access-system-audit.md:110`, `docs/access-architecture.md:97`: "pre-authorized holder".
- `docs/access-threat-model.md:42,106`: operator delivers the first grant.
- `docs/access-deployment-checklist.md:78-84`: *Controlled first enrollment*, "Create the intended holder".
- The operator chooses the `PROB–H` identifier (`create-enrollment.mjs:11-13`). The identifier is issued, not requested.
- The institutional register: "The `PROB–` prefix marks what PROBNAYA issues" (`participatory-publishing.md:7`). Under that reading, a `PROB–H` identifier is an issued mark.
- `design/participatory-publishing.md:184-188` and `design/observation.md:392,533-536` (untracked, later) assume invitation and treat opening enrolment as a future change that would alter Access's character.

**Indicating anyone should be able to establish a relation, or at least not ruling it out:**
- `laboratory/ROADMAP.md`, *RECORD V1*: "a person can enter PROBNAYA, receive an issued object, retain it in a permanent laboratory record". *PROB–H*: "ability to recover previously issued/purchased objects". Purchase (MPA–01 via Stripe Checkout, `api/machine-portrait.js`) is open to anyone, and the roadmap wants purchased objects attached to a holder.
- `laboratory/ROADMAP.md`, *Membership*: "membership opens more of the laboratory rather than closing the laboratory". Membership is paid, which implies a self-directed act, though it is explicitly deferred.
- `design/interior-integration.md` (current): ENTER is shown "for anyone Access does not recognize"; `f6b3b15` said ENTER "does not presume whether a relation already exists".
- `design/interior-take.md`: the Interior is "what changed because PROBNAYA recognized this person". Recognition, not approval, is its framing.

**The Interior itself** has no dependency on how a holder was created. It reads `holder.publicId`, `establishedAt` (first credential's `issuedAt`), key count, recovery, and last verification (`service.js:283-299`). Nothing in `interior/` or `js/relation.js` references grants, operators, or pending holders. Production renders the same empty first-entry state for every holder (`interior-integration.md`, *Content boundary*), so the Interior currently offers nothing that is specific to invitation.

**Net:** the repository holds two incompatible implications and no decision. Access and the documents derived from it say pre-authorized. The roadmap's record and membership direction implies self-directed entry tied to issue or purchase. The public ENTER path is written for everyone.

---

## 9. Security invariants that currently depend on enrollment grants

What would actually break or weaken if the requirement were removed or changed. This is not a proposal.

1. **Holder creation is not a public write.** Today the handler never writes `access_holders` (§3). Any grantless path adds an unauthenticated route that creates durable rows. Current protections do not cover that:
   - rate limits are keyed per grant (`service.js:172`);
   - `prune-expired` never removes holders or pending state (`postgres-store.js:186-196`);
   - the threat model's denial-of-service row assumes no such write (`access-threat-model.md:82`).
2. **Identifier allocation.** The operator chooses `PROB–H–…` and the unique constraint arbitrates. A public path needs server-side allocation. Sequential identifiers would become an enumeration and volume signal; the identifier is declared non-secret (`access-architecture.md:53`) but is currently never handed out automatically.
3. **Sybil / abuse control.** The grant is the only control on how many relations exist and who holds them. It is the only thing making "one person ↔ one holder" plausible. Nothing prevents one person from creating many holders on many devices once grants are gone. Later designs (the table, invitations to a question, issued assemblies) implicitly rely on this scarcity.
4. **Person-to-record binding (identity-proofing).** The architecture places the only human verification of *who* a holder is at grant delivery (`access-architecture.md:97`; threat-model boundary `:42`). Without it, a holder is a self-asserted, anonymous passkey. That is acceptable for WebAuthn, but it is a different trust statement from "pre-authorized".
5. **"A grant is never a way into an established record."** This is enforced by condition checks (`service.js:178`, `postgres-store.js:149`, `lockHolder(…, 'pending')` at `:238`). A replacement flow that only ever *creates* a fresh holder need not weaken this. A flow that lets a person name or claim an identifier would, because any public identifier would become an attach target.
6. **First-registration transaction shape.** `completeFirstRegistration` requires a grant row: `grants.length !== 1` aborts (`postgres-store.js:239-240`). The ceremony's `reference_id` is the grant id (`service.js:182,212`). Removing grants is a change to the committed authority transaction, which is what the PostgreSQL race suites verify. It is not a UI change.
7. **Non-enumeration objective.** "Failures do not reveal whether a holder or credential exists" (`access-threat-model.md:56`). Holder-specific registration options (`userName = PROB–H–…`) are disclosed only to grant bearers (`access-independent-security-review.md:239`). A public flow must avoid revealing identifier assignment or existence.
8. **Suspension and reactivation.** A suspended holder with no active credential reactivates to `pending` and "needs a new enrollment grant" (`postgres-store.js:163-176`; `postgres-lifecycle.test.js:282-294`). Operator control over re-entry after an incident runs through grants.
9. **Grant-as-authentication-material handling.** Logging rules (`access-architecture.md:270`), key-rotation effects (`access-deployment-checklist.md:46`), and the checklist's delivery rules (`:81`) exist because of grants. Removing grants removes this surface; changing delivery (for example, links) changes it.
10. **Test and dev harness.** Every suite and the local run seed holders through grants (§7). Any change touches the complete test base and the production-profile config tests (`config.test.js:31`).

Invariants that do **not** depend on grants and would be unaffected by any enrollment policy:
- exact origin/RP ID;
- UV-required passkeys;
- one-shot ceremonies;
- session cookies, rotation, and expiry;
- CSRF;
- recent presence for key and recovery changes;
- last-credential refusal;
- recovery-code handling;
- the relation read and the Interior.

---

## 10. Assessment of the mismatch

**The production behaviour is exactly what the Access documents specify.** It is internally consistent, tested, and reviewed as a *security mechanism*.

**It is not consistent with any recorded product decision, because none exists.** The evidence:
- Invitation-only entry was never stated as a requirement. It enters as an assumption, "pre-authorized holder", in a pre-implementation infrastructure audit (`access-system-audit.md:110`). It hardens into a security design (`03af401`). It is then treated as settled by later design work (`participatory-publishing.md`, `observation.md`).
- The one product-level source about holders, `laboratory/ROADMAP.md`, points the other way ("a person can enter PROBNAYA"; purchased objects attach to a holder; membership opens rather than closes). It stops short of deciding.
- The integration made the gate public-facing without deciding who it is for. ENTER is offered to everyone. The sentence naming the precondition was removed in `834346e`. The screen still depends on a grant nobody can obtain from the product.
- The part of the grant model that would make it an operable invitation system was explicitly left for human approval and never approved: the identity-proofing and delivery procedure (`access-architecture.md:97,275`; `access-deployment-checklist.md:15`, unchecked). As deployed, the gate exists but has no process around it.

So yes: **we have built and deployed a gated registration system without making that an explicit product decision.** The security decision (first-credential authority must not be a public write without a deliberate design) is sound and documented. The product policy it implies (only people PROBNAYA has chosen become holders) was inherited from that mechanism, not chosen. What the new user saw is a policy nobody decided, shown through a primitive nobody named for users.

---

## Decision required

**Who may establish a relation with PROBNAYA: only people PROBNAYA has chosen, or anyone who arrives?**

Everything else depends on the answer: whether the enrollment grant remains the entry mechanism, what ESTABLISH ACCESS says and to whom it is shown, the operator procedure, and which invariants in §9 must be preserved or redesigned. No code should change until that decision is recorded.
