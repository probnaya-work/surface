// PROB–OBJ–001 · EX–. The object's canonical facts and the one message the
// public site sends about it. Pure: no DOM, no network, no storage, no clock.

export const OBJECT = Object.freeze({
  id: 'PROB–OBJ–001',
  number: '001',
  name: 'EX–',
  status: 'PROPOSED',
  prefix: 'EX',
  // One card, two printed states. The prefix is printed once and never
  // changes; only the tail is interlaced.
  states: Object.freeze([
    Object.freeze({ key: 'excitement', word: 'EXCITEMENT', tail: 'CITEMENT', ink: 'blue' }),
    Object.freeze({ key: 'exhaustion', word: 'EXHAUSTION', tail: 'HAUSTION', ink: 'red' }),
  ]),
  card: Object.freeze({ widthMm: 148, heightMm: 105, lens: 'FLIP', lpi: 75, lensMm: 0.45 }),
  // A target, not a promise: print 50 once 20 paid orders are in.
  run: Object.freeze({ cards: 50, paidOrdersBeforePrint: 20 }),
});

// The palette the object is made in. Blue is the first state, red the second.
export const INK = Object.freeze({
  paper: '#EFF0F2',
  ink: '#16181C',
  mid: '#767B84',
  border: '#D2D5DA',
  blue: '#2233CC',
  red: '#D23D2B',
});

// Interest is carried by the site's intake endpoint on channel B. It is not an
// order: no payment and no postal address are asked for or sent.
export const INTEREST_CHANNEL = 'B';
export const INTEREST_HEADING = 'OBJECT 001 — EX– · INTEREST';
export const INTEREST_TERMS = 'NON-BINDING · NO PAYMENT TAKEN · NO POSTAL ADDRESS TAKEN';
export const INTEREST_NO_NOTE = '(no note)';

// Field limits sit inside the intake endpoint's: FROM and REPLY are capped at
// 200 characters, BODY at 4000. The note leaves room for the heading lines.
export const INTEREST_LIMITS = Object.freeze({ name: 200, email: 200, note: 3800 });

export function interestBody(note) {
  const text = typeof note === 'string' ? note.trim() : '';
  return [INTEREST_HEADING, INTEREST_TERMS, '', text || INTEREST_NO_NOTE].join('\n');
}

// The exact JSON the intake endpoint receives. `website` is the honeypot field:
// the endpoint accepts and silently drops any request where it is filled.
export function interestPayload({ name, email, note, website } = {}) {
  return {
    from: typeof name === 'string' ? name : '',
    reply: typeof email === 'string' ? email : '',
    body: interestBody(note),
    tried: '',
    channel: INTEREST_CHANNEL,
    __hp: typeof website === 'string' ? website : '',
  };
}
