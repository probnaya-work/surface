// PROBNAYA — the holder's issued representation.
//
// A holder is represented by an issued MPA–01 Machine Portrait, or, until one is
// issued, by the apparatus field itself. Nothing here is uploaded, chosen, or
// personalised: an issued portrait is drawn from its record's measured matrix by
// the apparatus' own mark authority (instrument-mpa/js/turn2.js), and the
// unissued field is identical for every holder.
//
// Small sizes use 2A RASTER — one filled cell per level — so the lattice stays
// whole-pixel exact. From PLATE_MIN_PX the principal 2C CONCENTRIC mark is used,
// as on the issued PORTRAIT face.

import { TURN2_CELLS, TURN2_N, renderTurn2Plate } from '/instrument-mpa/js/turn2.js';

const PLATE_MIN_PX = 96;
const SVG_NS = 'http://www.w3.org/2000/svg';

function levelsOf(portrait) {
  const matrix = portrait?.matrix;
  if (typeof matrix !== 'string' || matrix.length !== TURN2_CELLS || !/^[0-4]+$/.test(matrix)) return null;
  return Uint8Array.from(matrix, (digit) => digit.charCodeAt(0) - 48);
}

function registrationOf(portrait) {
  const [c, r] = Array.isArray(portrait?.cell) ? portrait.cell : [];
  return Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < TURN2_N && r < TURN2_N ? { c, r } : undefined;
}

// Draw an issued portrait into a square canvas of `size` CSS pixels. The backing
// store is a whole multiple of 16 device pixels so every cell edge lands on a pixel.
export function drawPortrait(canvas, portrait, size) {
  const levels = levelsOf(portrait);
  if (!levels) return false;
  const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const backing = Math.max(TURN2_N, Math.round((size * ratio) / TURN2_N) * TURN2_N);
  canvas.width = canvas.height = backing;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  renderTurn2Plate(ctx, backing, levels, size >= PLATE_MIN_PX ? '2c' : '2a', registrationOf(portrait));
  return true;
}

// The unissued field: square extent, orthogonal axes, fixed centre.
export function unissuedField() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('unissued-field');
  const parts = [
    ['rect', { x: '0.5', y: '0.5', width: '31', height: '31', class: 'field-extent' }],
    ['path', { d: 'M16 0.5v31M0.5 16h31', class: 'field-axis' }],
    ['rect', { x: '14', y: '14', width: '4', height: '4', class: 'field-centre' }],
  ];
  for (const [tag, attributes] of parts) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}

// A representation element at `size`: the issued portrait when there is one,
// the unissued field otherwise. The caller supplies any accessible name.
export function representation(portrait, size, className = 'representation') {
  const frame = document.createElement('span');
  frame.className = className;
  frame.dataset.issued = portrait ? 'true' : 'false';
  frame.style.setProperty('--representation-size', `${size}px`);
  if (portrait) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    if (drawPortrait(canvas, portrait, size)) {
      frame.append(canvas);
      return frame;
    }
    frame.dataset.issued = 'false';
  }
  frame.append(unissuedField());
  return frame;
}
