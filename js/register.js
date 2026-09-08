// PROBNAYA — the register of condition.
//
// One list of everything the laboratory has made, ordered by what a visitor can
// do with it: what can be entered stands above what can be asked for, above what
// can be looked at, above what is only on record. `rank` is that access ladder,
// not editorial preference — nothing in this list is chosen, it is sorted.
//
// index.html renders the register itself. Every page renders the standing line
// in its footer, which is the same reading stated in one sentence.
const Register = (() => {

  // The condition of MPA–01 is the one thing here that moves. Change this single
  // value when the apparatus changes state: the register re-sorts itself, the row
  // gains or loses its action, and the standing line follows. The register's
  // shape does not change.  ENTERABLE · UNAVAILABLE · WITHDRAWN
  const MPA_ACCESS = 'ENTERABLE';

  const WORKS = [
    { key: 'MPA-01', id: 'MPA–01', desc: 'Measuring apparatus for the machine portrait', rank: 1,
      condition: 'IN SERVICE', access: 'ENTERABLE', mark: 'issuing', live: true, plate: true,
      fields: [
        ['CLASS', 'APPARATUS'],
        ['INPUT', 'ONE PHOTOGRAPH, SUPPLIED BY THE VISITOR'],
        ['READING', '16 × 16 LATTICE · FIVE LEVELS · ONE FIDUCIAL'],
        ['ISSUE', 'PORTRAIT · RECORD · MARKS'],
        ['FEE', 'ON AUTHORISATION · EUR 5.00'],
        ['OPERATED BY', 'WHOEVER IS AT THE APPARATUS']
      ],
      act: { label: 'ENTER THE APPARATUS →', href: '/instrument-mpa/' } },

    { key: '0x2F', id: '0x2F', desc: 'Local task runtime for coding agents', rank: 2,
      condition: 'OPERATIONAL', access: 'BY REQUEST', mark: 'solid', live: false,
      fields: [
        ['CLASS', 'RUNTIME'],
        ['SUBJECT', 'CONTROL OF MACHINE WORK'],
        ['LOCUS', 'LOCAL'],
        ['ISSUE', 'NONE · THE INSTRUMENT STAYS WHERE IT RUNS']
      ],
      act: { label: 'REQUEST ACCESS →', href: '/intake?ch=b' } },

    { key: '057', id: '057', desc: 'Visual surface for computational activity', rank: 3,
      condition: 'IN OBSERVATION', access: 'CLOSED', mark: 'outline', live: false,
      fields: [
        ['CLASS', 'SURFACE'],
        ['SUBJECT', 'PERCEPTION OF MACHINE ACTIVITY'],
        ['INPUT', 'EVENT STREAM'],
        ['ISSUE', 'NONE WHILE UNDER OBSERVATION']
      ],
      act: { label: 'ASK TO BE SHOWN →', href: '/intake?ch=b' } },

    { key: '04', id: '04', desc: 'On the bench, not yet named', rank: 5,
      condition: 'ON THE BENCH', access: 'NOT DISCLOSED', mark: 'dashed', live: false,
      fields: [
        ['CLASS', 'UNDECIDED'],
        ['PLATE', 'NONE ISSUED']
      ],
      note: 'NOTHING TO ENTER YET' },

    { key: '17', id: '17', desc: 'Investigations on record — the written part of the laboratory', rank: 7,
      condition: 'ON RECORD', access: '04 DISCLOSED', mark: 'none', live: false,
      fields: [
        ['CLASS', 'RECORD'],
        ['DISCLOSED', '04 OF 17'],
        ['WITHHELD', 'ENTRIES EXIST, ARE INDEXED, AND ARE NOT SHOWN']
      ],
      act: { label: 'OPEN THE INDEX →', href: '/investigations' } }
  ];

  // One apparatus can change condition without the register changing shape.
  const MPA_STATE = {
    ENTERABLE: {},

    UNAVAILABLE: { rank: 4, condition: 'OUT OF SERVICE', access: 'UNAVAILABLE', mark: 'dashed',
      live: false, act: null, note: 'THE APPARATUS IS NOT ACCEPTING WORK',
      fields: [
        ['CLASS', 'APPARATUS'],
        ['INPUT', 'ONE PHOTOGRAPH, SUPPLIED BY THE VISITOR'],
        ['READING', '16 × 16 LATTICE · FIVE LEVELS · ONE FIDUCIAL'],
        ['ISSUE', 'SUSPENDED · ISSUES ALREADY MADE REMAIN VALID'],
        ['HALTED', 'PENDING WORK ON THE APPARATUS']
      ] },

    WITHDRAWN: { rank: 6, condition: 'WITHDRAWN', access: 'ON RECORD', mark: 'none',
      live: false, plate: false, act: null, note: 'WITHDRAWN · ITS ISSUES REMAIN VALID',
      fields: [
        ['CLASS', 'APPARATUS'],
        ['IN SERVICE', '2026 · ONE PROTOCOL, UNCHANGED'],
        ['ISSUE', 'CLOSED'],
        ['RECORD', 'THE READINGS TAKEN ARE KEPT']
      ] }
  };

  // The register as it currently reads: MPA–01 under its present condition,
  // everything sorted by the access ladder.
  function rows() {
    const state = MPA_STATE[MPA_ACCESS] || {};
    return WORKS
      .map(w => (w.key === 'MPA-01' ? Object.assign({}, w, state) : w))
      .sort((a, b) => a.rank - b.rank);
  }

  // The same reading in one sentence, for the footer of every page.
  function standing() {
    const enterable = rows().filter(w => w.live);
    if (!enterable.length) return { live: false, line: 'NOTHING ENTERABLE TODAY' };
    return {
      live: true,
      line: enterable.length === 1
        ? 'ENTERABLE NOW · ' + enterable[0].id
        : String(enterable.length).padStart(2, '0') + ' ENTERABLE NOW'
    };
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function specsList(fields) {
    const dl = el('dl', 'specs');
    fields.forEach(([k, v]) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); });
    return dl;
  }

  function renderRow(work, id) {
    const row = el('div', 'register-row');

    const head = el('button', 'register-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', id);

    const mark = el('span', 'mark mark--' + work.mark);
    mark.appendChild(el('i'));
    head.appendChild(mark);
    head.appendChild(el('span', 'id', work.id));
    head.appendChild(el('span', 'desc', work.desc));
    head.appendChild(el('span', 'condition', work.condition));
    head.appendChild(el('span', 'access' + (work.live ? ' is-live' : ''), work.access));
    row.appendChild(head);

    const panel = el('div', 'register-panel');
    panel.id = id;
    panel.hidden = true;

    if (work.plate) {
      const figure = el('div', 'figure register-figure');
      const plate = el('div', 'figure-plate');
      plate.appendChild(el('canvas'));
      const caption = el('div', 'figure-caption');
      caption.appendChild(el('span', 'dim', 'FIG. 2 — CONCENTRIC'));
      caption.appendChild(el('span', 'accent', 'FIDUCIAL COL 9 · ROW 6'));
      figure.appendChild(plate);
      figure.appendChild(caption);
      panel.appendChild(figure);
    }

    const detail = el('div', 'register-detail');
    detail.appendChild(specsList(work.fields));
    if (work.act) {
      const a = el('a', 'action-link', work.act.label);
      a.href = work.act.href;
      detail.appendChild(a);
    }
    if (work.note) detail.appendChild(el('span', 'register-note', work.note));
    panel.appendChild(detail);
    row.appendChild(panel);

    return { row, head, panel };
  }

  // Renders the register into `host`. One row is open at a time; the topmost row
  // is open on arrival if it is a row that can actually be entered.
  function mount(host) {
    const list = rows();
    const built = [];
    let plate = null;

    const close = () => {
      built.forEach(b => { b.panel.hidden = true; b.head.setAttribute('aria-expanded', 'false'); });
      if (plate) { plate.destroy(); plate = null; }
    };

    const open = (b) => {
      close();
      b.panel.hidden = false;
      b.head.setAttribute('aria-expanded', 'true');
      const canvas = b.panel.querySelector('canvas');
      if (canvas && typeof Apparatus !== 'undefined') {
        plate = Apparatus.mount(canvas, (S) => Apparatus.buildPlate(S));
      }
    };

    host.textContent = '';
    list.forEach((work, i) => {
      const b = renderRow(work, 'register-panel-' + i);
      b.head.addEventListener('click', () => {
        if (b.panel.hidden) open(b); else close();
      });
      built.push(b);
      host.appendChild(b.row);
    });

    if (list.length && list[0].live) open(built[0]);
  }

  function mountStanding() {
    const s = standing();
    document.querySelectorAll('[data-standing]').forEach(node => {
      const mark = node.querySelector('.standing-mark');
      const line = node.querySelector('.standing-line');
      if (mark) mark.hidden = !s.live;
      if (line) line.textContent = s.line;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    mountStanding();
    const host = document.querySelector('[data-register]');
    if (host) mount(host);
  });

  return { rows, standing, mount };
})();
