# Observations — operations and publication

Observations is where PROBNAYA publishes things other people noticed and sent to it. This document is the working procedure for receiving and publishing them. The editorial model is in `design/observations.md`; the architecture decision is in `design/observations-production.md`.

**Submission is not publication.** Nothing sent through the form appears anywhere until an editor deliberately edits `observations.html`, commits, and deploys.

---

## 1. What runs

| Part | File | Does |
|---|---|---|
| Send form | `observations.html` (send section and inline script) | Collects the material, one optional file, an optional name and context, and an email address. Shows preparing, sending, received, and failure states. |
| Field before the first publication | `js/observations-field.js` | While `<ol class="obs-sequence">` has no `<li>`, draws the field in the reading area. It is not mounted once the list holds an observation, so publishing the first one removes it with no other edit. |
| Attachment preparation | `js/observation-attachment.js` | Checks the file's content signature and, only when the file exceeds the transport budget, prepares an image to fit. |
| Endpoint | `api/observations.js` | Validates everything again, checks content signatures, and sends one plain-text message to `mail@probnaya.work` with `Reply-To` set to the sender and the file attached. Stores nothing. |
| Tests | `test/observations.test.js` | Endpoint behaviour with a mocked mailer. No real mail. |

There is no database, file store, dashboard, content generator, or automatic email to senders. The mailbox message is the only copy of an unpublished submission.

---

## 2. Limits and attachment behaviour

Vercel Functions accept at most **4.5 MB** of request body. Everything is sized to stay safely under it.

| Limit | Value | Enforced by |
|---|---|---|
| Whole request | 4,400,000 bytes | Endpoint (declared `Content-Length` and parsed body); form checks before sending |
| Attachment, decoded | 3,100,000 bytes, one file | Endpoint; form prepares or refuses |
| Material | 40,000 characters | Endpoint; `maxlength` in the form |
| Name | 120 characters | Endpoint; `maxlength` |
| Context | 160 characters | Endpoint; `maxlength` |
| Email | 200 characters, required | Endpoint; `maxlength` |

The largest permitted submission (3.1 MB file, 40,000 three-byte characters, full name and context) is about 4.3 MB of JSON. A test asserts this.

**Accepted file content** (checked from the bytes, never from the name or declared type): JPEG, PNG, GIF, WebP, HEIC/HEIF, PDF, UTF-8 plain text. Anything that decodes as text, including SVG or HTML, is delivered as `text/plain` with a `.txt` name. Everything else is refused.

**Browser preparation**, only when a file is larger than 3.1 MB:

| File | What happens |
|---|---|
| Photograph: JPEG, WebP, or HEIC the browser can decode | Resized to a 3,000 px long edge and re-encoded as JPEG at quality 0.86, stepping to 0.78, then 2,400 px and 2,000 px if still too large. |
| Screenshot: PNG | Legibility first. Lossless PNG at full size, then lossless PNG at 75% and 67% (never below a 1,600 px long edge). Only then high-quality lossy at full size (WebP 0.95 where the browser encodes WebP, otherwise JPEG 0.95), then lossless 50%, then smaller lossy steps. |
| PDF, text, GIF, or HEIC the browser cannot decode | Not changed. Refused with: `FILES UP TO 3 MB. SEND THE TEXT AND MENTION THE FILE; IF NEEDED, WE WILL ASK FOR IT.` |

Files within 3.1 MB are always sent exactly as chosen. Canvas re-encoding drops embedded metadata as a side effect, but **publication must still sanitise every file** (section 6).

Measured in Chromium against representative files, 2026-09-15:

| Sample | In | Out | Method |
|---|---|---|---|
| 12 MP phone photograph, EXIF orientation 6 and GPS | 4.27 MB | 1.09 MB | JPEG 0.86, 2250×3000, orientation applied |
| 48 MP photograph | 12.82 MB | 0.89 MB | JPEG 0.86, 3000×2250 |
| 12 MP HEIC | 2.73 MB | 2.73 MB | unchanged |
| 20 MB HEIC (Chromium cannot decode HEIC) | 20.36 MB | refused | size message |
| Phone screenshot, 1290×2796, text only | 0.55 MB | 0.55 MB | unchanged |
| Phone screenshot, photograph and text, noisy | 5.04 MB | 2.99 MB | lossless PNG at 67%, 860×1864 |
| 5K text screenshot with background grain | 9.52 MB | 1.39 MB | WebP 0.95 at full 5120×3200 |
| 5K text screenshot with heavy grain | 15.38 MB | 2.64 MB | WebP 0.95 at 3840×2400 |
| 5K screenshot of a photograph | 14.31 MB | 1.87 MB | WebP 0.95 at full 5120×3200 |
| PDF | 5.51 MB | refused | size message |
| ZIP | — | refused | unsupported message |

The worst full request among these was 4.10 MB. Text in every prepared screenshot was compared side by side with the original at the same display size and remained sharp.

---

## 3. Configuration

The endpoint reuses the public site's mail variables:

| Variable | Meaning |
|---|---|
| `SMTP_USER` | Workspace user that authenticates to `smtp.gmail.com:465` |
| `SMTP_PASS` | That user's app password |
| `SMTP_FROM` | Sender address; must be that user or a verified alias |

Without them the endpoint answers `503 submission_unavailable` and the form says sending is unavailable. It never falls back to anything else.

**Local development without sending mail.** Set `OBSERVATIONS_DEV_OUTBOX=1` (for example in `.env`, which `.claude/dev-server.js` loads) and run the dev server. The endpoint prints the message to the terminal instead of sending it. The outbox is refused whenever `VERCEL` is set, so it cannot run on a deployment.

**Logs.** Each refusal or failure writes one JSON line: `{"event":"observations.request","outcome":"refused|error","status":…,"code":…}`, plus a bounded `detail` such as `EAUTH` for delivery failures. Successful submissions and the honeypot write nothing. No log line ever contains material, names, context, addresses, file names, or error messages.

---

## 4. Required production mail change — awaiting approval

**§4.1 has been applied** (2026-09-15): the three SMTP variables in `surface` are restricted to Production. **§4.2 has not been done**, and §4.3 has been checked only for its last step. POP and IMAP remain as they were, and no mail user or app password has been created or rotated. Decide §4.2, with explicit approval, before public launch.

The credential in `SMTP_PASS` is a Workspace app password. Mail protocols reach Gmail through the full-mailbox scope, so while IMAP or POP is enabled for its user, that password can **read** the mailbox as well as send. From v1 the mailbox holds unpublished Observations as well as intake problems and Access requests.

### 4.1 Remove the credential from Preview (Vercel project `surface`)

Current state: `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` are set for **Production and Preview**. Production is the only environment that needs them.

Each of the three is **one shared variable record** whose targets are both Production and Preview, not a separate value per environment. Change only the record's targets; never delete it.

**Do not use `vercel env rm <name> preview`.** The CLI resolves the name to that shared record and sends `DELETE /v10/projects/{project}/env/{id}`, which deletes the whole record, including its Production value. The next production deployment would then have no mail credentials, and both intake and Observations would stop.

Use either target-only edit:

- **Dashboard:** project `surface` → Settings → Environment Variables → for each of `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` → Edit → clear **Preview**, keep **Production** → Save. Do not re-enter or change the value. If the dashboard insists on a value, stop and use the API instead.
- **API:** find each record's `id` with `GET https://api.vercel.com/v10/projects/surface/env` (sensitive values are not returned), then `PATCH https://api.vercel.com/v9/projects/surface/env/<id>` with the body `{"target":["production"]}`. Send no `value` field; the stored value is kept.

Either edit applies to new deployments only. Existing preview deployments keep the credentials they were built with until they are deleted or the app password is rotated.

Afterwards, `vercel env ls` must show the three variables for Production only. Consequences: on preview deployments, intake answers `Submission unavailable` and Observations answers `submission_unavailable`. Test those forms with `node --test` and the local outbox instead. If an end-to-end preview test is ever needed, add a temporary branch-scoped Preview variable for a separate test sender, and remove it afterwards.

`probnaya-access` already scopes its copy (`ACCESS_REQUEST_SMTP_*`) to Production only.

### 4.2 Make the deployed credential unable to read mail (Google Workspace Admin)

Choose one:

**Option A — turn POP and IMAP off for the sending account.** Use this if nobody reads `mail@probnaya.work` through an IMAP or POP mail client (Apple Mail, Outlook, Thunderbird). Gmail on the web and the Gmail apps are unaffected.

1. Admin console → Directory → Organizational units → create an OU, for example `Mail senders`.
2. Move the user behind `SMTP_USER` into that OU.
3. Apps → Google Workspace → Gmail → End User Access → select the OU → **POP and IMAP access**: off for both → Save.
4. Changes can take up to 24 hours.

**Option B — a dedicated send-only user.** Use this if an IMAP or POP client needs the main account.

1. Create a user, for example `relay@probnaya.work`, in its own OU with POP and IMAP off (steps 1–3 above), with 2-Step Verification on.
2. Create an app password for it.
3. Set `SMTP_USER=relay@probnaya.work`, `SMTP_PASS=<its app password>`, and `SMTP_FROM=relay@probnaya.work` in `surface` **Production**. Messages still go to `mail@probnaya.work`, and the sender domain still aligns for SPF, DKIM, and DMARC.
4. Decide separately whether `probnaya-access` moves to the same user by setting `ACCESS_REQUEST_SMTP_USER`, `ACCESS_REQUEST_SMTP_PASS`, and `ACCESS_REQUEST_SMTP_FROM` in its Production environment. Its runtime (`access/lib/config.js`) requires plain addresses and an app-password-length secret.

### 4.3 Verify

After the change has taken effect:

1. An IMAP login with the deployed app password fails.
2. An intake submission on production still arrives at `mail@probnaya.work`.
3. An Access request still arrives, if `probnaya-access` uses the same credential.
4. In Gmail, *Show original* on one message reports SPF, DKIM, and DMARC **PASS**.
5. `vercel env ls` for `surface` shows the SMTP variables in Production only.

Rotating the app password later must update every project that uses it at the same time.

---

## 5. Mailbox

Create once in `mail@probnaya.work`:

- A filter: **Subject** contains `OBSERVATION / RECEIVED` → **Apply the label** `OBSERVATIONS/RECEIVED` → never send to Spam.
- Labels: `OBSERVATIONS/RECEIVED`, `OBSERVATIONS/KEEP`, `OBSERVATIONS/PUBLISHED`.

| State | Action |
|---|---|
| **RECEIVED** | The filter labels the message. It is the only copy. |
| **REVIEW** | Read it. To ask for a change, reply to the sender; the reply goes to the address they entered. Their revision arrives in the same thread. |
| **DECLINE** | Delete the message and remove it from Trash within 30 days of receipt. Send one reply only if the sender needs redirecting, for example to intake. |
| **KEEP** | Only with the sender's agreement, confirmed by one reply. Label `OBSERVATIONS/KEEP`. Delete when the sender asks, or publish on the agreed date. |
| **Published** | Label `OBSERVATIONS/PUBLISHED` and keep the message while the piece is published. It is the record of consent and the way to recognise an addition or withdrawal from the same address. |

Never copy an email address, a reference, or a received time into the repository.

---

## 6. Publication checklist

Work on a local branch. **Until launch, never push real material:** the repository is public, so a pushed branch is already publication.

### 6.1 Material

1. Copy the material exactly as sent. Keep the sender's words, paragraphs, and punctuation. Do not correct, summarise, shorten, or retitle.
2. Escape `&` as `&amp;`, `<` as `&lt;`, and `>` as `&gt;`. Keep curly quotes and dashes as typed.
3. Add a new `<li class="observation">` at the **end** of `<ol class="obs-sequence">` (earliest first), using the template in 6.4.
4. Give it a stable `id` of the form `<published-date>-<slug>`, for example `2027-03-02-what-i-do-now-is-read`. The same value goes in the `PUBLISHED` link.
5. Attribution:
   - A name or initials appear identically in the margin `FROM` line and the signature.
   - A blank name is `UNSIGNED` in the margin and `Unsigned` in the signature, with `is-unsigned` on the signature.
   - A context line appears only if the sender gave one.
   - A title appears only if the sender gave one.
6. Search the new markup for `@` and for the reference `O–`. Neither may appear.

### 6.2 Media sanitisation

Every published file, without exception:

1. **Look at the image itself before anything else.** Check for faces; names and signatures; email addresses and account names; notification banners; open tabs, window titles, and file paths; internal URLs, tickets, and chat messages from other people; QR codes and barcodes; badges and ID cards; addresses, licence plates, and house numbers; screens and documents in the background; reflections in glass and screens.
2. **Anything unintentionally identifying goes back to the sender as a question.** Do not crop, blur, or edit silently: that edits the material. Publish only a version the sender has agreed to.
3. **Rename** the file to `assets/observations/<published-date>-<slug>.<ext>`. Never publish the original file name.
4. **Size, if needed.** For photographs, a long edge of 2,400–3,000 px is enough. Resize before stripping metadata: `sips -Z 3000 <file>`.
5. **Strip metadata** while keeping colour and orientation (install once with `brew install exiftool`):

   ```bash
   exiftool -all= -tagsfromfile @ -ICC_Profile -Orientation -overwrite_original <file>
   ```

6. **Verify.** The output must show no GPS fields, no camera make, model, lens, or serial number, no owner, author, artist, or copyright of a person, no software or host names, and no original date or time tags:

   ```bash
   exiftool -a -G1 -s <file>
   ```

7. **PDFs are not published as PDFs in v1.** Publish a sanitised image of the relevant page, or the text as the material.
8. **Text files** are published as the material or as the file object in the grammar, never as a download.
9. Write `alt` text describing what the image shows, in plain words.

### 6.3 Check and deploy

1. Serve locally and check the new observation at desktop and mobile widths, including *Open original* for images.
2. Check the browser console for errors.
3. Run the test suites (section 9).
4. Commit, for example `feat(observations): publish what-i-do-now-is-read`, push `main`, and confirm the production deployment.
5. Write to the sender from `mail@probnaya.work` with the address of the piece (`https://probnaya.work/observations#<id>`), and move their message to `OBSERVATIONS/PUBLISHED`.

### 6.4 Markup templates (the frozen grammar)

Text, with a name and context:

```html
<li class="observation" id="2027-03-02-what-i-do-now-is-read">
  <div class="obs-margin">
    <a class="obs-published" href="#2027-03-02-what-i-do-now-is-read"><span>PUBLISHED</span><span>02 MAR 2027</span></a>
    <span class="obs-from"><span>FROM</span><span>Sabine Hartmann</span></span>
  </div>
  <div class="obs-body">
    <div class="obs-text">
      <h2 class="obs-title">What I do now is read</h2>          <!-- only if the sender gave a title -->
      <p>First paragraph as sent.</p>
      <p>Second paragraph as sent.</p>
    </div>
    <p class="obs-sender"><span class="obs-name">Sabine Hartmann</span><span class="obs-context">legal translator, Vienna</span></p>
  </div>
</li>
```

Unsigned:

```html
    <span class="obs-from"><span>FROM</span><span>UNSIGNED</span></span>
    …
    <p class="obs-sender is-unsigned"><span class="obs-name">Unsigned</span></p>
```

Photograph or screenshot, before the text:

```html
    <figure class="obs-thing obs-thing--photograph">                <!-- or obs-thing--screenshot -->
      <a class="obs-thing-link" href="assets/observations/2026-11-10-door.jpg" target="_blank" rel="noopener"><img src="assets/observations/2026-11-10-door.jpg" width="825" height="1050" alt="Describe what the image shows."></a>
      <figcaption class="obs-thing-open"><a href="assets/observations/2026-11-10-door.jpg" target="_blank" rel="noopener">OPEN ORIGINAL ↗</a></figcaption>
    </figure>
```

Provenance note in the margin, only for what the sender chose, for example an excerpt:

```html
    <span class="obs-provenance"><span>TEN OF 912 LINES</span><span>CHOSEN BY THE SENDER</span></span>
```

A later addition by the sender, after the first `obs-body` inside the same `<li>`:

```html
  <div class="obs-margin obs-margin--addition">
    <span class="obs-provenance"><span>ADDED BY THE SENDER</span><span>03 MAR 2027</span></span>
  </div>
  <div class="obs-body obs-body--addition">
    <div class="obs-text"><p>The addition as sent.</p></div>
  </div>
```

---

## 7. Additions, corrections, and withdrawal

- **Addition or correction.** The sender writes from the same address. Add the dated addition block; never change the original text. Commit, deploy, and reply.
- **Withdrawal.** The sender writes from the same address. Remove the `<li>` and its media, commit, and deploy. Reply to confirm, then delete the mailbox message. Tell the sender plainly: the piece is removed from PROBNAYA, but its earlier version remains in the public repository's history and in any copies made while it was public.

---

## 8. Launch checklist

- [ ] Section 4 applied and verified.
- [ ] Gmail filter and labels created (section 5).
- [ ] One controlled real submission received, with an attachment, and then deleted.
- [x] Launch release: `<meta name="robots" content="noindex">` removed from `observations.html`; `https://probnaya.work/observations` added to `sitemap.xml`; OBSERVATIONS in the desktop and mobile navigation; the homepage entry. The page opened with no published observations and shows the field until the first is published (section 6).
- [ ] After deploy: desktop, mobile, and a recognized holder's header checked in production; one test submission through production; each published sender told.

---

## 9. Tests

```bash
node --test test/intake.test.js test/machine-portrait.test.js test/observations.test.js
```

`test/observations.test.js` never contacts SMTP. It covers methods and content types, both size guards, every field limit, header-injection defence, the honeypot, all content signatures and refusals, file-name reduction, the largest permitted request, message construction (recipient, sender, `Reply-To`, subject, text, attachment), missing configuration, delivery failures, log hygiene, and the local outbox, including its refusal on Vercel.
