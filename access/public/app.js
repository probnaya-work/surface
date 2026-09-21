(() => {
  'use strict';

  const webauthn = window.SimpleWebAuthnBrowser;
  const state = { csrf: null, session: null, recovery: null, returnAfterCodes: 'boundary', offers: [], afterOffers: null };
  const views = new Map([...document.querySelectorAll('[data-view]')].map((node) => [node.dataset.view, node]));

  // Fixed destinations on the public PROBNAYA origin. The origin is written into
  // the page, never read from the URL, so no request can choose where Access sends
  // an authenticated holder.
  const publicOrigin = (() => {
    const value = document.querySelector('meta[name="probnaya-public-origin"]')?.content;
    return /^(https:\/\/probnaya\.work|http:\/\/localhost:\d{2,5})$/.test(value || '') ? value : 'https://probnaya.work';
  })();
  const INTERIOR = `${publicOrigin}/interior/`;
  const PUBLIC = `${publicOrigin}/`;
  document.querySelectorAll('[data-interior-link]').forEach((link) => { link.href = INTERIOR; });
  document.querySelectorAll('[data-public-link]').forEach((link) => { link.href = PUBLIC; });

  // The Interior links here for key maintenance (#record) and for ending the
  // session (#end). Anything else opens the ordinary entry or boundary.
  const requested = ['record', 'end'].includes(location.hash.slice(1)) ? location.hash.slice(1) : null;
  const expired = location.hash === '#expired';
  // An establishment link carries its grant in the fragment, which browsers never
  // send to a server. It is held only in this closure, removed from the address
  // bar before any request, and sent once, when the person chooses CREATE PASSKEY.
  // Opening the link does nothing else, so previews and scanners cannot use it.
  const ESTABLISH_LINK = /^#establish=([A-Za-z0-9_-]{32,256})$/;
  const establishing = location.hash.startsWith('#establish=');
  let grant = ESTABLISH_LINK.exec(location.hash)?.[1] || null;
  if (location.hash) history.replaceState(null, '', location.pathname);

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
    enrollmentUnconfirmed: 'ACCESS WAS NOT CONFIRMED. IF A KEY WAS CREATED, PRESENT KEY, THEN REPLACE RECOVERY CODES IN THE ACCESS RECORD.',
    linkClosed: 'THIS LINK IS NO LONGER OPEN. IF A KEY WAS ALREADY CREATED WITH IT, PRESENT KEY. OTHERWISE REQUEST ACCESS AGAIN.',
    addressInvalid: 'THIS ADDRESS COULD NOT BE USED. CHECK IT AND TRY AGAIN.',
    labelRequired: 'NAME THE KEY. UP TO 48 CHARACTERS.',
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
    document.querySelector('[data-end-holder]').textContent = session.holder.publicId;
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
    if (reveal) show(requested || 'boundary');
    return true;
  }

  // Observations privately associated with this record (docs/observation-ownership.md).
  // Offers are shown one at a time and nothing is added without ADD TO MY ACCOUNT.
  // Reading them never blocks entry: on any failure the holder simply continues.
  async function loadObservations() {
    try {
      const result = await api('observations');
      renderHeld(result.held);
      state.offers = result.offers;
    } catch {
      state.offers = [];
    }
    return state.offers;
  }

  function observationURL(number) {
    return `${publicOrigin}/observations/${number}`;
  }

  function renderHeld(held) {
    const list = document.querySelector('[data-held]');
    list.replaceChildren(...held.map((item) => {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.href = observationURL(item.number);
      link.rel = 'noreferrer';
      link.textContent = item.title || 'Untitled Observation';
      const published = document.createElement('time');
      published.dateTime = item.publishedOn;
      published.textContent = item.publishedOn.replaceAll('-', '.');
      row.append(link, published);
      return row;
    }));
    document.querySelector('[data-held-block]').hidden = held.length === 0;
  }

  function showOffer(next) {
    state.afterOffers = next;
    const offer = state.offers[0];
    if (!offer) return next();
    document.querySelector('[data-offer-lead]').textContent = offer.basis === 'address'
      ? 'We found an Observation previously published from this email.'
      : 'PROBNAYA has connected an Observation to this record.';
    document.querySelector('[data-offer-title]').textContent = offer.title || 'Untitled Observation';
    const date = document.querySelector('[data-offer-date]');
    date.dateTime = offer.publishedOn;
    date.textContent = offer.publishedOn.replaceAll('-', '.');
    document.querySelector('[data-offer-link]').href = observationURL(offer.number);
    status('observation-offer');
    show('observation-offer');
  }

  async function withOffers(next) {
    if ((await loadObservations()).length) return showOffer(next);
    return next();
  }

  async function decideOffer(button, action) {
    const offer = state.offers[0];
    if (!offer) return state.afterOffers?.();
    busy(button, true);
    try {
      await api(action, { number: offer.number });
      await loadObservations();
      showOffer(state.afterOffers);
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) return endSession();
      if (error instanceof RequestError && error.status === 409) {
        await loadObservations();
        showOffer(state.afterOffers);
        return status('observation-offer', message(error), true);
      }
      await handleAuthenticatedError(error, 'observation-offer');
    } finally {
      busy(button, false);
    }
  }

  // Leaving Access for the Interior replaces this entry, so browser Back from
  // CURRENT does not land on a finished ceremony.
  function enterInterior() {
    location.replace(INTERIOR);
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
      if (requested) return void (await loadSession());
      await withOffers(enterInterior);
    } catch (error) {
      const failedVerification = error instanceof RequestError && error.status === 400;
      status('entry', failedVerification ? MESSAGES.presentFailed : message(error), true);
    } finally {
      busy(button, false);
    }
  }

  // Disabled controls are excluded from FormData: read every form before busy().
  async function requestAccess(form) {
    const email = String(new FormData(form).get('email') || '').trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return status('request', MESSAGES.addressInvalid, true);
    busy(form, true);
    status('request', 'SENDING REQUEST');
    try {
      await api('request-access', { email }, null);
      form.reset();
      status('request');
      document.querySelector('[data-received-address]').textContent = email;
      show('received');
    } catch (error) {
      status('request', message(error), true);
    } finally {
      busy(form, false);
    }
  }

  function closeLink() {
    grant = null;
    document.querySelector('[data-form="establish"]').hidden = true;
    document.querySelector('[data-establish-supporting]').hidden = true;
    document.querySelector('[data-establish-note]').hidden = true;
    status('establish', MESSAGES.linkClosed, true);
  }

  async function establish(form) {
    const label = String(new FormData(form).get('label') || '').trim();
    if (!grant) return closeLink();
    if (!label || label.length > 48 || /[\u0000-\u001F\u007F]/.test(label)) return status('establish', MESSAGES.labelRequired, true);
    busy(form, true);
    status('establish', 'WAITING FOR AUTHENTICATOR');
    let started = false;
    let created = false;
    try {
      requireWebAuthn();
      const start = await api('enrollment-options', { grant, label }, null);
      started = true;
      const credential = await webauthn.startRegistration({ optionsJSON: start.options });
      created = true;
      const result = await api('enrollment-verify', { ceremonyId: start.ceremonyId, label, credential }, null);
      grant = null;
      form.reset();
      state.csrf = result.csrf;
      state.returnAfterCodes = 'boundary';
      status('establish');
      showCodes(result.recoveryCodes);
    } catch (error) {
      // Before any ceremony, a refused request means the link itself is no longer
      // usable: expired, used, replaced, or its holder suspended. One message
      // covers every cause. The grant is consumed only when establishment commits;
      // if the key was created but the confirmation was lost, the key is the way back.
      if (!started && error instanceof RequestError && error.status === 400) return closeLink();
      status('establish', created && !(error instanceof RequestError && error.status === 429) ? MESSAGES.enrollmentUnconfirmed : message(error), true);
    } finally {
      busy(form, false);
    }
  }

  function showEstablishment() {
    document.querySelector('[data-form="establish"]').hidden = false;
    document.querySelector('[data-establish-supporting]').hidden = false;
    status('establish');
    show('establish');
    if (!grant) return closeLink();
    // A browser that already holds a relation is told that this link makes another.
    const note = document.querySelector('[data-establish-note]');
    note.hidden = !state.session;
    note.textContent = state.session ? `THIS BROWSER HOLDS ${state.session.holder.publicId}. THIS LINK ESTABLISHES A SEPARATE RELATION.` : '';
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
      location.replace(PUBLIC);
    } catch (error) {
      // A session that has already ended is closed from the holder's point of view.
      if (error instanceof RequestError && (error.status === 401 || error.status === 403)) return location.replace(PUBLIC);
      status(button.closest('[data-view]')?.dataset.view || 'boundary', message(error), true);
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
    // The first key is established: the holder crosses directly into the Interior.
    if (state.returnAfterCodes === 'boundary') return withOffers(enterInterior);
    try {
      if (!(await loadSession({ reveal: false }))) return endSession();
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
    if (action === 'show-establish') return show(grant ? 'establish' : 'request');
    if (action === 'show-recovery') return openRecovery();
    if (action === 'home') {
      document.querySelector('[data-received-address]').textContent = '';
      return show('entry');
    }
    if (action === 'boundary') return show('boundary');
    if (action === 'record') return show('record');
    if (action === 'show-end') return show('end');
    if (action === 'verify') return verifyPresence(button);
    if (action === 'replace-codes') return replaceCodes(button);
    if (action === 'codes-stored') return codesStored();
    if (action === 'logout') return logout(button);
    if (action === 'claim-observation') return decideOffer(button, 'observation-claim');
    if (action === 'decline-observation') return decideOffer(button, 'observation-decline');
    if (action === 'later-observation') return state.afterOffers?.();
  });

  document.querySelector('[data-form="request"]').addEventListener('submit', (event) => { event.preventDefault(); requestAccess(event.currentTarget); });
  document.querySelector('[data-form="establish"]').addEventListener('submit', (event) => { event.preventDefault(); establish(event.currentTarget); });
  document.querySelector('[data-form="recovery"]').addEventListener('submit', (event) => { event.preventDefault(); recover(event.currentTarget); });
  document.querySelector('[data-form="add-key"]').addEventListener('submit', (event) => { event.preventDefault(); addKey(event.currentTarget); });

  // A link opened in an Access tab that is already loaded changes only the
  // fragment; it is taken and cleared the same way, still without any request.
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#establish=')) return;
    grant = ESTABLISH_LINK.exec(location.hash)?.[1] || null;
    history.replaceState(null, '', location.pathname);
    showEstablishment();
  });

  if (establishing) {
    showEstablishment();
    loadSession({ reveal: false }).then((present) => { if (present && grant) showEstablishment(); }, () => {});
    return;
  }

  loadSession({ reveal: Boolean(requested) }).then((present) => {
    if (present) return requested ? loadObservations() : withOffers(() => show('boundary'));
    show('entry');
    if (expired) status('entry', MESSAGES.sessionEnded);
  }, (error) => {
    show('entry');
    status('entry', message(error), true);
  });
})();
