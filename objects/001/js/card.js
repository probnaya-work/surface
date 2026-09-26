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

export function lensAt(t) {
  const at = clamp01(t);
  const blend = clamp01((at - FLIP_START) / FLIP_WIDTH);
  const deg = (at - 0.5) * TURN_DEG;
  return { t: at, blend, deg, state: blend > 0.5 ? 1 : 0 };
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
