// PROBNAYA — the holder relation, as the public origin may know it.
//
// Access (access.probnaya.work) is the only authority. This file asks it, with
// the browser's own Access session cookie, whether the current browser holds a
// session, and receives the public holder identifier and Access condition. It
// never sees a session token or CSRF value and cannot change anything.
//
// `probnaya:recognized` in localStorage is a hint, not authority: it only
// decides whether a public page should ask at all, so visitors who have never
// entered do not contact Access on every page view. An absent session clears it.
//
// Relation content — correspondence, investigations, issued objects, and the
// issued representation — has no production source yet. In production every
// holder is therefore shown exactly what Access can prove: identifier, keys,
// recovery, and establishment. On localhost only, /interior/fixtures.js may
// supply content for named local holders so populated states can be rendered.
window.ProbnayaRelation = (() => {
  const HINT = 'probnaya:recognized';
  const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
  const ACCESS = LOCAL ? 'http://localhost:4174' : 'https://access.probnaya.work';

  function hinted() {
    try { return localStorage.getItem(HINT) === '1'; } catch { return false; }
  }

  function hint(value) {
    try {
      if (value) localStorage.setItem(HINT, '1');
      else localStorage.removeItem(HINT);
    } catch { /* storage unavailable: every page asks or none does */ }
  }

  function emptyContent() {
    return { portrait: null, correspondence: [], investigations: [], held: [], history: [] };
  }

  async function contentFor(holder) {
    if (!LOCAL) return emptyContent();
    try {
      const fixtures = await import('/interior/fixtures.js');
      return { ...emptyContent(), ...(fixtures.contentFor(holder.publicId) || {}) };
    } catch {
      return emptyContent();
    }
  }

  async function ask() {
    const response = await fetch(`${ACCESS}/api/relation`, { credentials: 'include', cache: 'no-store', mode: 'cors' });
    if (response.status === 401) return { state: 'absent' };
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok || typeof body.relation?.holder?.publicId !== 'string') return { state: 'unavailable' };
    return { state: 'present', relation: body.relation };
  }

  // { state: 'present', relation } | { state: 'absent' } | { state: 'unavailable' }
  // `force` asks even without a hint (the Interior itself, and returning from Access).
  async function read({ force = false } = {}) {
    if (!force && !hinted()) return { state: 'absent' };
    let result;
    try {
      result = await ask();
      // Two tabs can race the fifteen-minute rotation; the loser's cookie is
      // already replaced by the time it asks again.
      if (result.state === 'absent' && hinted()) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        result = await ask();
      }
    } catch {
      result = { state: 'unavailable' };
    }
    if (result.state === 'absent') hint(false);
    if (result.state === 'present') {
      hint(true);
      result.relation = { ...result.relation, ...(await contentFor(result.relation.holder)) };
    }
    return result;
  }

  return Object.freeze({
    read,
    hinted,
    access: Object.freeze({
      entry: `${ACCESS}/`,
      expired: `${ACCESS}/#expired`,
      record: `${ACCESS}/#record`,
      end: `${ACCESS}/#end`,
    }),
  });
})();
