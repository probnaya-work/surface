# Objects integration

`/objects` lists the things the laboratory makes to be kept rather than run.
The first is Object 001, EX–, at `/objects/001`. An object is reached from its
band on the index, the OBJECTS group on the lab card and `/objects`; it has no
place in the header.

## Ownership boundary

`probnaya-work/objects/ex` is the source of truth for Object 001's behaviour and
artwork: the card's lens model, the object record and interest message, the page
controller, and the wallpapers with the generator that draws them. The files in
`objects/001/js/` and `objects/001/wallpapers/` are a deploy artifact. Do not
edit them in `surface`.

`objects/001/index.html` is surface-owned: markup, copy, metadata and layout.
It loads the behaviour with one module script, `/objects/001/js/page.js`, which
finds its elements by id. Artifact paths are absolute because the clean URL has
no trailing slash, so a relative `js/` would resolve under `/objects/`.

`objects/001/SOURCE.json` records the exact `objects` commit and the runtime
files copied. It is excluded from deployment in `.vercelignore`.

## Interest

The interest form posts to the existing `/api/intake` on channel B. The body
starts `OBJECT 001 — EX– · INTEREST`, and the mail subject is
`INTAKE / CHANNEL B — <name>`. It takes a name, an email and an optional note.
It is not an order: no payment and no postal address are asked for, sent or
stored. `api/intake.js` is unchanged; `test/objects.test.js` holds the copied
message builder to that endpoint's validation, the honeypot and the mail it
produces.

## Refreshing the artifact

From the `surface` repository, with a clean `objects` checkout at the intended
commit (run `node ex/scripts/render-wallpapers.mjs` there first if the
composition changed):

```sh
./scripts/sync-ex.sh
```

An alternate `objects` checkout can be passed as the first argument. Review the
diff, run `node --test ex/test/*.test.js` in `objects` and `npm test` here, and
walk `/objects/001` locally: turn the card with the pointer and both buttons,
check the phone layout below 760 px, and submit the form (locally, without SMTP
configured, the endpoint refuses and the page must show its error line).
