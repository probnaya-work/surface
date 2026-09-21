# AGENTS.md

Instructions for AI coding agents working in this repository. Read this before making changes.

## Project overview

The PROBNAYA marketing site. A static, multi-page website — plain HTML/CSS/JS, no framework and no build step. Each page is a real `.html` file with its own `<head>`; there is no client-side router and no templating engine. Shared code lives in `css/style.css` (one stylesheet, design tokens as CSS custom properties) and `js/` (a small canvas engine plus page-specific inline `<script>` blocks).

Keep it this way. Do not introduce a frontend framework, bundler, or package manager unless the task explicitly calls for it — dependency-light and readable-by-inspection is a deliberate constraint, not an oversight.

## Running locally

No install step. Serve the directory with any static file server, e.g.:

```
python3 -m http.server 4173
```

`.claude/launch.json` already defines this for the Claude Code browser preview. Open `index.html` (or any other page) directly — nothing needs a build.

## Code style

- HTML: one file per page, chrome (header/mobile-header/bottom-nav/footer) duplicated across pages rather than templated. This is intentional — no build step to inject partials, and duplication here is cheap to read and cheap to grep.
- CSS: all shared styling lives in `css/style.css`. Design tokens (`--ink`, `--paper`, `--blue`, `--mid`, `--faint`, `--border`, etc.) are CSS custom properties on `:root` — use them, don't hardcode hex values in new rules. Mobile layout is one `@media (max-width: 760px)` block at the bottom of the file, not a separate stylesheet.
- JS: no transpilation, no modules/bundling — plain `<script>` tags, loaded in dependency order (`apparatus.js` / `records.js` before page-specific inline scripts). Keep functions small and avoid adding a state-management or templating library for what a few `document.querySelector` calls already do.

## The apparatus (`js/apparatus.js`)

The canvas figures on every page are live simulations, not decorative animations — this distinction matters and should survive future edits:

- Every plate advances by measured delta-time (`dt`, `norm = dt * 60`), never by a fixed per-frame constant. A per-frame constant makes the drawing run faster on a 120/144Hz display than a 60Hz one — this has been a real, repeated bug in this file. When adding a new plate or changing an existing one, scale continuous motion by `norm` and pace any *periodic* effect (a fade every N frames, a sample every N ticks) with a fractional accumulator (`acc += norm; while (acc >= N) { acc -= N; ... }`), not `frame % N` or `Math.round`.
- Preserve the original cadence and alpha/speed constants when refactoring — the feel is meant to be restrained and mechanical (a plotter, not a screensaver). If a change makes a figure look smoother or more "animated," that's a regression, not an improvement.
- There is one shared `requestAnimationFrame` loop with a watchdog (`js/apparatus.js`, `ensureLoop`) — don't start a second `rAF` loop per plate.

## The mail handlers (`api/intake.js`, `api/observations.js`)

Vercel serverless functions, separate from the static site. `package.json` exists for them and for the Observations publishing scripts (`npm run observation:*`, which use Node's standard library only); `nodemailer` is the only dependency, and nothing in the site pages uses it.

Mail delivery uses Google Workspace SMTP with credentials supplied by the environment (`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Never hardcode or commit credentials. The sender address must remain the authenticated account or a verified alias on it. Both handlers send only to `mail@probnaya.work`, never to the person who submitted, and log codes only, never submitted content or addresses.

`api/observations.js` receives Observations. It stores nothing: the mailbox message is the editorial queue. Publication is a deliberate terminal step: `npm run observation:new`, `:validate`, `:preview`, `:publish` (`scripts/observations/`, documented in `docs/observations-publishing.md`). Each published Observation is a committed record in `observations/<number>/` at the archival address `/observations/<number>` (three digits, never reused, recorded in `observations/ledger.json`; the number is an address only and must never be shown in the interface), and the build writes its sheet page, two GENERATED regions of `observations.html`, and one of `sitemap.xml`. The approved visual source for Observations is fixed in `docs/observations-publishing.md` §0 (the first-pass design file, approved despite "superseded" in its name); never switch to another design file on your own. Git stores published public material only (drafts, raw submissions, and editorial notes stay outside it; see `docs/observations-publishing.md` §9), and the section has one shared social image (§10), never one per publication. Never edit generated output by hand, never commit `observations/_drafts/`, and keep the publishing commands free of git, network, and deployment side effects. The endpoint's limits keep every request under the Vercel Function body limit (4.5 MB), and `js/observation-attachment.js` prepares oversized images in the browser to match. `js/observations-field.js` draws the field above the sequence. Never add storage, a database, or automatic mail to senders without an explicit decision. Working procedure, limits, the pending mail-credential change, and the publication and media-sanitisation checklist are in `docs/observations.md`. The repository is public: never commit unpublished material or sender addresses.

## Testing / verification

The serverless functions have executable test suites; none of them contacts SMTP or Stripe:

```
npm test
```

(`node --test test/intake.test.js test/machine-portrait.test.js test/observations.test.js test/observations-publishing.test.js`.)

To exercise the Observations form locally without sending mail, set `OBSERVATIONS_DEV_OUTBOX=1` for the dev server; the endpoint then prints the message to the terminal. It refuses to do so on Vercel.

Name the file, not the directory. Tests live outside `api/` so Vercel never
turns test harnesses into public Functions.

The pages themselves have no automated tests. Before considering a visual or interaction change done:

1. Serve the site locally and check the page in-browser (both the change and anything it might affect).
2. Check both breakpoints — desktop and the mobile layout below 760px (resize or use device emulation). The two are meant to be structurally different (bottom tab bar vs. top nav, hero-only mobile index screen), not just a scaled-down desktop.
3. Check the browser console for errors.

`js/apparatus.js` is pure enough to unit-test headlessly with Node's `vm` module against a mocked canvas/`requestAnimationFrame` — useful for verifying a builder doesn't throw across different simulated frame rates (60Hz, 144Hz, a backgrounded-tab stall) before trusting it in-browser. Write such a harness to a scratch file rather than committing it as project infrastructure unless asked to.

## Commits

Follow `docs/commit-convention.md`. In short: `type(scope): imperative subject`, one logical change per commit, no vague or filler wording, no AI/tool attribution in commit messages or trailers.
