// Small shared page chrome behaviour used across all pages.

// The Index covers the page, but leaves the visible header usable. Keep keyboard
// navigation in that same surface, and restore the page's previous inert state.
(function () {
  const panel = document.getElementById('site-index');
  if (!panel) return;
  const toggles = [...document.querySelectorAll('.index-toggle')];
  const background = [...document.querySelectorAll('main, .site-footer')];
  const previousInert = new Map();
  let trigger = null;

  const visible = (el) => el && el.isConnected && el.getClientRects().length &&
    !el.closest('[inert]') && getComputedStyle(el).visibility !== 'hidden';
  const visibleToggle = () => toggles.find(visible);
  const focus = (el) => { if (visible(el)) el.focus({ preventScroll: true }); };
  const controls = () => [...document.querySelectorAll(
    '.site-header a[href], .site-header button, .mobile-header a[href], .mobile-header button, #site-index a[href], #site-index button'
  )].filter(el => visible(el) && !el.disabled && el.tabIndex >= 0);

  const set = (open) => {
    if (open && panel.hidden) {
      background.forEach(el => { previousInert.set(el, el.inert); el.inert = true; });
    } else if (!open) {
      previousInert.forEach((inert, el) => { el.inert = inert; });
      previousInert.clear();
    }
    panel.hidden = !open;
    document.documentElement.classList.toggle('index-open', open);
    toggles.forEach((t) => {
      t.setAttribute('aria-expanded', String(open));
      const act = t.querySelector('[data-index-act]');
      if (act) act.textContent = open ? 'CLOSE' : 'INDEX';
    });
  };
  const open = (source) => {
    trigger = source;
    set(true);
    focus(visibleToggle());
  };
  const close = (restoreFocus) => {
    set(false);
    if (restoreFocus) focus(visible(trigger) ? trigger : visibleToggle());
    trigger = null;
  };
  const ordinaryClick = (event, link) => !event.defaultPrevented && !(event.button > 0) &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
    !link.hasAttribute('download') && (!link.target || link.target === '_self');

  toggles.forEach(t => t.addEventListener('click', () => panel.hidden ? open(t) : close(true)));
  document.querySelectorAll('[data-open-index]').forEach(link => link.addEventListener('click', event => {
    if (!ordinaryClick(event, link)) return;
    event.preventDefault();
    if (panel.hidden) open(link);
  }));

  panel.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || !panel.contains(link) || !ordinaryClick(event, link)) return;
    // Leave cross-page and modified clicks to the browser. Root anchors also
    // work when the homepage is served as index.html for a local preview.
    let url, id;
    try {
      url = new URL(link.href, location.href);
      id = decodeURIComponent(url.hash.slice(1));
    } catch (_) { return; }
    const home = ['/', '/index', '/index.html'];
    const samePath = url.pathname === location.pathname ||
      (home.includes(url.pathname) && home.includes(location.pathname));
    if (url.origin !== location.origin || !samePath || url.search !== location.search || !id) return;
    const destination = document.getElementById(id);
    if (!destination) return;
    close(false);
    if (!destination.hasAttribute('tabindex')) {
      destination.setAttribute('tabindex', '-1');
      destination.addEventListener('blur', () => destination.removeAttribute('tabindex'), { once: true });
    }
    focus(destination);
    // The browser still updates history and scrolls to the anchor normally.
  });

  document.addEventListener('keydown', event => {
    if (panel.hidden || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      const items = controls();
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      if (current < 0 || (event.shiftKey ? current === 0 : current === items.length - 1)) {
        event.preventDefault();
        focus(event.shiftKey ? items[items.length - 1] : items[0]);
      }
    }
  });
  window.addEventListener('resize', () => {
    if (!panel.hidden && !controls().includes(document.activeElement)) focus(visibleToggle());
  });
  window.addEventListener('pageshow', () => close(!panel.hidden));
})();

document.addEventListener('DOMContentLoaded', () => {
  const stamp = 'PROB–' + new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  document.querySelectorAll('[data-stamp]').forEach(el => { el.textContent = stamp; });
});

// Public PROBNAYA stays public for a recognized holder. The only change is one
// path in the existing header: ENTER for everyone else, or a return to the
// Interior carrying the holder's issued representation and identifier.
// Recognition comes from Access through js/relation.js; nothing here is authority.
//
// The path lives in a `.relation-slot` written into every header, so the header
// is complete before any script runs. A visitor without the recognition hint is
// already known to be shown ENTER, which the page carries statically. For a
// hinted visitor an inline script in <head> marks the document
// `data-relation="pending"` before first paint, which keeps the slot empty until
// Access answers; the answer is then written into the slot and the mark removed
// in the same task, so nothing is ever shown and then replaced.
(function recognition() {
  function place(make) {
    for (const slot of document.querySelectorAll('.relation-slot')) slot.replaceChildren(make());
    delete document.documentElement.dataset.relation;
  }

  function enter(access) {
    place(() => {
      const link = document.createElement('a');
      link.className = 'access-entry';
      link.href = access.entry;
      link.textContent = 'ENTER';
      return link;
    });
  }

  async function recognized(relation) {
    const { representation } = await import('/js/representation.js');
    place(() => {
      const link = document.createElement('a');
      link.className = 'recognized-return';
      link.href = '/interior/';
      link.setAttribute('aria-label', `Interior — ${relation.holder.publicId}`);
      const label = document.createElement('span');
      label.className = 'return-label';
      label.textContent = 'INTERIOR';
      const holder = document.createElement('span');
      holder.className = 'return-holder';
      holder.textContent = relation.holder.publicId;
      link.append(representation(relation.portrait, 16, 'representation mark'), label, holder);
      return link;
    });
  }

  async function update() {
    const Relation = window.ProbnayaRelation;
    if (!Relation) return;
    if (!Relation.hinted()) return enter(Relation.access);
    const result = await Relation.read();
    if (result.state === 'present') await recognized(result.relation).catch(() => enter(Relation.access));
    else enter(Relation.access);
  }

  function start() {
    if (window.ProbnayaRelation) return update();
    const script = document.createElement('script');
    script.src = '/js/relation.js';
    script.onload = update;
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // A page restored from history (for example after ending the session) asks again.
  addEventListener('pageshow', event => { if (event.persisted) update(); });
})();

// Vercel Web Analytics — anonymous pageviews. Loaded here so every page that
// already pulls in site.js is covered. Root-relative src works at any depth.
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
(function () {
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})();
