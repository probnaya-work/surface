(() => {
  'use strict';

  const webauthn = window.SimpleWebAuthnBrowser;
  const state = { csrf: null, session: null, returnAfterCodes: 'boundary' };
  const views = new Map([...document.querySelectorAll('[data-view]')].map((node) => [node.dataset.view, node]));

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

  async function api(action, data = {}, csrf = state.csrf) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-PROBNAYA-CSRF'] = csrf;
    const response = await fetch('/api/access', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ action, data }),
    });
    const result = await response.json().catch(() => ({ ok: false, error: 'ACCESS SERVICE UNAVAILABLE' }));
    if (!response.ok || !result.ok) throw new Error(result.error || 'ACCESS SERVICE UNAVAILABLE');
    return result;
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
      keys.append(row);
    }
  }

  async function loadSession({ reveal = true } = {}) {
    const response = await fetch('/api/access', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) { state.csrf = null; state.session = null; return false; }
    const session = await response.json();
    renderSession(session);
    if (reveal) show('boundary');
    return true;
  }

  async function presentKey(button) {
    busy(button, true);
    status('entry', 'WAITING FOR AUTHENTICATOR');
    try {
      if (!webauthn?.browserSupportsWebAuthn()) throw new Error('WEBAUTHN IS NOT AVAILABLE IN THIS BROWSER');
      const start = await api('authentication-options');
      const credential = await webauthn.startAuthentication({ optionsJSON: start.options });
      const result = await api('authentication-verify', { ceremonyId: start.ceremonyId, credential });
      state.csrf = result.csrf;
      await loadSession();
    } catch (error) {
      status('entry', error.message, true);
    } finally {
      busy(button, false);
    }
  }

  async function establish(form) {
    busy(form, true);
    status('establish', 'WAITING FOR AUTHENTICATOR');
    const fields = new FormData(form);
    try {
      const label = fields.get('label');
      const start = await api('enrollment-options', { grant: fields.get('grant'), label });
      const credential = await webauthn.startRegistration({ optionsJSON: start.options });
      const result = await api('enrollment-verify', { ceremonyId: start.ceremonyId, label, credential });
      state.csrf = result.csrf;
      state.returnAfterCodes = 'boundary';
      showCodes(result.recoveryCodes);
    } catch (error) {
      status('establish', error.message, true);
    } finally {
      busy(form, false);
    }
  }

  async function recover(form) {
    busy(form, true);
    status('recovery', 'VERIFYING RECOVERY');
    const fields = new FormData(form);
    try {
      const recovered = await api('recovery-begin', { code: fields.get('code') }, null);
      const label = fields.get('label');
      const start = await api('recovery-registration-options', { label }, recovered.csrf);
      const credential = await webauthn.startRegistration({ optionsJSON: start.options });
      const result = await api('recovery-registration-verify', { ceremonyId: start.ceremonyId, label, credential }, recovered.csrf);
      state.csrf = null;
      state.session = null;
      state.returnAfterCodes = 'entry';
      showCodes(result.recoveryCodes);
    } catch (error) {
      status('recovery', error.message, true);
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
      const start = await api('presence-options');
      const credential = await webauthn.startAuthentication({ optionsJSON: start.options });
      const result = await api('presence-verify', { ceremonyId: start.ceremonyId, credential });
      state.csrf = result.csrf;
      document.querySelector('[data-presence]').textContent = `PRESENCE VERIFIED ${formatDate(result.lastVerifiedAt)}`;
      status('record');
      return true;
    } catch (error) {
      status('record', error.message, true);
      return false;
    } finally {
      busy(button, false);
    }
  }

  async function addKey(form) {
    busy(form, true);
    try {
      if (!(await verifyPresence(form.querySelector('button')))) return;
      const label = new FormData(form).get('label');
      const start = await api('add-key-options', { label });
      const credential = await webauthn.startRegistration({ optionsJSON: start.options });
      const added = await api('add-key-verify', { ceremonyId: start.ceremonyId, label, credential });
      state.csrf = added.csrf;
      await loadSession({ reveal: false });
      status('record', 'KEY ADDED');
    } catch (error) {
      status('record', error.message, true);
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
      status('record', error.message, true);
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
      status('record', error.message, true);
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    if (button.classList.contains('revoke')) return revokeKey(button);
    if (action === 'present') return presentKey(button);
    if (action === 'show-establish') return show('establish');
    if (action === 'show-recovery') return show('recovery');
    if (action === 'home') return show('entry');
    if (action === 'boundary') return show('boundary');
    if (action === 'record') return show('record');
    if (action === 'verify') return verifyPresence(button);
    if (action === 'replace-codes') return replaceCodes(button);
    if (action === 'codes-stored') {
      document.querySelector('[data-codes]').replaceChildren();
      if (state.returnAfterCodes === 'entry') return show('entry');
      await loadSession({ reveal: state.returnAfterCodes === 'boundary' });
      if (state.returnAfterCodes === 'record') show('record');
    }
    if (action === 'logout') {
      busy(button, true);
      try {
        await api('logout');
        state.csrf = null;
        state.session = null;
        show('entry');
      } catch (error) {
        status('boundary', error.message, true);
      } finally {
        busy(button, false);
      }
    }
  });

  document.querySelector('[data-form="establish"]').addEventListener('submit', (event) => { event.preventDefault(); establish(event.currentTarget); });
  document.querySelector('[data-form="recovery"]').addEventListener('submit', (event) => { event.preventDefault(); recover(event.currentTarget); });
  document.querySelector('[data-form="add-key"]').addEventListener('submit', (event) => { event.preventDefault(); addKey(event.currentTarget); });

  loadSession().catch(() => show('entry'));
})();
