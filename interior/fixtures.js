// LOCAL FIXTURES — never deployed (.vercelignore) and never imported off localhost.
//
// Relation content has no production source yet. These named local holders let
// the populated Interior be rendered against a real local Access session:
//
//   PROB–H–0087  correspondence, open investigation, issued Machine Portrait
//   PROB–H–0119  the same relation without an issued portrait
//
// Any other holder — including every production holder — receives no content.
// Keys, recovery, and the session always come from Access. `establishedAt` is
// overridden here only so a populated history is chronologically coherent.
//
// The portrait below is the measured matrix derived by MPA–01 from the synthetic
// specimen (objects/machine-portrait/test/fixtures/specimen-synthetic.png, pupils
// 0.38/0.62 at 0.42). It is not a photograph of a person and not a real issue.

const PORTRAIT = Object.freeze({
  slug: 'mpa-portrait',
  issue: 'PROB–MPA–8B90DDF4146358BC5ED1',
  issued: '2026.06.18',
  apparatus: 'MPA–01',
  derivation: 'PROB-MPA-01/TURN-2/1.0.1',
  matrix: '0000144444310000000044444433000000024444443320000003444442332000000444444133300000044444333330000004444433332000000344433333200011124443333221111112444333321111111124333322111111111233332111111111222222221111111132234322112112223223432222212222322343222222',
  cell: [9, 6],
  populations: [52, 51, 51, 51, 51],
});

const LETTER = Object.freeze({
  slug: 'cor-006',
  id: 'PROB–COR–006',
  title: 'A note before disclosure',
  received: '2026-09-14T09:32:00Z',
  unread: true,
  deck: 'The interruption work has survived three independent runs. A field note is available to you before public disclosure.',
  excerpt: 'The first finding is narrower than the question: a running agent can be stopped without losing the task, but only when the record of the interruption is treated as part of the work.',
  body: [
    'We have kept the interruption work private while the result could still change. It has now survived three independent runs.',
    'The first finding is narrower than the question: a running agent can be stopped without losing the task, but only when the record of the interruption is treated as part of the work rather than as an error around it.',
    'Field note 03 is available to this relation before disclosure. It includes the failed run from 3 September, because removing it would make the conclusion cleaner and less true.',
    'We expect to disclose PROB–017 on 21 September. Until then, the note remains inside this relation.',
  ],
  enclosure: 'inv-017',
});

const INVESTIGATION = Object.freeze({
  slug: 'inv-017',
  id: 'PROB–017/H',
  title: 'Interruption as a primitive of machine work',
  state: 'OPEN · PRIVATE',
  accepted: '2026-04-02',
  disclosure: 'EXPECTED 21 SEP',
  summary: 'COMMISSION ACCEPTED · FIELD NOTE 03 AVAILABLE',
  question: 'Can a running machine process be interrupted without treating interruption as failure?',
  finding: 'A task survives transfer only when the interruption itself enters the task record. Continuity is produced by the record, not by the uninterrupted presence of one agent.',
  notes: [{ id: 'FIELD NOTE 03', date: '2026-09-11', title: 'Three runs, including one failed transfer' }],
});

const OBJECTS = Object.freeze([
  { slug: 'obj-096', id: 'PROB–OBJ.000096', title: '057 / one workday', form: 'FIELD CAPTURE · 24 HOURS', issued: '2025-02-07', trace: 'field' },
  { slug: 'obj-031', id: 'PROB–OBJ.000031', title: '0x2F / task trace', form: 'FOUR-LANE PERSISTENCE RECORD', issued: '2024-05-02', trace: 'lanes' },
]);

const HISTORY = Object.freeze([
  { date: '2026-08-03', id: 'PROB–ACC–021', title: 'Access to 057 field notes', state: 'GRANTED · UNTIL DISCLOSURE' },
  { date: '2026-06-18', id: PORTRAIT.issue, title: 'Machine Portrait', state: 'ISSUED', portrait: true },
  { date: '2025-12-11', id: 'PROB–COR–004', title: 'The instrument remained running', state: 'RECEIVED · READ' },
  { date: '2025-02-07', id: 'PROB–OBJ.000096', title: '057 / one workday', state: 'ISSUED' },
  { date: '2024-05-02', id: 'PROB–OBJ.000031', title: '0x2F / task trace', state: 'ISSUED' },
]);

const populated = (portrait) => ({
  establishedAt: '2024-05-02T10:00:00Z',
  portrait,
  correspondence: [LETTER, { slug: 'cor-004', id: 'PROB–COR–004', title: 'The instrument remained running', received: '2025-12-11T10:00:00Z', unread: false }],
  investigations: [INVESTIGATION],
  held: OBJECTS,
  history: HISTORY.filter((event) => portrait || !event.portrait),
});

const HOLDERS = {
  'PROB–H–0087': populated(PORTRAIT),
  'PROB–H–0119': populated(null),
};

export function contentFor(publicId) {
  return HOLDERS[publicId] || null;
}
