// Integration prototype only. Recognition is tab-scoped on the public local
// origin; production Access cookies remain isolated and are never read here.
const PROBNAYA_MOCK_RELATION = 'probnaya:mock-relation';
const PROBNAYA_MOCK_JOURNEY = 'probnaya:mock-journey';
const PROBNAYA_MOCK_ENDED = 'probnaya:mock-ended';
const PROBNAYA_MOCK_LAST_RELATION = 'probnaya:mock-last-relation';

(function initMockRecognition() {
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(location.hostname) || location.protocol === 'file:';
  if (!isLocal) return;
  const params = new URLSearchParams(location.search);
  const mode = params.get('recognized');
  const relation = params.get('relation');
  const journey = params.get('journey');
  if (journey && ['first', 'populated', 'unissued'].includes(journey)) sessionStorage.setItem(PROBNAYA_MOCK_JOURNEY, journey);
  if (relation && ['empty', 'populated', 'unissued'].includes(relation)) {
    sessionStorage.setItem(PROBNAYA_MOCK_RELATION, relation);
    sessionStorage.setItem('probnaya:mock-recognition', 'known');
    sessionStorage.removeItem(PROBNAYA_MOCK_ENDED);
  }
  if (mode === '1' && !sessionStorage.getItem(PROBNAYA_MOCK_RELATION)) {
    sessionStorage.setItem(PROBNAYA_MOCK_RELATION, 'populated');
    sessionStorage.setItem('probnaya:mock-recognition', 'known');
  }
  if (mode === '0') {
    const previous = sessionStorage.getItem(PROBNAYA_MOCK_RELATION);
    if (previous) sessionStorage.setItem(PROBNAYA_MOCK_LAST_RELATION, previous);
    sessionStorage.removeItem(PROBNAYA_MOCK_RELATION);
    sessionStorage.removeItem('probnaya:mock-recognition');
    if (params.get('ended') === '1') sessionStorage.setItem(PROBNAYA_MOCK_ENDED, 'true');
    else sessionStorage.removeItem(PROBNAYA_MOCK_ENDED);
  }
  const active = sessionStorage.getItem(PROBNAYA_MOCK_RELATION);
  if (active) {
    document.documentElement.dataset.recognized = 'true';
    document.documentElement.dataset.relation = active;
    document.documentElement.dataset.portrait = active === 'populated' ? 'issued' : 'unissued';
  }
})();

// Small shared page chrome behaviour used across all pages.
document.addEventListener('DOMContentLoaded', () => {
  const stamp = 'PROB–' + new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  document.querySelectorAll('[data-stamp]').forEach(el => { el.textContent = stamp; });

  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(location.hostname) || location.protocol === 'file:';
  const representation = '<span class="holder-presence-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="3.5" y="3.5" width="25" height="25"></rect><path class="presence-axis" d="M1 16h30M16 1v30"></path><g class="presence-issued"><circle cx="16" cy="16" r="9"></circle><circle cx="16" cy="16" r="5"></circle></g><rect class="presence-neutral" x="13" y="13" width="6" height="6"></rect></svg></span>';
  const relation = sessionStorage.getItem(PROBNAYA_MOCK_RELATION) || 'populated';
  const holders = { populated: 'PROB–H–0087', empty: 'PROB–H–0142', unissued: 'PROB–H–0119' };

  if (document.documentElement.dataset.recognized === 'true') {
    const makeReturn = () => {
      const link = document.createElement('a');
      link.className = 'recognized-return';
      link.href = '/interior-prototype/';
      link.setAttribute('aria-label', `Return to the PROBNAYA Interior for holder ${holders[relation]}`);
      link.innerHTML = `${representation}<span class="return-label">INTERIOR</span><span class="return-holder">${holders[relation]}</span>`;
      return link;
    };
    document.querySelectorAll('.site-header .nav-right').forEach(nav => nav.prepend(makeReturn()));
    document.querySelectorAll('.mobile-header').forEach(header => {
      header.insertBefore(makeReturn(), header.querySelector('.crumb'));
    });
  } else {
    const journey = sessionStorage.getItem(PROBNAYA_MOCK_JOURNEY) || 'populated';
    const accessHref = isLocal ? `http://localhost:4183/integration-access/?journey=${journey}&reset=1` : 'https://access.probnaya.work/';
    const makeEntry = () => {
      const link = document.createElement('a');
      link.className = 'access-entry';
      link.href = accessHref;
      link.textContent = 'ENTER';
      link.setAttribute('aria-label', 'Enter PROBNAYA through Access');
      return link;
    };
    document.querySelectorAll('.site-header .nav-right').forEach(nav => nav.prepend(makeEntry()));
    document.querySelectorAll('.mobile-header').forEach(header => header.insertBefore(makeEntry(), header.querySelector('.crumb')));
  }
});

// Vercel Web Analytics — anonymous pageviews. Loaded here so every page that
// already pulls in site.js is covered. Root-relative src works at any depth.
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
(function () {
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})();
