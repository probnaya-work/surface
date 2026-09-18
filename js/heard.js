(function () {
  'use strict';

  // Invented fixtures. No source reader, network request, storage, or model call.
  const records = [
    {
      id: 'h-01',
      text: 'A person describes reopening an AI conversation each morning because it holds the unfinished shape of a project.',
      themes: ['ATTACHMENT', 'CONTINUITY'], context: 'WORK',
      observedAt: '18 SEP · 09:04 UTC · SIMULATED', reading: '0041'
    },
    {
      id: 'h-02',
      text: 'When a familiar model changes, someone misses the accumulated context more than its voice.',
      themes: ['ATTACHMENT', 'CONTINUITY'], context: 'EVERYDAY',
      observedAt: '18 SEP · 09:11 UTC · SIMULATED', reading: '0041'
    },
    {
      id: 'h-03',
      text: 'A developer notices they now ask an assistant before attempting an unfamiliar problem alone.',
      themes: ['AGENCY', 'DEPENDENCE'], context: 'WORK',
      observedAt: '18 SEP · 09:18 UTC · SIMULATED', reading: '0041'
    },
    {
      id: 'h-04',
      text: 'An illustrator feels relief at having an immediate second opinion, then wonders which decisions remain theirs.',
      themes: ['AGENCY', 'RELIEF'], context: 'CREATIVE',
      observedAt: '18 SEP · 09:25 UTC · SIMULATED', reading: '0041'
    },
    {
      id: 'h-05',
      text: 'Someone trusts an answer enough to begin, but checks it before anyone else depends on the result.',
      themes: ['TRUST', 'VERIFICATION'], context: 'WORK',
      observedAt: '18 SEP · 09:32 UTC · SIMULATED', reading: '0041'
    },
    {
      id: 'h-06',
      text: 'A student turns to a model to understand a difficult idea, then hesitates to ask a classmate.',
      themes: ['AGENCY', 'ISOLATION'], context: 'LEARNING',
      observedAt: '18 SEP · 09:39 UTC · SIMULATED', reading: '0041'
    }
  ];

  const host = document.getElementById('heard-records');
  if (!host) return;
  const status = document.getElementById('heard-simulation-status');
  const toggle = document.getElementById('heard-toggle');
  const next = document.getElementById('heard-next');
  const filters = Array.from(document.querySelectorAll('[data-heard-filter]'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = !reducedMotion;
  let filter = 'ALL';
  let offset = 0;

  function element(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function recordNode(record) {
    const article = element('article', 'heard-record', '');
    const meta = element('div', 'heard-record-meta', '');
    meta.append(
      element('span', 'heard-record-id', `SIGNAL ${record.id.slice(2).padStart(4, '0')}`),
      element('span', '', record.observedAt)
    );
    const body = element('p', 'heard-record-text', record.text);
    const tags = element('div', 'heard-record-tags', '');
    for (const theme of record.themes) tags.append(element('span', '', theme));
    const context = element('div', 'heard-record-context', `CONTEXT / ${record.context}   ·   READING / ${record.reading}`);
    article.append(meta, body, tags, context);
    return article;
  }

  function tremorNode() {
    const tremor = element('div', 'heard-tremor', '');
    tremor.append(
      element('span', 'heard-tremor-label', 'TREMOR 0041 / SYNTHETIC'),
      element('p', '', 'Continuity and attachment meet in two expressions. The next record holds the same thought from another angle.')
    );
    return tremor;
  }

  function render() {
    const pool = filter === 'ALL' ? records : records.filter(record => record.themes.includes(filter));
    const count = Math.min(3, pool.length);
    const visible = Array.from({ length: count }, (_, index) => pool[(offset + index) % pool.length]);
    const fragment = document.createDocumentFragment();
    visible.forEach((record, index) => {
      fragment.append(recordNode(record));
      if (index === 0 && visible[1]?.id === 'h-02' && record.id === 'h-01') fragment.append(tremorNode());
    });
    host.replaceChildren(fragment);
    const rotating = pool.length > 3;
    const step = `STEP ${String(offset + 1).padStart(2, '0')} / ${String(pool.length).padStart(2, '0')}`;
    status.textContent = rotating
      ? `${running ? 'SIMULATION RUNNING' : 'SIMULATION PAUSED'} · ${count} OF ${pool.length} SYNTHETIC RECORDS · ${step}`
      : `FILTERED VIEW · ${pool.length} MATCHING SYNTHETIC ${pool.length === 1 ? 'RECORD' : 'RECORDS'}`;
    toggle.textContent = running ? 'PAUSE' : 'RESUME';
    toggle.setAttribute('aria-pressed', String(!running));
    toggle.hidden = !rotating;
    next.hidden = !rotating;
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.heardFilter === filter)));
  }

  function advance() {
    const poolLength = filter === 'ALL' ? records.length : records.filter(record => record.themes.includes(filter)).length;
    if (poolLength <= 3) return;
    offset = (offset + 1) % poolLength;
    render();
  }

  filters.forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.heardFilter;
    offset = 0;
    render();
  }));
  toggle.addEventListener('click', () => { running = !running; render(); });
  next.addEventListener('click', advance);
  window.setInterval(() => { if (running && !document.hidden) advance(); }, 18000);
  render();
}());
