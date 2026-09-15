import { randomInt, randomUUID } from 'node:crypto';
import {
  CEREMONY_TTL_MS,
  GENERIC_AUTH_ERROR,
  GENERIC_RECOVERY_ERROR,
  RECENT_AUTH_MS,
  RECOVERY_SESSION_MS,
  REQUEST_DAILY_LIMIT,
  REQUEST_NETWORK_LIMIT,
  REQUEST_UNAVAILABLE,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_ROTATE_MS,
} from './constants.js';
import { generateRecoveryCodes, keyedHash, normalizeRecoveryCode, randomToken, safeEqual } from './crypto.js';
import { AccessError, badRequest, forbidden, rateLimited, unauthorized } from './errors.js';
import { base64url, credentialLabel, exactObject, requestEmail, webauthnResponse } from './validation.js';

const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// A non-personal reference that joins the request message to the operator's note.
export function requestReference() {
  let value = '';
  for (let index = 0; index < 6; index += 1) value += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `R–${value}`;
}

function verifiedRegistration(result) {
  return result?.verified === true && result.registrationInfo?.userVerified === true && result.registrationInfo?.credential;
}

function verifiedAuthentication(result) {
  return result?.verified === true && result.authenticationInfo?.userVerified === true;
}

export class AccessService {
  constructor({ config, store, webauthn, notifier = null, clock = () => Date.now() }) {
    this.config = config;
    this.store = store;
    this.webauthn = webauthn;
    this.notifier = notifier;
    this.clock = clock;
  }

  tokenHash(kind, token) {
    return keyedHash(this.config.sessionHashKey, `${kind}:${token}`);
  }

  recoveryHash(code) {
    return keyedHash(this.config.recoveryHashKey, normalizeRecoveryCode(code));
  }

  networkHash(network) {
    return keyedHash(this.config.networkHashKey, network);
  }

  // CSRF tokens are derived from the opaque cookie token, so a session's token is
  // stable for its lifetime: reading status never has to mutate or rotate it,
  // concurrent tabs share it, and a lost response can be recovered by asking again.
  csrfToken(kind, token) {
    return keyedHash(this.config.sessionHashKey, `csrf-token:${kind}:${token}`);
  }

  newBinding(existing) {
    const token = typeof existing === 'string' && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : randomToken();
    return { token, hash: this.tokenHash('preauth', token), fresh: token !== existing };
  }

  newSession(holderId, credentialId, lastVerifiedAt, now = this.clock()) {
    const token = randomToken();
    const csrf = this.csrfToken('session', token);
    return {
      token,
      csrf,
      record: {
        id: randomUUID(),
        tokenHash: this.tokenHash('session', token),
        csrfHash: this.tokenHash('csrf', csrf),
        holderId,
        credentialId,
        issuedAt: now,
        lastActiveAt: now,
        renewAfter: now + SESSION_ROTATE_MS,
        idleExpiresAt: now + SESSION_IDLE_MS,
        absoluteExpiresAt: now + SESSION_ABSOLUTE_MS,
        lastVerifiedAt,
        revokedAt: null,
      },
    };
  }

  makeRecoverySet(holderId, now = this.clock()) {
    const plaintext = generateRecoveryCodes();
    const set = { id: randomUUID(), holderId, issuedAt: now, replacedAt: null };
    return {
      plaintext,
      set,
      codeRecords: plaintext.map((code) => ({ setId: set.id, holderId, codeHash: this.recoveryHash(code), usedAt: null })),
    };
  }

  async limit(scope, dimension, network, options = {}) {
    const now = this.clock();
    const result = await this.store.checkRateLimit({
      key: `${scope}:${this.networkHash(network)}:${dimension || '-'}`,
      limit: options.limit ?? 10,
      windowMs: options.windowMs ?? 60_000,
      blockMs: options.blockMs ?? 60_000,
      now,
    });
    if (!result.allowed) throw rateLimited(result.retryAfter);
  }

  async createCeremony({ purpose, bindingHash, holderId = null, referenceId = null, options }) {
    const now = this.clock();
    const ceremony = {
      id: randomToken(18),
      purpose,
      bindingHash,
      holderId,
      referenceId,
      challenge: options.challenge,
      createdAt: now,
      expiresAt: now + CEREMONY_TTL_MS,
      consumedAt: null,
    };
    await this.store.createCeremony(ceremony);
    return { ceremonyId: ceremony.id, options };
  }

  async authenticationOptions({ preauthToken, network }) {
    await this.limit('authentication-options', '', network, { limit: 20 });
    const binding = this.newBinding(preauthToken);
    await this.limit('authentication-options-binding', binding.hash, network, { limit: 8 });
    const options = await this.webauthn.authenticationOptions();
    return { binding, ...(await this.createCeremony({ purpose: 'authentication', bindingHash: binding.hash, options })) };
  }

  async authenticationVerify({ preauthToken, payload, network }) {
    exactObject(payload, ['ceremonyId', 'credential']);
    const ceremonyId = base64url(payload.ceremonyId, 64);
    const response = webauthnResponse(payload.credential, 'authentication');
    const binding = this.newBinding(preauthToken);
    if (binding.fresh) throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    await this.limit('authentication-verify-network', '', network, { limit: 30, blockMs: 5 * 60_000 });
    await this.limit('authentication-verify', binding.hash, network, { limit: 12, blockMs: 5 * 60_000 });
    const now = this.clock();
    const ceremony = await this.store.consumeCeremony({ id: ceremonyId, bindingHash: binding.hash, purpose: 'authentication', now });
    if (!ceremony) throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    const credential = await this.store.findCredential(response.id);
    if (!credential || credential.revokedAt) throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    const holder = await this.store.findHolder(credential.holderId);
    if (!holder || holder.condition !== 'active' || response.response.userHandle !== holder.webauthnUserId) {
      throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    }
    let result;
    try {
      result = await this.webauthn.verifyAuthentication({ response, challenge: ceremony.challenge, credential });
    } catch {
      throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    }
    if (!verifiedAuthentication(result)) throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    const newCounter = result.authenticationInfo.newCounter;
    const anomaly = credential.counter > 0 && newCounter > 0 && newCounter <= credential.counter;
    const credentialUpdate = {
      counter: newCounter,
      deviceType: result.authenticationInfo.credentialDeviceType,
      backedUp: result.authenticationInfo.credentialBackedUp,
      lastUsedAt: now,
      anomaly,
    };
    const session = this.newSession(holder.id, credential.credentialId, now, now);
    const audits = [{ id: randomUUID(), holderId: holder.id, type: 'authentication', outcome: 'success', occurredAt: now, networkHash: this.networkHash(network) }];
    if (anomaly) audits.push({ id: randomUUID(), holderId: holder.id, type: 'signature-counter-anomaly', outcome: 'observed', occurredAt: now, networkHash: this.networkHash(network) });
    if (!(await this.store.completeAuthentication({ holderId: holder.id, credentialId: credential.credentialId, expectedCounter: credential.counter, credentialUpdate, session: session.record, audits }))) {
      throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    }
    return { token: session.token, csrf: session.csrf, holder: this.publicHolder(holder), anomaly };
  }

  // A request is not authorization. It creates no holder, grant, ceremony, session,
  // or audit event, and stores no address: the only durable write is the hashed
  // rate-limit bucket. The address leaves Access once, in a message to PROBNAYA.
  async requestAccess({ payload, network }) {
    if (!this.notifier) throw new AccessError(503, 'request_unavailable', REQUEST_UNAVAILABLE);
    exactObject(payload, ['email']);
    await this.limit('request-access', '', network, REQUEST_NETWORK_LIMIT);
    const email = requestEmail(payload.email);
    const now = this.clock();
    const daily = await this.store.checkRateLimit({ key: 'request-access-daily', ...REQUEST_DAILY_LIMIT, now });
    if (!daily.allowed) throw new AccessError(503, 'request_ceiling', REQUEST_UNAVAILABLE, { retryAfter: daily.retryAfter });
    try {
      await this.notifier.send({ email, reference: requestReference(), receivedAt: now });
    } catch {
      throw new AccessError(503, 'request_delivery_failed', REQUEST_UNAVAILABLE);
    }
    return { received: true };
  }

  async enrollmentOptions({ preauthToken, payload, network }) {
    exactObject(payload, ['grant', 'label']);
    const grantToken = base64url(payload.grant, 256);
    await this.limit('enrollment-network', '', network, { limit: 20, blockMs: 10 * 60_000 });
    await this.limit('enrollment', this.tokenHash('enrollment', grantToken), network, { limit: 8, blockMs: 10 * 60_000 });
    const label = credentialLabel(payload.label);
    const now = this.clock();
    const grant = await this.store.findGrant(this.tokenHash('enrollment', grantToken), now);
    if (!grant) throw new AccessError(400, 'enrollment_failed', GENERIC_AUTH_ERROR);
    const holder = await this.store.findHolder(grant.holderId);
    if (!holder || holder.condition !== 'pending') throw new AccessError(400, 'enrollment_failed', GENERIC_AUTH_ERROR);
    const credentials = await this.store.listCredentials(holder.id);
    const binding = this.newBinding(preauthToken);
    const options = await this.webauthn.registrationOptions({ holder, credentials });
    const result = await this.createCeremony({ purpose: 'first-registration', bindingHash: binding.hash, holderId: holder.id, referenceId: grant.id, options });
    return { binding, label, ...result };
  }

  async enrollmentVerify({ preauthToken, payload, network }) {
    await this.limit('enrollment-verify', '', network, { limit: 8, blockMs: 10 * 60_000 });
    exactObject(payload, ['ceremonyId', 'label', 'credential']);
    const ceremonyId = base64url(payload.ceremonyId, 64);
    const label = credentialLabel(payload.label);
    const response = webauthnResponse(payload.credential, 'registration');
    const binding = this.newBinding(preauthToken);
    if (binding.fresh) throw new AccessError(400, 'enrollment_failed', GENERIC_AUTH_ERROR);
    const now = this.clock();
    const ceremony = await this.store.consumeCeremony({ id: ceremonyId, bindingHash: binding.hash, purpose: 'first-registration', now });
    if (!ceremony) throw new AccessError(400, 'enrollment_failed', GENERIC_AUTH_ERROR);
    let result;
    try {
      result = await this.webauthn.verifyRegistration({ response, challenge: ceremony.challenge });
    } catch {
      throw new AccessError(400, 'enrollment_failed', GENERIC_AUTH_ERROR);
    }
    if (!verifiedRegistration(result)) throw new AccessError(400, 'enrollment_failed', GENERIC_AUTH_ERROR);
    const credential = this.credentialRecord(ceremony.holderId, response, result.registrationInfo, label, now);
    const session = this.newSession(ceremony.holderId, credential.credentialId, now, now);
    const recovery = this.makeRecoverySet(ceremony.holderId, now);
    const audits = [
      { id: randomUUID(), holderId: ceremony.holderId, type: 'first-credential-enrolled', outcome: 'success', occurredAt: now, networkHash: this.networkHash(network) },
      { id: randomUUID(), holderId: ceremony.holderId, type: 'recovery-set-issued', outcome: 'success', occurredAt: now, networkHash: this.networkHash(network) },
    ];
    const completed = await this.store.completeFirstRegistration({
      grantId: ceremony.referenceId,
      holderId: ceremony.holderId,
      credential,
      session: session.record,
      recoverySet: recovery.set,
      codeRecords: recovery.codeRecords,
      audits,
      now,
    });
    if (!completed) throw new AccessError(400, 'enrollment_failed', GENERIC_AUTH_ERROR);
    const holder = await this.store.findHolder(ceremony.holderId);
    return { token: session.token, csrf: session.csrf, holder: this.publicHolder(holder), recoveryCodes: recovery.plaintext };
  }

  credentialRecord(holderId, response, info, label, now) {
    return {
      id: randomUUID(),
      managementRef: randomToken(18),
      holderId,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey),
      counter: info.credential.counter,
      transports: response.response.transports || [],
      label,
      kind: response.authenticatorAttachment === 'cross-platform' ? 'SECURITY KEY' : 'PASSKEY',
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      issuedAt: now,
      lastUsedAt: null,
      revokedAt: null,
      counterAnomalyAt: null,
    };
  }

  publicHolder(holder) {
    return { publicId: holder.publicId };
  }

  async authenticated(sessionToken, csrf, { recent = false, requireCsrf = false } = {}) {
    if (typeof sessionToken !== 'string') throw unauthorized();
    const now = this.clock();
    const tokenHash = this.tokenHash('session', sessionToken);
    const session = await this.store.getSession(tokenHash, now);
    if (!session) throw unauthorized();
    if (requireCsrf && typeof csrf !== 'string') throw forbidden();
    if (csrf !== undefined && !safeEqual(this.csrfToken('session', sessionToken), csrf)) throw forbidden();
    if (recent && now - session.lastVerifiedAt > RECENT_AUTH_MS) throw forbidden('VERIFY PRESENCE REQUIRED');
    const holder = await this.store.findHolder(session.holderId);
    return { tokenHash, session, holder, now };
  }

  // Idle refresh and the fifteen-minute rotation shared by every session read.
  async currentSession(sessionToken) {
    const auth = await this.authenticated(sessionToken);
    let token = sessionToken;
    let session = auth.session;
    if (auth.now >= session.renewAfter) {
      const replacement = this.newSession(session.holderId, session.credentialId, session.lastVerifiedAt, auth.now);
      replacement.record.absoluteExpiresAt = session.absoluteExpiresAt;
      const rotated = await this.store.rotateSession(auth.tokenHash, replacement.record, auth.now);
      if (!rotated) throw unauthorized();
      token = replacement.token;
      session = replacement.record;
    }
    const ok = await this.store.touchSession(session.tokenHash, auth.now);
    if (!ok) throw unauthorized();
    return { token, rotated: token !== sessionToken, session, holder: auth.holder };
  }

  // The relation as the public site may know it: holder identifier and Access
  // condition only. No CSRF token, credential label, or management reference.
  async relation(sessionToken) {
    const { token, rotated, session, holder } = await this.currentSession(sessionToken);
    const credentials = await this.store.listCredentials(session.holderId, false);
    const active = credentials.filter((credential) => !credential.revokedAt);
    const recovery = await this.store.hasActiveRecoveryCodes(session.holderId);
    return {
      token,
      rotated,
      relation: {
        holder: this.publicHolder(holder),
        establishedAt: credentials.length ? new Date(credentials[0].issuedAt).toISOString() : null,
        lastVerifiedAt: new Date(session.lastVerifiedAt).toISOString(),
        keys: active.length,
        recovery,
      },
    };
  }

  async status(sessionToken) {
    const { token, rotated, session, holder } = await this.currentSession(sessionToken);
    const credentials = await this.store.listCredentials(session.holderId);
    const recovery = await this.store.hasActiveRecoveryCodes(session.holderId);
    return {
      token,
      rotated,
      csrf: this.csrfToken('session', token),
      holder: this.publicHolder(holder),
      lastVerifiedAt: new Date(session.lastVerifiedAt).toISOString(),
      record: {
        credentials: credentials.map((credential, index) => ({
          ref: credential.managementRef,
          key: `KEY ${String(index + 1).padStart(2, '0')}`,
          label: credential.label,
          kind: credential.kind,
          issuedAt: new Date(credential.issuedAt).toISOString(),
          lastUsedAt: credential.lastUsedAt ? new Date(credential.lastUsedAt).toISOString() : null,
          status: 'ACTIVE',
        })),
        recovery: recovery ? 'CODES ACTIVE' : 'NONE ACTIVE',
      },
    };
  }

  async presenceOptions({ sessionToken, csrf, network }) {
    const auth = await this.authenticated(sessionToken, csrf, { requireCsrf: true });
    await this.limit('verify-presence', auth.session.holderId, network, { limit: 12 });
    const credentials = await this.store.listCredentials(auth.session.holderId);
    const options = await this.webauthn.authenticationOptions({ credentials });
    return this.createCeremony({ purpose: 'verify-presence', bindingHash: auth.tokenHash, holderId: auth.session.holderId, options });
  }

  async presenceVerify({ sessionToken, csrf, payload, network }) {
    const auth = await this.authenticated(sessionToken, csrf, { requireCsrf: true });
    exactObject(payload, ['ceremonyId', 'credential']);
    const response = webauthnResponse(payload.credential, 'authentication');
    const ceremony = await this.store.consumeCeremony({ id: base64url(payload.ceremonyId, 64), bindingHash: auth.tokenHash, purpose: 'verify-presence', now: auth.now });
    if (!ceremony) throw new AccessError(400, 'presence_failed', GENERIC_AUTH_ERROR);
    const credential = await this.store.findCredential(response.id);
    if (!credential || credential.holderId !== auth.session.holderId || credential.revokedAt) throw new AccessError(400, 'presence_failed', GENERIC_AUTH_ERROR);
    const result = await this.verifyAuthentication(response, ceremony, credential);
    const replacement = this.newSession(auth.session.holderId, credential.credentialId, auth.now, auth.now);
    replacement.record.absoluteExpiresAt = auth.session.absoluteExpiresAt;
    const nextCounter = result.authenticationInfo.newCounter;
    const anomaly = credential.counter > 0 && nextCounter > 0 && nextCounter <= credential.counter;
    const audits = [{ id: randomUUID(), holderId: auth.session.holderId, type: 'presence-verified', outcome: 'success', occurredAt: auth.now, networkHash: this.networkHash(network) }];
    if (anomaly) audits.push({ id: randomUUID(), holderId: auth.session.holderId, type: 'signature-counter-anomaly', outcome: 'observed', occurredAt: auth.now, networkHash: this.networkHash(network) });
    if (!(await this.store.completePresence({
      holderId: auth.session.holderId,
      oldSessionHash: auth.tokenHash,
      credentialId: credential.credentialId,
      expectedCounter: credential.counter,
      credentialUpdate: {
        counter: nextCounter,
        deviceType: result.authenticationInfo.credentialDeviceType,
        backedUp: result.authenticationInfo.credentialBackedUp,
        lastUsedAt: auth.now,
        anomaly,
      },
      session: replacement.record,
      audits,
      now: auth.now,
    }))) throw unauthorized();
    return { token: replacement.token, csrf: replacement.csrf, lastVerifiedAt: new Date(auth.now).toISOString() };
  }

  async verifyAuthentication(response, ceremony, credential) {
    let result;
    try {
      result = await this.webauthn.verifyAuthentication({ response, challenge: ceremony.challenge, credential });
    } catch {
      throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    }
    if (!verifiedAuthentication(result)) throw new AccessError(400, 'authentication_failed', GENERIC_AUTH_ERROR);
    return result;
  }

  async addKeyOptions({ sessionToken, csrf, payload, network }) {
    const auth = await this.authenticated(sessionToken, csrf, { recent: true, requireCsrf: true });
    await this.limit('add-key', auth.session.holderId, network, { limit: 12 });
    exactObject(payload, ['label']);
    const label = credentialLabel(payload.label);
    const credentials = await this.store.listCredentials(auth.session.holderId);
    const options = await this.webauthn.registrationOptions({ holder: auth.holder, credentials });
    return { label, ...(await this.createCeremony({ purpose: 'add-key', bindingHash: auth.tokenHash, holderId: auth.session.holderId, options })) };
  }

  async addKeyVerify({ sessionToken, csrf, payload, network }) {
    const auth = await this.authenticated(sessionToken, csrf, { recent: true, requireCsrf: true });
    exactObject(payload, ['ceremonyId', 'label', 'credential']);
    const response = webauthnResponse(payload.credential, 'registration');
    const ceremony = await this.store.consumeCeremony({ id: base64url(payload.ceremonyId, 64), bindingHash: auth.tokenHash, purpose: 'add-key', now: auth.now });
    if (!ceremony) throw badRequest('registration_failed', GENERIC_AUTH_ERROR);
    let result;
    try {
      result = await this.webauthn.verifyRegistration({ response, challenge: ceremony.challenge });
    } catch {
      throw badRequest('registration_failed', GENERIC_AUTH_ERROR);
    }
    if (!verifiedRegistration(result)) throw badRequest('registration_failed', GENERIC_AUTH_ERROR);
    const credential = this.credentialRecord(auth.session.holderId, response, result.registrationInfo, credentialLabel(payload.label), auth.now);
    const replacement = this.newSession(auth.session.holderId, auth.session.credentialId, auth.session.lastVerifiedAt, auth.now);
    replacement.record.absoluteExpiresAt = auth.session.absoluteExpiresAt;
    const audit = { id: randomUUID(), holderId: auth.session.holderId, type: 'credential-added', outcome: 'success', occurredAt: auth.now, credentialRef: credential.managementRef, networkHash: this.networkHash(network) };
    if (!(await this.store.completeAddKey({ oldSessionHash: auth.tokenHash, credential, session: replacement.record, audit, now: auth.now }))) throw badRequest('registration_failed', GENERIC_AUTH_ERROR);
    return { added: true, token: replacement.token, csrf: replacement.csrf };
  }

  async revokeKey({ sessionToken, csrf, payload, network }) {
    const auth = await this.authenticated(sessionToken, csrf, { recent: true, requireCsrf: true });
    exactObject(payload, ['credentialRef']);
    const managementRef = base64url(payload.credentialRef, 64);
    const audit = { id: randomUUID(), holderId: auth.session.holderId, type: 'credential-revoked', outcome: 'success', occurredAt: auth.now, credentialRef: managementRef, networkHash: this.networkHash(network) };
    if (!(await this.store.revokeCredentialAndSessions({ holderId: auth.session.holderId, authorizingSessionHash: auth.tokenHash, managementRef, now: auth.now, audit }))) throw forbidden('KEY COULD NOT BE REVOKED');
    return { revoked: true, sessionInvalidated: true };
  }

  async replaceRecoveryCodes({ sessionToken, csrf, network }) {
    const auth = await this.authenticated(sessionToken, csrf, { recent: true, requireCsrf: true });
    await this.limit('replace-recovery-codes', auth.session.holderId, network, { limit: 6, windowMs: 10 * 60_000, blockMs: 10 * 60_000 });
    const recovery = this.makeRecoverySet(auth.session.holderId, auth.now);
    const replacement = this.newSession(auth.session.holderId, auth.session.credentialId, auth.session.lastVerifiedAt, auth.now);
    replacement.record.absoluteExpiresAt = auth.session.absoluteExpiresAt;
    const audit = { id: randomUUID(), holderId: auth.session.holderId, type: 'recovery-set-replaced', outcome: 'success', occurredAt: auth.now, networkHash: this.networkHash(network) };
    if (!(await this.store.replaceRecoverySetAndRotate({ holderId: auth.session.holderId, recoverySet: recovery.set, codeRecords: recovery.codeRecords, oldSessionHash: auth.tokenHash, session: replacement.record, audit, now: auth.now }))) throw unauthorized();
    return { recoveryCodes: recovery.plaintext, token: replacement.token, csrf: replacement.csrf };
  }

  async logout(sessionToken, csrf, network) {
    const auth = await this.authenticated(sessionToken, csrf, { requireCsrf: true });
    const audit = { id: randomUUID(), holderId: auth.session.holderId, type: 'logout', outcome: 'success', occurredAt: auth.now, networkHash: this.networkHash(network) };
    if (!(await this.store.completeLogout({ tokenHash: auth.tokenHash, holderId: auth.session.holderId, now: auth.now, audit }))) throw unauthorized();
    return { closed: true };
  }

  async recoveryBegin({ payload, network }) {
    await this.limit('recovery', '', network, { limit: 5, windowMs: 10 * 60_000, blockMs: 30 * 60_000 });
    exactObject(payload, ['code']);
    const code = credentialLabel(payload.code);
    const now = this.clock();
    const token = randomToken();
    const csrf = this.csrfToken('recovery-session', token);
    const recoverySession = {
      id: randomUUID(),
      tokenHash: this.tokenHash('recovery-session', token),
      csrfHash: this.tokenHash('csrf', csrf),
      issuedAt: now,
      expiresAt: now + RECOVERY_SESSION_MS,
      consumedAt: null,
    };
    const audit = { id: randomUUID(), type: 'recovery-code-accepted', outcome: 'success', occurredAt: now, networkHash: this.networkHash(network) };
    const used = await this.store.beginRecovery({ codeHash: this.recoveryHash(code), session: recoverySession, audit, now });
    if (!used) throw new AccessError(400, 'recovery_failed', GENERIC_RECOVERY_ERROR);
    return { token, csrf, expiresAt: new Date(recoverySession.expiresAt).toISOString() };
  }

  async recoveryAuth(token, csrf) {
    if (typeof token !== 'string') throw unauthorized();
    const tokenHash = this.tokenHash('recovery-session', token);
    const session = await this.store.getRecoverySession(tokenHash, this.clock());
    if (!session || !safeEqual(this.csrfToken('recovery-session', token), csrf)) throw unauthorized();
    return { tokenHash, session };
  }

  // Recovery authority is already bound to the HttpOnly recovery cookie. A page
  // reload, a cancelled authenticator prompt, or a lost response must not burn
  // another single-use code while that authority is still valid.
  async recoveryResume({ recoveryToken, network }) {
    if (typeof recoveryToken !== 'string') throw unauthorized();
    const tokenHash = this.tokenHash('recovery-session', recoveryToken);
    await this.limit('recovery-resume', tokenHash, network, { limit: 12 });
    const session = await this.store.getRecoverySession(tokenHash, this.clock());
    if (!session) throw unauthorized();
    return { csrf: this.csrfToken('recovery-session', recoveryToken), expiresAt: new Date(session.expiresAt).toISOString() };
  }

  async recoveryRegistrationOptions({ recoveryToken, csrf, payload, network }) {
    const auth = await this.recoveryAuth(recoveryToken, csrf);
    await this.limit('recovery-registration', auth.tokenHash, network, { limit: 12 });
    exactObject(payload, ['label']);
    const label = credentialLabel(payload.label);
    const holder = await this.store.findHolder(auth.session.holderId);
    if (!holder || holder.condition !== 'active') throw unauthorized();
    const credentials = await this.store.listCredentials(holder.id);
    const options = await this.webauthn.registrationOptions({ holder, credentials });
    return { label, ...(await this.createCeremony({ purpose: 'recovery-registration', bindingHash: auth.tokenHash, holderId: holder.id, options })) };
  }

  async recoveryRegistrationVerify({ recoveryToken, csrf, payload, network }) {
    const auth = await this.recoveryAuth(recoveryToken, csrf);
    exactObject(payload, ['ceremonyId', 'label', 'credential']);
    const response = webauthnResponse(payload.credential, 'registration');
    const now = this.clock();
    const ceremony = await this.store.consumeCeremony({ id: base64url(payload.ceremonyId, 64), bindingHash: auth.tokenHash, purpose: 'recovery-registration', now });
    if (!ceremony) throw badRequest('recovery_failed', GENERIC_RECOVERY_ERROR);
    let result;
    try {
      result = await this.webauthn.verifyRegistration({ response, challenge: ceremony.challenge });
    } catch {
      throw badRequest('recovery_failed', GENERIC_RECOVERY_ERROR);
    }
    if (!verifiedRegistration(result)) throw badRequest('recovery_failed', GENERIC_RECOVERY_ERROR);
    const credential = this.credentialRecord(auth.session.holderId, response, result.registrationInfo, credentialLabel(payload.label), now);
    const recovery = this.makeRecoverySet(auth.session.holderId, now);
    const audits = [
      { id: randomUUID(), holderId: auth.session.holderId, type: 'recovery-completed', outcome: 'success', occurredAt: now, networkHash: this.networkHash(network) },
      { id: randomUUID(), holderId: auth.session.holderId, type: 'recovery-set-replaced', outcome: 'success', occurredAt: now, networkHash: this.networkHash(network) },
    ];
    const completed = await this.store.completeRecovery({ recoveryTokenHash: auth.tokenHash, holderId: auth.session.holderId, credential, recoverySet: recovery.set, codeRecords: recovery.codeRecords, audits, now });
    if (!completed) throw badRequest('recovery_failed', GENERIC_RECOVERY_ERROR);
    return { recovered: true, recoveryCodes: recovery.plaintext, requiresAuthentication: true };
  }

}
