# Objects integration

`/objects` is the workshop: the things the laboratory makes to be kept rather
than run, one bay each, on the one page of the site with an ink ground. The
first is Object 001, EX–, at `/objects/001`. Objects are reached from 03 in the
index and, while an object is proposed, from its band on the home page.

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

## Social images

`/objects` shares `assets/og-objects-1200x630.png` and `/objects/001` shares
`assets/og-object-001-1200x630.png`, both 1200 × 630. They are the design's own
exports (Claude Design project `d02780a6-…`, `site/assets/`), committed as
delivered; there is no generator for them in this repository. Keep each page's
`og:image:alt` and `twitter:image:alt` identical.

## Configuration

The card is one ground and one white. Beside the lede the reader picks the
ground (BLACK or BLUE) and the finish (PEARL SHEEN or WHITE); the card on the
plate shows the choice, it is kept in `localStorage['probnaya:ex-config']` on
that device only, and it is echoed above the interest form. The options, their
names and the default (black · pearl sheen) come from `objects`
(`CONFIG` in `object.js`); the buttons' `data-set` / `data-v` must match them,
and `test/objects.test.js` checks that they do. FRONT / BACK shows the back:
each time, a random issue number out of 50 and the blue dot it places. On
phones the wallpaper sheet gives way to a swipe slider of the three phone
wallpapers.

## Interest

The page's primary action is the free wallpaper pack; interest is secondary.
The interest form posts to the existing `/api/intake` on channel B. It asks for
one thing, an email address, which also stands in for the sender's name: the
mail subject is `INTAKE / CHANNEL B — <email>` and the body is
`OBJECT 001 — EX– · INTEREST`, then `CONFIGURATION · <GROUND> · <FINISH>`, then
its terms. It is not an order: no payment and
no postal address are asked for, sent or stored. At 20 registrations PROBNAYA
asks a printer for a quote; everyone registered then gets one email with the
price and an order link.

Mail is sent only where `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are set. They
are set for Production only, so on a Preview the endpoint answers 500 and the
page shows its error line.

`api/intake.js` is unchanged; `test/objects.test.js` holds the copied message
builder to that endpoint's validation, the honeypot and the mail it produces.

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
