(() => {
  'use strict';

  const PUBLIC_ORIGIN = 'http://localhost:4182';
  const SESSION_KEY = 'probnaya:access-mock-session';
  const params = new URLSearchParams(location.search);
  const views = new Map([...document.querySelectorAll('[data-view]')].map((node) => [node.dataset.view, node]));
  let returnAfterCodes = 'interior';

  const profiles = {
    first: { relation: 'empty', holder: 'PROB–H–0142', credentials: 1 },
    empty: { relation: 'empty', holder: 'PROB–H–0142', credentials: 1 },
    populated: { relation: 'populated', holder: 'PROB–H–0087', credentials: 2 },
    unissued: { relation: 'unissued', holder: 'PROB–H–0119', credentials: 2 },
  };

  function requestedProfile() {
    const requested = params.get('relation') || params.get('journey') || 'populated';
    return profiles[requested] || profiles.populated;
  }

  if (params.get('reset') === '1') {
    sessionStorage.removeItem(SESSION_KEY);
    params.delete('reset');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }

  function readSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  }

  function writeSession(profile) {
    const session = {
      relation: profile.relation,
      holder: profile.holder,
      credentials: profile.credentials,
      verifiedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function show(name) {
    for (const [key, view] of views) view.hidden = key !== name;
    document.querySelector(`[data-view="${name}"] button, [data-view="${name}"] input`)?.focus();
  }

  function status(name, message = '') {
    const node = document.querySelector(`[data-status="${name}"]`);
    if (node) node.textContent = message;
  }

  function busy(target, value) {
    const nodes = target instanceof HTMLFormElement ? target.querySelectorAll('button, input') : [target];
    for (const node of nodes) node.disabled = value;
  }

  function formatDate(value, dateOnly = false) {
    const date = new Date(value);
    if (dateOnly) return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('-', '.');
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function renderSession(session) {
    document.querySelector('[data-holder]').textContent = session.holder;
    document.querySelector('[data-record-holder]').textContent = session.holder;
    const verified = document.querySelector('[data-verified]');
    verified.textContent = formatDate(session.verifiedAt);
    verified.dateTime = session.verifiedAt;
    document.querySelector('[data-recovery-state]').textContent = 'ESTABLISHED';

    const credentials = [
      { key: 'KEY 01', label: 'PRIMARY PASSKEY', kind: 'MULTI-DEVICE', issuedAt: '2024-05-02T10:00:00Z' },
      { key: 'KEY 02', label: 'SECONDARY KEY', kind: 'SINGLE-DEVICE', issuedAt: '2025-06-19T10:00:00Z' },
    ];
    const keys = document.querySelector('[data-keys]');
    keys.replaceChildren();
    for (const credential of credentials.slice(0, session.credentials || 1)) {
      const row = document.querySelector('#key-template').content.firstElementChild.cloneNode(true);
      row.querySelector('.key-index').textContent = credential.key;
      row.querySelector('.key-label').textContent = credential.label;
      row.querySelector('.key-kind').textContent = credential.kind;
      row.querySelector('.key-date').textContent = `ISSUED ${formatDate(credential.issuedAt, true)}`;
      keys.append(row);
    }
  }

  function enterInterior(profile = readSession()) {
    location.href = `${PUBLIC_ORIGIN}/interior-prototype/?relation=${profile.relation}#current`;
  }

  function authenticate(button) {
    busy(button, true);
    status('entry', 'WAITING FOR AUTHENTICATOR');
    setTimeout(() => enterInterior(writeSession(requestedProfile())), 240);
  }

  function showCodes() {
    const codes = ['PROB-DEMO-41K7', 'PROB-DEMO-89Q2', 'PROB-DEMO-16HM', 'PROB-DEMO-73XC', 'PROB-DEMO-28RT', 'PROB-DEMO-95VF'];
    const list = document.querySelector('[data-codes]');
    list.replaceChildren(...codes.map((code) => {
      const item = document.createElement('li');
      item.textContent = code;
      return item;
    }));
    show('codes');
  }

  function mockPresence(button) {
    busy(button, true);
    status('record', 'WAITING FOR AUTHENTICATOR');
    setTimeout(() => {
      document.querySelector('[data-presence]').textContent = `PRESENCE VERIFIED ${formatDate(new Date().toISOString())}`;
      status('record');
      busy(button, false);
    }, 240);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;

    if (button.classList.contains('revoke')) return status('record', 'KEY REVOKED. PRESENT A REMAINING KEY.');
    if (action === 'present') return authenticate(button);
    if (action === 'show-establish') return show('establish');
    if (action === 'show-recovery') return show('recovery');
    if (action === 'home') return show('entry');
    if (action === 'boundary') return show('boundary');
    if (action === 'record') return show('record');
    if (action === 'verify') return mockPresence(button);
    if (action === 'replace-codes') {
      returnAfterCodes = 'record';
      return showCodes();
    }
    if (action === 'codes-stored') {
      document.querySelector('[data-codes]').replaceChildren();
      if (returnAfterCodes === 'entry') return show('entry');
      if (returnAfterCodes === 'record') return show('record');
      return enterInterior(readSession());
    }
    if (action === 'logout') {
      busy(button, true);
      sessionStorage.removeItem(SESSION_KEY);
      location.href = `${PUBLIC_ORIGIN}/?recognized=0&ended=1`;
    }
  });

  document.querySelector('[data-form="establish"]').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(event.currentTarget, true);
    status('establish', 'WAITING FOR AUTHENTICATOR');
    setTimeout(() => {
      writeSession(profiles.first);
      returnAfterCodes = 'interior';
      showCodes();
      busy(event.currentTarget, false);
    }, 240);
  });

  document.querySelector('[data-form="recovery"]').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(event.currentTarget, true);
    status('recovery', 'VERIFYING RECOVERY');
    setTimeout(() => {
      returnAfterCodes = 'entry';
      showCodes();
      busy(event.currentTarget, false);
    }, 240);
  });

  document.querySelector('[data-form="add-key"]').addEventListener('submit', (event) => {
    event.preventDefault();
    status('record', 'KEY ADDED');
  });

  const session = readSession();
  if (session) renderSession(session);
  if (session && params.get('action') === 'record') show('record');
  else if (session && params.get('action') === 'end') show('boundary');
  else if (session) show('boundary');
  else show('entry');
})();
