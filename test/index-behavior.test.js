'use strict';

// Exercise the shared Index controller without a browser or network access.
// The DOM fixture models visibility, focus and inert ancestry; browser layout
// and actual scrolling still need the desktop/mobile visual checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/site.js'), 'utf8');
const controller = source.slice(0, source.indexOf("\ndocument.addEventListener('DOMContentLoaded'"));

function fixture({ mobile = false, pathname = '/', footerInert = false } = {}) {
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn, options = {}) {
      const listeners = this.listeners.get(type) || [];
      listeners.push({ fn, once: options.once });
      this.listeners.set(type, listeners);
    }
    dispatch(type, supplied = {}) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...supplied };
      for (const listener of [...(this.listeners.get(type) || [])]) {
        listener.fn(event);
        if (listener.once) this.listeners.set(type, this.listeners.get(type).filter(item => item !== listener));
      }
      return event;
    }
  }
  let document;
  class Element extends Events {
    constructor(name, { parent = null, attrs = {}, header = null } = {}) {
      super(); this.name = name; this.parent = parent; this.attrs = { ...attrs };
      this.header = header; this.inert = false; this.hidden = false; this.disabled = false;
      this.isConnected = true; this.visibility = 'visible'; this.label = { textContent: 'INDEX' };
    }
    get href() { return this.attrs.href; }
    get target() { return this.attrs.target; }
    get tabIndex() { return this.hasAttribute('tabindex') ? Number(this.attrs.tabindex) : this.href || this.attrs.button ? 0 : -1; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
    querySelector(selector) { return selector === '[data-index-act]' ? this.label : null; }
    closest(selector) {
      for (let element = this; element; element = element.parent) {
        if (selector === '[inert]' && element.inert) return element;
        if (selector === 'a[href]' && element.href) return element;
      }
      return null;
    }
    contains(element) {
      for (; element; element = element.parent) if (element === this) return true;
      return false;
    }
    getClientRects() {
      for (let element = this; element; element = element.parent) {
        if (element.hidden || (element.header && (element.header === 'mobile') !== mobile)) return [];
      }
      return [{}];
    }
    focus(options) {
      if (this.closest('[inert]') || !this.getClientRects().length || this.visibility === 'hidden') return;
      if (document.activeElement !== this) document.activeElement?.dispatch('blur');
      document.activeElement = this; this.focusOptions = options;
    }
  }
  document = new Events();
  const window = new Events();
  const body = new Element('body');
  const main = new Element('main', { parent: body });
  const footer = new Element('footer', { parent: body });
  footer.inert = footerInert;
  const desktop = new Element('desktop header', { parent: body, header: 'desktop' });
  const phone = new Element('mobile header', { parent: body, header: 'mobile' });
  const panel = new Element('panel', { parent: body }); panel.hidden = true;
  const link = (name, parent, href) => new Element(name, { parent, attrs: { href } });
  const button = (name, parent) => new Element(name, { parent, attrs: { button: true, 'aria-expanded': 'false' } });
  const brand = link('brand', desktop, '/');
  const enter = link('enter', desktop, 'https://access.probnaya.work/');
  const desktopToggle = button('desktop toggle', desktop);
  const submit = link('submit', desktop, '/intake');
  const mobileBrand = link('mobile brand', phone, '/');
  const mobileEnter = link('mobile enter', phone, 'https://access.probnaya.work/');
  const mobileToggle = button('mobile toggle', phone);
  const instrument = link('0x2F', panel, '/instrument-0x2f');
  const questions = link('questions', panel, '/#investigations');
  const last = link('last link', panel, '/intake');
  const opener = link('content Index', main, '#site-index');
  const destination = new Element('Investigations', { parent: main });
  const controls = [brand, enter, desktopToggle, submit, mobileBrand, mobileEnter, mobileToggle, instrument, questions, last];
  const classes = new Set();
  document.activeElement = body;
  document.documentElement = { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } };
  document.getElementById = id => ({ 'site-index': panel, investigations: destination })[id] || null;
  document.querySelectorAll = selector => {
    if (selector === '.index-toggle') return [desktopToggle, mobileToggle];
    if (selector === 'main, .site-footer') return [main, footer];
    if (selector === '[data-open-index]') return [opener];
    if (selector.startsWith('.site-header a[href]')) return controls;
    throw new Error(`Unexpected selector: ${selector}`);
  };
  const location = new URL(`https://probnaya.work${pathname}`);
  vm.runInNewContext(controller, { document, window, location, URL, getComputedStyle: element => ({ visibility: element.visibility }) });
  const click = (element, options = {}) => {
    const event = element.dispatch('click', { button: 0, ...options });
    if (panel.contains(element)) panel.dispatch('click', event);
    return event;
  };
  return {
    document, window, panel, main, footer, classes, brand, enter, desktopToggle, submit,
    mobileBrand, mobileEnter, mobileToggle, instrument, questions, last, opener, destination,
    click, key: (key, options = {}) => document.dispatch('keydown', { key, ...options }),
    resize: value => { mobile = value; window.dispatch('resize'); },
  };
}

test('the closed Index leaves existing focus and inert state alone', () => {
  const f = fixture({ footerInert: true });
  f.opener.focus();
  f.window.dispatch('pageshow');
  assert.equal(f.document.activeElement, f.opener);
  assert.equal(f.main.inert, false);
  assert.equal(f.footer.inert, true);
  assert.equal(f.key('Tab').defaultPrevented, false);
  f.resize(true);
  assert.equal(f.document.activeElement, f.opener);
});

test('opening synchronizes both controls; closing restores prior inert and trigger focus', () => {
  const f = fixture({ footerInert: true });
  f.click(f.desktopToggle);
  assert.equal(f.panel.hidden, false);
  assert.equal(f.classes.has('index-open'), true);
  for (const toggle of [f.desktopToggle, f.mobileToggle]) {
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.label.textContent, 'CLOSE');
  }
  assert.equal(f.main.inert, true);
  assert.equal(f.footer.inert, true);
  f.last.focus();
  assert.equal(f.key('Escape').defaultPrevented, true);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.main.inert, false);
  assert.equal(f.footer.inert, true);
  assert.equal(f.document.activeElement, f.desktopToggle);
  assert.equal(f.classes.has('index-open'), false);
  assert.equal(f.mobileToggle.label.textContent, 'INDEX');
});

test('the content trigger opens the Index and receives focus when it closes', () => {
  const f = fixture();
  f.opener.focus();
  assert.equal(f.click(f.opener).defaultPrevented, true);
  assert.equal(f.document.activeElement, f.desktopToggle);
  f.click(f.desktopToggle);
  assert.equal(f.document.activeElement, f.opener);
  assert.equal(f.main.inert, false);
});

test('keyboard boundaries include the visible brand, Enter and Submit controls', () => {
  const f = fixture();
  f.click(f.desktopToggle);
  f.last.focus();
  assert.equal(f.key('Tab').defaultPrevented, true);
  assert.equal(f.document.activeElement, f.brand);
  assert.equal(f.key('Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(f.document.activeElement, f.last);
  for (const control of [f.brand, f.enter, f.desktopToggle, f.submit, f.instrument]) {
    control.focus();
    assert.equal(f.key('Tab').defaultPrevented, false, `${control.name} retains native tab order`);
  }
});

test('mobile focus follows the visible header after resizing and when restoring a hidden trigger', () => {
  const f = fixture();
  f.click(f.desktopToggle);
  f.resize(true);
  assert.equal(f.document.activeElement, f.mobileToggle);
  f.last.focus();
  f.key('Tab');
  assert.equal(f.document.activeElement, f.mobileBrand);
  f.key('Escape');
  assert.equal(f.document.activeElement, f.mobileToggle);
});

test('resizing recovers focus if the browser drops a hidden header control onto the body', () => {
  const f = fixture();
  f.click(f.desktopToggle);
  f.document.activeElement = f.desktopToggle.parent.parent;
  f.resize(true);
  assert.equal(f.document.activeElement, f.mobileToggle);
});

test('a pending hidden Enter link and disabled controls are excluded from keyboard boundaries', () => {
  const f = fixture({ mobile: true });
  f.mobileBrand.disabled = true;
  f.mobileEnter.visibility = 'hidden';
  f.click(f.mobileToggle);
  f.last.focus();
  f.key('Tab');
  assert.equal(f.document.activeElement, f.mobileToggle);
});

test('same-page root anchors close, release inert and focus the destination without replacing native navigation', () => {
  for (const pathname of ['/', '/index.html']) {
    const f = fixture({ pathname });
    f.click(f.desktopToggle);
    const event = f.click(f.questions);
    assert.equal(event.defaultPrevented, false, 'native history and anchor scrolling remain available');
    assert.equal(f.panel.hidden, true);
    assert.equal(f.main.inert, false);
    assert.equal(f.document.activeElement, f.destination);
    assert.equal(f.destination.getAttribute('tabindex'), '-1');
    f.opener.focus();
    assert.equal(f.destination.hasAttribute('tabindex'), false, 'temporary focusability is removed after leaving');
  }
});

test('pre-existing destination tabindex is retained', () => {
  const f = fixture();
  f.destination.setAttribute('tabindex', '0');
  f.click(f.desktopToggle); f.click(f.questions); f.opener.focus();
  assert.equal(f.destination.getAttribute('tabindex'), '0');
});

test('modified and alternate-target clicks keep normal browser behavior', () => {
  for (const options of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const f = fixture();
    f.click(f.opener, options);
    assert.equal(f.panel.hidden, true);
    f.click(f.desktopToggle);
    f.click(f.questions, options);
    assert.equal(f.panel.hidden, false);
    assert.notEqual(f.document.activeElement, f.destination);
  }
  for (const attribute of ['target', 'download']) {
    const f = fixture();
    f.questions.setAttribute(attribute, attribute === 'target' ? '_blank' : 'questions.html');
    f.click(f.desktopToggle); f.click(f.questions);
    assert.equal(f.panel.hidden, false);
  }
});

test('cross-page anchors, missing IDs and other origins are not intercepted', () => {
  const cases = [
    { pathname: '/instrument-0x2f', href: '/#investigations' },
    { href: '/#missing' },
    { href: '/#%broken' },
    { href: 'https://example.org/#investigations' },
    { href: '/?other=1#investigations' },
  ];
  for (const { pathname, href } of cases) {
    const f = fixture({ pathname });
    f.questions.setAttribute('href', href);
    f.click(f.desktopToggle);
    assert.equal(f.click(f.questions).defaultPrevented, false);
    assert.equal(f.panel.hidden, false);
  }
});

test('restoring a page from history closes its Index and restores page interactivity', () => {
  const f = fixture();
  f.click(f.opener); f.last.focus();
  f.window.dispatch('pageshow', { persisted: true });
  assert.equal(f.panel.hidden, true);
  assert.equal(f.main.inert, false);
  assert.equal(f.document.activeElement, f.opener);
});
