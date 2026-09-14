(() => {
  'use strict';

  const webauthn = window.SimpleWebAuthnBrowser;
  const state = { csrf: null, session: null, recovery: null, returnAfterCodes: 'boundary' };
  const views = new Map([...document.querySelectorAll('[data-view]')].map((node) => [node.dataset.view, node]));

  const MESSAGES = Object.freeze({
    unreachable: 'ACCESS SERVICE UNREACHABLE. CHECK THE CONNECTION AND TRY AGAIN.',
    cancelled: 'THE AUTHENTICATOR DID NOT COMPLETE. NOTHING WAS CHANGED.',
    registered: 'THIS AUTHENTICATOR ALREADY HOLDS A KEY FOR THIS RECORD. USE ANOTHER AUTHENTICATOR.',
    unsupported: 'THIS AUTHENTICATOR CANNOT HOLD A VERIFIED PASSKEY. USE ANOTHER AUTHENTICATOR.',
    authenticator: 'THE AUTHENTICATOR REPORTED AN ERROR. TRY AGAIN OR USE ANOTHER KEY.',
    noWebAuthn: 'PASSKEYS ARE NOT AVAILABLE IN THIS BROWSER.',
    sessionEnded: 'SESSION ENDED. PRESENT KEY TO CONTINUE.',
    sessionChanged: 'THIS SESSION CHANGED IN ANOTHER WINDOW. TRY AGAIN.',
    presentFailed: 'ACCESS COULD NOT BE VERIFIED. TRY ANOTHER KEY, OR RECOVER ACCESS.',
    enrollmentUnconfirmed: 'ENROLLMENT WAS NOT CONFIRMED. IF A KEY WAS CREATED, PRESENT KEY, THEN REPLACE RECOVERY CODES IN THE ACCESS RECORD.',
    recoveryHeld: 'THE AUTHENTICATOR DID NOT COMPLETE. YOUR RECOVERY IS STILL OPEN — SUBMIT AGAIN WITHOUT A NEW CODE.',
    recoveryOpen: 'A RECOVERY IS ALREADY OPEN IN THIS BROWSER. REGISTER THE REPLACEMENT KEY WITHOUT A NEW CODE.',
    recoveryClosed: 'RECOVERY IS NO LONGER OPEN. IF A NEW KEY WAS CREATED, PRESENT IT; OTHERWISE USE ANOTHER UNUSED CODE.',
    recoveryComplete: 'RECOVERY COMPLETE. PRESENT THE NEW KEY, THEN REVOKE ANY LOST OR EXPOSED KEY IN THE ACCESS RECORD.',
  });

  class RequestError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function show(name) {
    for (const [key, view] of views) view.hidden = key !== name;
    document.querySelector(`[data-view="${name}"] button, [data-view="${name}"] input`)?.focus();
  }

  function status(name, message = '', error = false) {
    const node = document.querySelector(`[data-status="${name}"]`);
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  function busy(formOrButton, value) {
    const nodes = formOrButton instanceof HTMLFormElement ? formOrButton.querySelectorAll('button, input') : [formOrButton];
    for (const node of nodes) node.disabled = value;
  }

  async function request(url, init) {
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
    } catch {
      throw new RequestError(0, MESSAGES.unreachable);
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new RequestError(response.status, result?.error || 'ACCESS SERVICE UNAVAILABLE');
    return result;
  }

  function api(action, data = {}, csrf = state.csrf) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-PROBNAYA-CSRF'] = csrf;
    return request('/api/access', { method: 'POST', headers, body: JSON.stringify({ action, data }) });
  }

  // Native WebAuthn failures are deliberately collapsed into a few outcomes the
  // holder can act on; platform-specific error text is not shown.
  function authenticatorMessage(error) {
    if (!(error instanceof Error) || error instanceof RequestError) return null;
    const code = error.code || '';
    if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return MESSAGES.registered;
    if (code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT' || code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT') return MESSAGES.unsupported;
    if (error.name === 'NotAllowedError' || error.name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') return MESSAGES.cancelled;
    if (/not supported/i.test(error.message)) return MESSAGES.noWebAuthn;
    return MESSAGES.authenticator;
  }

  function message(error) {
    return authenticatorMessage(error) || error.message || 'ACCESS SERVICE UNAVAILABLE';
  }

  function requireWebAuthn() {
    if (!webauthn?.browserSupportsWebAuthn()) throw new Error('WebAuthn is not supported in this browser');
  }

  function endSession(notice = MESSAGES.sessionEnded) {
    state.csrf = null;
    state.session = null;
    show('entry');
    status('entry', notice, true);
  }

  // Authenticated failures that mean "this page's authority is stale" are
  // resolved here, so every action reports them the same way.
  async function handleAuthenticatedError(error, view) {
    if (error instanceof RequestError && error.status === 401) return endSession();
    if (error instanceof RequestError && error.status === 403 && error.message === 'REQUEST NOT AUTHORIZED') {
      const refreshed = await loadSession({ reveal: false }).catch(() => false);
      if (!refreshed) return endSession();
      return status(view, MESSAGES.sessionChanged, true);
    }
    status(view, message(error), true);
  }

  function formatDate(value, dateOnly = false) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return '—';
    return dateOnly
      ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('-', '.')
      : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function renderSession(session) {
    state.session = session;
    state.csrf = session.csrf;
    document.querySelector('[data-holder]').textContent = session.holder.publicId;
    document.querySelector('[data-record-holder]').textContent = session.holder.publicId;
    document.querySelector('[data-verified]').textContent = formatDate(session.lastVerifiedAt);
    document.querySelector('[data-verified]').dateTime = session.lastVerifiedAt;
    document.querySelector('[data-recovery-state]').textContent = session.record.recovery;
    const keys = document.querySelector('[data-keys]');
    keys.replaceChildren();
    for (const credential of session.record.credentials) {
      const row = document.querySelector('#key-template').content.firstElementChild.cloneNode(true);
      row.querySelector('.key-index').textContent = credential.key;
      row.querySelector('.key-label').textContent = credential.label;
      row.querySelector('.key-kind').textContent = credential.kind;
      row.querySelector('.key-date').textContent = `ISSUED ${formatDate(credential.issuedAt, true)}`;
      const revoke = row.querySelector('.revoke');
      revoke.dataset.ref = credential.ref;
      revoke.hidden = session.record.credentials.length <= 1;
      keys.append(row);
    }
  }

  async function loadSession({ reveal = true } = {}) {
    try {
      renderSession(await request('/api/access', { method: 'GET' }));
    } catch (error) {
      state.csrf = null;
      state.session = null;
      if (error instanceof RequestError && error.status === 401) return false;
      throw error;
    }
    if (reveal) show('boundary');
    return true;
  }

  async function presentKey(button) {
    busy(button, true);
    status('entry', 'WAITING FOR AUTHENTICATOR');
    try {
      requireWebAuthn();
      const start = await api('authentication-options');
      const credential = await webauthn.startAuthentication({ optionsJSON: start.options });
      const result = await api('authentication-verify', { ceremonyId: start.ceremonyId, credential });
      state.csrf = result.csrf;
      status('entry');
      await loadSession();
    } catch (error) {
      const failedVerification = error instanceof RequestError && error.status === 400;
      status('entry', failedVerification ? MESSAGES.presentFailed : message(error), true);
    } finally {
      busy(button, false);
    }
  }

  // Disabled controls are excluded from FormData: read every form before busy().
  async function establish(form) {
    const fields = new FormData(form);
    busy(form, true);
    status('establish', 'WAITING FOR AUTHENTICATOR');
    let created = false;
    try {
      requireWebAuthn();
      const label = fields.get('label');
      const start = await api('enrollment-options', { grant: fields.get('grant'), label });
      const credential = await webauthn.startRegistration({ optionsJSON: start.options });
      created = true;
      const result = await api('enrollment-verify', { ceremonyId: start.ceremonyId, label, credential });
      form.reset();
      state.csrf = result.csrf;
      state.returnAfterCodes = 'boundary';
      status('establish');
      showCodes(result.recoveryCodes);
    } catch (error) {
      // The grant is consumed only when enrollment commits. If the key was
      // created but the confirmation was lost, the key itself is the way back.
      status('establish', created && !(error instanceof RequestError && error.status === 429) ? MESSAGES.enrollmentUnconfirmed : message(error), true);
    } finally {
      busy(form, false);
    }
  }

  async function openRecovery() {
    show('recovery');
    status('recovery');
    try {
      state.recovery = await api('recovery-resume', {}, null);
      status('recovery', MESSAGES.recoveryOpen);
    } catch {
      state.recovery = null;
    }
    document.querySelector('[data-recovery-code]').hidden = Boolean(state.recovery);
  }

  async function recover(form) {
    const fields = new FormData(form);
    busy(form, true);
    status('recovery', 'VERIFYING RECOVERY');
    try {
      requireWebAuthn();
      if (!state.recovery) {
        state.recovery = await api('recovery-begin', { code: fields.get('code') }, null);
        form.elements.code.value = '';
        document.querySelector('[data-recovery-code]').hidden = true;
      }
      const label = fields.get('label');
      const start = await api('recovery-registration-options', { label }, state.recovery.csrf);
      status('recovery', 'WAITING FOR AUTHENTICATOR');
      const credential = await webauthn.startRegistration({ optionsJSON: start.options });
      const result = await api('recovery-registration-verify', { ceremonyId: start.ceremonyId, label, credential }, state.recovery.csrf);
      state.recovery = null;
      state.csrf = null;
      state.session = null;
      state.returnAfterCodes = 'entry';
      document.querySelector('[data-recovery-code]').hidden = false;
      status('recovery');
      showCodes(result.recoveryCodes);
    } catch (error) {
      if (!state.recovery) {
        status('recovery', message(error), true);
        return;
      }
      // Keep the open recovery unless the server says it is gone; a single-use
      // code must never be spent twice for one interrupted recovery.
      const open = await api('recovery-resume', {}, null).then((resumed) => { state.recovery = resumed; return true; }, () => false);
      if (!open) {
        state.recovery = null;
        document.querySelector('[data-recovery-code]').hidden = false;
        status('recovery', MESSAGES.recoveryClosed, true);
      } else {
        status('recovery', authenticatorMessage(error) ? MESSAGES.recoveryHeld : message(error), true);
      }
    } finally {
      busy(form, false);
    }
  }

  function showCodes(codes) {
    const list = document.querySelector('[data-codes]');
    list.replaceChildren();
    for (const code of codes) {
      const item = document.createElement('li');
      item.textContent = code;
      list.append(item);
    }
    show('codes');
  }

  async function verifyPresence(button) {
    busy(button, true);
    status('record', 'WAITING FOR AUTHENTICATOR');
    try {
      requireWebAuthn();
      const start = await api('presence-options');
      const credential = await webauthn.startAuthentication({ optionsJSON: start.options });
      const result = await api('presence-verify', { ceremonyId: start.ceremonyId, credential });
      state.csrf = result.csrf;
      document.querySelector('[data-presence]').textContent = `PRESENCE VERIFIED ${formatDate(result.lastVerifiedAt)}`;
      status('record');
      return true;
    } catch (error) {
      await handleAuthenticatedError(error, 'record');
      return false;
    } finally {
      busy(button, false);
    }
  }

  async function addKey(form) {
    const label = new FormData(form).get('label');
    busy(form, true);
    try {
      if (!(await verifyPresence(form.querySelector('button')))) return;
      const start = await api('add-key-options', { label });
      status('record', 'WAITING FOR AUTHENTICATOR');
      const credential = await webauthn.startRegistration({ optionsJSON: start.options });
      const added = await api('add-key-verify', { ceremonyId: start.ceremonyId, label, credential });
      state.csrf = added.csrf;
      await loadSession({ reveal: false });
      status('record', 'KEY ADDED');
    } catch (error) {
      await handleAuthenticatedError(error, 'record');
    } finally {
      busy(form, false);
    }
  }

  async function revokeKey(button) {
    if (!(await verifyPresence(button))) return;
    try {
      await api('revoke-key', { credentialRef: button.dataset.ref });
      state.csrf = null;
      state.session = null;
      show('entry');
      status('entry', 'KEY REVOKED. PRESENT A REMAINING KEY.');
    } catch (error) {
      await handleAuthenticatedError(error, 'record');
    }
  }

  async function replaceCodes(button) {
    if (!(await verifyPresence(button))) return;
    try {
      const result = await api('replace-recovery-codes');
      state.csrf = result.csrf;
      state.returnAfterCodes = 'record';
      showCodes(result.recoveryCodes);
    } catch (error) {
      await handleAuthenticatedError(error, 'record');
    }
  }

  async function logout(button) {
    busy(button, true);
    try {
      await api('logout');
      state.csrf = null;
      state.session = null;
      show('entry');
      status('entry', 'SESSION CLOSED.');
    } catch (error) {
      // A session that has already ended is closed from the holder's point of view.
      if (error instanceof RequestError && (error.status === 401 || error.status === 403)) return endSession('SESSION CLOSED.');
      status('boundary', message(error), true);
    } finally {
      busy(button, false);
    }
  }

  async function codesStored() {
    document.querySelector('[data-codes]').replaceChildren();
    if (state.returnAfterCodes === 'entry') {
      show('entry');
      status('entry', MESSAGES.recoveryComplete);
      return;
    }
    try {
      if (!(await loadSession({ reveal: state.returnAfterCodes === 'boundary' }))) return endSession();
      if (state.returnAfterCodes === 'record') show('record');
    } catch (error) {
      endSession(message(error));
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    if (button.classList.contains('revoke')) return revokeKey(button);
    if (action === 'present') return presentKey(button);
    if (action === 'show-establish') return show('establish');
    if (action === 'show-recovery') return openRecovery();
    if (action === 'home') return show('entry');
    if (action === 'boundary') return show('boundary');
    if (action === 'record') return show('record');
    if (action === 'verify') return verifyPresence(button);
    if (action === 'replace-codes') return replaceCodes(button);
    if (action === 'codes-stored') return codesStored();
    if (action === 'logout') return logout(button);
  });

  document.querySelector('[data-form="establish"]').addEventListener('submit', (event) => { event.preventDefault(); establish(event.currentTarget); });
  document.querySelector('[data-form="recovery"]').addEventListener('submit', (event) => { event.preventDefault(); recover(event.currentTarget); });
  document.querySelector('[data-form="add-key"]').addEventListener('submit', (event) => { event.preventDefault(); addKey(event.currentTarget); });

  loadSession().then((present) => { if (!present) show('entry'); }, (error) => {
    show('entry');
    status('entry', message(error), true);
  });
})();
