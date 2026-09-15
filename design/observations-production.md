# Observations — minimal production architecture (v1)

Status: revised proposal. No code, credentials, or production configuration changed. The prototype interface is frozen; `design/observations.md` is the editorial source of truth.

Investigated 2026-09-15 against `origin/main` (`d233738`), the `design/observations` worktree, the Vercel projects `surface` and `probnaya-access`, and primary platform documentation (sources at the end).

---

## 0. Frozen decisions

- **Access Neon stays completely separate.** Observations never connects to it.
- **No Observations database, dashboard, CMS, or persistent store of unpublished files.**
- **The mailbox is the editorial queue:** `RECEIVED / REVIEW / KEEP / DECLINE`.
- **Publication is a deliberate manual edit, commit, and deploy.** `observations.html` is the publication source for the first 10–30 pieces, written by hand in the frozen grammar. There are no source files and no generator until real material shows a need.
- **No automatic email to senders.** The browser receipt is the only acknowledgement.
- **First real material stays off the public repository until launch.**
- **Withdrawal removes the current published version from PROBNAYA.** It cannot guarantee erasure from public git history, or from copies made while the piece was public.

---

## 1. Relevant facts

| Area | Fact |
|---|---|
| **Site** | `probnaya.work` is the Vercel project `surface`. It is static, has no build step, and runs CommonJS functions from `api/`. The repository `probnaya-work/surface` is public. |
| **Form precedent** | `api/intake.js` validates JSON, uses a honeypot, and sends one plain-text message to `mail@probnaya.work` through Google Workspace SMTP with `Reply-To` set to the sender. It stores nothing. |
| **Request limit** | A Vercel Function accepts at most **4.5 MB** of request body. Larger requests fail with `413 FUNCTION_PAYLOAD_TOO_LARGE`. This is the binding constraint on attachments. |
| **Mail size** | Workspace documents receiving limits of 50 MB (Enterprise Standard) and 70 MB (Enterprise Plus) after encoding, which adds about 37%. Even Gmail's long-standing 25 MB attachment ceiling is several times the 4.5 MB request limit. Mail is not the constraint. |
| **Mail credential** | `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` on `surface` are scoped to **Production and Preview**. `probnaya-access` holds the same account's credential in Production only. The credential is a Workspace app password for the account behind `mail@probnaya.work`, and authenticates SMTP. |
| **Storage** | Neither project has a database variable, Blob store, or integration. Access uses Neon through its own least-privilege roles. |

---

## 2. Architecture

```text
Browser: observations.html send form
   │  prepares one attachment to fit the transport budget (images only)
   │  POST /api/observations — JSON, ≤ 4.4 MB
   ▼
surface: api/observations.js
   │  validates, checks the file's leading bytes, builds one message
   │  Workspace SMTP — send-only credential, Production only (section 6)
   ▼
mail@probnaya.work — Gmail filter: OBSERVATIONS/RECEIVED
   │  REVIEW → KEEP or DECLINE, or publish
   ▼
Local branch: hand edit observations.html + assets/observations/<slug>.<ext>
   │  publication checklist, including media sanitisation (section 5)
   ▼
git push main → Vercel production → probnaya.work/observations
```

---

## 3. Submission endpoint and attachment transport

### Why 3 MB was wrong, and what to do instead

Ordinary phone images regularly exceed a fixed 3 MB cap. A 12 MP photograph that iOS converts to JPEG on upload is typically 2–5 MB. Higher-resolution sensors and Android JPEGs often reach 5–10 MB. A large-phone PNG screenshot can be 2–5 MB.

The 4.5 MB request limit is fixed, so simply raising the cap cannot work. Three ways to accept a normal photograph without storage:

| Approach | Largest original accepted | Complexity | Verdict |
|---|---|---|---|
| **Send the original as base64 JSON** | About 3.2 MB | None beyond intake's pattern | Rejects many ordinary photos. |
| **Send multipart or raw binary** | About 4.3 MB | Hand-written multipart parsing, or a new dependency, and the local dev server can't parse it | Still rejects many photos, for real added complexity. |
| **Prepare images in the browser, then send base64 JSON** | Any image the browser can decode | About 40 lines in the page; the server is unchanged | **Recommended.** |

A direct upload to object storage would remove the limit entirely, but it is a persistent unpublished-file store, which is excluded for v1.

### Browser preparation, images only

When the chosen file is a JPEG, PNG, or WebP and is larger than the **transport budget of 3.1 MB**:

1. Decode it with `createImageBitmap`, which applies orientation.
2. **Photographs (JPEG or WebP):** scale so the long edge is at most **3,000 px**, then encode JPEG at quality 0.86. If still over budget, retry at 0.78, then at 2,400 px.
3. **Screenshots (PNG):** keep the original dimensions and encode JPEG at 0.92, which keeps text legible. If still over budget, scale the long edge to 2,560 px.
4. If nothing fits after these attempts, refuse with the size message below.

**Files within budget are sent unchanged**, so the material arrives exactly as chosen. A 3,000 px photograph comfortably covers the published size and the "open original" view.

Re-encoding in the canvas drops EXIF, including location, as a side effect. Sanitisation is still an editorial step (section 5), because files within budget, PDFs, HEIC, and text keep whatever they carry.

**Files that cannot be prepared** (PDF, text, HEIC in browsers without HEIC decoding) are sent as-is if they fit the budget. Otherwise the form says:

```text
FILES UP TO 3 MB. SEND THE TEXT AND MENTION THE FILE; IF NEEDED, WE WILL ASK FOR IT.
```

The editor can then ask the sender to email the file directly, which Workspace accepts at far larger sizes. That keeps the endpoint small and uses no storage.

### Server limits in `api/observations.js`

- **Request:** refuse `Content-Length` above **4.4 MB**, and re-check after parsing. This stays below Vercel's 4.5 MB with room for JSON overhead.
- **Fields:**

| Field | Rule |
|---|---|
| `material` | Required, trimmed, up to 40,000 characters. Line endings normalised. |
| `name` | Optional, up to 120 characters, CR/LF stripped. Blank means unsigned. |
| `context` | Optional, up to 160 characters, CR/LF stripped. |
| `email` | Required, email-shaped, up to 200 characters. |
| `attachment` | Optional, exactly one. Decoded size up to **3.1 MB**. The file name is reduced to a safe basename of at most 100 characters. |

- **File types:** accepted only when the leading bytes match JPEG, PNG, WebP, GIF, HEIC/HEIF, PDF, or UTF-8 text. The declared type is ignored, and nothing is decoded or rendered server-side.
- **Arithmetic:** 3.1 MB becomes about 4.13 MB in base64, plus at most about 0.16 MB of text and fields, which is at most about 4.3 MB. That is under the 4.4 MB guard and the 4.5 MB platform limit.
- **Other behaviour:**
  - a honeypot, as in intake;
  - a reference `O–` plus six characters from `crypto.randomBytes`, for the mailbox only;
  - a response of `200 { ok: true }`;
  - one JSON log line per refusal or failure, with an outcome code only and no content, name, address, or file name;
  - nodemailer with the timeouts and file and URL access disabled, as in `access/lib/notify.js`.

### The notification

One plain-text message to `mail@probnaya.work`, with `Reply-To` set to the sender and the file attached:

```text
Subject:  OBSERVATION / RECEIVED O–7K2QX9

REFERENCE  O–7K2QX9
RECEIVED   2027-03-02T09:14:00Z
FROM       Sabine Hartmann            (or UNSIGNED)
CONTEXT    legal translator, Vienna   (or —)
EMAIL      <sender>                   private, never published
FILE       photo.jpg · image/jpeg · 1.8 MB · prepared in browser: yes/no

--- MATERIAL, AS SENT ---
…
```

### The acknowledgement

The existing on-page receipt only: "RECEIVED. If it is published, you will be told."

---

## 4. Mailbox lifecycle

| State | Where | Action |
|---|---|---|
| **RECEIVED** | Inbox; a Gmail filter on the subject applies `OBSERVATIONS/RECEIVED` | Nothing else holds the submission. |
| **REVIEW** | Mailbox | The editor reads it. An **ask** is a reply to the sender, and the revision arrives in the thread. |
| **DECLINE** | Deleted | Delete, and empty Trash, within 30 days of receipt. One reply only if the sender needs redirecting, for example to intake. |
| **KEEP** | `OBSERVATIONS/KEEP` | Only with the sender's agreement, confirmed by one reply. Delete when the sender asks, or publish on the agreed date. |
| **Published** | `OBSERVATIONS/PUBLISHED` | Keep the message while the piece is published. It is the record of consent and the only way to recognise an addition or withdrawal from the same address. Delete it after a withdrawal. |

Publication is not a mailbox state. It is the action in section 5.

---

## 5. Publication: `observations.html` as the source

### Publication checklist

Carry this out on a local branch, pushed only at launch or for each later publication.

1. **Material.**
   - Copy the text exactly as sent into a new `<li class="observation">` in the frozen grammar: `PUBLISHED` date and `FROM` in the margin, then the material, then the signature.
   - Escape `&`, `<`, and `>`, and keep the sender's punctuation.
   - Add the sender's title, context line, provenance note, or dated addition only where the grammar allows it.
   - Give the item a stable `id` of the form `<published-date>-<slug>`.
2. **Attribution check.**
   - The margin FROM line and the signature show the same name or initials, or `UNSIGNED` and `Unsigned`.
   - No email address, reference, received date, or editorial note appears anywhere in the file.
3. **Media sanitisation** (images and any other published file).
   - Rename to a neutral `assets/observations/<slug>.<ext>`. Never publish the original file name.
   - Strip all metadata: `exiftool -all= -tagsfromfile @ -Orientation <file>`. PDFs are published only as images or excerpts in v1.
   - Verify: `exiftool -a -G1 <file>` shows no GPS, device make, model, or serial, owner or author, software, or original timestamps.
   - **Look at the image itself**, not only its metadata. Check for faces, names, email addresses, account names, notification banners, open tabs, window titles, file paths, QR codes and barcodes, badges and ID cards, addresses, licence plates, reflections, internal URLs, and colleagues' messages.
   - If anything identifying is unintended, **ask the sender**. Do not crop or edit silently: that edits the material. Publish only the version the sender agrees to.
   - Re-save photographs only to strip metadata or to reach a sensible web size, for example a long edge of 2,400–3,000 px. Never retouch.
   - Write `alt` text describing what the image shows.
4. **Page state.** Remove every prototype stand-in before the first real publication. Keep the page `noindex` and the navigation undeployed until launch.
5. **Check locally** at desktop and mobile widths, including "open original" for images.
6. **Commit and deploy.** Commit as `feat(observations): publish <slug>`, push to `main`, and confirm the production deploy.
7. **Tell the sender** in a personal email with the address of the piece, and move the message to `OBSERVATIONS/PUBLISHED`.

### Additions and withdrawals

- **Addition:** the sender writes from the same address. Add the `ADDED BY THE SENDER` block with the date, then commit and deploy.
- **Withdrawal:** the sender writes from the same address. Remove the item and its media, commit and deploy, reply to confirm, and delete the mailbox message. The sender is told plainly that the piece is removed from PROBNAYA; git history and copies made while it was public cannot be erased.

---

## 6. SMTP credential boundary

### The problem

The credential is an app password on the account behind `mail@probnaya.work`. Mail protocols reach Gmail through the full-mailbox scope, so a credential that can send by SMTP can, while IMAP or POP is enabled, also **read** the mailbox. From v1 that mailbox holds unpublished Observations, intake problems, and Access requests.

`surface` needs only to send. Today its copy is also in **Preview**, which receives every preview deployment of a branch pushed to a public repository.

### Options, smallest first

| Option | What changes | Reduces reading authority | Cost and effort | Caveats |
|---|---|---|---|---|
| **1. Remove from Preview** | Delete `SMTP_*` from `surface` Preview. Keep Production. | Removes the credential from preview deployments. | Configuration only. | Preview can't send real mail. Test with the mocked mailer in `node --test`, or use a temporary branch-scoped Preview variable with a separate test sender only when an end-to-end preview test is truly needed. |
| **2a. Turn POP and IMAP off for the account** | In Admin console → Gmail → End User Access, place the `mail@probnaya.work` user in its own organisational unit with POP and IMAP off. | **Yes.** The app password can still authenticate SMTP to send, but cannot fetch mail. | Admin setting, no code, no cost. Up to 24 hours to take effect. | Any IMAP or POP client on that account stops working. Gmail web and the Gmail app are unaffected. The app password may still reach calendar and contacts. It can still send as `mail@probnaya.work`, which any send credential can. |
| **2b. A dedicated send-only user** | A new user such as `relay@probnaya.work`, in an organisational unit with POP and IMAP off, with its own app password. Both projects send as it; `To` stays `mail@probnaya.work`. | **Yes.** The deployed credential belongs to an empty mailbox. | One Workspace licence and a credential rotation in both projects. | This is what the Access checklist already recommends as hardening. The sender domain still aligns for SPF, DKIM, and DMARC. |
| **3. Gmail API with a service account** | A service account with domain-wide delegation limited to the `gmail.send` scope; the function calls the Gmail API instead of SMTP. | **Yes, and no password at all.** The scope can only send. | A Google Cloud project, delegation in the Admin console, a private key in Vercel, and about 60 lines of token-signing code replacing nodemailer. | Delegation can send as any user in the domain unless constrained. More moving parts than v1 needs. |
| **Rejected: a third-party email service** | A send-only API key. | Yes. | New DNS records for DKIM. | Sends unpublished material to a new processor. |

### Recommendation

- **Before implementation:** Option 1. Decide the preview testing path, which is the mocked mailer by default.
- **Before the first public submission:**
  - **Option 2a** if nobody reads `mail@probnaya.work` through an IMAP or POP client. It is the smallest real reduction.
  - **Otherwise Option 2b.**
- **Postpone Option 3** unless the credential needs to be removed entirely.

**Verification after 2a or 2b takes effect:**

1. An IMAP login with the deployed app password fails.
2. An intake submission and an Access request still arrive.
3. `Show original` still reports SPF, DKIM, and DMARC PASS.

Rotation stays coordinated across `surface` and `probnaya-access`.

**Nothing in this section is changed yet.**

---

## 7. Privacy notes

- **The mailbox is the only store of unpublished material and sender addresses.** Section 6 is what protects it.
- **Declines are deleted within 30 days.** Kept items are held only with agreement. Published messages are kept only while the piece is published.
- **The repository only ever contains what was published, as it was published.** First real material stays on an unpushed branch until launch.
- **Logs carry outcome codes only.**
- **A short legal check of the send explanation** as an EU privacy notice is still recommended before launch, as the direction document notes.

---

## 8. What is needed when

### Required before the first public submission

- The SMTP decisions in section 6: Option 1, plus 2a or 2b, applied and verified.
- `api/observations.js` with tests, following intake's structure and Access's transport and logging.
- The send form connected to the endpoint: one attachment, browser preparation for large images, the size message, and an error state.
- The Gmail filter and labels `OBSERVATIONS/RECEIVED`, `KEEP`, and `PUBLISHED`.
- The publication checklist written into the repository, for example in `docs/`, so every publication follows the same steps.
- `observations.html` cleared of all prototype material, with real pieces added on an unpushed branch.
- One end-to-end test: a phone photograph over 3.1 MB, a large PNG screenshot, a PDF under budget, and an oversized PDF refused with the message.
- Launch release: first batch, header navigation, homepage threshold, `sitemap.xml` entry, and `noindex` removed, all together.

### Manual for the first 10–30 Observations

- Editorial state in Gmail labels.
- Asking, keeping, and published notices as personal emails.
- Hand-writing each observation into `observations.html`.
- Metadata stripping and the visual identifying-content check.
- Retention sweeps of declined messages.
- Junk handling. The honeypot and limits are the only automatic defences.

### Postponed

- Structured content sources and a generator, until hand-editing becomes error-prone or repetitive.
- A database, object storage, direct uploads, multiple attachments, and server-side media processing.
- Dashboards, a CMS, and editor authentication.
- Automatic sender email.
- Per-observation routes, splitting by year, RSS, search, and an Interior trace.
- CAPTCHA and stateful rate limits. A Vercel Firewall rule for `POST /api/observations` is optional, if the plan allows.
- Gmail API with a service account (section 6, Option 3).

---

## 9. Implementation plan

1. **Credential boundary, as decisions first.** Confirm Options 1 and 2a or 2b, the preview testing path, and the verification steps. Apply them in Vercel and the Admin console only after approval.
2. **Endpoint.** Add `api/observations.js` and `test/observations.test.js`, covering validation, the 4.4 MB guard, the honeypot, leading-byte checks, the single attachment, message construction, failure paths, and that nothing is logged. The site stays deployable, and the endpoint is unreferenced until the form uses it.
3. **Form.** Connect the frozen send interaction to the endpoint, add the browser image preparation and the size message, and verify with real phone files locally against a console transport.
4. **Page preparation.** Clear the prototype material and stand-in images from `observations.html`, keep `noindex`, and add the publication checklist to `docs/`.
5. **Mailbox.** Create the filter and labels. After the credential change, run one production test submission to `mail@probnaya.work` before any public link exists, then delete it.
6. **Private collection.** Invited senders email `mail@probnaya.work` or use the unlinked form. Hand-write accepted pieces into `observations.html` on a local, unpushed branch, applying the checklist.
7. **Launch.** One release pushes the first batch, the navigation and homepage entry, the `sitemap.xml` entry, and the `noindex` removal. Verify desktop, mobile, and a signed-in holder's header in production, and tell each sender their piece is published.

---

## Sources

- [Vercel Functions limits — request body size](https://vercel.com/docs/functions/limitations)
- [Gmail receiving limits in Google Workspace](https://knowledge.workspace.google.com/admin/gmail/gmail-receiving-limits-in-google-workspace)
- [Turn POP & IMAP on or off for users](https://knowledge.workspace.google.com/admin/sync/turn-pop-and-imap-on-or-off-for-users)
- [Sign in with app passwords](https://support.google.com/accounts/answer/185833)
- [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [OAuth 2.0 mechanism for IMAP, POP, and SMTP](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol)
- [Control API access with domain-wide delegation](https://support.google.com/a/answer/162106)
