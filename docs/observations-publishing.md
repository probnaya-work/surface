# Observations — publishing from the terminal

One Observation is one independent publication with its own permanent archival address, `https://probnaya.work/observations/<number>`, where `<number>` is three digits: `001`, `002`, and so on. Each is created as a draft, validated, previewed in the real template, and then published with one explicit command. No command commits, pushes, deploys, or sends anything.

```text
npm run observation:new                      create a draft (asks questions)
npm run observation:validate -- <number>       check it
npm run observation:preview  -- <number>       see it in the real template, locally
npm run observation:publish  -- <number>       publish it locally; then review, commit, deploy
```

Receiving, the mailbox, and media sanitisation are in `docs/observations.md`. Read §6.2 there before any image is published.

---

## 0. The approved design

The visual source of truth is the first design pass in Claude Design project `d02780a6-b7fa-4b59-89ac-64f60f27f3b1`, file **`PROBNAYA - Observations Published (sheets, superseded).dc.html`**. It was approved on 2026-09-21 despite "superseded" in its filename. Do not take `PROBNAYA - Observations Published.dc.html` or any other file in that project as the source without an explicit editorial decision recorded here. The implementation is `scripts/observations/render.js` and the observations section of `css/style.css`.

**Archival numbers are addresses, not marks.** Each Observation is at `/observations/<number>`, a three-digit number (`001`, `002`, …) assigned explicitly when its draft is made. The number is stored in the record as `number` and is never changed or given to another Observation, including after a withdrawal. It exists only to give the piece a stable archival address, in the URL, the canonical and Open Graph URLs, the sitemap, image paths, and the index fragment `#001`. **The number must never be visible in the interface.** It must not appear as a badge, a title prefix, margin metadata, a printed address line, or any identifier on the page or in the index. This keeps the editorial rule intact: other people's words carry no visible PROBNAYA registry mark. `PROB–OBS–001` and any other `PROB–` form stay forbidden. `O–XXXXXX` stays reserved for references to incoming mail. Titles, names, dates, and slugs are never part of the address.

As a consequence, the design's printed address under the sheet ("probnaya.work/observations#…") is not rendered.

Recorded departure from that design (2026-09-21): **no signature line under the material.** Who an Observation is from (name or UNSIGNED, then role and context, when given) is stated once, in the margin. The design's closing signature is not rendered.

Deliberately not implemented in this pass: the design's "ADDED BY THE SENDER" block and its margin provenance notes (for example "TEN OF 912 LINES / CHOSEN BY THE SENDER"). The wording addresses outside contributors ("FROM OUTSIDE THE LABORATORY", "SENT BY OTHERS"); it has not been reworded for authors inside PROBNAYA.

## 1. Where things live

```text
observations/_drafts/<number>/        a draft. Ignored by git and by Vercel. The repository is public:
                                    a draft must never be committed.
observations/<number>/                a published Observation. Committed and deployed.
  observation.json                  the record (not deployed)
  body.txt | body.md                the contributor's text, byte for byte (not deployed)
  body-2.txt, body-3.md …           further text blocks, when text and images alternate (not deployed)
  images/<number>-1.jpg …             the images, renamed; the original file name is never kept (deployed)
  index.html                        GENERATED: the Observation on its own sheet (deployed)
observations/ledger.json            every number ever published, and when it was withdrawn. Committed, never deployed.
observations.html                   the index. Only its two GENERATED regions are written by the build.
sitemap.xml                         one GENERATED region lists every published sheet.
```

Only `index.html` and `images/` are publicly addressable. `.vercelignore` allowlists exactly those two inside each `observations/<number>/` and excludes everything else there, including `observation.json` and the `body*` text files. As a second guard, validation refuses a text file with any other name, an image outside `images/`, and any unlisted file in a published directory. The files you started from (in your inbox, downloads, and so on) are only ever copied, and never enter the repository.

`observation.json`:

```json
{
  "number": "001",
  "status": "published",
  "published_at": "2027-03-02T09:14:05Z",
  "title": "What I do now is read",
  "author": "Sabine Hartmann",
  "author_role": "PRINCIPAL, PROBNAYA",
  "context": "legal translator, Vienna",
  "blocks": [
    { "text": "body.txt" },
    { "image": "images/what-i-do-now-is-read-1.jpg", "alt": "What the image shows, in plain words.", "caption": "Only if the sender gave one." },
    { "text": "body-2.txt" }
  ]
}
```

`blocks` is the material in reading order. Each block is either a text file or an image with its alt text and an optional caption. **The page shows the blocks in exactly the declared order.** Text may come before an image, after it, or between images, and consecutive images share one row. Nothing is reordered. A title, when given, always stands first. Nothing follows the material on the sheet.

`blocks` needs at least one block. Every other field except `number` and `status` is optional. `number` must match the directory name and never changes. Leave a field out rather than empty. Without `author` the Observation is unsigned. `author_role` and `context` are quiet lines in the margin under the name, for anyone. It gives no one a different position or style, and it needs an `author`. `published_at` is written by `observation:publish`; a draft never has it.

## 2. What a text file may contain

The text is shown exactly as sent: its words, casing, punctuation, emoji, spacing, and line breaks. A blank line starts a new paragraph. Anything that looks like HTML (`<script>`, `<img onerror=…>`, `<b>`, links) is escaped and shown as the characters typed. It is never interpreted or run.

- **`.txt`**: nothing is interpreted. Use it by default.
- **`.md`**: these are also recognised, and nothing else.
  - A line on its own starting with `# ` (up to six `#`) is a heading.
  - A block where every line starts with `- `, `* ` or `+ ` is a list.
  - A line of three or more `-`, `*` or `_` is a rule.
  - `**bold**` and `*italic*` within a line. The markers must hug the words: `5 * 3`, `a*b*c`, and `** x **` stay as typed.

  Links, `_underscores_`, and numbered lines stay exactly as typed. The text is escaped before emphasis is applied, so emphasis can only ever produce bold or italic. Use `.md` only when the sender's text is already written that way.

Two presentation rules apply to `.md` text. Neither changes the stored file:

- **A repeated title is shown once.** When the first `#` heading in the material is exactly the `title`, that heading is not rendered, because the title already heads the piece. Any other first heading stays.
- **Headings keep their hierarchy under the title.** The highest submitted heading sits one level below the title (`h2` on an Observation's own page, `h3` in the index). Deeper headings keep their distance from it, down to `h6`.

Save the text as UTF-8. Paste the sender's words into the file unchanged. Never retype them.

## 3. Creating each kind of publication

`observation:new` asks only for what is needed and copies everything into a new draft directory. Then it asks for the material **in reading order**, one file per answer. A `.txt` or `.md` file becomes a text block. Anything else is an image, and it asks for alt text and an optional caption. Paths may be relative to where you run the command. Leave an answer blank to omit it.

```text
Title, only if the sender gave one:
Name or initials (blank: unsigned):
Role, optional (for example PRINCIPAL, PROBNAYA):      ← asked only when there is a name
Context line, optional (for example "legal translator, Vienna"):
Block 1: text or image file (blank when done):
  Alt text, what the image shows (required):            ← for an image
  Caption, only if the sender gave one:                 ← for an image
Block 2: text or image file (blank when done):
Archival number, the permanent address /observations/<number> [002]:   ← Enter accepts the next free number
```

Images are JPEG, PNG, or WebP. They are copied, never moved, to `images/<number>-<n>.<ext>`. Text files are copied to `body.<ext>`, `body-2.<ext>`, and so on. `observation:new` proposes the next number that no draft, published Observation, or ledger entry has used, so pressing Enter is the normal answer. You may type another free three-digit number when needed. A number that is taken, or was ever published, is refused. Existing files are never overwritten: the command refuses instead.

**Text only.** One text file.

```text
Name or initials (blank: unsigned): L. M.
Context line, optional:
Block 1: text or image file (blank when done): ~/observations-inbox/it-is-accurate.txt
Block 2: text or image file (blank when done):
Archival number, the permanent address /observations/<number> [001]:
```

**Image only, or several images only.** One or more images, no text file.

```text
Name or initials (blank: unsigned):
Context line, optional:
Block 1: text or image file (blank when done): ~/observations-inbox/bed-rail.jpg
  Alt text, what the image shows (required): A laminated instruction card zip-tied to a hospital bed rail, its printed steps worn away and a shorter list written over them in marker.
  Caption, only if the sender gave one:
Block 2: text or image file (blank when done):
Archival number, the permanent address /observations/<number> [002]:
```

**Text and images, in the sender's order.** Give them in the order they should be read: an image and then its text, text and then an image, or text between images.

```text
Name or initials (blank: unsigned): E. Brandt
Context line, optional:
Block 1: text or image file (blank when done): ~/observations-inbox/frame-1.jpg
  Alt text, what the image shows (required): Frame 1: a robot lawnmower at dawn approaching a hedgehog on cut grass.
  Caption, only if the sender gave one:
Block 2: text or image file (blank when done): ~/observations-inbox/frame-2.jpg
  …
Block 3: text or image file (blank when done): ~/observations-inbox/brandt.txt
Block 4: text or image file (blank when done):
Archival number, the permanent address /observations/<number> [003]:
```

**Another image later**, appended as the last block, on a draft or on a published Observation (on a published one, the pages are rebuilt):

```bash
npm run observation:image -- 003 ~/observations-inbox/frame-3.jpg --alt "Frame 3: the mower approaching again from another side, stopped."
```

Add `--caption "…"` only if the sender gave a caption.

**Anything else**: edit `observation.json` or a text file in the draft directory directly, then validate again. To change the order, reorder the `blocks` list.

## 4. Validate

```bash
npm run observation:validate -- <number>     # one Observation
npm run observation:validate               # everything, and whether the generated pages are current
```

Validation reports each problem in words and exits non-zero when something is wrong. It refuses:

- a missing file; a path that is absolute or contains `..`, a hidden segment, a backslash, or a symbolic link
- missing or empty alt text
- an unsupported or misnamed format (GIF, HEIC, PDF, or a PNG named `.jpg`)
- an image that still carries identifying metadata: GPS, camera or lens, serial number, owner or artist, original dates, XMP, IPTC, or PNG text chunks. Strip it with the `exiftool` command that validation prints, which is the command in `docs/observations.md` §6.2.
- a number that is not exactly three digits (001–999), does not match its directory, is used by both a draft and a published Observation, or disagrees with `observations/ledger.json`
- a date that is invalid or in the future; `status` that disagrees with the directory; a draft with `published_at`
- an unknown field (for example `alt_text` for `alt`); a role without a name; a text file that is not UTF-8
- any file in a published directory that the record does not name, because it would be deployed

It warns, without refusing, about images larger than 3 MB and about anything in the material that looks like an email address or a mailbox reference (`O–…`). Confirm each of these with the sender.

## 5. Preview

```bash
npm run observation:preview -- <number>
```

This serves the whole site on `http://localhost:4177` with the draft placed in the sequence as if it were published now. It uses the same template and the same build as publication. Open `/observations/<number>` for its own sheet and `/observations#<number>` for its place in the index. Reload after editing. Nothing is written. Check the preview at desktop and mobile widths (below 760px). If port 4177 is taken, add `--port 4190`.

## 6. Publish

```bash
npm run observation:publish -- <number>
npm run observation:publish -- <number> --date 2027-03-02   # to state an earlier publication date
npm run observation:publish -- <number> --reissue           # only for a withdrawn Observation returning
```

Publishing validates the draft again and refuses if anything is wrong. As a final collision check, it refuses a number that is published or listed in the ledger. A withdrawn number is accepted only with `--reissue`, and only for the same Observation returning. It then records the number in `observations/ledger.json`, sets `status` and `published_at`, moves the directory from `observations/_drafts/` to `observations/`, and rebuilds the index, the sheet pages, and the sitemap. Nothing else changes. The text and images are never modified. Publication order is by `published_at`, then by number; a number never changes when others are added, withdrawn, or reordered. The index shows the newest publication first. Each sheet's ← PUBLISHED BEFORE and PUBLISHED AFTER → links follow publication order, and the extent line takes its date from the earliest publication.

The index states its extent as `SENT BY OTHERS · PUBLISHED BY PROBNAYA · PUBLISHED SINCE <MON YYYY>`, with the month and year taken from the earliest published Observation. The total number of publications is never displayed, on the index or anywhere else. Like the archival number, a count is not part of the interface.

Then:

1. Serve the site locally (the `probnaya-static` launch configuration, or `node .claude/dev-server.js`) and look at the result. Check the browser console.
2. Run `npm test`.
3. Commit exactly these paths:

   ```text
   observations/<number>/          (observation.json, the text files, images/, index.html)
   observations/ledger.json
   observations.html
   sitemap.xml
   ```

   For example `git commit -m "feat(observations): publish observation 001"`. Never commit `observations/_drafts/`; git ignores it.
4. Push and deploy only as a separate, deliberate step. Then write to the sender with the address (`docs/observations.md` §6.3, step 5).

## 7. Correct, withdraw, rebuild

- **Correct** a published Observation (for example a wrong alt text, or a caption the sender asked for): edit its `observation.json` in `observations/<number>/`, then run `npm run observations:build`. Never edit the sender's text without their agreement. Commit the directory and the rebuilt files.
- **Withdraw** it:

  ```bash
  npm run observation:unpublish -- <number>
  ```

  This moves the directory back to `observations/_drafts/<number>/` (out of git and out of the deployment), removes its sheet, marks the number withdrawn in `observations/ledger.json`, and rebuilds the index and the sitemap. The number is never given to another Observation. Commit the deletion of `observations/<number>/` together with `observations/ledger.json`, `observations.html`, and `sitemap.xml`. Tell the sender that earlier versions stay in the public repository's history and in any copies made while the Observation was public. The address `/observations/<number>` then returns 404. Delete the draft directory once it is no longer needed.
- **Rebuild** everything from the records at any time:

  ```bash
  npm run observations:build            # writes only what differs; building twice changes nothing
  npm run observations:build -- --check # writes nothing; exits 1 if a generated file is out of date
  ```

Never edit a GENERATED region of `observations.html`, a sheet's `index.html`, or the GENERATED region of `sitemap.xml` by hand. The next build replaces them. The sheets take their header, footer, and tab bar from `observations.html`, so a change to the site navigation needs `npm run observations:build` afterwards.

## 8. Tests and fixtures

```bash
npm test
```

`test/observations-publishing.test.js` works in temporary copies of the pages and never writes to the repository. `test/fixtures/observations/fixtures.js` holds the only sample material, all marked FIXTURE and drawn or written for testing. To look at every content combination in a browser, copy the site elsewhere and seed the copy (the script refuses to seed this repository):

```bash
rsync -a --exclude node_modules --exclude .git ./ /tmp/obs-fixtures/
node test/fixtures/observations/fixtures.js /tmp/obs-fixtures
PORT=4181 node /tmp/obs-fixtures/.claude/dev-server.js
```

## 9. What is stored where

**Git is the canonical store for published, public material, and only for that.** A published Observation's directory holds:

- the public title, the displayed name or initials, and an optional displayed role and context line
- the publication date and the archival number
- the contributor's text as published (`body*.txt` / `body*.md`, byte for byte)
- public image derivatives (renamed, with identifying metadata stripped), their alt text, and captions the sender gave
- the generated page

It never holds sender email addresses, mail headers or message IDs, mailbox references (`O–XXXXXX`), internal editorial notes, correspondence, local source paths or original file names, unpublished attachments, or images that still carry EXIF, XMP, IPTC, or PNG text metadata. The format enforces this:

- the record accepts only the fields in §1, and any other field is an error
- file references are relative and renamed by the CLI
- validation refuses anything that looks like an email address or a mailbox reference, identifying image metadata, and any file (hidden ones included) that the record does not name
- `.DS_Store` is ignored by git

`observations/ledger.json` holds only numbers and dates.

**Outside git:**

- drafts (`observations/_drafts/`, ignored by git and Vercel)
- raw submissions and their attachments (the mailbox, `docs/observations.md` §5)
- correspondence with senders and editorial notes
- the original files an image was prepared from

The publishing workflow uses no database and no external object storage. The one exception is outside it: whether a published Observation has been privately added to someone's PROBNAYA account lives only in the Access database, keyed by the archival number and nothing else ([observation-ownership.md](observation-ownership.md)). At the expected scale (a few dozen pieces a year, images of a few hundred kilobytes after preparation) the repository is the simplest durable store, and every change is reviewable in a commit.

**Future migration boundary.** If image weight in the repository ever becomes material, the image files can move to object storage without changing the public model. What stays fixed:

- the addresses (`/observations/<number>`)
- the record format (blocks, alt text, captions)
- the pages

Only the build's image URLs would change, from `/observations/<number>/images/…` to the storage origin. Records and text stay in git. Measure before moving; nothing needs to change for now.

## 10. Social sharing

`/observations` and every `/observations/<number>` share **one** image, `assets/og-observations-1200x630.png` (1200 × 630 PNG). It shows the section's own frame: the name, PROBNAYA, the margin label, and the field. It never shows a contributor's name, a title, a number, a quotation, or a submitted image. Everything that matters stays inside the central 630 × 630, so square and 2:1 crops keep it. No per-publication social image is generated or stored.

Each Observation page keeps its own title, canonical URL, `og:url`, and `og:title`, plus `article:published_time` and `article:section`. Its description (`description`, `og:description`, `twitter:description`) is a neutral line in PROBNAYA's voice: "An observation by {displayed author}, published as sent by PROBNAYA." or "An unsigned observation, published as sent by PROBNAYA." Metadata never extracts, truncates, summarises, or quotes the contributor's material. A signed Observation also gets `<meta name="author">` with the displayed name.

To change the image, edit `scripts/og/observations-og.html` (never deployed), open it through a local server, save the canvas (`window.ogPNG()`) over the asset, and keep the alt text in `observations.html` and `SHARE_IMAGE` in `scripts/observations/render.js` identical.
