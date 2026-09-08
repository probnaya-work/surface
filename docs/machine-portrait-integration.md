# Machine Portrait integration

The public Machine Portrait route is `/instrument-mpa/`. It uses the existing
Instruments information architecture while serving the shipped apparatus as a
directory-indexed static page.

## Ownership boundary

`probnaya-work/objects/machine-portrait` is the source of truth for the
apparatus implementation. The files in `instrument-mpa/` are a deploy artifact,
not a separately maintained implementation. Do not edit copied runtime files in
`surface`.

The artifact contains ten runtime files needed by the browser. Its repository-
only `SOURCE.json` records the exact `objects` commit and is excluded from the
public deployment. The surface-owned HTML overlay
sets `/instrument-mpa/` as the asset base (so the clean URL and its trailing-
slash form resolve identically) and turns the shipped `← INSTRUMENTS` crumb into
a link to `/instruments`. It does not change apparatus copy, behavior or
presentation.

## Payment boundary

`api/machine-portrait.js` is the surface-owned server boundary. One POST handler
accepts the explicit actions `create-checkout` and `verify-issuance`. It creates
a hosted, one-time Stripe Checkout Session using a server-configured Price and
retrieves that Session directly from Stripe before authorising construction.
Direct API requests pin Stripe API version `2026-02-25.clover` so response
semantics do not depend on the account's mutable default version.

Only the issuance protocol and SHA-256 commitment to the canonical local draft
are stored in Stripe metadata. The source image, canonical record, and 16 × 16
matrix stay in the browser. The server authenticates that immutable commitment,
successful payment, and the resulting server-derived issue identity. It does
not independently certify that the client-derived measurement corresponds to
the source photograph. A persisted attempt UUID is the Stripe idempotency key.
The stable issue digest is SHA-256 over the protocol, Checkout Session ID, and
draft commitment.

## Source admission boundary

Source photographs remain entirely client-side. Before bytes are read, the
apparatus admits only `image/jpeg` and `image/png` files up to 32 MiB. After
browser decode it admits dimensions from 512 px through 12,000 px per side and
at most 80 million total pixels. The encoded limit bounds the pre-decode buffer;
the side limit rejects pathological long images; the pixel limit admits normal
12/24/48/61 MP phone and camera captures while bounding the decoded RGBA surface
to roughly 320 MiB before canvas overhead. These admission checks do not change
registration, measurement geometry or commitment semantics for accepted input.

V1 has no webhook, database, registry, or automatic recovery. If payment finishes
but the browser loses its local draft, support or refund is manual. The visible
`PROB–MPA–` issue label remains the apparatus' existing presentation convention;
it does not establish an authoritative global PROBNAYA namespace.

Required environment variables are documented in `.env.example` and the root
README. The Stripe Price must be a one-time EUR 5.00 Price. `STRIPE_LIVEMODE`
must match the secret and Price resources.

## Refreshing the artifact

From the `surface` repository, with a clean sibling `objects` checkout at the
intended authoritative commit, run:

```sh
./scripts/sync-machine-portrait.sh
```

An alternate `objects` checkout can be passed as the first argument. Review the
resulting diff, run the authoritative tests in `objects`, and walk the public
apparatus flow before committing the refreshed artifact.
