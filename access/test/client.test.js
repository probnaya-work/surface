import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Runs the real public/app.js against a minimal document, history, and fetch, so
// the order of operations around an establishment link can be asserted exactly.
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const VIEWS = ['entry', 'request', 'received', 'establish', 'recovery', 'boundary', 'end', 'record', 'codes'];
const GRANT = 'Hk3vQ2wZ8pL0sT5yN1bR7cX4mD9fJ6aE2gU3hK5nW0q';

class Element {
  constructor(props = {}) {
    this.hidden = false;
    this.textContent = '';
    this.dataset = {};
    this.listeners = {};
    this.fields = {};
    this.children = [];
    this.classList = { toggle: () => {} };
    Object.assign(this, props);
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  focus() {}
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  reset() { this.resets = (this.resets || 0) + 1; }
  closest() { return null; }
}

class FormElement extends Element {}

function page({ hash = '', respond }) {
  const log = [];
  const elements = new Map();
  const views = VIEWS.map((name) => new Element({ hidden: name !== 'entry', dataset: { view: name } }));
  let clickListener;
  const location = {
    hash,
    pathname: '/',
    replace: (url) => log.push({ type: 'navigate', url }),
  };
  const document = {
    querySelector(selector) {
      if (selector === 'meta[name="probnaya-public-origin"]') return new Element({ content: 'https://probnaya.work' });
      if (!elements.has(selector)) elements.set(selector, selector.startsWith('[data-form=') ? new FormElement() : new Element());
      return elements.get(selector);
    },
    querySelectorAll: (selector) => (selector === '[data-view]' ? views : []),
    createElement: () => new Element(),
    addEventListener: (type, listener) => { if (type === 'click') clickListener = listener; },
  };
  const context = {
    document,
    location,
    history: { replaceState: (state, title, url) => { log.push({ type: 'replaceState', url, hashBefore: location.hash }); location.hash = ''; } },
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form.fields[name]; } },
    fetch: async (url, init = {}) => {
      log.push({ type: 'fetch', url, method: init.method, body: init.body || '', headers: init.headers || {}, hashAtRequest: location.hash });
      const [status, body] = await respond({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
    HTMLFormElement: FormElement,
    Intl,
    console,
  };
  const windowListeners = {};
  context.addEventListener = (type, listener) => { (windowListeners[type] ||= []).push(listener); };
  context.window = context;
  context.window.SimpleWebAuthnBrowser = {
    browserSupportsWebAuthn: () => true,
    startRegistration: async () => { log.push({ type: 'webauthn' }); return { id: 'cred', rawId: 'cred', type: 'public-key', response: {}, clientExtensionResults: {} }; },
    startAuthentication: async () => { throw new Error('not used'); },
  };
  vm.runInNewContext(source, context);
  const flush = async () => { for (let tick = 0; tick < 12; tick += 1) await new Promise((resolve) => setImmediate(resolve)); };
  const visible = () => views.filter((view) => !view.hidden).map((view) => view.dataset.view);
  const form = (name) => document.querySelector(`[data-form="${name}"]`);
  const submit = async (name, fields) => {
    const target = form(name);
    target.fields = fields;
    target.listeners.submit[0]({ preventDefault() {}, currentTarget: target });
    await flush();
  };
  const click = async (action) => {
    clickListener({ target: { closest: () => new Element({ dataset: { action }, classList: { contains: () => false } }) } });
    await flush();
  };
  const text = () => [...elements.values()].map((element) => element.textContent).join('\n');
  const changeHash = async (value) => { location.hash = value; for (const listener of windowListeners.hashchange || []) listener(); await flush(); };
  return { log, flush, visible, form, submit, click, text, document, changeHash, fetches: () => log.filter((entry) => entry.type === 'fetch') };
}

const signedOut = ({ method }) => (method === 'GET' ? [401, { ok: false, error: 'AUTHENTICATION REQUIRED' }] : [500, { ok: false }]);

test('an establishment link is cleared from the address bar before any request and is not sent on load', async () => {
  const p = page({ hash: `#establish=${GRANT}`, respond: signedOut });
  await p.flush();
  const first = p.log.findIndex((entry) => entry.type === 'fetch');
  const cleared = p.log.findIndex((entry) => entry.type === 'replaceState');
  assert.ok(cleared >= 0 && cleared < first, 'the fragment is replaced before the first request');
  assert.equal(p.log[cleared].url, '/');
  assert.equal(p.log[cleared].hashBefore, `#establish=${GRANT}`);
  for (const entry of p.fetches()) {
    assert.equal(entry.hashAtRequest, '', 'no request is made while the fragment is visible');
    assert.equal(entry.body.includes(GRANT) || entry.url.includes(GRANT), false, 'the grant is not sent on load');
  }
  assert.deepEqual(p.fetches().map((entry) => entry.method), ['GET'], 'only the session read happens on load');
  assert.equal(p.log.some((entry) => entry.type === 'webauthn'), false, 'WebAuthn never starts by itself');
  assert.deepEqual(p.visible(), ['establish']);
  assert.equal(p.text().includes(GRANT), false, 'the grant is never written into the page');
});

test('CREATE PASSKEY sends the grant exactly once, then hands off to the Interior', async () => {
  const p = page({
    hash: `#establish=${GRANT}`,
    respond: ({ method, body }) => {
      if (method === 'GET') return [401, { ok: false }];
      if (body.action === 'enrollment-options') return [200, { ok: true, ceremonyId: 'ceremony', options: {} }];
      if (body.action === 'enrollment-verify') return [200, { ok: true, authenticated: true, holder: { publicId: 'PROB–H–0144' }, csrf: 'c', recoveryCodes: ['AAAA-BBBB'] }];
      return [500, { ok: false }];
    },
  });
  await p.flush();
  await p.submit('establish', { label: 'PRIMARY PASSKEY' });
  const posts = p.fetches().filter((entry) => entry.method === 'POST');
  assert.deepEqual(posts.map((entry) => JSON.parse(entry.body).action), ['enrollment-options', 'enrollment-verify']);
  assert.deepEqual(JSON.parse(posts[0].body).data, { grant: GRANT, label: 'PRIMARY PASSKEY' });
  assert.equal(posts[1].body.includes(GRANT), false);
  assert.equal(posts.every((entry) => !entry.headers['X-PROBNAYA-CSRF']), true);
  assert.equal(p.log.filter((entry) => entry.type === 'webauthn').length, 1);
  assert.deepEqual(p.visible(), ['codes']);

  await p.click('codes-stored');
  assert.deepEqual(p.log.filter((entry) => entry.type === 'navigate').map((entry) => entry.url), ['https://probnaya.work/interior/']);

  // The grant is gone from memory: a second submission sends nothing.
  const before = p.fetches().length;
  await p.submit('establish', { label: 'PRIMARY PASSKEY' });
  assert.equal(p.fetches().length, before);
});

test('a link the server refuses shows one closed-link message and is never retried', async () => {
  const p = page({
    hash: `#establish=${GRANT}`,
    respond: ({ method }) => (method === 'GET' ? [401, { ok: false }] : [400, { ok: false, error: 'ACCESS COULD NOT BE VERIFIED' }]),
  });
  await p.flush();
  await p.submit('establish', { label: 'PRIMARY PASSKEY' });
  assert.match(p.document.querySelector('[data-status="establish"]').textContent, /^THIS LINK IS NO LONGER OPEN\./);
  assert.equal(p.form('establish').hidden, true);
  assert.equal(p.document.querySelector('[data-establish-supporting]').hidden, true, 'the page no longer says the link works');
  assert.equal(p.log.some((entry) => entry.type === 'webauthn'), false);
  const before = p.fetches().length;
  await p.submit('establish', { label: 'PRIMARY PASSKEY' });
  assert.equal(p.fetches().length, before);
  await p.click('home');
  await p.click('show-establish');
  assert.deepEqual(p.visible(), ['request'], 'ESTABLISH ACCESS then offers a request');
});

test('a malformed establishment fragment is cleared and never sent', async () => {
  const p = page({ hash: '#establish=short<script>', respond: signedOut });
  await p.flush();
  assert.equal(p.log.find((entry) => entry.type === 'replaceState').url, '/');
  assert.deepEqual(p.visible(), ['establish']);
  assert.match(p.document.querySelector('[data-status="establish"]').textContent, /^THIS LINK IS NO LONGER OPEN\./);
  assert.equal(p.fetches().some((entry) => entry.method === 'POST'), false);
});

test('without a link, ESTABLISH ACCESS asks only for an address and shows a receipt', async () => {
  const p = page({ respond: ({ method, body }) => (method === 'GET' ? [401, { ok: false }] : body.action === 'request-access' ? [200, { ok: true, received: true }] : [500, { ok: false }]) });
  await p.flush();
  assert.deepEqual(p.visible(), ['entry']);
  await p.click('show-establish');
  assert.deepEqual(p.visible(), ['request']);

  await p.submit('request', { email: 'not an address' });
  assert.equal(p.fetches().some((entry) => entry.method === 'POST'), false, 'an obviously invalid address is not sent');
  assert.equal(p.document.querySelector('[data-status="request"]').textContent, 'THIS ADDRESS COULD NOT BE USED. CHECK IT AND TRY AGAIN.');

  await p.submit('request', { email: '  noor.haddad@fastmail.com ' });
  const [post] = p.fetches().filter((entry) => entry.method === 'POST');
  assert.deepEqual(JSON.parse(post.body), { action: 'request-access', data: { email: 'noor.haddad@fastmail.com' } });
  assert.equal(post.headers['X-PROBNAYA-CSRF'], undefined);
  assert.deepEqual(p.visible(), ['received']);
  assert.equal(p.document.querySelector('[data-received-address]').textContent, 'noor.haddad@fastmail.com');
  assert.equal(p.form('request').resets, 1);

  await p.click('home');
  assert.equal(p.document.querySelector('[data-received-address]').textContent, '', 'the address leaves the page with the receipt');
});

test('request failures are shown plainly and leave the form in place', async () => {
  const p = page({ respond: ({ method }) => (method === 'GET' ? [401, { ok: false }] : [503, { ok: false, error: 'REQUESTS CANNOT BE SENT FROM HERE AT THE MOMENT. WRITE TO MAIL@PROBNAYA.WORK.' }]) });
  await p.flush();
  await p.click('show-establish');
  await p.submit('request', { email: 'noor@example.org' });
  assert.deepEqual(p.visible(), ['request']);
  assert.equal(p.document.querySelector('[data-status="request"]').textContent, 'REQUESTS CANNOT BE SENT FROM HERE AT THE MOMENT. WRITE TO MAIL@PROBNAYA.WORK.');
});

test('a browser that already holds a relation is told the link establishes a separate one', async () => {
  const session = { ok: true, holder: { publicId: 'PROB–H–0087' }, lastVerifiedAt: '2026-09-17T10:00:00Z', record: { credentials: [], recovery: 'CODES ACTIVE' }, csrf: 'c' };
  const p = page({ hash: `#establish=${GRANT}`, respond: ({ method }) => (method === 'GET' ? [200, session] : [500, { ok: false }]) });
  await p.flush();
  assert.deepEqual(p.visible(), ['establish'], 'the link is not replaced by the authenticated boundary');
  const note = p.document.querySelector('[data-establish-note]');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'THIS BROWSER HOLDS PROB–H–0087. THIS LINK ESTABLISHES A SEPARATE RELATION.');
});

test('a link opened in an Access tab that is already loaded is taken and cleared the same way', async () => {
  const p = page({ respond: ({ method, body }) => (method === 'GET' ? [401, { ok: false }] : body.action === 'request-access' ? [200, { ok: true, received: true }] : [500, { ok: false }]) });
  await p.flush();
  await p.click('show-establish');
  await p.submit('request', { email: 'noor@example.org' });
  assert.deepEqual(p.visible(), ['received']);
  const requests = p.fetches().length;
  await p.changeHash(`#establish=${GRANT}`);
  const cleared = p.log.filter((entry) => entry.type === 'replaceState').at(-1);
  assert.deepEqual([cleared.url, cleared.hashBefore], ['/', `#establish=${GRANT}`]);
  assert.deepEqual(p.visible(), ['establish']);
  assert.equal(p.fetches().length, requests, 'taking the link makes no request');
  assert.equal(p.form('establish').hidden, false);
  await p.changeHash('#record');
  assert.deepEqual(p.visible(), ['establish'], 'other fragments are left to the existing boot handling');
});
