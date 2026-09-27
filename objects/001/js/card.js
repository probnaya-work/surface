// The EX– card as a lens. One number, t, runs 0..1 across the card's viewing
// range; everything shown on the page is read from it. Pure and event-free.

// A flip lens holds the first state, hands over in a narrow band, then holds
// the second. The hand-over is centred on the card's face-on angle.
export const FLIP_START = 0.42;
export const FLIP_WIDTH = 0.16;
// Degrees of turn across the whole range: ±18° either side of face-on.
export const TURN_DEG = 36;
// Where the card rests when nothing is turning it: in the first state,
// a few degrees off face-on.
export const REST = 0.35;
// The two buttons each set the card squarely into one state.
export const FIRST = 0.15;
export const SECOND = 0.85;
// A phone's left-right tilt (deviceorientation gamma) covered by the range.
export const TILT_RANGE_DEG = 30;

export const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : REST));

// The lens highlight crosses the card as it turns, from 12% to 88% of its
// width, and never reaches either edge.
export const HIGHLIGHT_FROM = 12;
export const HIGHLIGHT_SPAN = 76;

export function lensAt(t) {
  const at = clamp01(t);
  const blend = clamp01((at - FLIP_START) / FLIP_WIDTH);
  const deg = (at - 0.5) * TURN_DEG;
  const highlight = HIGHLIGHT_FROM + at * HIGHLIGHT_SPAN;
  return { t: at, blend, deg, highlight, state: blend > 0.5 ? 1 : 0 };
}

export function fromPointer(clientX, left, width) {
  return width > 0 ? clamp01((clientX - left) / width) : REST;
}

export function fromTilt(gamma) {
  return clamp01((gamma + TILT_RANGE_DEG) / (2 * TILT_RANGE_DEG));
}

// ANGLE −05.4° · always signed, one decimal, two integer digits.
export function formatAngle(deg) {
  const sign = deg < 0 ? '−' : '+';
  return 'ANGLE ' + sign + Math.abs(deg).toFixed(1).padStart(4, '0') + '°';
}

// The back. Each card carries its issue number, and the number places a blue
// dot, so no two backs are alike. The dot stays inside the band between the
// head and the foot, and out of the middle of the card, where the dot would
// read as a mark on the type.
export function issueHash(seed) {
  let x = Math.imul(seed ^ 0x9E3779B9, 0x85EBCA6B);
  x ^= x >>> 13;
  x = Math.imul(x, 0xC2B2AE35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Percentages of the card's width and height. The first candidate outside
// the middle wins; after 24 tries the last one is kept.
export function backDot(issue) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < 24; i++) {
    x = 6.8 + issueHash(issue * 97 + i * 2 + 1) * 85;
    y = 20 + issueHash(issue * 97 + i * 2 + 2) * 40;
    const dx = (x - 50) / 50;
    const dy = (y - 50) / 50;
    if (dx * dx + dy * dy > 0.3) break;
  }
  return { x, y };
}

// 007 / 100
export function formatIssue(issue, issues) {
  return String(issue).padStart(3, '0') + ' / ' + issues;
}
