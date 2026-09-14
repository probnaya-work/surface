// PROBNAYA — Interior.
//
// The holder's relation with PROBNAYA, organised by its state: CURRENT (open
// now), HELD (issued and retained), HISTORY (no longer current), and RELATION
// (standing, representation, Access condition, session).
//
// Nothing renders until Access confirms a session. An absent session returns to
// Access; an unreachable Access says so and never loops. Keys, recovery, and
// ending the session are Access actions reached by link.

import { representation } from '/js/representation.js';

const Relation = window.ProbnayaRelation;
const root = document.documentElement;
const view = document.getElementById('interior-view');
const holderControl = document.querySelector('.holder-control');
const RECHECK_MS = 60_000;
const ESTABLISHMENT_CURRENT_MS = 24 * 60 * 60_000;

let relation = null;
let checkedAt = 0;
let checking = null;

// ---------- small DOM and format helpers ----------

function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function toDate(value) {
  const date = new Date(typeof value === 'string' && /^\d{4}\.\d{2}\.\d{2}$/.test(value) ? value.replaceAll('.', '-') : value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function day(value, long = false) {
  const date = toDate(value);
  if (!date) return '—';
  return `${String(date.getDate()).padStart(2, '0')} ${(long ? MONTHS_LONG : MONTHS)[date.getMonth()]} ${date.getFullYear()}`;
}

function time(value) {
  const date = toDate(value);
  return date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '';
}

function isToday(value) {
  const date = toDate(value);
  return Boolean(date) && date.toDateString() === new Date().toDateString();
}

const count = (n) => String(n).padStart(2, '0');

function recentlyEstablished() {
  const date = toDate(relation.establishedAt);
  return Boolean(date) && Date.now() - date.valueOf() < ESTABLISHMENT_CURRENT_MS;
}

function unread() {
  return relation.correspondence.filter((item) => item.unread);
}

function heldCount() {
  return relation.held.length + (relation.portrait ? 1 : 0);
}

// ---------- shared pieces ----------

function pageHeading(kicker, title, aside) {
  return h('header', { class: 'page-heading' },
    h('div', {}, h('p', { class: 'kicker', text: kicker }), h('h1', { tabindex: '-1', text: title })),
    aside ? h('div', { class: 'heading-aside' }, aside) : null);
}

function sectionRule(title, aside, id) {
  return h('header', { class: 'section-rule' },
    h('h2', { id, text: title }),
    aside instanceof Node ? aside : h('span', { text: aside }));
}

function ledger(rows, className = 'ledger') {
  return h('dl', { class: className }, rows.flatMap(([term, value, signal]) => [
    h('dt', { text: term }),
    h('dd', { class: signal ? 'is-signal' : null, text: value }),
  ]));
}

function foot(left, link) {
  return h('footer', { class: 'interior-foot' }, h('span', { text: left }), link);
}

function publicLink(label = 'PUBLIC PROBNAYA →') {
  return h('a', { href: '/', text: label });
}

function condition(label) {
  return h('span', { class: 'condition' }, h('i', { 'aria-hidden': 'true' }), label);
}

// ---------- CURRENT ----------

function establishmentMatter() {
  return h('section', { class: 'primary-matter', 'aria-labelledby': 'matter-title' },
    h('div', { class: 'matter-index' },
      h('span', { class: 'signal-square', 'aria-hidden': 'true' }),
      h('p', { text: 'RELATION' }),
      h('strong', { text: 'ESTABLISHED' }),
      h('span', { text: `${isToday(relation.establishedAt) ? 'TODAY' : day(relation.establishedAt)} · ${time(relation.establishedAt)}` })),
    h('div', { class: 'matter-body' },
      h('p', { class: 'matter-id', text: relation.holder.publicId }),
      h('h2', { id: 'matter-title', text: 'Relation established.' }),
      ledger([
        ['ACCESS', `${count(relation.keys)} ${relation.keys === 1 ? 'KEY' : 'KEYS'}`],
        ['RECOVERY', relation.recovery ? 'ESTABLISHED' : 'NOT ESTABLISHED', !relation.recovery],
        ['REPRESENTATION', relation.portrait ? relation.portrait.issue : 'UNISSUED'],
      ], 'ledger matter-ledger')));
}

function letterMatter(letter) {
  return h('section', { class: 'primary-matter', 'aria-labelledby': 'matter-title' },
    h('div', { class: 'matter-index' },
      h('span', { class: 'signal-square', 'aria-hidden': 'true' }),
      h('p', { text: 'ADDRESSED TO YOU' }),
      h('strong', { text: `${count(unread().length)} UNREAD` }),
      h('span', { text: `RECEIVED ${day(letter.received)} · ${time(letter.received)}` })),
    h('div', { class: 'matter-body' },
      h('p', { class: 'matter-id', text: `${letter.id} · CORRESPONDENCE` }),
      h('h2', { id: 'matter-title', text: letter.title }),
      letter.deck ? h('p', { class: 'matter-deck', text: letter.deck }) : null,
      letter.excerpt ? h('blockquote', { class: 'matter-excerpt', text: `“${letter.excerpt}”` }) : null,
      h('a', { class: 'text-action', href: `#correspondence/${letter.slug}`, text: 'READ CORRESPONDENCE →' })));
}

function nothingOpen() {
  return h('section', { class: 'condition-block', 'aria-labelledby': 'condition-title' },
    h('div', {},
      h('p', { class: 'matter-id', text: 'CURRENT CONDITION' }),
      h('h2', { id: 'condition-title', text: 'Nothing open.' })),
    ledger([
      ['CORRESPONDENCE', 'NONE UNREAD'],
      ['INVESTIGATIONS', 'NONE OPEN'],
    ]));
}

function openMatter() {
  const open = relation.investigations;
  return h('section', { class: 'open-matter', 'aria-labelledby': 'open-title' },
    sectionRule('OPEN BETWEEN US', open.length ? `${count(open.length)} ${open.length === 1 ? 'INVESTIGATION' : 'INVESTIGATIONS'}` : 'NOTHING OPEN', 'open-title'),
    open.map((item) => h('a', { class: 'work-row', href: `#investigation/${item.slug}` },
      h('span', { class: 'row-id', text: item.id }),
      h('span', { class: 'row-title' }, h('strong', { text: item.title }), h('small', { text: item.summary })),
      h('span', { class: 'row-state', text: item.state }),
      h('span', { class: 'row-arrow', 'aria-hidden': 'true', text: '→' }))));
}

function current() {
  const letters = unread();
  const summary = h('a', { class: 'relation-summary', href: '#relation' },
    h('span', { text: isToday(relation.establishedAt) ? 'RELATION ESTABLISHED TODAY' : `RELATION ESTABLISHED ${day(relation.establishedAt)}` }),
    h('strong', { text: 'ACTIVE' }));
  const body = [];
  if (letters.length) body.push(letterMatter(letters[0]));
  else if (recentlyEstablished() && !relation.investigations.length) body.push(establishmentMatter());
  else if (!relation.investigations.length) body.push(nothingOpen());
  if (letters.length || relation.investigations.length || recentlyEstablished()) body.push(openMatter());
  return h('div', { class: 'interior-page current-page' },
    pageHeading(`${relation.holder.publicId} · ${day(new Date(), true)}`, 'Current', summary),
    body,
    foot(`${relation.holder.publicId} · RELATION ACTIVE`, publicLink('CONTINUE THROUGH PUBLIC PROBNAYA →')));
}

// ---------- HELD ----------

const TRACES = {
  field: ['M1 23h94M1 36h94M1 49h94', 'M18 10v52M48 10v52M78 10v52', 'M1 10h94v52H1z'],
  lanes: ['M1 15h94M1 29h94M1 43h94M1 57h94', 'M20 15v14h22v14h25v14h18', ''],
};

function trace(kind) {
  const [structure, accent, extent] = TRACES[kind] || TRACES.lanes;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 96 72');
  svg.setAttribute('aria-hidden', 'true');
  for (const [d, className] of [[extent, ''], [structure, ''], [accent, 'trace-accent']]) {
    if (!d) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    if (className) path.setAttribute('class', className);
    svg.append(path);
  }
  return h('span', { class: 'object-trace' }, svg);
}

function portraitObject(portrait, { index = '01', size = 232 } = {}) {
  return h('section', { class: 'held-portrait', 'aria-labelledby': 'portrait-title' },
    sectionRule(`${index} · MACHINE PORTRAIT`, 'REPRESENTATION', null),
    h('div', { class: 'portrait-object' },
      h('figure', { class: 'portrait-figure' },
        representation(portrait, size, 'representation plate'),
        h('figcaption', {}, h('span', { text: 'PORTRAIT · CONCENTRIC' }), h('span', { class: 'is-signal', text: `FIDUCIAL COL ${portrait.cell[0]} · ROW ${portrait.cell[1]}` }))),
      h('div', { class: 'portrait-provenance' },
        h('p', { class: 'object-id', text: portrait.issue }),
        h('h2', { id: 'portrait-title', text: 'Machine Portrait' }),
        ledger([
          ['APPARATUS', portrait.apparatus],
          ['ISSUED', day(portrait.issued)],
          ['MEASUREMENT', '16 × 16 · FIVE LEVELS'],
          ['HOLDER', relation.holder.publicId],
        ]),
        h('a', { class: 'text-action', href: `#object/${portrait.slug}`, text: 'VIEW OBJECT →' }))));
}

function held() {
  const total = heldCount();
  const aside = h('p', { class: 'heading-count', text: `${count(total)} ${total === 1 ? 'OBJECT' : 'OBJECTS'}` });
  const body = [];
  if (!total) {
    body.push(h('section', { class: 'condition-block', 'aria-labelledby': 'condition-title' },
      h('div', {}, h('p', { class: 'matter-id', text: 'ISSUED TO THIS RELATION' }), h('h2', { id: 'condition-title', text: 'Nothing issued.' })),
      ledger([['OBJECTS', '00'], ['REPRESENTATION', 'UNISSUED']])));
  } else {
    if (relation.portrait) body.push(portraitObject(relation.portrait));
    if (relation.held.length) {
      const offset = relation.portrait ? 1 : 0;
      body.push(h('section', { class: 'held-register', 'aria-label': 'Other issued objects' },
        sectionRule(relation.portrait ? 'ALSO HELD' : 'ISSUED OBJECTS', `${count(relation.held.length)}`),
        h('ol', {}, relation.held.map((item, i) => h('li', { class: 'held-row' },
          h('span', { class: 'held-number', text: count(i + 1 + offset) }),
          trace(item.trace),
          h('span', { class: 'held-id' }, item.id, h('small', { text: day(item.issued) })),
          h('span', { class: 'held-title' }, item.title, h('small', { text: item.form })),
          h('span', { class: 'held-state', text: 'ISSUED' }))))));
    }
  }
  return h('div', { class: 'interior-page held-page' },
    pageHeading(`${relation.holder.publicId} · ISSUED AND RETAINED`, 'Held', aside),
    body,
    foot(`${count(total)} ${total === 1 ? 'OBJECT' : 'OBJECTS'} HELD`, h('a', { href: '#history', text: 'HISTORY →' })));
}

// ---------- HISTORY ----------

function historyView() {
  // Newest first by calendar day; the establishment of the relation precedes
  // anything else that happened on its day.
  const dayOf = (event) => toDate(event.date)?.toISOString().slice(0, 10) || '';
  const events = [
    ...relation.history,
    { date: relation.establishedAt, id: relation.holder.publicId, title: 'Relation established', state: 'ACTIVE', origin: true },
  ].sort((a, b) => dayOf(b).localeCompare(dayOf(a)) || Number(Boolean(a.origin)) - Number(Boolean(b.origin)));
  return h('div', { class: 'interior-page history-page' },
    pageHeading(`${relation.holder.publicId} · NO LONGER CURRENT`, 'History', h('p', { class: 'heading-count', text: `${count(events.length)} ${events.length === 1 ? 'EVENT' : 'EVENTS'}` })),
    h('ol', { class: 'history-list' }, events.map((event) => h('li', {},
      h('time', { datetime: toDate(event.date)?.toISOString().slice(0, 10), text: day(event.date) }),
      h('span', { text: event.id }),
      h('strong', { text: event.title }),
      h('em', { text: event.state })))),
    foot(`ESTABLISHED ${day(relation.establishedAt)}`, publicLink()));
}

// ---------- RELATION ----------

function relationView() {
  const portrait = relation.portrait;
  const letters = relation.correspondence.length;
  return h('div', { class: 'interior-page relation-page', 'data-title': 'Relation' },
    pageHeading('RELATION', relation.holder.publicId, condition('ACTIVE')),
    h('div', { class: 'relation-layout' },
      h('div', { class: 'relation-identity' },
        h('section', { class: 'relation-representation', 'aria-labelledby': 'representation-title' },
          representation(portrait, 176, 'representation plate'),
          h('div', {},
            h('h2', { id: 'representation-title', class: 'label', text: 'REPRESENTATION' }),
            h('p', { class: 'statement', text: portrait ? portrait.issue : 'UNISSUED' }),
            portrait ? h('p', { class: 'statement is-quiet', text: `MACHINE PORTRAIT · ISSUED ${day(portrait.issued)}` }) : null,
            portrait ? h('a', { class: 'text-action', href: `#object/${portrait.slug}`, text: 'HELD OBJECT →' }) : null)),
        h('section', { class: 'relation-standing', 'aria-labelledby': 'standing-title' },
          h('h2', { id: 'standing-title', class: 'label', text: 'STANDING' }),
          ledger([
            ['ESTABLISHED', day(relation.establishedAt)],
            ['CORRESPONDENCE', letters ? `${count(letters)}${unread().length ? ` · ${count(unread().length)} UNREAD` : ''}` : '00'],
            ['HELD', `${count(heldCount())} ${heldCount() === 1 ? 'OBJECT' : 'OBJECTS'}`],
            ['INVESTIGATIONS', relation.investigations.length ? `${count(relation.investigations.length)} OPEN` : '00'],
          ]))),
      h('div', { class: 'relation-authority' },
        h('section', { class: 'relation-access', 'aria-labelledby': 'access-title' },
          h('h2', { id: 'access-title', class: 'label', text: 'ACCESS' }),
          h('p', { class: 'statement', text: `${count(relation.keys)} ${relation.keys === 1 ? 'KEY' : 'KEYS'}` }),
          h('p', { class: `statement${relation.recovery ? '' : ' is-signal'}`, text: relation.recovery ? 'RECOVERY ESTABLISHED' : 'RECOVERY NOT ESTABLISHED' }),
          h('p', { class: 'statement is-quiet', text: `LAST ENTRY ${day(relation.lastVerifiedAt)} · ${time(relation.lastVerifiedAt)}` }),
          h('a', { class: 'line-action', href: Relation.access.record }, h('span', { text: 'OPEN ACCESS' }), h('span', { text: '→' }))),
        h('section', { class: 'relation-session', 'aria-labelledby': 'session-title' },
          h('h2', { id: 'session-title', class: 'label', text: 'SESSION' }),
          h('a', { class: 'line-action', href: '/' }, h('span', { text: 'PUBLIC PROBNAYA' }), h('span', { text: 'REMAIN RECOGNIZED →' })),
          h('a', { class: 'line-action is-quiet', href: Relation.access.end }, h('span', { text: 'END SESSION' }), h('span', { text: 'ACCESS →' }))))));
}

// ---------- detail views ----------

function detail(back, kicker, title, state, ...body) {
  return h('article', { class: 'interior-page detail-page' },
    h('a', { class: 'back-action', href: `#${back}`, text: `← ${back.toUpperCase()}` }),
    h('header', { class: 'detail-heading' },
      h('div', {}, h('p', { class: 'kicker', text: kicker }), h('h1', { tabindex: '-1', text: title })),
      condition(state)),
    body);
}

function correspondence(slug) {
  const letter = relation.correspondence.find((item) => item.slug === slug && item.body);
  if (!letter) return null;
  const enclosure = relation.investigations.find((item) => item.slug === letter.enclosure);
  return detail('current', `${letter.id} · CORRESPONDENCE`, letter.title, 'RECEIVED',
    h('div', { class: 'reading-layout' },
      h('aside', { class: 'detail-meta' }, ledger([['RECEIVED', day(letter.received)], ['TO', relation.holder.publicId], ['FROM', 'PROBNAYA'], ['FORM', 'LETTER']])),
      h('div', { class: 'letter' },
        h('div', { class: 'letter-head' }, h('span', { text: 'PROBNAYA / CORRESPONDENCE' }), h('span', { text: letter.id })),
        letter.body.map((paragraph) => h('p', { text: paragraph })),
        h('p', { class: 'signoff' }, 'PROBNAYA', h('br'), day(letter.received, true)),
        enclosure ? h('a', { class: 'enclosure', href: `#investigation/${enclosure.slug}` }, h('span', { text: `ENCLOSURE · ${enclosure.id}` }), h('span', { text: 'OPEN →' })) : null)));
}

function investigation(slug) {
  const item = relation.investigations.find((entry) => entry.slug === slug);
  if (!item) return null;
  return detail('current', `${item.id} · COMMISSIONED INVESTIGATION`, item.title, item.state,
    h('div', { class: 'reading-layout' },
      h('aside', { class: 'detail-meta' }, ledger([['ACCEPTED', day(item.accepted)], ['RELATION', relation.holder.publicId], ['DISCLOSURE', item.disclosure], ['FIELD NOTES', count(item.notes.length)]])),
      h('div', { class: 'investigation-body' },
        h('p', { class: 'lede', text: item.question }),
        h('section', {}, sectionRule('CURRENT FINDING', ''), h('p', { text: item.finding })),
        h('section', {}, sectionRule('AVAILABLE TO THIS RELATION', 'BEFORE DISCLOSURE'),
          item.notes.map((note) => h('div', { class: 'field-note' }, h('span', { text: `${note.id} · ${day(note.date)}` }), h('strong', { text: note.title })))))));
}

function object(slug) {
  const portrait = relation.portrait;
  if (!portrait || portrait.slug !== slug) return null;
  return detail('held', `${portrait.issue} · ISSUED OBJECT`, 'Machine Portrait', 'HELD',
    h('div', { class: 'object-layout' },
      h('figure', { class: 'portrait-figure is-large' },
        representation(portrait, 448, 'representation plate'),
        h('figcaption', {}, h('span', { text: 'PORTRAIT · CONCENTRIC · MEASURED' }), h('span', { class: 'is-signal', text: `FIDUCIAL COL ${portrait.cell[0]} · ROW ${portrait.cell[1]}` }))),
      h('div', { class: 'object-copy' },
        h('p', { class: 'lede', text: `One fixed measurement, issued through ${portrait.apparatus}.` }),
        ledger([
          ['ISSUE', portrait.issue],
          ['ISSUED', day(portrait.issued)],
          ['APPARATUS', portrait.apparatus],
          ['DERIVATION', portrait.derivation],
          ['MEASUREMENT', '16 × 16 · FIVE LEVELS'],
          ['POPULATIONS', portrait.populations.join(' / ')],
          ['HOLDER', relation.holder.publicId],
        ]),
        h('section', { class: 'representations' },
          sectionRule('ISSUED REPRESENTATIONS', '03'),
          ['PORTRAIT', 'RECORD', 'MARKS'].map((name, i) => h('p', {}, h('span', { text: `${count(i + 1)} · ${name}` }), h('span', { text: 'ISSUED' })))))));
}

// ---------- routing ----------

const SECTIONS = { current, held, history: historyView, relation: relationView };
const DETAILS = { correspondence, investigation, object };
const OWNER = { correspondence: 'current', investigation: 'current', object: 'held' };

function route() {
  const [name, slug] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (SECTIONS[name]) return { section: name, render: SECTIONS[name] };
  if (DETAILS[name] && slug) return { section: OWNER[name], render: () => DETAILS[name](slug) };
  return null;
}

function render({ focus = true } = {}) {
  let target = route();
  let page = target?.render();
  if (!page) {
    history.replaceState(null, '', '#current');
    target = route();
    page = target.render();
  }
  view.replaceChildren(page);
  for (const link of document.querySelectorAll('[data-section]')) {
    const active = link.dataset.section === target.section;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const heading = view.querySelector('h1');
  const name = view.firstElementChild?.dataset.title || heading?.textContent || 'Interior';
  document.title = `${name} — ${relation.holder.publicId} — PROBNAYA`;
  scrollTo({ top: 0, behavior: 'instant' });
  if (focus) (heading || view).focus({ preventScroll: true });
}

function renderIdentity() {
  holderControl.querySelector('[data-holder-id]').textContent = relation.holder.publicId;
  holderControl.querySelector('[data-holder-mark]').replaceChildren(representation(relation.portrait, 20, 'representation mark'));
  holderControl.setAttribute('aria-label', `Relation — ${relation.holder.publicId}`);
  holderControl.hidden = false;
}

function unavailable() {
  root.dataset.state = 'unavailable';
  const retry = h('button', { class: 'line-action', type: 'button' }, h('span', { text: 'ASK ACCESS AGAIN' }), h('span', { text: '→' }));
  retry.addEventListener('click', () => verify({ initial: true }));
  view.replaceChildren(h('div', { class: 'interior-page' },
    h('section', { class: 'condition-block is-unavailable', 'aria-labelledby': 'condition-title' },
      h('div', {}, h('p', { class: 'matter-id', text: 'ACCESS.PROBNAYA.WORK' }), h('h1', { id: 'condition-title', tabindex: '-1', text: 'Access unreachable.' })),
      h('div', { class: 'unavailable-actions' }, retry, h('a', { class: 'line-action', href: '/' }, h('span', { text: 'PUBLIC PROBNAYA' }), h('span', { text: '→' }))))));
  view.querySelector('h1').focus({ preventScroll: true });
}

// ---------- session ----------

async function verify({ initial = false } = {}) {
  if (checking) return checking;
  const wasHinted = Relation.hinted();
  checking = (async () => {
    const result = await Relation.read({ force: true });
    checkedAt = Date.now();
    if (result.state === 'absent') {
      root.dataset.state = 'leaving';
      view.replaceChildren();
      location.replace(wasHinted || relation ? Relation.access.expired : Relation.access.entry);
      return false;
    }
    if (result.state === 'unavailable') {
      if (initial || !relation) unavailable();
      return false;
    }
    const first = !relation || initial;
    relation = result.relation;
    root.dataset.state = 'present';
    renderIdentity();
    if (first) render({ focus: false });
    return true;
  })();
  try {
    return await checking;
  } finally {
    checking = null;
  }
}

addEventListener('hashchange', () => {
  if (!relation) return;
  render();
  if (Date.now() - checkedAt > RECHECK_MS) verify();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && relation) verify();
});

// Returning through browser history (for example after ending the session) must
// not show a cached relation before Access has been asked again, so the page is
// emptied as it is hidden and asks again when it is shown.
function withdraw() {
  root.dataset.state = 'verifying';
  relation = null;
  view.replaceChildren();
  holderControl.hidden = true;
  document.title = 'Interior — PROBNAYA';
}

addEventListener('pagehide', (event) => { if (event.persisted) withdraw(); });
addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  withdraw();
  verify({ initial: true });
});

if (!location.hash) history.replaceState(null, '', '#current');
verify({ initial: true });
