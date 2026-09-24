// The public reading count of each Observation, in its margin.
//
// A reading is one browser, one Observation, once a day. On its own sheet an
// Observation is read by being opened. In the index, where every piece is shown
// whole, it is read once its sheet has stayed at least half in view, in a visible
// tab, for a few seconds. The day it was last counted is remembered in this browser only
// (localStorage); the request sends the archival number and nothing else.
//
// The number is an address and is never shown: it only names the slot. A count
// appears only when there is one; until then, and whenever the store cannot be
// reached, the margin shows nothing.
(function observationViews() {
  const slots = [...document.querySelectorAll('[data-views]')];
  if (!slots.length) return;

  const DWELL_MS = 3000;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const mark = (n) => `probnaya:read:${n}`;

  function readToday(n) {
    try { return localStorage.getItem(mark(n)) === today(); } catch { return false; }
  }
  function rememberToday(n) {
    try { localStorage.setItem(mark(n), today()); } catch {}
  }

  function show(n, count) {
    if (!(count > 0)) return;
    for (const slot of slots) {
      if (slot.dataset.views !== n) continue;
      slot.textContent = count === 1 ? 'READ ONCE' : `READ ${count.toLocaleString('en-US')} TIMES`;
      slot.hidden = false;
    }
  }

  async function count(n) {
    if (readToday(n)) return;
    rememberToday(n);
    try {
      const response = await fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: n }),
        keepalive: true,
      });
      if (!response.ok) return;
      const body = await response.json();
      show(n, body.count);
    } catch {}
  }

  const numbers = [...new Set(slots.map((s) => s.dataset.views))];

  fetch(`/api/views?n=${numbers.join(',')}`)
    .then((r) => (r.ok ? r.json() : { counts: {} }))
    .then(({ counts }) => { for (const n of numbers) show(n, counts[n]); })
    .catch(() => {});

  const sheet = document.querySelector('.observations-page--sheet');
  if (sheet) {
    count(numbers[0]);
    return;
  }

  if (!('IntersectionObserver' in window)) return;
  // "In view": half the sheet is visible, or — for a sheet taller than the
  // screen, which can never be half visible — it fills half the screen.
  const inView = (e) => e.isIntersecting &&
    (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= window.innerHeight * 0.5);
  const timers = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const n = entry.target.closest('.observation').id;
      if (inView(entry)) {
        if (!timers.has(n)) timers.set(n, setTimeout(() => {
          timers.delete(n);
          if (document.hidden) return;   // a background tab is not reading
          observer.unobserve(entry.target);
          count(n);
        }, DWELL_MS));
      } else {
        clearTimeout(timers.get(n));
        timers.delete(n);
      }
    }
  }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
  const watched = [...document.querySelectorAll('.observation .obs-sheet')]
    .filter((el) => !readToday(el.closest('.observation').id));
  watched.forEach((el) => observer.observe(el));
  // Coming back to the tab starts the dwell again for whatever is in view.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    for (const el of watched) {
      if (readToday(el.closest('.observation').id)) continue;
      observer.unobserve(el);
      observer.observe(el);
    }
  });
})();
