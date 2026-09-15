# Access — request and establishment (v1)

Status: design investigation. No production code changed, nothing committed.
Builds on `design/access-enrollment-investigation.md`, against `design/interior-access-integration` at `e50eaf4`.

Product decision given (2026-09-15): for v1, Access is established **on request**. The reason is operating scale, not exclusivity. It is an early condition, not a membership policy.

---

## 1. Core product model

A person indicates one thing: *I would like to establish a relation with PROBNAYA.* PROBNAYA reads it and answers by establishing access. The person uses what arrives to issue their first key. From then on they are a holder like any other.

Three roles stay separate:

| Thing | What it is | Where it lives |
|---|---|---|
| **The request** | An operational message: "this address would like a relation". It is not an application, has no status, and asks for nothing but an address. | The PROBNAYA mailbox only. Access never stores it. |
| **The establishment** | PROBNAYA's act: a pending holder plus a one-time authority to issue its first key. | Access database (existing tables). Created by the operator CLI. |
| **The relation** | A holder with a passkey. | Access, read by the Interior exactly as today. |

Email connects the request to the establishment, and nothing else. It is never an identity, never a login, never recovery. Authentication stays passkey-only.

The enrollment grant is kept unchanged as the security primitive. The person never sees the word, the value, or a field for it. It travels inside a link and is used without being shown.

**Why this reads as an institution and not a signup:**
- a human reads every request;
- the page makes no promise of instant access, collects no profile, and has no account screen;
- the address is used once, for one message.

**Why it is not ceremonial:** one field, one button, one message, one key.

---

## 2. Exact new-user journey

```
public PROBNAYA · ENTER
  → Access · PRESENT KEY                     (no key on this device)
  → ESTABLISH ACCESS
  → Leave an address.  EMAIL ____  REQUEST ACCESS
  → Received. PROBNAYA will write to this address.
        ⋯ PROBNAYA reads the request; the operator establishes access ⋯
  → a message from mail@probnaya.work arrives
  → the person opens its link on the device that should hold the key
  → Access · ESTABLISH ACCESS · Issue the first key.   KEY LABEL · CREATE PASSKEY
  → device passkey sheet (Face ID / Touch ID / Windows Hello / security key)
  → RECOVERY CODES · Store these once. · I HAVE STORED THESE
  → Interior · CURRENT · Relation established.
```

Returning later is unchanged: ENTER → PRESENT KEY → Interior.

---

## 3. What the person sees

Copy follows the existing Access voice:
- uppercase eyebrow;
- one short imperative or declarative heading ("Issue the first key.", "Replace a lost path.", "Store these once.");
- one or two plain supporting sentences;
- uppercase status lines.

It deliberately avoids *join, sign up, account, member, welcome, approval, pending, review, waitlist*. The wording is proposed, not final.

### 3a. Entry (unchanged)

`ACCESS · PRESENT KEY` with `ESTABLISH ACCESS` and `RECOVER ACCESS`.

### 3b. ESTABLISH ACCESS, arriving without a link: request

```
← ACCESS

ESTABLISH ACCESS
Leave an address.

At present PROBNAYA establishes access on request. It will write to this
address with a link that issues your first key. The address is used for
that message and never opens Access.

EMAIL
____________________________

REQUEST ACCESS
```

- "At present" states the operating condition without announcing a policy.
- "never opens Access" tells the person at the only moment it matters that email is not a login.
- The page has no second field, no reason box, and no checkbox.

### 3c. After REQUEST ACCESS: receipt

```
ESTABLISH ACCESS
Received.

PROBNAYA will write to a.person@example.com. Open that message on the
device that should hold your key.

← ACCESS
```

- Echoing the address lets a typo be caught. It is shown only to the person who typed it and is not stored.
- There is no receipt number, no status, no "we'll review". It matches intake's plainness ("RECEIVED · … NO FURTHER CONFIRMATION WILL BE SENT.", `intake.html:108-111`) without borrowing its queue language.
- The receipt promises that PROBNAYA **will write**. That is a real commitment: every genuine request is answered (see §11).

### 3d. Opening the establishment link

```
← ACCESS

ESTABLISH ACCESS
Issue the first key.

Access has been established for you. Your authenticator will create the
key and keep its private part. This link works once.

KEY LABEL
PRIMARY PASSKEY

CREATE PASSKEY
```

- The address bar shows `access.probnaya.work/` only, with no secret visible (§7).
- There is no grant field. The key label keeps its current default.
- If this browser already has a live Access session, one extra status line appears above the button: `THIS BROWSER HOLDS PROB–H–0087. THIS LINK ESTABLISHES A SEPARATE RELATION.` It exists so a holder who was sent a link by mistake notices.

### 3e. Link that is expired, used, replaced, suspended, or malformed

Shown after CREATE PASSKEY, before any OS prompt. It is one message for all causes:

```
THIS LINK IS NO LONGER OPEN. IF A KEY WAS ALREADY CREATED WITH IT, PRESENT KEY.
OTHERWISE REQUEST ACCESS AGAIN.
```

### 3f. After the key: unchanged

Recovery codes, then the Interior.

---

## 4. What PROBNAYA / the operator does

1. A notification arrives at `mail@probnaya.work`: subject `ACCESS / REQUEST R–4QX7NC`, `Reply-To:` the person's address.
2. The operator reads it. If it is a real request, they choose the next `PROB–H` identifier and run:
   `npm run create-enrollment -- --new 'PROB–H–0144' 'R–4QX7NC'`
   The CLI prints one line: the establishment link.
3. The operator replies to the notification from `mail@probnaya.work` with the link, in the plain message in §11.
4. The operator closes the terminal. Nothing else is recorded, because the mailbox thread is the record.

If a link lapses or the person asks again, the operator runs `--reissue 'PROB–H–0144'`, which expires the earlier link, and replies again.

---

## 5. Role of email

| Email is | Email is not |
|---|---|
| where the person says they would like a relation | an account identifier, username, or login |
| where PROBNAYA delivers the one-time establishment link | a recovery path, for any holder, ever |
| a thread the operator can reply in | stored in Access (no column, no audit field, no log line) |
| operational mail | PROBNAYA Correspondence (`PROB–COR`) |

Consequences to state honestly in the threat model:

- **Email becomes the delivery channel for first-key authority.** Whoever reads that message before the person does can establish that relation. This is acceptable in v1 for two reasons. A pending holder contains nothing, and the grant can never enter an active or suspended record (`service.js:178`, `postgres-store.js:149`). It stops being acceptable the moment anything is issued to a holder *before* it is established. Rule: **nothing is ever issued to a pending holder.**
- **v1 does no identity-proofing beyond control of the address at the moment the link is used.** This answers the open checklist item "Approve the operator identity-proofing and out-of-band delivery procedure" (`docs/access-deployment-checklist.md:15`). The honest answer is *address control only, by design*. That is consistent with "becoming a holder is not an endorsement".
- **The person-to-holder link lives only in the mailbox.** The operator note on the grant carries the request ID (`R–…`), never the address. Access stays free of personal data, as it is today (`participatory-publishing.md`: "Access holds nothing else").

---

## 6. Role of the existing enrollment grant

Kept as is. It already has exactly the properties a link needs:

- 256-bit random bearer value; only the HMAC is stored (`crypto.js:3`, `service.js:32`).
- Authority limited to the first key of one pending holder (`service.js:175-178`).
- **Consumed only when a verified, user-verified registration commits** (`postgres-store.js:239`), not when it is presented. This one property makes link delivery safe against scanners and prefetch.
- Single-use, with replacement expiring earlier grants (`postgres-store.js:153`).
- Per-grant and per-network rate limits (`service.js:171-172`).

Renamed only where people see it: UI copy, email copy, and CLI output say *establishment link* or *establish access*. Internal names (`access_enrollment_grants`, `enrollment-options`, `enrollment-verify`, `create-enrollment`) stay. Renaming them would churn tested code for no security or product gain.

Changes to the grant, all small:
- lifetime (§7.6);
- how the CLI prints it (a link, not a raw value);
- a guard against reissuing to the wrong holder (§13);
- suspension expiring it (§10).

The representation (random value plus keyed hash) does not change.

---

## 7. Secure establishment-link protocol

### 7.1 Where the secret goes in the URL

| Placement | Server / Vercel request logs | Referer | Browser history | Link scanners / rewriters | Verdict |
|---|---|---|---|---|---|
| Path `…/establish/<secret>` | **Logged.** Paths are request data and appear in Vercel logs and any proxy log. Also needs a rewrite on a static project. | Not sent from Access (`Referrer-Policy: no-referrer`, `access/vercel.json`), but relies on that header forever. | Stored. | Fetched and stored. | Rejected. |
| Query `…/?g=<secret>` | **Logged**, same as path. | Same. | Stored. | Fetched and stored. | Rejected. |
| **Fragment `…/#establish=<secret>`** | **Never sent to the server.** Browsers do not transmit fragments in HTTP requests, so the secret cannot reach Vercel, the Function, or platform logs. | Never included in Referer by any browser. | Stored, but mitigated (7.3). | Preview bots fetch without the fragment. Rewriters (e.g. Safe Links) carry the whole URL, including the fragment, to their own service. That is unavoidable for any emailed secret, and harmless under 7.4. | **Chosen.** |
| Short code typed by hand | Not logged. | — | — | — | Rejected: the person copies a secret, which the brief rules out, and short codes need guessing controls. |

The fragment also fits existing Access conventions. The client already reserves fragments for view selection (`#record`, `#end`, `#expired`) and clears the address bar before doing anything else (`app.js:20-23`). No server routing, rewrite, or redirect changes.

Link form:

```
https://access.probnaya.work/#establish=<43-character base64url grant>
```

### 7.2 What the page does on load

Synchronously, before any network request:

1. Match `location.hash` against `^#establish=([A-Za-z0-9_-]{43})$`.
2. Copy the value into a closure variable. Never write it to the DOM, `localStorage`, `sessionStorage`, or a cookie.
3. `history.replaceState(null, '', '/')`, extending the existing line 23.
4. Show the establish-with-link view (§3d).

The page makes **no server call with the secret on load.** The existing `loadSession()` status read still runs, only to decide whether to show the "this browser holds …" line.

### 7.3 Exchange only on a deliberate gesture

CREATE PASSKEY → `enrollment-options {grant, label}` (unchanged endpoint). The server:
- checks the grant and that the holder is pending;
- creates a five-minute `first-registration` ceremony bound to an HttpOnly, `SameSite=Strict` pre-auth cookie;
- returns registration options.

This exchange is the "short-lived establishment ceremony". From here the browser holds a bound ceremony, not just a bearer secret, and `enrollment-verify` needs that cookie (`service.js:192-196`).

No exchange happens on page load, because some mail scanners execute JavaScript. An on-load exchange would not consume anything, but it would spend the grant's rate-limit budget from scanner networks for no benefit. The secret stays in email and history either way, so an early exchange buys no real reduction in exposure.

A reload after step 3 loses the in-memory secret. The page then shows the request view. Re-opening the link from the message restores it. That is accepted: it is simpler and safer than persisting the secret.

### 7.4 Accidental consumption, scanners, prefetch

- **Preview and prefetch bots** (iMessage, Slack, Gmail previews, Safe Links time-of-click checks) request `https://access.probnaya.work/` without the fragment and receive the ordinary static page.
- **JavaScript-executing scanners** see the establish view. If one ever pressed CREATE PASSKEY, it would get a ceremony it cannot complete, because registration requires a real authenticator with user verification (`service.js:17`, `webauthn.js:24-28`). **The grant is consumed only at commit, so no scanner can burn a link.**
- **Rate-limit lockout:** enrollment limits are keyed by network plus grant (`service.js:89-99,171-172`). A scanner's network cannot block the person's network.

### 7.5 Replay and single use

Unchanged, and already covered by PostgreSQL tests:
- the ceremony is consumed before verification;
- the grant is consumed in the commit transaction, under the holder lock and only while the holder is `pending` (`postgres-store.js:235-252`);
- a second use returns the §3e message (`postgres-lifecycle.test.js:147-162`).

Two devices racing with the same link can both create a passkey on their own authenticators, but only one commit wins. The loser holds an orphan passkey entry the server never accepted; the existing message covers it well enough at this scale (§9).

### 7.6 Expiry

The current 24 hours (`constants.js:13`) was sized for an operator handing a code to someone waiting for it. An emailed link is opened when the person next reads mail, so 24 hours would routinely force a second exchange.

Recommendation: **7 days**, the common lifetime for invitations to create a *new* account rather than recover an existing one.
- **Justification:** the link cannot touch an established record, and the relation it creates holds nothing.
- **Cost:** a longer window for a leaked mailbox or history entry. It is bounded by single use, by operator reissue expiring earlier links, and by suspension expiring them (§10).

This is the one parameter that deserves the user's explicit sign-off.

### 7.7 After the secret is accepted

- **Successful establishment:** the grant is consumed; the link, history entries, email copy, and scanner logs are all inert.
- **Abandoned:** nothing is consumed; the link works until expiry or reissue.
- **Lost confirmation** after the key was created: existing behaviour (PRESENT KEY, then replace codes; `app.js:36`).

### 7.8 Residual exposures, stated plainly

- **Browser history and synced history** (for example iCloud Safari history) keep the full URL until the link is consumed or expires. `replaceState` updates the tab's entry, but the visit may already be in global history.
- **Copy, paste, and screenshots of the email.** Screenshots of the page after load show no secret.
- **Mail rewriting services** retain the URL.
- **Anyone with mailbox access before use.**
- **All four are bounded the same way:** single use, expiry, reissue, and suspension. Their worst outcome is establishing an *empty* relation, which the operator can suspend (§9).

### 7.9 Phishing posture

- A look-alike domain cannot create or use a passkey for RP ID `access.probnaya.work`. That is WebAuthn's origin binding.
- Access never asks for a password, an email to sign in, or an emailed code.
- The establishment message says what it will ask for: one key, once. A fake page can still ask for recovery codes, which is the existing residual risk.

---

## 8. Pending-holder lifecycle

```
(request in mailbox)                         no Access state
        │ operator: create-enrollment --new
        ▼
pending + live grant ──── link used, key committed ───▶ active   (grant consumed)
   │        │
   │        ├─ 7 days pass ─────────────▶ pending, no live grant
   │        │                               │ operator: --reissue ──▶ pending + new live grant
   │        ├─ operator: --reissue ─────▶ pending + new live grant (old expired)
   │        └─ operator: suspend ───────▶ suspended, grants expired  (§10 change)
   │                                        │ reactivate ──▶ pending, no live grant
   ▼
never used: stays pending indefinitely; identifier stays reserved
```

- **Identifier allocation stays with the operator** (`create-enrollment.mjs:11-13`). There is no reason to change it at this scale. A person reading the request is also the natural moment to issue the number. Sequential numbers disclose roughly how many relations exist. That is honest for a small institution, and it is the operator's convention to choose; nothing forces a change.
- **Unused pending holders are not pruned** (`postgres-store.js:186-196`) and keep their identifier. At 5–20 that is a handful of reserved numbers, and consistent with the register's "entries not listed are not missing". Revisit at 50 (§17).
- **The person-to-identifier mapping** lives only in the mailbox thread, joined through the `R–` note on the grant.

---

## 9. Failure, expiry, and replay behaviour

| Situation | What happens | What the person sees | Operator action |
|---|---|---|---|
| Link opened, nothing done | Nothing consumed | Establish view | None |
| Opened in a scanner / previewer | Nothing consumed | — | None |
| Reload after opening | Secret gone from the page | Request view | None. Re-open the link. |
| Expired (7 days) | `findGrant` fails | §3e | `--reissue` on reply |
| Reissued; old link opened | Old grant expired | §3e | None |
| Used successfully, opened again | Grant consumed | §3e (PRESENT KEY hint) | None |
| Cancelled Face ID | Ceremony unused; grant live | `THE AUTHENTICATOR DID NOT COMPLETE. NOTHING WAS CHANGED.` (`app.js:28`) | None |
| Key created, confirmation lost | Grant consumed, holder active | `ENROLLMENT WAS NOT CONFIRMED…` (`app.js:36`), which should be reworded without "ENROLLMENT" | None |
| Two devices race | One commit wins; the other has an orphan passkey entry | Winner proceeds; loser sees §3e | Rare. The person may delete the stray passkey in their password manager. |
| Someone else used the link first | That person holds an empty relation | Real person sees §3e and writes back | Check `first-credential-enrolled` audit time; suspend that holder; `--new` for the person with a new identifier |
| Holder suspended before use | Grants expired (§10) | §3e | — |
| Too many attempts | Existing per-grant/per-network limits | Existing 429 message | None |

Every §3e case uses one message. Distinguishing them would tell only the bearer of a 256-bit secret, so it is not an enumeration risk. It would add copy and states for no benefit at this scale.

---

## 10. Interaction with recovery and suspension

**Preserved without change:**

- **A link can never reach an established relation.** Grants are issued only to new or pending holders (`issueEnrollmentGrant`, `postgres-store.js:141-160`). Options require `pending` (`service.js:178`). The commit locks the holder as `pending` (`postgres-store.js:238`).
- **Recovery is untouched.** Recovery codes work only for `active` holders (`beginRecovery` locks `active`, `postgres-store.js:379`; `getRecoverySession` requires `active`, `:400`). A pending holder has no codes.
- **Email is not a recovery path.** A holder who loses every key and every code cannot be restored by PROBNAYA. `create-enrollment` refuses active holders, and there is no operator credential revocation. This is existing design ("No email link … or operator-known fact authenticates a person", `access-architecture.md:204`). The request flow must not soften it. The operator's only honest answer to such a person is a *new* relation with a new identifier. Whether that is acceptable is an existing product consequence, now more visible because people have a mailbox thread to write in.
- **Existing holders writing in** ("new phone"): the answer is PRESENT KEY with a synced passkey, or ADD ANOTHER KEY from a device that still holds one. Never a link.

**One change recommended: suspension ends outstanding establishment.**

Today, suspending a `pending` holder blocks use of its grant only while suspended. `reactivate` returns it to `pending`, and **the old grant works again** until expiry. This is asserted as intended in `postgres-lifecycle.test.js:291-293`.

With emailed, 7-day links, suspending a pending holder is exactly how an operator would say *that link must not be used*. Letting it revive on reactivation is a trap. Change:
- when a holder becomes `suspended`, expire its unconsumed grants in the same transaction;
- implement this as an idempotent `003` migration extending the `002` freeze trigger, so raw operator SQL is covered as well as the CLI;
- reactivation of a credential-less holder then yields `pending` with no live grant, and the operator reissues deliberately.

This adds no bypass and removes one.

---

## 11. Minimal operational workflow for the first 5–20 people

**Once:**
- Confirm the SMTP account used for request notifications (§13) is **not** the mailbox that sends establishment links. It must not be able to read that mailbox. A Google app password grants IMAP as well as SMTP, so a sender-only account (or an alias on a separate account) should hold it. Verify what the public site's `SMTP_USER` is too, because the same concern applies to intake.
- The operator's machine holds the migration/operator database role and `SESSION_HASH_KEY` only while running commands (`access-deployment-checklist.md:27,46`).

**Per request (about three minutes):**
1. Read `ACCESS / REQUEST R–…` in `mail@probnaya.work`.
2. `npm run create-enrollment -- --new 'PROB–H–NNNN' 'R–…'` → copy the printed link.
3. Reply from `mail@probnaya.work`:

   > Subject: PROBNAYA — access
   >
   > Access has been established for you.
   >
   > Open this link on the device that should hold your key:
   > https://access.probnaya.work/#establish=…
   >
   > Access will ask your device to create a passkey with Face ID, Touch ID, Windows Hello, or a security key. No password or account is created; the key is how you return. The link works once and closes on 23 September.
   >
   > If you did not ask for this, ignore it. Nothing happens unless the link is used.
   >
   > PROBNAYA

4. Nothing else. Do not paste the link anywhere else, do not keep it, do not put the address in the operator note.

**Policy for v1:** every genuine request is answered, ordinarily by establishing access. Requests that are plainly automated or abusive get no reply; there is no one to write to. If PROBNAYA ever wants to decline a real person, that is a product decision this design does not make, and the receipt's "PROBNAYA will write" would need to stay true.

**Not Correspondence:** no `PROB–COR` identifier, no editorial form, no entry in the Interior. It is a plain operational reply, the same kind of message as answering intake.

**No trace in the Interior:** the request predates the relation and belongs to the mailbox. HISTORY already opens with `Relation established`, dated by Access. That is the first fact both parties share, and it is enough.

---

## 12. What changes in the current Access UI

`access/public/index.html`, `access/public/app.js`, and a little of `access.css`:

1. **`establish` view** becomes two states of one view:
   - **request** (no link): heading *Leave an address.*, supporting copy, `EMAIL` input (`type=email`, `autocomplete=email`, `maxlength=254`), `REQUEST ACCESS`;
   - **establish** (link present): *Issue the first key.*, new supporting line, `KEY LABEL`, `CREATE PASSKEY`.
2. **Receipt state** after a successful request (§3c).
3. **Remove the `ENROLLMENT GRANT` input and the "operator-issued enrollment grant" sentence** (`index.html:38,40`).
4. **Fragment handling** at boot (§7.2), extending the existing `requested`/`expired` hash parsing (`app.js:20-23`). A valid `#establish=` routes directly to the establish state, ahead of `loadSession()`'s default view.
5. **`establish(form)`** takes the grant from the closure rather than `FormData` (`app.js:196-221`).
6. **Messages:**
   - add `linkClosed` (§3e), `requestReceived`, and `requestUnavailable` (`REQUESTS CANNOT BE SENT FROM HERE AT THE MOMENT. WRITE TO MAIL@PROBNAYA.WORK.`);
   - reword `enrollmentUnconfirmed` to drop "ENROLLMENT", e.g. `ACCESS WAS NOT CONFIRMED. IF A KEY WAS CREATED, PRESENT KEY, THEN REPLACE RECOVERY CODES IN THE ACCESS RECORD.`
7. Optional "this browser holds PROB–H–…" line when a session is live (§3d).

Entry, PRESENT KEY, RECOVER ACCESS, boundary, record, codes, and END SESSION views are unchanged.

---

## 13. What changes in the backend

**A. One new unauthenticated action, `request-access`** (`api/access.js` `ACTIONS`, `lib/service.js`, a new small `lib/notify.js`):

- Existing POST guards apply unchanged: exact Origin, JSON, body limit, `exactObject`.
- Payload `{ email }`:
  - trimmed, 3–254 characters;
  - a single `@` with a dot in the domain;
  - no whitespace or control characters (so no CR/LF header injection);
  - lower-casing is not needed.
- Rate limits through the existing durable limiter:
  - per network, e.g. 3 per 10 minutes with a 30-minute block;
  - a global daily ceiling, e.g. 100. The limiter needs one fixed-key call, since `service.limit` always includes the network hash. The ceiling protects the sending account from provider limits, and a suspended Google account would also break intake.
- Sends **one** plain-text message **to `mail@probnaya.work` only**:
  - fixed `From` (the sender account);
  - `Reply-To:` the validated address;
  - constant subject `ACCESS / REQUEST R–XXXXXX`, where the receipt comes from `randomToken`, not `Math.random` as intake uses;
  - body: address, received time (UTC), the `R–` ID, and the two CLI command templates.
- **Never sends anything to the entered address.** Otherwise Access becomes a way to make PROBNAYA email arbitrary people, the standard verification-spam vector.
- Stores nothing:
  - no table and no audit event;
  - the only database write is the rate-limit bucket, which holds an HMAC of the network;
  - the response is `{ ok: true }` and does not echo anything.
- Logging stays within `logOutcome` (`http.js:98-111`): action and code only. Mail-driver errors are caught and never logged verbatim, because driver messages can contain addresses. Failure returns `503 request_unavailable`.
- Configuration: `ACCESS_REQUEST_SMTP_USER`, `ACCESS_REQUEST_SMTP_PASS`, `ACCESS_REQUEST_SMTP_FROM`, Production-scoped.
  - **Missing values disable only this action** (503 with the write-to-mail fallback). Key authentication must not depend on mail configuration.
  - Present values are shape-validated at startup.
  - Development and tests use an injected mailer, following intake's `_setMailer` pattern (`api/intake.js:94`).
- New pinned dependency: `nodemailer` (exact version, lockfile), matching the public site.

**B. `scripts/create-enrollment.mjs`:**
- `--new PROB–H–… [R–…]` refuses if the identifier exists. `--reissue PROB–H–…` refuses unless it exists and is pending.
  - This prevents the one dangerous manual slip in this workflow: typing another person's pending identifier, which today silently expires *their* link and hands their holder to someone else.
  - `issueEnrollmentGrant` already returns `created`; the script only needs to assert the expectation, or pass a mode to the store.
- Prints `https://access.probnaya.work/#establish=<token>` to stdout once, and the expiry date to stderr.
- The optional note is validated as an `R–` reference rather than free text, so addresses do not drift into the database.

**C. `lib/constants.js`:** `ENROLLMENT_GRANT_MS` = 7 days (decision point, §7.6).

**D. `migrations/003_suspension_expires_grants.sql`:** idempotent `CREATE OR REPLACE` of the freeze function. Condition becomes `suspended` → `UPDATE access_enrollment_grants SET expires_at = LEAST(expires_at, CURRENT_TIMESTAMP) WHERE holder_id = NEW.id AND consumed_at IS NULL`. It also brings existing suspended holders' grants into the invariant.

**E. Documentation:**
- `docs/access-architecture.md`: first-passkey section, operator procedures, email role.
- `docs/access-threat-model.md`:
  - replace "SMTP/email → notification only, never authentication" with the two email roles;
  - add the rule "nothing issued to a pending holder";
  - add the link-delivery row;
  - replace the operator-delivery assumption.
- `docs/access-deployment-checklist.md`: resolve item 15 with the v1 procedure; add SMTP separation and link-delivery checks (Gmail, Outlook with Safe Links, iCloud Mail preserve the fragment).
- `access/README.md`: CLI usage.
- `design/interior-integration.md`: first-entry steps.

---

## 14. What does NOT need to change

- WebAuthn options and verification, UV required, attestation `none`, resident keys (`webauthn.js`).
- `enrollment-options` / `enrollment-verify` request shapes, the first-registration transaction, and ceremony binding (`service.js:168-224`, `postgres-store.js:235-252`).
- Grant representation (random value plus HMAC under `SESSION_HASH_KEY`), single use, replacement semantics.
- Holder conditions, holder-first lock protocol, migration `001`, and the `002` session-freeze behaviour.
- Sessions, rotation, idle/absolute expiry, recent-auth/VERIFY PRESENCE, CSRF, add/revoke key, last-credential rule.
- Recovery codes, recovery sessions, recovery-resume.
- `GET /api/relation`, exact-origin CORS, Access → Interior handoff and END SESSION.
- Interior CURRENT / HELD / HISTORY / RELATION and first-entry state.
- Operator identifier allocation, `set-holder-condition`, `prune-expired`, `migrate`.
- Access CSP and headers. `connect-src 'self'` already permits the new same-origin POST, and `Referrer-Policy: no-referrer` stays.
- The public site: ENTER still goes to Access; intake is untouched.

---

## 15. Required test changes and additions

**Handler / service (memory store, `handler.test.js`, `service.test.js`):**
- `request-access`:
  - valid address → exactly one message, to `mail@probnaya.work`, `Reply-To` equals the address, constant subject pattern, response `{ok:true}` without echo;
  - nothing sent to the entered address.
- Rejections:
  - missing, extra, or oversized fields;
  - CR/LF, control characters, no `@`, more than 254 characters;
  - wrong Origin (existing matrix extended);
  - non-JSON.
- Per-network limit and global ceiling return 429. Another network is unaffected by one network's block.
- Mailer failure returns 503 with a generic message. The log line contains no address, driver text, or body (extend the log test at `handler.test.js:172`).
- Unconfigured production mailer: `request-access` returns 503, while `authentication-options` still works.
- Enrollment gap from the investigation: a **never-issued** grant and an **empty** grant are refused.
- Scanner shape: `enrollment-options` repeated from a different network does not consume the grant and does not rate-limit the person's network; the grant then establishes normally.

**PostgreSQL (`postgres-lifecycle.test.js`):**
- **Replace** the assertion at lines 291-293 ("the outstanding grant can still establish the first key" after reactivation) with: suspending a pending holder expires its grant; reactivation yields `pending`; the old link fails; `--reissue` establishes.
- Migration `003` applies idempotently on a schema with existing suspended holders and outstanding grants.
- `--new` refuses an existing identifier; `--reissue` refuses a missing or non-pending one (store-level, or a CLI test against the disposable database).

**Config (`config.test.js`):** request SMTP variables are shape-checked when present; development and test profiles never require them.

**Client (currently untested in code; PC-02 showed why that matters):**
- A headless check (Node `vm` harness in scratch, or the existing Browser-pane soft-authenticator run) that:
  - the `#establish=` value is read and `location.hash` is cleared before any `fetch`;
  - no request carries the grant on load;
  - the grant never appears in the DOM;
  - CREATE PASSKEY sends it once.
- Rendered verification added to the checklist: request → receipt; link → establish → Face ID-style soft authenticator → codes → CURRENT; reload after link shows request view; used link shows §3e; desktop and 375 px widths.

**Dev harness:** `ACCESS_DEV_ENROLLMENT_TOKEN` stays. The local instruction becomes "open `http://localhost:4174/#establish=<token>`".

---

## 16. Security considerations (summary)

1. **New unauthenticated write to an external system** (mail). Bounded by exact Origin, schema, per-network and global limits, a single fixed recipient, and no echo or storage.
2. **Email becomes the first-key delivery channel.** Acceptable only because pending holders are empty and grants cannot enter established records. Record the "nothing issued to a pending holder" rule in the threat model.
3. **Bearer secret in an emailed link.** Kept out of servers and Referer by the fragment; cleared from the address bar before any request; consumption gated on UV registration; 7-day expiry, reissue, and suspension bound the rest (§7.8).
4. **Mail credential separation.** The runtime SMTP credential must not be able to read the mailbox where establishment links are sent and retained. Verify intake's credential as well.
5. **Personal data stays out of Access.** No address in the database, audit, or logs; the `R–` reference is the only join.
6. **Operator error** is the most likely real failure: the wrong identifier on reissue, or the link pasted into the wrong thread. `--new`/`--reissue` guards the first. The second is the reason every link is single-use and replaceable.
7. **No bypass of recovery or suspension.** §10; suspension becomes strictly stronger.
8. **Phishing.** Passkeys are origin-bound; the message states what Access will ask for.
9. **Threat-model review trigger.** "email recovery" is already listed (`access-threat-model.md:112`). This design adds email *delivery*, not recovery. Say so explicitly in the updated threat model so a later reader does not mistake one for the other.

---

## 17. Behaviour at 5 / 50 / hundreds of requests

**5–20 (designed for).**
- Each request is read. Replies go out within a day or two. One operator command each.
- A few unused pending identifiers.
- The operator learns who arrives and how they use the Interior, which is the point of v1.

**Around 50: uncomfortable.**
- The operator needs production database access and `SESSION_HASH_KEY` on their machine several times a week, so exposure of operator material grows.
- Tracking which requests were answered, reissued, or lapsed in a mailbox becomes error-prone, and the wrong-thread paste becomes likely.
- Junk requests appear, with no verification and no honeypot. The global ceiling may start to bite.
- Unused pending holders accumulate reserved identifiers with no cleanup.
- Duplicate requests from people who already hold a relation are hard to spot, because Access knows no addresses.
- "PROBNAYA will write" starts to carry latency.
- The first thing to build would be a small operator tool that issues and sends from one place. Its main job would be keeping link delivery out of copy-paste, not tidiness.

**Hundreds: the model breaks.**
- Manual reading becomes rubber-stamping.
- Automated sending moves the bearer secret into a runtime mailer, which is a threat-model change.
- Identifier choice has to be server-allocated.
- The gate becomes a queue.

**When to reconsider:**
- Sustained volume above what one person answers within two days, roughly **one or more requests a day for several weeks**.
- More decisively, **when the operator is accepting essentially every request without reading it**. At that point the gate no longer serves its stated purpose (seeing who arrives) and provides only delay. That is the moment to reconsider public self-establishment, with its own abuse controls, as a deliberate product decision.

Not solved here.

---

## 18. Smallest implementation scope

1. **UI:** request state, receipt, link-driven establish state, fragment capture and clear, remove grant field and operator wording, closed-link and unavailable messages (§12).
2. **Access action `request-access`** with rate limits and a single-recipient notifier; no storage (§13A).
3. **CLI:** `--new` / `--reissue`, print the link, `R–` note (§13B).
4. **Grant lifetime 7 days** (§13C). Needs sign-off.
5. **Migration 003:** suspension expires grants (§13D).
6. **Tests** in §15, including replacing `postgres-lifecycle.test.js:291-293`.
7. **Doc updates** (§13E) and the one-time SMTP credential separation check (§11).

Out of scope: dashboards, request records, statuses, automated sending, identifier allocation, pruning, Interior changes, Correspondence.

---

## Complete example

**Tuesday 16 September, 21:40.** Noor Haddad reads Laboratory Statement 001 on probnaya.work and taps **ENTER** in the header. Access opens at `access.probnaya.work`, warmer paper, one command: **PRESENT KEY**. They have no key, so they tap **ESTABLISH ACCESS**.

The page reads *Leave an address.* and says that at present PROBNAYA establishes access on request, and will write with a link that issues the first key. Noor types `noor.haddad@fastmail.com` and taps **REQUEST ACCESS**. The browser sends:
- `POST /api/access {"action":"request-access","data":{"email":"noor.haddad@fastmail.com"}}` with `Origin: https://access.probnaya.work`.

The server checks the origin, shape, and network limit. It sends one plain-text message to `mail@probnaya.work` and returns `{ok:true}`. The page shows *Received.* and *PROBNAYA will write to noor.haddad@fastmail.com. Open that message on the device that should hold your key.* Access stores nothing about Noor. The Function log for this request has no warning or error line.

**Wednesday 17 September, 09:15.** In `mail@probnaya.work`:

> **ACCESS / REQUEST R–4QX7NC** · Reply-To: noor.haddad@fastmail.com
> ADDRESS  noor.haddad@fastmail.com
> RECEIVED 2026-09-16 20:40 UTC
> ESTABLISH  npm run create-enrollment -- --new 'PROB–H–…' 'R–4QX7NC'

The operator reads it; it is a person. The last identifier issued was `PROB–H–0143`. From `access/`, with the operator environment loaded:

```
$ npm run create-enrollment -- --new 'PROB–H–0144' 'R–4QX7NC'
Created pending holder PROB–H–0144; link closes 2026-09-24T08:15:02Z.
https://access.probnaya.work/#establish=Hk3v…43 characters…Q2w
```

In Access, one transaction creates holder `PROB–H–0144` (`pending`), a grant row with its hash, a 7-day expiry, note `R–4QX7NC`, and an `enrollment-grant-issued` audit event. The operator presses Reply on the notification, which addresses it to Noor, pastes the link into the short message from §11, sends it from `mail@probnaya.work`, and closes the terminal.

**Wednesday, 12:30.** On their iPhone, Noor opens Mail and taps the link. Safari opens `https://access.probnaya.work/#establish=Hk3v…`.
- The request that reaches Vercel is `GET /`; the fragment never leaves the phone.
- Before anything else, `app.js` reads the value into memory and replaces the address with `access.probnaya.work/`.
- The status read finds no session.

The page shows *ESTABLISH ACCESS · Issue the first key. · Access has been established for you. Your authenticator will create the key and keep its private part. This link works once.* KEY LABEL reads `PRIMARY PASSKEY`. Noor leaves it and taps **CREATE PASSKEY**.

The browser posts `enrollment-options` with the grant and label. The server:
- finds the live grant for pending `PROB–H–0144`;
- creates a five-minute `first-registration` ceremony bound to a new `__Host-probnaya_preauth` cookie;
- returns options with `user.name = PROB–H–0144`, resident key required, UV required.

iOS shows its passkey sheet, offering to save a passkey for `PROB–H–0144` on `access.probnaya.work` (exact wording is Apple's). Noor taps Continue and Face ID confirms.

`enrollment-verify` runs:
- the ceremony is consumed and the registration is verified (origin, RP ID, challenge, UV);
- one transaction locks the holder as pending, consumes the grant, inserts the credential, sets `PROB–H–0144` to `active`, opens a session, and writes ten recovery-code hashes and two audit events;
- the response sets `__Host-probnaya_session`, expires the pre-auth cookie, and carries the ten codes once.

*RECOVERY CODES · Store these once.* Noor writes them on the card they keep in a drawer and taps **I HAVE STORED THESE**. Access replaces itself with `https://probnaya.work/interior/`.

**Interior · CURRENT · PROB–H–0144.** *Relation established.* ACCESS `01 KEY` · RECOVERY `ESTABLISHED` · REPRESENTATION `UNISSUED` · `OPEN BETWEEN US · NOTHING OPEN`. HISTORY holds one event, *Relation established*, dated 17 September. Nothing mentions the request, the email, or a grant.

The link in Noor's Mail and Safari history is now inert. Opening it again shows *THIS LINK IS NO LONGER OPEN. IF A KEY WAS ALREADY CREATED WITH IT, PRESENT KEY.* A month later, on the same phone, Noor taps ENTER, then PRESENT KEY, and Face ID takes them back in. No email is involved, ever again.

---

## Recommendation: smallest production-ready v1

Build §18 as written.
- **Keep the enrollment grant unchanged underneath.** It already has the properties an emailed link needs, above all consumption only at a user-verified commit.
- **Put it in a URL fragment**, captured and cleared before any request, and exchanged only when the person presses CREATE PASSKEY.
- **Send requests from Access to `mail@probnaya.work`** through one rate-limited, store-nothing action whose credential cannot read the mailbox links are sent from.
- **Let the operator issue identifiers and reply by hand.**
- **Make two small hardening changes** this flow exposes: suspension expires outstanding grants, and the CLI refuses to reissue to the wrong holder.
- **Extend link lifetime to 7 days** only with explicit agreement.

Reject:
- a path or query token, which would reach Vercel logs;
- an automatic exchange on page load, which gives scanners something to do and adds no protection;
- storing requests or addresses in Access, which would put personal data in the authentication database;
- a `mailto:` link only, which is unreliable on desktop and leaves no receipt;
- routing requests through the public intake page, which means a detour through a second origin and changing intake's contract for a different kind of message.

Against the final test: the person leaves an address, PROBNAYA writes back, and one key makes them a holder. No account or profile is created and there is no status to watch. It reads as a small institution answering someone who asked.
