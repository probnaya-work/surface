# Authenticated interior — implemented take

The cross-origin entry, issued-representation, public-return, empty-relation, and session-termination pass is documented in design/interior-integration.md.

## Observations

- Public PROBNAYA is organized by institutional kinds and conditions: instruments, apparatus, investigations, documents, and issued objects. Its identity comes from Archivo and Geist Mono, cool `#EFF0F2` paper, precise rules, sparse cobalt, large plain-language headings, and live figures that do actual explanatory work.
- Access is a deliberately separate security origin. Its entry is unusually reduced: `PRESENT KEY`, followed by the browser or operating-system WebAuthn ceremony, then an authenticated holder identifier. It uses a warmer paper and deliberately stops before the future interior.
- The previous account prototype made `YOUR RECORD` the primary object and put every event into one chronological ledger. That proved accumulation and provenance, but it made the interior read mainly as an archive or activity feed. It also repeated an explanatory authentication boundary that real Access now supplies.
- Existing material distinguishes apparatus from instruments and issue from purchase. Correspondence is issued, not scheduled; an issued object has provenance and representations; a commission is an investigation under the same register; the holder identifier names continuity but is neither a profile nor a credential.

## Decision

The interior is organized by the state of the relationship, not by account modules and not by a total record.

- **CURRENT** contains what is presently open between the holder and PROBNAYA. One unread piece of correspondence is the primary matter; the open commissioned investigation is subordinate but immediately available.
- **HELD** contains issued objects that remain attached to the relationship. This is where durable retrieval belongs.
- **HISTORY** contains correspondence, grants, issues, and work only after they cease to be current. Chronology remains useful, but it is no longer the home or the governing metaphor.
- The holder identifier opens a compact account of the relationship. Access appears there as a separate maintained security system, not as settings distributed throughout the interior.

The immediate post-authentication destination is CURRENT. It answers what changed because PROBNAYA recognized this person: private correspondence can be addressed to them, commissioned work can be open between both parties, and issued objects can remain held for them.

## Material system

The interior uses warm gray `#E9E8E3` rather than the public cool gray `#EFF0F2`. The shift is intentionally small but systemic: every gap, rule, reading surface, and fixed navigation bar belongs to the interior condition. Ink and institutional blue remain unchanged, as do Archivo, Geist Mono, 1px rules, square geometry, and the basic typographic discipline.

This is not light versus dark and it is not a themed account shell. The public surface remains cooler and more open; the interior is slightly denser and warmer because its content is addressed and retained. When the holder moves through a public page, the public material returns unchanged and a single return path — issued representation, `INTERIOR`, holder ID — preserves recognition.

## Implemented interaction

- Direct entry into CURRENT, without replaying authentication.
- Navigation by CURRENT, HELD, and HISTORY on desktop and mobile.
- Full reading surfaces for one correspondence, one issued Machine Portrait, and one private commissioned investigation.
- A relationship view that states standing and directs key or recovery work to Access without becoming a settings center.
- A working move into `/lab` while remaining locally recognized, with a return path injected into existing public headers.
- Recognition and session state come from Access (`GET /api/relation`); see design/interior-integration.md.

## Focused refinement

- HELD retains one ruled register rather than becoming a gallery. An issued Machine Portrait leads it as an object — the plate drawn from its record on its own paper, with issue, apparatus, measurement, and holder — and other issued objects follow as ruled rows with a small unframed measurement trace. Nothing is a card, tile, or thumbnail grid.
- RELATION states conditions only: REPRESENTATION, STANDING (established, correspondence, held, investigations), ACCESS (`02 KEYS`, `RECOVERY ESTABLISHED`, last entry, `OPEN ACCESS →`), and SESSION (`PUBLIC PROBNAYA · REMAIN RECOGNIZED →`, `END SESSION · ACCESS →`). No prose about origins or security architecture.
- CURRENT, HELD, and HISTORY moved from a `132px` ceiling to `102px`, then, in the integration pass, to `62px` (`clamp(42px, 4.8vw, 62px)`) with `38px` on mobile. Weight and tracking are unchanged; the headings name the place and leave the current matter, the held portrait, and the relation to carry the page.

## Rejected mechanisms

- **Another YOUR RECORD ledger:** useful as history, but too retrospective to explain what being inside means now.
- **A dashboard of correspondence, objects, investigations, and access cards:** translates repository nouns directly into product modules and gives unlike things false equality.
- **A dark or high-contrast private theme:** overstates secrecy and turns authentication into theatre.
- **Persistent PRESENT or VERIFIED chrome:** repeats the ceremony instead of showing its consequence.
- **Security controls in the main navigation:** makes credentials the organizing idea of the relationship.
- **A purely typographic welcome statement:** communicates a position but provides no usable hierarchy or movement.

## Resistance in the existing site

- Public desktop and mobile headers have little spare width. Recognition therefore becomes one direct return path; the long laboratory descriptor is suppressed only at constrained desktop widths, and mobile shortens the visible treatment while preserving its accessible name.
- Lab Statement 001 and the homepage already use strong spatial fields. Applying the interior paper or density to public pages would damage their public compositions, so recognition persists there through navigation rather than a global recoloring.
- The Machine Portrait apparatus has its own dense interaction and issuance vocabulary. The interior does not embed that apparatus; it shows the resulting issued object and its representations.
- Access is visually and technically its own origin. The prototype respects that boundary by summarizing access condition and linking outward instead of cloning key management.

## Render verification

- Checked CURRENT, HELD, HISTORY, relationship, correspondence, commissioned investigation, and issued-object views at `1280 × 800`, `1024 × 768`, the live `842 × 720` browser panel, `390 × 844`, and `320 × 700`.
- Checked the recognized public state on the homepage, `/lab`, `/lab/001`, and the existing `0x2F` instrument at desktop and mobile widths. The public field remains `#EFF0F2`; the return path restores the `#E9E8E3` interior.
- Removed a mobile overflow in the issued-object row found during rendered inspection. All checked views now keep document width equal to viewport width.
- Interior ink, body text, blue, and both metadata tones meet WCAG AA contrast against the warm field (`14.49:1`, `9.29:1`, `7.09:1`, `5.67:1`, and `4.65:1`). Hairline rules remain deliberately quieter because they are structural decoration rather than the sole carrier of meaning. Focus-visible outlines use institutional blue, and relationship state is always named in text as well as marked in blue.
