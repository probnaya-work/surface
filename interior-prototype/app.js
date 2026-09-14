(() => {
  'use strict';

  const RELATION_KEY = 'probnaya:mock-relation';
  const ENDED_KEY = 'probnaya:mock-ended';
  const LAST_RELATION_KEY = 'probnaya:mock-last-relation';
  const view = document.getElementById('interior-view');
  const notice = document.getElementById('prototype-notice');
  const knownRoutes = new Set(['current', 'held', 'history', 'standing', 'correspondence', 'investigation', 'object']);
  const profiles = {
    populated: { key: 'populated', holder: 'PROB–H–0087', portrait: 'issued', empty: false },
    empty: { key: 'empty', holder: 'PROB–H–0142', portrait: 'unissued', empty: true },
    unissued: { key: 'unissued', holder: 'PROB–H–0119', portrait: 'unissued', empty: false },
  };
  let noticeTimer;

  function localAccess(action = '') {
    const query = new URLSearchParams({ relation: profile.key });
    if (action) query.set('action', action);
    return `http://localhost:4183/integration-access/?${query}`;
  }

  function readProfile() {
    const requested = new URLSearchParams(location.search).get('relation');
    if (profiles[requested]) {
      sessionStorage.setItem(RELATION_KEY, requested);
      sessionStorage.removeItem(ENDED_KEY);
      history.replaceState(null, '', `${location.pathname}${location.hash || '#current'}`);
      return profiles[requested];
    }
    const stored = sessionStorage.getItem(RELATION_KEY);
    if (profiles[stored]) return profiles[stored];
    if (sessionStorage.getItem('probnaya:mock-recognition') === 'known') return profiles.populated;
    if (sessionStorage.getItem(ENDED_KEY) === 'true' && location.protocol !== 'file:') {
      const lastRelation = sessionStorage.getItem(LAST_RELATION_KEY) || 'populated';
      location.replace(`http://localhost:4183/integration-access/?journey=${lastRelation}`);
      return profiles.populated;
    }
    sessionStorage.setItem(RELATION_KEY, 'populated');
    return profiles.populated;
  }

  const profile = readProfile();
  sessionStorage.setItem('probnaya:mock-recognition', 'known');
  document.documentElement.dataset.portrait = profile.portrait;
  document.documentElement.dataset.relation = profile.key;
  document.querySelector('.holder-control strong').textContent = profile.holder;

  function routeFromHash() {
    const route = location.hash.slice(1);
    const next = knownRoutes.has(route) ? route : 'current';
    if (profile.empty && !['current', 'held', 'history', 'standing'].includes(next)) return 'current';
    if (profile.portrait !== 'issued' && next === 'object') return 'held';
    return next;
  }

  function sectionFor(route) {
    if (route === 'object') return 'held';
    if (route === 'correspondence' || route === 'investigation' || route === 'standing') return 'current';
    return route;
  }

  function replaceHolder(root) {
    if (profile.holder === 'PROB–H–0087') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      walker.currentNode.nodeValue = walker.currentNode.nodeValue
        .replaceAll('PROB–H–0087', profile.holder)
        .replaceAll('PROB–H–0142', profile.holder);
    }
  }

  function applyRelationState(root) {
    replaceHolder(root);
    if (root.querySelector('.standing-page')) {
      const statement = root.querySelector('.standing-statement > p');
      const values = root.querySelectorAll('.standing-statement dl dd');
      const keyCount = root.querySelector('.access-separation dl dd');
      const representationState = root.querySelector('[data-representation-state]');
      const representationAction = root.querySelector('.relation-representation button');
      if (profile.empty) {
        statement.innerHTML = 'Relation active.<br>Established 14 September 2026.';
        values[0].textContent = '00';
        values[1].textContent = '00 OBJECTS';
        values[2].textContent = '00';
        keyCount.textContent = '01 ACTIVE';
      } else if (profile.portrait !== 'issued') {
        values[1].textContent = '02 OBJECTS';
      }
      if (profile.portrait !== 'issued') {
        representationState.textContent = 'UNISSUED';
        representationState.previousElementSibling.textContent = 'REPRESENTATION';
        representationAction.hidden = true;
      }
      const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
      if (local) {
        root.querySelector('[data-access-record]').href = localAccess('record');
        root.querySelector('[data-access-end]').href = localAccess('end');
      }
    }
    if (!profile.empty && profile.portrait !== 'issued') {
      root.querySelector('.held-feature')?.remove();
      const heldRule = root.querySelector('#held-title')?.parentElement.querySelector('button');
      if (heldRule) heldRule.textContent = '02 OBJECTS →';
      root.querySelector('button.collection-row')?.remove();
      root.querySelectorAll('.collection-number').forEach((node, index) => { node.textContent = String(index + 1).padStart(2, '0'); });
      const heldFoot = root.querySelector('.collection-page .interior-foot span');
      if (heldFoot) heldFoot.textContent = '02 OBJECTS · 04 REPRESENTATIONS';
      const portraitHistory = [...root.querySelectorAll('.history-list li')].find(node => node.textContent.includes('PROB–OBJ.000184'));
      portraitHistory?.remove();
    }
  }

  function render(route = routeFromHash(), { push = false } = {}) {
    if (!knownRoutes.has(route)) route = 'current';
    if (profile.empty && !['current', 'held', 'history', 'standing'].includes(route)) route = 'current';
    if (profile.portrait !== 'issued' && route === 'object') route = 'held';
    const emptyVariant = profile.empty && ['current', 'held', 'history'].includes(route);
    const template = document.getElementById(`view-${route}${emptyVariant ? '-empty' : ''}`);
    view.replaceChildren(template.content.cloneNode(true));
    applyRelationState(view);
    document.querySelectorAll('[data-route]').forEach(item => {
      const active = item.dataset.route === sectionFor(route);
      item.classList.toggle('is-active', active);
      if (item.tagName === 'BUTTON') item.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (push) history.pushState({ route }, '', `#${route}`);
    document.title = `${profile.holder} — PROBNAYA Interior`;
    view.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: 'instant' });
  }

  function showNotice(message) {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.hidden = false;
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3600);
  }

  document.addEventListener('click', event => {
    const routeControl = event.target.closest('[data-route]');
    if (routeControl) {
      event.preventDefault();
      render(routeControl.dataset.route, { push: true });
      return;
    }
    const openControl = event.target.closest('[data-open]');
    if (openControl) {
      event.preventDefault();
      render(openControl.dataset.open, { push: true });
      return;
    }
    if (event.target.closest('.representations button')) {
      showNotice('PROTOTYPE · THE REPRESENTATION IS NOT ATTACHED.');
      return;
    }
    if (event.target.closest('.field-note')) {
      showNotice('PROTOTYPE · THE FIELD NOTE READING IS REPRESENTED BY THE INVESTIGATION VIEW.');
    }
  });

  addEventListener('popstate', () => render());
  render();
})();
