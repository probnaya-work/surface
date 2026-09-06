# Machine Portrait integration

The public Machine Portrait route is `/instrument-mpa/`. It uses the existing
Instruments information architecture while serving the shipped apparatus as a
directory-indexed static page.

## Ownership boundary

`probnaya-work/objects/machine-portrait` is the source of truth for the
apparatus implementation. The files in `instrument-mpa/` are a deploy artifact,
not a separately maintained implementation. Do not edit the copied derivation,
geometry, record or apparatus state files in `surface`.

The artifact contains only the six runtime files needed by the browser. Its
`SOURCE.json` records the exact `objects` commit. The surface-owned HTML overlay
sets `/instrument-mpa/` as the asset base (so the clean URL and its trailing-
slash form resolve identically) and turns the shipped `← INSTRUMENTS` crumb into
a link to `/instruments`. It does not change apparatus copy, behavior or
presentation.

## Refreshing the artifact

From the `surface` repository, with a clean sibling `objects` checkout at the
intended authoritative commit, run:

```sh
./scripts/sync-machine-portrait.sh
```

An alternate `objects` checkout can be passed as the first argument. Review the
resulting diff, run the authoritative tests in `objects`, and walk the public
apparatus flow before committing the refreshed artifact.
