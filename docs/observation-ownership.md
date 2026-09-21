# Observation ownership

A published Observation can later be added, privately, to the PROBNAYA account of the person who sent it. Adding it changes nothing public: the page, its URL, the name or initials it is signed with (or its being unsigned), and its contents stay exactly as published.

This is the smallest foundation for that. There are no contributor pages, profiles, notifications, or automatic claims.

## 1. The boundary

| Public, in Git and the built site | Private, in the Access database only |
|---|---|
| The Observation record and its generated page, `observations.html`, `sitemap.xml`, `observations/ledger.json` | `access_observation_ownership`, `access_observation_declines`, and `contact_lookup` on `access_enrollment_grants` |

The only value the two sides share is the archival number (`001`). The Access row also copies the published title and day so the holder can recognise the Observation. Both are already public.

The following never enter Git, generated HTML, page metadata, the sitemap, client JavaScript for the public site, logs, analytics, or any public response: an address, its lookup, a holder identifier, ownership status, mail headers, mailbox references, claim state, or editorial notes. The record format already rejects any field outside its list (`docs/observations-publishing.md` §9). Tests check that the built output and the publishing scripts carry none of these, and that `access/` is excluded from the public deployment.

The static build never reads the database. Publishing stays offline and deterministic.

## 2. Addresses and lookups

Access still has no email identity: addresses never sign anyone in. What it stores is a **contact lookup**:

```
contact_lookup = "hmac-sha256:contact-v1:" + base64url(HMAC-SHA256(OBSERVATION_CONTACT_KEY,
                 "probnaya-access/observation-contact/v1:" + canonical(address)))
```

`canonical` (in `access/lib/contact.js`) trims the address, applies Unicode NFC, validates it with the same rules as Access requests, converts the domain to ASCII (IDNA), and lower-cases it. It does no provider-specific rewriting such as removing dots or `+tags`. One function computes every lookup, for both the sender's address and the account's address.

`OBSERVATION_CONTACT_KEY` is a dedicated key of at least 32 random bytes (`openssl rand -base64 32`). It must differ from `SESSION_HASH_KEY`, `RECOVERY_HASH_KEY`, and `NETWORK_HASH_KEY`. Only the operator commands compute lookups; the Access runtime only compares stored values. So the key is **operator-only**:

- It is stored in the password manager and entered at a silent prompt in production.
- It is never a Vercel environment variable, and never enters the repository, a browser, or a log.
- It is a **long-lived, recovery-critical secret**. Every stored lookup depends on it. If it is lost or changed, automatic matching stops for every Observation and setup link registered under it, and nothing reports this.
- Never rotate or replace it casually or silently. A rotation is a deliberate, recorded operation: every pending Observation must be registered again under the new key with the sender's verified address, and verified account contacts cannot be recomputed (their addresses were never kept). Those accounts then need the directed `offer` path in §5.
- Back it up the way the password manager backs up other recovery material.

A lookup cannot be reversed or tested against a list of addresses without the key. The database enforces its format, so a plaintext address cannot be stored in its place.

## 3. What counts as verified

- **The Observation's side.** The submission form does not verify addresses. The address becomes trustworthy through editorial correspondence: PROBNAYA writes to the sender and receives a reply from that address. `register` asks the operator to confirm this before it reads the address.
- **The account's side.** An establishment link is mailed to the address in the request, and only someone who reads that mailbox can open it. So `approve-request` (optionally) and `create-enrollment --contact` store the lookup of the address the link is sent to. That lookup becomes a verified contact of the holder only when the grant is **consumed**. Unopened, expired, or replaced grants verify nothing.

An account's address becomes a verified contact only after that specific setup link has been used successfully. Email remains a delivery and ownership-proof channel; it is never a sign-in identifier. Holders established before this change have no verified contact. They use the operator path in §5.

## 4. States

`awaiting_account` → `offered` → `claimed`. Any state can become `detached` by the operator.

- `awaiting_account`: registered; no holder with a matching verified contact has looked yet.
- `offered`: shown to at least one eligible holder, or offered to one named holder by an operator. Nothing is owned.
- `claimed`: one holder pressed ADD TO MY ACCOUNT. The row records that holder and `claimed_at`.
- `detached`: an operator undid the association. The public Observation is untouched, and the holder record stays for history.

Declining (NOT MINE) adds a row to `access_observation_declines`. The Observation is then never offered to that holder again. It claims nothing and does not change the Observation's state for anyone else.

The claim is one conditional `UPDATE`. When two holders claim at once, the row lock serialises them and the second re-checks the condition against the committed claim, so exactly one owns it. Claims, declines, registrations, and detachments are idempotent.

## 5. Procedures

Run these from `access/`, in a trusted operator checkout, with the `access_operator` credential (see the README).

**At publication.** After `npm run observation:publish -- 001` is committed and deployed:

```
npm run observation-owner -- register 001
```

The command:

1. prints the published title and date;
2. asks you to confirm the address was verified by correspondence;
3. asks for the sender's address twice, without echo;
4. asks for `OBSERVATION_CONTACT_KEY` without echo.

It stores only the lookup and never prints the address. Running it again is harmless. A different address is refused unless you add `--replace`, which is only for correcting a mistake before anyone has claimed it. In scripted use the address may come from a file descriptor named by `OBSERVATION_CONTACT_FD` (for example `OBSERVATION_CONTACT_FD=3 … 3< <(op read …)`). Never pass the address as an argument or a here-string: both end up in shell history.

**Approving a request.** `npm run approve-request -- 'R–XXXXXX'` now also asks for the address the link will be sent to (Enter skips). If you give it, send the message to exactly that address. For a reissue, `npm run create-enrollment -- --reissue 'PROB–H–…' 'R–XXXXXX' --contact` does the same.

**When the account uses a different address.** In v1 there is no self-service path, because it would need the original address to be kept or recoverable. When the holder writes from the new address:

1. Confirm by correspondence that the person controls the original contributor identity, that is, the address the Observation was sent from.
2. Only then run `npm run observation-owner -- offer 001 'PROB–H–…'`. This is always an operator action. It is also the v1 path for accounts established before this change, which have no recorded verified contact.

The offer goes only to that holder, who must still accept it. The schema keeps directed offers (`offered_holder_id`) separate from address matches, so a signed self-service claim can replace this step later without a migration of existing rows.

**An incorrect association.** Run `npm run observation-owner -- detach 001`. It removes the Observation from the holder's account. It does not delete, alter, or unpublish the public Observation. To associate it with someone else afterwards, use `offer`.

**Overview.** `npm run observation-owner -- list` is a read-only view: numbers, states, owners, and decline counts. It shows no lookups.

## 6. The account

After a holder signs in or finishes establishing access, and before the Interior opens, Access asks for their offers. For each one it shows:

- the title (or "Untitled Observation"), the publication date, and a READ link to the public page;
- *We found an Observation previously published from this email. Add it to your account?* (For an operator offer, *PROBNAYA has connected an Observation to this record.*)
- ADD TO MY ACCOUNT, NOT MINE, and NOT NOW.

Claimed Observations are listed under OBSERVATIONS in the Access record. If offers can't be read, entry simply continues. The Interior's HELD view is unchanged for now.

API (`POST /api/access`, session cookie and CSRF header required): `observations` returns `{ offers: [{ number, title, publishedOn, basis }], held: [{ number, title, publishedOn }] }`; `observation-claim` and `observation-decline` take `{ number }`. `/api/relation`, which the public site reads, is unchanged and carries nothing about Observations.

## 7. Rollout

1. Apply `access/migrations/004_observation_ownership.sql` (additive; it also grants the roles only what the code uses). Do this before deploying the runtime. Grant issuance without an address works on either schema.
2. Deploy Access.
3. Create `OBSERVATION_CONTACT_KEY` in the password manager.
4. Register Observations only after their pages are deployed.

Tests: `npm test` at the repository root and in `access/`; with a disposable database, `ACCESS_TEST_DATABASE_URL=… npm run test:postgres` in `access/` (includes `test/postgres-observations.test.js`).
