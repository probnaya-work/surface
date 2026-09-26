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
  card: Object.freeze({ widthMm: 148, heightMm: 105, lens: 'FLIP' }),
  // How it gets made: at 20 registrations PROBNAYA asks a printer for a quote
  // and plans production; then everyone registered gets one email with the
  // final price and an order link. Nothing is paid before that email.
  release: Object.freeze({ registrationsBeforeQuote: 20 }),
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

// Interest asks for one thing, an email address. It stands in for the sender's
// name too, so the mail subject reads INTAKE / CHANNEL B — <email>. The intake
// endpoint caps FROM and REPLY at 200 characters.
export const INTEREST_LIMITS = Object.freeze({ email: 200 });

export function interestBody() {
  return [INTEREST_HEADING, INTEREST_TERMS].join('\n');
}

// The exact JSON the intake endpoint receives. `website` is the honeypot field:
// the endpoint accepts and silently drops any request where it is filled.
export function interestPayload({ email, website } = {}) {
  const address = typeof email === 'string' ? email : '';
  return {
    from: address,
    reply: address,
    body: interestBody(),
    tried: '',
    channel: INTEREST_CHANNEL,
    __hp: typeof website === 'string' ? website : '',
  };
}
