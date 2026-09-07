// PROB–MPA–01 · HISTORICAL THREE-DERIVATION GEOMETRY (RETIRED)
//
// Retained as research source and regression coverage. This module is not
// imported by the active apparatus or issued-object record. Canonical TURN 2
// marks, including full-cell 2C level 4, live in turn2.js.
//
// In the historical system three deterministic geometries rendered one integer
// band into one cell. All read the same 32 × 32 matrix and used a 0.82 gutter.

export const PAPER = "#EFF0F2";
export const INK = "#16181C";
export const BLUE = "#2233CC";

export const GUTTER = 0.82;
export const REGISTRATION = Object.freeze({ c: 18, r: 12 }); // apparatus constant on the 32 × 32 lattice

export const DERIVATIONS = Object.freeze(["centric", "skyline", "raster"]);
export const FIELDS = Object.freeze(["light", "dark"]);

export const DERIVATION_WORD = Object.freeze({ centric: "CENTRIC", skyline: "SKYLINE", raster: "RASTER" });
export const DERIVATION_NAME = Object.freeze({
  centric: "CENTRIC · NESTED SQUARE",
  skyline: "SKYLINE · RULED BANDS",
  raster: "RASTER · QUARTER CELLS"
});

// Analytic ink coverage per band, as a fraction of the cell. Closed forms of the
// geometries below; recorded to three decimals as in the derivation record.
export const COVERAGE = Object.freeze({
  centric: [0, 0.042, 0.168, 0.378, 0.672],
  skyline: [0, 0.103, 0.205, 0.308, 0.410],
  raster: [0, 0.176, 0.353, 0.529, 0.706]
});

// Exact closed forms, used by the tests to check the table above.
export function coverageExact(kind, L) {
  if (!L) return 0;
  if (kind === "centric") return Math.pow(GUTTER * L / 4, 2);
  if (kind === "skyline") return GUTTER * (1 / 8) * L;
  if (kind === "raster") return 0.42 * 0.42 * L;
  throw new Error("unknown derivation " + kind);
}

// Flat greys for cells not yet constructed. Display only; never on the issued plate.
export const LEVEL_GREY = Object.freeze(["#EFF0F2", "#D2D5DA", "#A7ABB3", "#767B84", "#3B3E45"]);

// One mark for one cell. (x, y) top-left, s cell side, L band value 0…4.
export function mark(ctx, x, y, s, L, kind) {
  if (!L) return;
  if (kind === "raster") {
    const q = s * 0.42, g = (s - q * 2) / 3;
    const order = [[0, 0], [1, 1], [1, 0], [0, 1]]; // TL, BR, TR, BL
    for (let k = 0; k < L; k++) ctx.fillRect(x + g + order[k][0] * (q + g), y + g + order[k][1] * (q + g), q, q);
    return;
  }
  if (kind === "skyline") {
    const h = Math.max(1, s / 8), w = s * GUTTER, o = (s - w) / 2;
    for (let k = 0; k < L; k++) ctx.fillRect(x + o, y + (k + 0.5) * (s / (L + 1)) - h / 2, w, h);
    return;
  }
  // centric
  const side = s * GUTTER * L / 4, o = (s - side) / 2;
  ctx.fillRect(x + o, y + o, side, side);
}

export function registrationCell(n) {
  return { c: Math.round(REGISTRATION.c * n / 32), r: Math.round(REGISTRATION.r * n / 32) };
}

// Render a band matrix of side n into a square of `size` pixels. `upTo` limits
// the number of cells drawn (scan order); it is the construction front. Returns
// the number of cells committed to the surface.
export function renderPlate(ctx, size, bands, n, kind, dark, upTo = null, registration = true) {
  const cell = size / n;
  const fid = registrationCell(n);
  const limit = upTo == null ? n * n : Math.min(upTo, n * n);
  ctx.fillStyle = dark ? INK : PAPER;
  ctx.fillRect(0, 0, size, size);
  const ink = dark ? PAPER : INK;
  for (let i = 0; i < limit; i++) {
    const c = i % n, r = (i / n) | 0;
    ctx.fillStyle = (registration && c === fid.c && r === fid.r) ? BLUE : ink;
    mark(ctx, c * cell, r * cell, cell, bands[i], kind);
  }
  return limit;
}

// Construction view: the first `drawn` cells as marks, the rest as flat band
// greys (inverted on a dark field so the matrix stays readable), a faint 4-cell
// guide grid and a blue front at the row being drawn. Returns `drawn`.
export function renderConstruction(ctx, size, bands, n, kind, dark, drawn) {
  const cell = size / n, cells = n * n;
  const fid = registrationCell(n);
  ctx.fillStyle = dark ? INK : PAPER;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = dark ? "rgba(59,62,69,0.9)" : "rgba(167,171,179,0.55)";
  ctx.lineWidth = 1;
  for (let i = 4; i < n; i += 4) {
    const p = Math.round(i * cell) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }

  const committed = Math.min(drawn, cells);
  for (let i = 0; i < cells; i++) {
    const c = i % n, r = (i / n) | 0, x = c * cell, y = r * cell, L = bands[i];
    if (i < committed) {
      ctx.fillStyle = (c === fid.c && r === fid.r) ? BLUE : (dark ? PAPER : INK);
      mark(ctx, x, y, cell, L, kind);
    } else {
      ctx.fillStyle = dark ? LEVEL_GREY[4 - L] : LEVEL_GREY[L];
      ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    }
  }

  if (committed > 0 && committed < cells) {
    const y = Math.round(Math.ceil(committed / n) * cell) + 0.5;
    ctx.strokeStyle = BLUE; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  return committed;
}

// Inspection figures read off the finished classification. Coverage is analytic
// (coverage table × populations), separation is the smallest step between
// adjacent bands, expressed in pixels of a cell at the given output size.
export function inspect(bands, population, kind, outputSize, n = 32) {
  const cov = COVERAGE[kind];
  let ink = 0;
  for (let i = 0; i < bands.length; i++) ink += cov[bands[i]];
  let sep = 1;
  for (let k = 1; k < cov.length; k++) sep = Math.min(sep, cov[k] - cov[k - 1]);
  const cellPx = (outputSize / n) * (outputSize / n);
  const sepPx = sep * cellPx;
  return {
    population: Array.from(population),
    coverage: ink / bands.length,
    separation: sep,
    separationPx: sepPx,
    cellPx,
    separable: sepPx >= 2
  };
}
