# Observations — publishing from the terminal

One Observation is one independent publication with its own permanent address, `https://probnaya.work/observations/<slug>`. Each is created as a draft, validated, previewed in the real template, and then published with one explicit command. No command commits, pushes, deploys, or sends anything.

```text
npm run observation:new                      create a draft (asks questions)
npm run observation:validate -- <slug>       check it
npm run observation:preview  -- <slug>       see it in the real template, locally
npm run observation:publish  -- <slug>       publish it locally; then review, commit, deploy
```

Receiving, the mailbox, and media sanitisation are in `docs/observations.md`. Read §6.2 there before any image is published.

---

## 0. The approved design

The visual source of truth is the first design pass in Claude Design project `d02780a6-b7fa-4b59-89ac-64f60f27f3b1`, file **`PROBNAYA - Observations Published (sheets, superseded).dc.html`**. It was approved on 2026-09-21 despite "superseded" in its filename. Do not take `PROBNAYA - Observations Published.dc.html` or any other file in that project as the source without an explicit editorial decision recorded here. The implementation is `scripts/observations/render.js` and the observations section of `css/style.css`.

Deliberately not implemented in this pass: the design's "ADDED BY THE SENDER" block and its margin provenance notes (for example "TEN OF 912 LINES / CHOSEN BY THE SENDER"). The wording addresses outside contributors ("FROM OUTSIDE THE LABORATORY", "SENT BY OTHERS"); it has not been reworded for authors inside PROBNAYA.

## 1. Where things live

```text
observations/_drafts/<slug>/        a draft. Ignored by git and by Vercel. The repository is public:
                                    a draft must never be committed.
observations/<slug>/                a published Observation. Committed and deployed.
  observation.json                  the record (not deployed)
  body.txt | body.md                the contributor's text, byte for byte (not deployed)
  body-2.txt, body-3.md …           further text blocks, when text and images alternate (not deployed)
  images/<slug>-1.jpg …             the images, renamed; the original file name is never kept (deployed)
  index.html                        GENERATED: the Observation on its own sheet (deployed)
observations.html                   the index. Only its two GENERATED regions are written by the build.
sitemap.xml                         one GENERATED region lists every published sheet.
```

Only `index.html` and `images/` are publicly addressable. `.vercelignore` allowlists exactly those two inside each `observations/<slug>/` and excludes everything else there, including `observation.json` and the `body*` text files. As a second guard, validation refuses a text file with any other name, an image outside `images/`, and any unlisted file in a published directory. The files you started from (in your inbox, downloads, and so on) are only ever copied, and never enter the repository.

`observation.json`:

```json
{
  "slug": "what-i-do-now-is-read",
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

`blocks` is the material in reading order. Each block is either a text file or an image with its alt text and an optional caption. **The page shows the blocks in exactly the declared order.** Text may come before an image, after it, or between images, and consecutive images share one row. Nothing is reordered. A title, when given, always stands first, and the signature always stands last.

`blocks` needs at least one block. Every other field except `slug` and `status` is optional. Leave a field out rather than empty. Without `author` the Observation is unsigned. `author_role` is a quiet third line in the margin, for anyone. It gives no one a different position or style, and it needs an `author`. `published_at` is written by `observation:publish`; a draft never has it.

## 2. What a text file may contain

The text is shown exactly as sent: its words, casing, punctuation, emoji, spacing, and line breaks. A blank line starts a new paragraph. Anything that looks like HTML (`<script>`, `<img onerror=…>`, `<b>`, links) is escaped and shown as the characters typed. It is never interpreted or run.

- **`.txt`**: nothing is interpreted. Use it by default.
- **`.md`**: three structures are also recognised, and nothing else.
  - A line on its own starting with `# ` (up to six `#`) is a heading.
  - A block where every line starts with `- `, `* ` or `+ ` is a list.
  - A line of three or more `-`, `*` or `_` is a rule.

  `*emphasis*`, links, and numbered lines stay exactly as typed. Use `.md` only when the sender's text is already written that way.

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
Slug, the permanent address /observations/<slug> [suggested]:
```

Images are JPEG, PNG, or WebP. They are copied, never moved, to `images/<slug>-<n>.<ext>`. Text files are copied to `body.<ext>`, `body-2.<ext>`, and so on. A slug or a file that already exists is never overwritten: the command refuses instead.

**Text only.** One text file.

```text
Name or initials (blank: unsigned): L. M.
Context line, optional:
Block 1: text or image file (blank when done): ~/observations-inbox/it-is-accurate.txt
Block 2: text or image file (blank when done):
Slug, the permanent address /observations/<slug> [under-the-last-photograph-of-my-father]: it-is-accurate
```

**Image only, or several images only.** One or more images, no text file.

```text
Name or initials (blank: unsigned):
Context line, optional:
Block 1: text or image file (blank when done): ~/observations-inbox/bed-rail.jpg
  Alt text, what the image shows (required): A laminated instruction card zip-tied to a hospital bed rail, its printed steps worn away and a shorter list written over them in marker.
  Caption, only if the sender gave one:
Block 2: text or image file (blank when done):
Slug, the permanent address /observations/<slug> [observation]: bed-rail
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
Slug, the permanent address /observations/<slug> [our-garden-6-a-m-it-stopped]: it-stopped-every-time
```

**Another image later**, appended as the last block, on a draft or on a published Observation (on a published one, the pages are rebuilt):

```bash
npm run observation:image -- it-stopped-every-time ~/observations-inbox/frame-3.jpg --alt "Frame 3: the mower approaching again from another side, stopped."
```

Add `--caption "…"` only if the sender gave a caption.

**Anything else**: edit `observation.json` or a text file in the draft directory directly, then validate again. To change the order, reorder the `blocks` list.

## 4. Validate

```bash
npm run observation:validate -- <slug>     # one Observation
npm run observation:validate               # everything, and whether the generated pages are current
```

Validation reports each problem in words and exits non-zero when something is wrong. It refuses:

- a missing file; a path that is absolute or contains `..`, a hidden segment, a backslash, or a symbolic link
- missing or empty alt text
- an unsupported or misnamed format (GIF, HEIC, PDF, or a PNG named `.jpg`)
- an image that still carries identifying metadata: GPS, camera or lens, serial number, owner or artist, original dates, XMP, IPTC, or PNG text chunks. Strip it with the `exiftool` command that validation prints, which is the command in `docs/observations.md` §6.2.
- a slug that is invalid, or used by both a draft and a published Observation
- a date that is invalid or in the future; `status` that disagrees with the directory; a draft with `published_at`
- an unknown field (for example `alt_text` for `alt`); a role without a name; a text file that is not UTF-8
- any file in a published directory that the record does not name, because it would be deployed

It warns, without refusing, about images larger than 3 MB and about anything in the material that looks like an email address or a mailbox reference (`O–…`). Confirm each of these with the sender.

## 5. Preview

```bash
npm run observation:preview -- <slug>
```

This serves the whole site on `http://localhost:4177` with the draft placed in the sequence as if it were published now. It uses the same template and the same build as publication. Open `/observations/<slug>` for its own sheet and `/observations#<slug>` for its place in the index. Reload after editing. Nothing is written. Check the preview at desktop and mobile widths (below 760px). If port 4177 is taken, add `--port 4190`.

## 6. Publish

```bash
npm run observation:publish -- <slug>
npm run observation:publish -- <slug> --date 2027-03-02   # to state an earlier publication date
```

Publishing validates the draft again and refuses if anything is wrong. It then sets `status` and `published_at`, moves the directory from `observations/_drafts/` to `observations/`, and rebuilds the index, the sheet pages, and the sitemap. Nothing else changes. The text and images are never modified. Sheets are ordered earliest first by `published_at`, then by slug.

Then:

1. Serve the site locally (the `probnaya-static` launch configuration, or `node .claude/dev-server.js`) and look at the result. Check the browser console.
2. Run `npm test`.
3. Commit exactly these paths:

   ```text
   observations/<slug>/          (observation.json, the text files, images/, index.html)
   observations.html
   sitemap.xml
   ```

   For example `git commit -m "feat(observations): publish it-is-accurate"`. Never commit `observations/_drafts/`; git ignores it.
4. Push and deploy only as a separate, deliberate step. Then write to the sender with the address (`docs/observations.md` §6.3, step 5).

## 7. Correct, withdraw, rebuild

- **Correct** a published Observation (for example a wrong alt text, or a caption the sender asked for): edit its `observation.json` in `observations/<slug>/`, then run `npm run observations:build`. Never edit the sender's text without their agreement. Commit the directory and the rebuilt files.
- **Withdraw** it:

  ```bash
  npm run observation:unpublish -- <slug>
  ```

  This moves the directory back to `observations/_drafts/<slug>/` (out of git and out of the deployment), removes its sheet, and rebuilds the index and the sitemap. Commit the deletion of `observations/<slug>/` together with `observations.html` and `sitemap.xml`. Tell the sender that earlier versions stay in the public repository's history and in any copies made while the Observation was public. The address `/observations/<slug>` then returns 404. Delete the draft directory once it is no longer needed.
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
