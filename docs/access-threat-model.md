# PROBNAYA access — threat model

Status: implementation baseline, updated after security review, 2026-09-14; request-based establishment, 2026-09-15
Scope: `PROBNAYA → ACCESS → authenticated`, access requests and establishment links, credential management, sessions, recovery, and the read-only relation read used by the public-origin Interior. Interior content has no production source yet; future private material is treated as protected data.

## Assets

- Association between a person, their internal holder row, and public `PROB–H` identifier.
- WebAuthn credential IDs, public keys, user handles, counters, transports, state, and safe labels.
- Authenticated and pre-authentication session identifiers.
- Registration/authentication challenges and ceremony state.
- Recent-auth / VERIFY PRESENCE state.
- Enrollment grants (as carried in establishment links) and recovery-code material.
- Addresses submitted with access requests, while in transit to the PROBNAYA mailbox (Access does not store them).
- The request-sender SMTP credential.
- Credential enrollment and revocation authority.
- Server secrets, database credentials, recovery pepper, and IP-hashing key.
- Audit/security events.
- Future private correspondence, issued objects, permissions, and provenance reachable after authentication.

Private passkey keys and device biometrics are not PROBNAYA assets because they must remain inside the authenticator or passkey provider and are never sent to PROBNAYA.

## Actors and trust boundaries

```text
person
  │ local user verification
  ▼
OS / authenticator / passkey provider
  │ WebAuthn create/get through browser
  ▼
browser at exact allowed origin
  │ HTTPS + origin-bound cookies + CSRF token
  ▼
Vercel CDN / firewall / TLS termination
  │ serverless invocation
  ▼
PROBNAYA access handler
  │ parameterized SQL / transactions
  ▼
PostgreSQL persistence

Separate operational boundaries:
  Access runtime → dedicated sender account → SMTP → mail@probnaya.work   (access request; notification only)
  operator → PostgreSQL (operator role) → create-enrollment → establishment link
  operator mailbox (mail@probnaya.work) → email → person   (establishment link delivery)
  deployment platform → environment secrets and logs
```

The browser and OS UI are not reproduced by the site. Vercel and the selected database provider are trusted infrastructure and part of the compromise surface.

Email has exactly two roles and is never a login, identifier, or recovery path:

1. **Request notification.** The runtime sends a request to the PROBNAYA mailbox. It authorizes nothing and creates no Access state.
2. **Establishment-link delivery.** Whoever reads the operator's reply before the person does can establish that relation. This is accepted only because a link can reach nothing but an empty `pending` holder, is single-use, expires in seven days, and is invalidated by reissue or suspension. **Nothing may be issued to a pending holder.** If that ever changes, this delivery channel must be re-reviewed.

v1 performs no identity-proofing beyond control of the address when the link is used. A relation is with whoever controls that address and creates the key.

## Security objectives

- Only possession and successful user verification of a registered WebAuthn credential, or deliberate single-use recovery, may establish control of a holder record.
- Every WebAuthn response is verified for exact expected challenge, RP ID, origin, ceremony type, user verification, and credential ownership.
- Challenges and recovery codes are single-use under concurrent requests.
- Authentication rotates into a fresh server-side session; no bearer token is exposed to JavaScript or local storage.
- Credential changes require a fresh WebAuthn ceremony and cannot silently remove the final viable access path.
- Failures do not reveal whether a holder or credential exists.
- An access request never creates authority or state: no holder, grant, ceremony, session, or stored address.
- Opening an establishment link never consumes, exchanges, or sends its grant; only an explicit CREATE PASSKEY does, and only a verified user-verified registration consumes it.
- Suspension ends every outstanding establishment authority, and reactivation never revives it.

## Threats and mitigations

| Threat | Intended mitigation | Residual risk |
|---|---|---|
| Phishing | RP ID `access.probnaya.work`, exact expected origin `https://access.probnaya.work`, browser-owned WebAuthn UI, no passwords or emailed login links. The only emailed link establishes a first key for a pending holder and cannot open an established relation; a look-alike domain cannot create or use a credential for the RP ID. | A person can still be socially engineered into recovery or into using a compromised legitimate device. |
| Credential theft | Private keys never reach the server; UV is required; database holds only public credential data. | Synced passkeys inherit the security of the person’s platform account; a compromised unlocked device may authenticate. |
| Session theft | 256-bit opaque token in `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookie; only an HMAC/hash is stored; short idle/absolute expiry; rotation and server revocation. | XSS can act through an active session even when it cannot read the cookie. Endpoint authorization and CSP remain essential. |
| Session fixation | Ignore incoming unknown IDs; create a fresh ordinary session only after verified authentication; rotate it after credential/recovery changes and invalidate predecessors atomically. Recovery uses a separate short-lived, one-purpose cookie and requires a later normal passkey login. | Concurrent requests during rotation require careful transaction handling. |
| Replay / challenge reuse | Server-generated high-entropy challenge, five-minute expiry, bound to one browser ceremony and purpose, atomically consumed before verification on success or failure. | An attacker with the pre-auth cookie can consume a challenge and cause a retry (availability, not bypass). |
| Invalid origin or RP ID | Exact allowlist from configuration; never derive security values from `Host`; verify both in the maintained library. Production and localhost are distinct configurations. | Misconfigured deployment variables can deny all login or broaden trust; startup/config tests and deployment checklist mitigate this. |
| CSRF | `SameSite=Strict`; exact `Origin` on every POST; mandatory synchronizer token for ordinary authenticated mutations; JSON-only exact schemas. | XSS is same-origin and bypasses CSRF defenses. GET status refreshes idle state; fetch metadata refuses same-site and cross-site reads, and the CSRF token is stable per session token (IR-05 closed). Browsers that omit `Sec-Fetch-Site` rely on SameSite=Strict for that read. |
| XSS causing authenticated actions | Dedicated authentication origin, no inline executable code, restrictive origin-wide CSP, no user HTML interpolation, text-only safe labels, and output encoding. | An XSS in Access itself can still act through an active session; isolation reduces the code exposed on that origin but does not make XSS harmless. |
| Account enumeration | Usernameless authentication; generic errors and status codes; unknown credential follows bounded generic failure; public `PROB–H` identifiers are not login inputs. | Timing differences in database paths need adversarial measurement, not just message equality. |
| Brute force and recovery abuse | High-entropy codes, keyed one-way code representations, durable per-network recovery limits with a longer block, generic errors, and WAF as an outer layer. | Distributed low-rate attempts and denial of service remain possible. |
| Recovery takeover | Recovery is last after other WebAuthn routes; 160-bit single-use codes, plaintext shown once, HMAC at rest under separate pepper, limited ten-minute recovery session, mandatory replacement passkey, whole-set rotation, all-session invalidation, audit event. | Theft of a plaintext recovery code enables takeover; safe storage remains the holder’s responsibility. |
| Unauthorized credential enrollment | Requires authenticated session plus VERIFY PRESENCE within five minutes; challenge bound to holder and `add-key`; duplicate IDs rejected transactionally. | Malware controlling a recently verified browser can race the holder. |
| Credential deletion/replacement | Fresh VERIFY PRESENCE, ownership checks, atomic revocation, unconditional refusal to remove the final active credential, session invalidation, audit event. Recovery must add a replacement credential before an old one can be revoked. | A compromised existing authenticator can still authorize destructive changes; notification/response procedures remain valuable. |
| Privilege escalation / IDOR | Holder identity comes only from the server session; endpoints never accept holder ID as authority; credential ownership checked inside the mutation transaction. | Future roles/administrator functions need a separate model and are not authorized by this design. |
| Stale sessions | Thirty-minute idle and eight-hour absolute server-enforced expiry; rotation every fifteen minutes; credential state checked on sensitive operations; revocation invalidates holder sessions. | Stolen sessions can be exercised until detected/expired. |
| Malicious or compromised device | UV, short recent-auth window, access-event visibility, multiple keys, logout/revocation. | WebAuthn does not make a compromised browser trustworthy and does not attest that the OS is clean. |
| Database compromise | No private passkey keys; session tokens stored one-way; recovery values require separate pepper; least-privilege DB role; encrypted provider transport/backups; minimize retained IP data. | Credential metadata, holder associations, audit history, and public keys are exposed; combined DB+runtime-secret compromise is more severe. |
| Secrets leakage | `.env*` ignored, Vercel encrypted environment variables, no secrets in client bundles/tests/logs, deployment allowlist, rotation procedure. | Platform administrator compromise remains in the trust model. |
| Sensitive logging | Central error mapping; one bounded JSON line per rejected/failed request (action, status, code) and opaque audit IDs only; never log assertions, challenges, cookies, enrollment tokens, request addresses or references, recovery codes, raw credential IDs, DB URLs, or mail-provider messages. | Platform/request logs may still retain path, timing, and network metadata. |
| Race conditions | Transactions, unique constraints, a stable holder-first lock protocol, commit-time authority checks, exact-source recovery-set replacement, competing recovery-session consumption, atomic challenge/code use, and compare-and-update signature counters. | The remediated schedules pass on local PostgreSQL 17.6; isolation, timeouts, pooler behavior, and deadlock handling must still be verified with the selected provider. |
| Endpoint denial of service | Small body limit, schema bounds, timeouts, durable rate limiting, database indexes, generic early rejection, Vercel Firewall recommendation, and deployment-scheduled bounded retention cleanup. | WebAuthn verification and database connections still consume resources; capacity, cleanup, and WAF settings are operational controls that repository tests cannot prove. |
| Access-request abuse | Exact Origin and JSON schema; strict single-address validation (no display names, separators, whitespace, or control characters); durable per-network limit and a global daily ceiling; one fixed recipient; nothing ever sent to the entered address; no storage; bounded generic errors. | A distributed sender can still fill the daily ceiling and pause requests (availability only); junk requests reach the mailbox for manual discard. |
| Mail credential compromise | Dedicated sender account whose credential lives only in the Access Production environment; configuration refuses `mail@probnaya.work` as the sender user or From address; nodemailer with certificate verification to the fixed host; the credential authorizes nothing in Access. | A Google app password can read its own account's mail, so the sender account holds past request notifications. Whether the operator mailbox (and the public intake credential) can be read by any deployed credential cannot be established from the repository and is a deployment check. |
| Establishment-link leakage | Grant in the URL fragment (never sent to servers or in `Referer`); removed with `history.replaceState` before any request; held only in memory; no analytics or third-party script on Access; consumption only on a verified first registration; seven-day expiry; single use; `--reissue` and suspension expire it. | Global/synced browser history, the email itself, mail-rewriting services, and anyone reading the mailbox before use retain a usable link until consumption or expiry. The worst outcome is an empty relation under that identifier, which the operator suspends. |
| Link prefetch / scanners | Preview bots fetch without the fragment; the page makes no grant-bearing request on load; options never consume; enrollment limits are keyed by network and grant, so a scanner network cannot block the person. | A JavaScript-executing scanner that presses CREATE PASSKEY consumes rate-limit budget on its own network only. |
| Operator error on issuance | `--new` refuses an existing identifier and `--reissue` refuses a missing or non-pending one, enforced inside the holder-row transaction; concurrent `--new` for one identifier yields one holder; the note accepts only a request reference. | Pasting a link into the wrong reply remains a human error; single use and reissue bound it. |
| Open redirects | No client-supplied post-login URL. Successful authentication goes only to the fixed authenticated boundary. | Future return-to behavior must introduce an allowlist, not arbitrary URLs. |

## What WebAuthn protects

- It binds credentials to an RP ID and assertions to a challenge and origin.
- It proves possession of the private key without sending that key to PROBNAYA.
- With required user verification, it conveys that the authenticator performed its configured local verification.
- Proper random one-time challenges prevent assertion replay.
- Discoverable credentials permit identifier-free authentication.

## What WebAuthn does not protect

- It does not prevent XSS from issuing actions through an already authenticated browser.
- It does not secure stolen session cookies, server secrets, the database, recovery material, or operator enrollment policy.
- It does not prove a device or browser is free of malware.
- It does not guarantee a passkey is hardware-bound; multi-device credentials may be synced by a platform provider.
- Signature counters are not universal clone detection. Zero-valued counters are valid for credentials without a monotonic counter. The pinned verifier rejects positive non-increasing counters before the service commits authentication; such a rejection is a signal for investigation, not automatic proof of cloning.
- Attestation is not requested, so PROBNAYA does not establish authenticator model or hardware provenance.

## Assumptions requiring validation

- DNS and Vercel routing will preserve the approved permanent origin `https://access.probnaya.work`; previews do not share production credentials.
- The database provider supports transactions, row locks, unique constraints, TLS, backups, and a region compatible with the Vercel Function region.
- The request-sender account is dedicated, and no credential deployed to any Vercel project can read the mailbox from which establishment links are sent or retained.
- Email providers, rewriting services, and browsers preserve the URL fragment of the establishment link (verify with the supported mail clients before first production use).
- The operator issues links only in reply to requests, one per person, and never issues content to a pending holder.
- Recovery codes can be shown once and the person will store them outside the authenticated device.
- Future private material performs authorization from the server-side holder identity rather than trusting client identifiers.

## Review triggers

Re-run this threat model before adding account content, administrator functions, email recovery, automated sending of establishment links, anything issued to pending holders, self-service establishment, multiple production origins, native apps, cross-origin embedding, delegation, transferable objects, privileged roles, or any RP ID/hostname transition. Existing WebAuthn credentials are not casually migratable to another RP ID.

## References

- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
- [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server)
- [SimpleWebAuthn passkey guidance](https://simplewebauthn.dev/docs/advanced/passkeys)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN secure cookie configuration](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies)

## Relation read (public origin)

- **Script on `https://probnaya.work` reads the relation.** Any script running on the public origin — including an injected one — can learn the holder identifier, key count, recovery condition, and establishment time of a browser with a session, and can keep that session's idle lifetime alive. It cannot obtain the session token or CSRF token, change credentials or recovery, or end the session. The public site's script supply chain is therefore part of this boundary; it carries no user-supplied markup and loads only first-party scripts plus Vercel Analytics.
- **Sibling or look-alike origins.** Refused by exact Origin; they receive no CORS headers, so a browser withholds the response.
- **Concurrent rotation.** Two tabs can race the fifteen-minute rotation; the loser receives 401 once. The public client retries once when it previously held recognition.
- **Stale recognition.** The public origin's `probnaya:recognized` localStorage value only decides whether to ask Access; it is cleared by any 401 and never displayed as recognition.

