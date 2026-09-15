# Public → Access → Interior

Status: integrated with production Access. Interior content (correspondence, investigations, issued objects, the issued representation) has no production source yet; see *Content boundary*.

## One product path

Public PROBNAYA shows one quiet path in the existing desktop and mobile header: **ENTER** for anyone Access does not recognize, or the holder's return path for anyone it does. ENTER opens `https://access.probnaya.work/`, where **PRESENT KEY**, **ESTABLISH ACCESS**, and **RECOVER ACCESS** are unchanged.

### First entry

Access is established on request (`design/access-request-establishment.md`, `docs/access-architecture.md`).

1. Public PROBNAYA / ENTER.
2. Access / ESTABLISH ACCESS / *Leave an address.* / EMAIL / REQUEST ACCESS → *Received.* A message goes to `mail@probnaya.work`; Access stores nothing.
3. PROBNAYA replies with a one-time establishment link, `https://access.probnaya.work/#establish=…`, issued by the operator for a new pending holder.
4. The link opens Access / ESTABLISH ACCESS / *Issue the first key.* / KEY LABEL / CREATE PASSKEY. Opening it does nothing else.
5. Browser-owned WebAuthn registration; the server atomically activates the holder, consumes the link's authority, stores the credential, opens the session, and issues recovery codes.
6. Recovery codes are acknowledged once.
7. Access replaces itself with `https://probnaya.work/interior/` → CURRENT.

The request leaves no trace in the Interior; `Relation established` is the first shared fact.

### Returning entry

Public PROBNAYA / ENTER → Access / PRESENT KEY → native WebAuthn → Interior / CURRENT. Access replaces its own history entry on the way, so Back from CURRENT returns to the Access boundary (`AUTHENTICATED · INTERIOR → · ACCESS RECORD · END SESSION`), never to a finished ceremony.

### Leaving

- **Public PROBNAYA is not leaving.** The wordmark, `PUBLIC` (mobile), `CONTINUE THROUGH PUBLIC PROBNAYA →`, and RELATION / SESSION / `PUBLIC PROBNAYA · REMAIN RECOGNIZED →` all go to public pages; the session is untouched.
- **Ending the session is deliberate and lives in one place:** RELATION / SESSION / `END SESSION · ACCESS →`. It opens Access `#end`, which names the holder, states `PRESENT KEY TO ENTER AGAIN`, and offers `END SESSION` or `← INTERIOR`. The unchanged logout POST closes the session and Access replaces itself with `https://probnaya.work/`. Recognition and the representation disappear; ENTER returns; `/interior/` and Back both lead to PRESENT KEY.

No avatar, account menu, or settings centre was added.

## How recognition works

Access is the only authority. `js/relation.js` asks `GET https://access.probnaya.work/api/relation` with the browser's own Access cookie (credentialed CORS, exact origin `https://probnaya.work`). The response is the holder identifier, key count, recovery condition, establishment time, and last verification — no token of any kind. The endpoint is specified in `docs/access-architecture.md`.

- **Interior** asks on load, on route changes after 60 s, when the tab becomes visible, and when restored from history. It renders nothing until Access answers. `401` → Access (`#expired` when this browser was recognized before). Unreachable → `Access unreachable.` with `ASK ACCESS AGAIN` and `PUBLIC PROBNAYA`; it never redirects in a loop. The page empties itself on `pagehide`, so a history snapshot holds no holder content.
- **Public pages** ask only when `localStorage['probnaya:recognized']` is set. The Interior sets that hint after a successful read; any `401` clears it. The hint decides whether to ask, never what to show. Unrecognized visitors never contact Access.
- Session idle refresh and rotation are Access's, so moving through public PROBNAYA keeps an active session alive and never extends its absolute lifetime.

## Issued representation

A holder is represented by an issued MPA–01 Machine Portrait, or by the apparatus field until one is issued. `js/representation.js` draws an issued portrait from its measured 16 × 16 matrix only through the apparatus' own mark authority, `instrument-mpa/js/turn2.js`:

- below 96 px: **2A RASTER** (one level per cell, whole-pixel exact);
- from 96 px: **2C CONCENTRIC**, the principal mark of the issued PORTRAIT face, including the blue fiducial cell.

The portrait keeps the paper it was issued on (`#EFF0F2`) inside a hairline edge, square and uncropped, so it reads as an object with extent rather than a profile photograph. The unissued field is identical for every holder: square extent, orthogonal axes, fixed centre.

Where it appears, and only there:

| Surface | Size | Role |
|---|---|---|
| Interior header, beside `PROB–H–…` | 20 px raster | who is inside; opens RELATION |
| RELATION / REPRESENTATION | 176 px plate (96 px mobile) | the holder's representation, with issue ID and date |
| HELD / 01 · MACHINE PORTRAIT | 232 px plate | the object, with provenance and `VIEW OBJECT →` |
| HELD / object | up to 448 px plate | the full issued object |
| Public header return path | 16 px raster | `▦ INTERIOR PROB–H–…` |

CURRENT and HISTORY do not repeat it. The public PROBNAYA mark is never replaced. Obtaining a portrait is never prompted: an unissued relation states `REPRESENTATION · UNISSUED` and nothing more.

### Return path on public pages

The portrait alone would read as an avatar; the identifier alone is abstract. The combined treatment — issued raster, `INTERIOR`, holder ID — reads as an issued object with provenance and names where the link goes. Mobile keeps the raster and ID and drops the word, and fits at 320 px on every page that loads `js/site.js`.

## First-entry state

A newly established holder (Access-proven facts only):

- **CURRENT** — for the first 24 hours the primary matter is the one real current fact: `Relation established.` with ACCESS `01 KEY`, RECOVERY `ESTABLISHED`, REPRESENTATION `UNISSUED`; then `OPEN BETWEEN US · NOTHING OPEN`. Afterwards: `Nothing open.` with `CORRESPONDENCE · NONE UNREAD` and `INVESTIGATIONS · NONE OPEN`.
- **HELD** — `Nothing issued.` with `OBJECTS 00` and `REPRESENTATION UNISSUED`.
- **HISTORY** — one event: `Relation established`, dated from Access.
- **RELATION** — unissued field, standing counts at `00`, `01 KEY`, `RECOVERY ESTABLISHED`, last entry, OPEN ACCESS, and the session actions.

No onboarding cards, tours, illustrations, or invented content.

## Content boundary

Access proves identity, keys, recovery, establishment, and session. Nothing in production yet supplies correspondence, commissioned investigations, issued objects, or a holder ↔ issued-portrait link (MPA–01 V1 issues client-side with no registry). Production therefore renders the first-entry content state for every holder.

`interior/fixtures.js` supplies populated content for two local holders only, so populated states can be rendered against a real local Access session. It is excluded from deployment by `.vercelignore` and imported only on `localhost`:

- `PROB–H–0087` — unread correspondence, one open investigation, two issued objects, and an issued portrait whose matrix was derived by MPA–01 from the synthetic specimen in `objects/machine-portrait/test/fixtures/`;
- `PROB–H–0119` — the same relation without a portrait.

## Local run

Serve the public site on `http://localhost:4173` (`.claude/dev-server.js`) and Access on `http://localhost:4174` with `ACCESS_ENV=development`, `ACCESS_LOCAL_ORIGIN=http://localhost:4174`, `ACCESS_PUBLIC_ORIGIN=http://localhost:4173`, `ACCESS_USE_MEMORY_STORE=true`, three 32-byte keys, and `ACCESS_DEV_ENROLLMENT_TOKEN` / `ACCESS_DEV_PUBLIC_ID` naming the holder to establish (`PROB–H–0087`, `PROB–H–0119`, or any other ID for the unpopulated state); open `http://localhost:4174/#establish=<token>`. Add `ACCESS_DEV_REQUEST_OUTBOX=console` to see REQUEST ACCESS messages in the dev server output.

## Rendered verification (2026-09-15)

Run in Chromium against the real local Access server, with WebAuthn ceremonies performed by an in-page WebCrypto P-256 authenticator and verified by the server:

- first enrollment → codes → CURRENT; CURRENT / HELD / HISTORY / RELATION for unissued-empty, issued-populated, and unissued-populated holders;
- public ↔ Interior while recognized on `/`, `/lab`, `/lab/001`, `/instruments`, `/instrument-0x2f`, `/instrument-057`, `/instrument-mpa-01`, `/investigations`, `/intake`, `/record`;
- RELATION → OPEN ACCESS → Access record → add key → RELATION shows `02 KEYS`;
- RELATION → END SESSION → public with ENTER; Back and direct `/interior/` → PRESENT KEY; PRESENT KEY → CURRENT; Back → Access boundary;
- unknown session (server restarted) → Access `SESSION ENDED. PRESENT KEY TO CONTINUE.`; Access stopped → `Access unreachable.`, public pages fall back to ENTER;
- 1280 × 800, 375 × 812, and 320 × 700: document width equals viewport width on every Interior route and public page checked;
- keyboard order: skip link, wordmark, CURRENT / HELD / HISTORY, relation, content; route changes move focus to the page heading.
