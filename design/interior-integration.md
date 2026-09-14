# Public → Access → Interior integration

Status: working design prototype, not production authentication.

## One product path

Public PROBNAYA now exposes one quiet action, **ENTER**, in the existing desktop and mobile header. It does not presume whether a relation already exists. ENTER moves to Access, where the existing distinction remains:

- **PRESENT KEY** for a returning holder;
- **ESTABLISH ACCESS** for a person holding an operator-issued enrollment grant;
- **RECOVER ACCESS** for replacement of a lost path.

The public action is intentionally plain. SIGN UP, REGISTER, and CREATE ACCOUNT would describe a generic software account rather than the PROBNAYA relation; ESTABLISH ACCESS remains visible where its grant and first passkey can be understood.

### First entry

1. Public PROBNAYA / ENTER.
2. Access / ESTABLISH ACCESS.
3. Enrollment grant and key label / CREATE PASSKEY.
4. Browser-owned WebAuthn registration ceremony.
5. Successful server verification atomically activates the holder, consumes the grant, inserts the first credential, creates the first session, and issues recovery codes. This is the moment the relation becomes established.
6. Recovery codes are shown once and explicitly acknowledged, preserving the production Access sequence.
7. The holder crosses directly into warm Interior / CURRENT.

The example first holder is PROB–H–0142. CURRENT states NOTHING OPEN; HELD states NOTHING ISSUED; HISTORY states NO EARLIER EVENTS. Counts are zero. There are no onboarding panels, invented correspondence, or tutorial tasks.

### Returning entry

1. Public PROBNAYA / ENTER.
2. Access / PRESENT KEY.
3. Browser-owned WebAuthn authentication ceremony.
4. Warm Interior / CURRENT.

The production Access boundary remains useful on browser Back and for credential maintenance, but it is not an extra destination in the forward journey.

## Issued representation

An issued Machine Portrait can represent the holder because it is already a PROBNAYA object with an issuing apparatus, identifier, date, measurement record, and retained representations. It is not user-uploaded and cannot be edited as profile decoration.

- In the Interior header, the issued portrait geometry occupies the small mark position beside the unchanged PROBNAYA wordmark. The wordmark and the separate relation identifier keep institution and holder legible at once.
- RELATION states ISSUED REPRESENTATION / PROB–OBJ.000184 and links to the object. It does not repeat the full portrait.
- HELD remains the authoritative object/provenance surface.
- If no Machine Portrait has been issued, the same position contains a canonical neutral apparatus field: square extent, orthogonal axes, fixed center. It is identical for every unissued holder and is labeled REPRESENTATION / UNISSUED in RELATION.
- Obtaining a Machine Portrait would replace the neutral field as a consequence of issue, not as profile customization.

On public PROBNAYA, the institutional mark is never replaced. Public paper remains cool #EFF0F2; a reduced representation plus INTERIOR / PROB–H provides the return path. This retains recognition without importing Interior identity chrome into the public institution.

## Public is not leave

ENTER PUBLIC SURFACE and the persistent public return path do not alter the authenticated condition. The holder can move through the homepage, /lab, /lab/001, and instrument/project pages while the public composition and palette remain intact.

Session termination is an Access authority, reached deliberately from RELATION as **END RECOGNITION**:

1. Interior / RELATION / END RECOGNITION.
2. The unchanged Access authenticated boundary opens.
3. Its existing CLOSE action closes the session.
4. Public PROBNAYA remains; holder ID and representation disappear; ENTER returns.
5. Direct Interior entry again requires PRESENT KEY.

This avoids an avatar menu and does not confuse visiting the public surface with ending the session.

## Prototype boundary

`integration-access/` preserves the production Access UI, language, state sequence, and CSS without adding integration controls or prototype notation to the rendered interface. It runs at a separate localhost origin; that origin and this document are the explicit prototype boundary.

The handoff is a query plus tab-scoped mock state behind the unchanged interface. It does not read Access cookies, invoke WebAuthn, create credentials, authorize private data, or imitate a production session token. The production Access implementation was run separately and inspected without modification.

Scenario starts:

- First entry: http://localhost:4182/?recognized=0&journey=first
- Returning holder with issued portrait: http://localhost:4182/?recognized=0&journey=populated
- Returning holder without issued portrait: http://localhost:4182/?recognized=0&journey=unissued

## Production integration questions

The current Access architecture intentionally ends at its own authenticated boundary. Its host-only, SameSite=Strict, HttpOnly cookie is not available to probnaya.work, and Access currently permits no client-controlled post-authentication destination. The following require an explicit production architecture decision before this prototype can become real:

- How Interior receives server-verifiable holder authority without exposing the Access session token or broadening the Access cookie.
- The permanent Interior origin and its own server-side authorization/session boundary.
- A fixed, allowlisted post-authentication handoff from Access to Interior; an arbitrary return URL must not be introduced.
- A fixed post-logout destination after the Access logout POST succeeds.
- How public pages know recognition is still valid or expired without treating client storage as authority.
- Which issued MPA–01 representation is canonical for the header mark, and how issue/revocation/withholding changes are delivered to Interior.

These are recorded rather than answered in client code. Production WebAuthn, recovery, session rotation, credential mutation, database authorization, RP ID, and origin policy remain unchanged.

## Rendered verification

- Full first-entry, returning, unissued, public-return, Access-record, and end-recognition paths were exercised in the browser.
- Interior route Back/Forward was verified across CURRENT and HELD.
- Cross-origin Back returns to the authenticated Access boundary; Forward returns to Interior.
- Public recognition and unauthenticated ENTER were checked on the homepage, /lab, /lab/001, and 0x2F.
- Desktop, intermediate, 389px, and 320px layouts were checked with document width equal to viewport width.
