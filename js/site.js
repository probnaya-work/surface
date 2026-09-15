// Small shared page chrome behaviour used across all pages.
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
