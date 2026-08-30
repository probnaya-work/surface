# AGENTS.md

Instructions for AI coding agents working in this repository. Read this before making changes.

## Project overview

The Bogart Labs marketing site. A static, multi-page website — plain HTML/CSS/JS, no framework, no build step, no `package.json`. Each page is a real `.html` file with its own `<head>`; there is no client-side router and no templating engine. Shared code lives in `css/style.css` (one stylesheet, design tokens as CSS custom properties) and `js/` (a small canvas engine plus page-specific inline `<script>` blocks).

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

## Testing / verification

There is no automated test suite for the pages themselves. Before considering a visual or interaction change done:

1. Serve the site locally and check the page in-browser (both the change and anything it might affect).
2. Check both breakpoints — desktop and the mobile layout below 760px (resize or use device emulation). The two are meant to be structurally different (bottom tab bar vs. top nav, hero-only mobile index screen), not just a scaled-down desktop.
3. Check the browser console for errors.

`js/apparatus.js` is pure enough to unit-test headlessly with Node's `vm` module against a mocked canvas/`requestAnimationFrame` — useful for verifying a builder doesn't throw across different simulated frame rates (60Hz, 144Hz, a backgrounded-tab stall) before trusting it in-browser. Write such a harness to a scratch file rather than committing it as project infrastructure unless asked to.

## Commits

Follow `docs/commit-convention.md`. In short: `type(scope): imperative subject`, one logical change per commit, no vague or filler wording, no AI/tool attribution in commit messages or trailers.
