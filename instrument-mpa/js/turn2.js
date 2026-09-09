// PROBNAYA · MPA-01 · CANONICAL TURN 2 ENGINE
//
// TURN 2 is the active MPA-01 portrait generator. The issued record contains
// both independently ranked 16 × 16 matrices: MEASURED / AS-READ and
// RECONSTRUCTED / ANFAS. CONCENTRIC is the principal portrait mark; all eight
// mark vocabularies are deterministic representations of either matrix.
//
// The historical photograph-to-pixel implementation did not survive. The
// production reading method chosen here is therefore explicit, deterministic,
// and new rather than presented as recovered fact:
//
//   1. Browser-decoded, EXIF-oriented sRGB pixels are registered into one fixed
//      1024 × 1024 Canvas 2D surface.
//   2. The interpupillary line is rotated horizontal. Its midpoint lands at
//      (0.50 W, 0.40 H); the square window is 4.2 × IPD.
//   3. Canvas 2D performs the one registration resample with smoothing set to
//      high quality. Areas outside the source are the TURN 2 paper colour.
//   4. Every output byte is inverse-transferred from sRGB, then converted to
//      Rec.709 relative luminance. Each 64 × 64 cell is averaged row-major.
//
// Browser image decoding and Canvas 2D resampling are deterministic for a given
// browser build, but are not claimed to reproduce the missing historical reader
// or to be bit-identical across browser engines.

export const TURN2_N = 16;
export const TURN2_CELLS = TURN2_N * TURN2_N;
export const TURN2_LEVELS = 5;
export const TURN2_DERIVATION_VERSION = "PROB-MPA-01/TURN-2/1.0.1";
export const TURN2_WINDOW_IPD = 4.2;
export const TURN2_EYE_Y = 0.40;
export const TURN2_INTERNAL_SIZE = 1024;

export const TURN2_PAPER = "#EFF0F2";
export const TURN2_INK = "#16181C";
export const TURN2_BLUE = "#2233CC";
export const TURN2_RAMP = Object.freeze(["#EFF0F2", "#D2D5DA", "#A7ABB3", "#767B84", "#16181C"]);
export const TURN2_REGISTRATION = Object.freeze({ c: 9, r: 6 });

export const TURN2_MARKS = Object.freeze([
  { id: "2a", name: "RASTER" },
  { id: "2b", name: "HALFTONE" },
  { id: "2c", name: "CONCENTRIC" },
  { id: "2d", name: "OUTLINE" },
  { id: "2e", name: "READOUT" },
  { id: "2f", name: "SCANLINE" },
  { id: "2g", name: "PANEL" },
  { id: "2h", name: "SILHOUETTE" }
]);

const SRGB_LINEAR = (() => {
  const table = new Float64Array(256);
  for (let u = 0; u < 256; u++) {
    const v = u / 255;
    table[u] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return table;
})();

function assertPupils(pupils) {
  const values = [pupils.rx, pupils.ry, pupils.lx, pupils.ly];
  if (!values.every(Number.isFinite)) throw new Error("TURN 2 pupil positions must be finite");
  if (!values.every(value => value >= 0 && value <= 1)) throw new Error("TURN 2 pupil positions must be normalised to 0…1");
}

// `r` is the subject's right pupil (image left); `l` is the subject's left
// pupil (image right), which becomes the registration address [9,6].
export function framingGeometry(width, height, pupils, outputSize = TURN2_INTERNAL_SIZE) {
  assertPupils(pupils);
  if (!(width > 0 && height > 0 && outputSize > 0)) throw new Error("TURN 2 dimensions must be positive");
  const right = { x: pupils.rx * width, y: pupils.ry * height };
  const left = { x: pupils.lx * width, y: pupils.ly * height };
  const dx = left.x - right.x, dy = left.y - right.y;
  const ipd = Math.hypot(dx, dy);
  if (!(ipd > 0)) throw new Error("TURN 2 pupils must not coincide");
  const midpoint = { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2 };
  const angle = Math.atan2(dy, dx);
  const windowSide = TURN2_WINDOW_IPD * ipd;
  return {
    width, height, outputSize, right, left, midpoint, ipd, angle, windowSide,
    scale: outputSize / windowSide,
    target: { x: outputSize / 2, y: TURN2_EYE_Y * outputSize }
  };
}

export function registeredPoint(point, geometry) {
  const x = point.x - geometry.midpoint.x, y = point.y - geometry.midpoint.y;
  const cos = Math.cos(geometry.angle), sin = Math.sin(geometry.angle);
  return {
    x: geometry.target.x + geometry.scale * (cos * x + sin * y),
    y: geometry.target.y + geometry.scale * (-sin * x + cos * y)
  };
}

export function registrationCell(geometry) {
  const p = registeredPoint(geometry.left, geometry);
  return {
    c: Math.floor(p.x / (geometry.outputSize / TURN2_N)),
    r: Math.floor(p.y / (geometry.outputSize / TURN2_N))
  };
}

export function mirrorReadings(readings) {
  if (readings.length !== TURN2_CELLS) throw new Error("TURN 2 requires 256 readings");
  const mirrored = new Float64Array(TURN2_CELLS);
  for (let r = 0; r < TURN2_N; r++) {
    for (let c = 0; c < TURN2_N; c++) {
      const i = r * TURN2_N + c;
      mirrored[i] = (readings[i] + readings[r * TURN2_N + (TURN2_N - 1 - c)]) / 2;
    }
  }
  return mirrored;
}

// Stable row-major ties are explicit and do not depend on engine sort stability.
// Highest relative luminance is level 0; lowest is level 4.
export function rankReadings(readings) {
  if (readings.length !== TURN2_CELLS) throw new Error("TURN 2 requires 256 readings");
  const order = Array.from(readings, (value, index) => {
    if (!Number.isFinite(value)) throw new Error("TURN 2 readings must be finite");
    return { value, index };
  });
  order.sort((a, b) => (b.value - a.value) || (a.index - b.index));
  const levels = new Uint8Array(TURN2_CELLS);
  const population = new Uint16Array(TURN2_LEVELS);
  for (let rank = 0; rank < order.length; rank++) {
    const level = Math.floor(rank * TURN2_LEVELS / TURN2_CELLS);
    levels[order[rank].index] = level;
    population[level]++;
  }
  return { levels, population };
}

export function deriveFramings(readings) {
  const asread = rankReadings(readings);
  const anfasReadings = mirrorReadings(readings);
  const anfas = rankReadings(anfasReadings);
  return { asread: { readings, ...asread }, anfas: { readings: anfasReadings, ...anfas } };
}

export function relativeLuminance8(r, g, b) {
  return 0.2126 * SRGB_LINEAR[r] + 0.7152 * SRGB_LINEAR[g] + 0.0722 * SRGB_LINEAR[b];
}

export function readRegisteredPixels(rgba, size = TURN2_INTERNAL_SIZE) {
  if (size % TURN2_N !== 0) throw new Error("TURN 2 internal size must divide into 16 exact cells");
  if (rgba.length !== size * size * 4) throw new Error("TURN 2 registered pixel buffer has the wrong size");
  const cell = size / TURN2_N;
  const readings = new Float64Array(TURN2_CELLS);
  for (let row = 0; row < TURN2_N; row++) {
    for (let col = 0; col < TURN2_N; col++) {
      let sum = 0;
      for (let y = row * cell; y < (row + 1) * cell; y++) {
        let offset = (y * size + col * cell) * 4;
        for (let x = 0; x < cell; x++, offset += 4) {
          sum += relativeLuminance8(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
        }
      }
      readings[row * TURN2_N + col] = sum / (cell * cell);
    }
  }
  return readings;
}

export function registerAndRead(image, pupils) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const geometry = framingGeometry(width, height, pupils);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TURN2_INTERNAL_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb", alpha: true });
  ctx.fillStyle = TURN2_PAPER;
  ctx.fillRect(0, 0, TURN2_INTERNAL_SIZE, TURN2_INTERNAL_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(geometry.target.x, geometry.target.y);
  ctx.rotate(-geometry.angle);
  ctx.scale(geometry.scale, geometry.scale);
  ctx.translate(-geometry.midpoint.x, -geometry.midpoint.y);
  ctx.drawImage(image, 0, 0, width, height);
  ctx.restore();
  const readings = readRegisteredPixels(ctx.getImageData(0, 0, TURN2_INTERNAL_SIZE, TURN2_INTERNAL_SIZE).data);
  return { canvas, geometry, readings, framings: deriveFramings(readings) };
}

function centredRect(x, y, s, side) {
  const offset = (s - side) / 2;
  return { x: x + offset, y: y + offset, w: side, h: side };
}

// Eight canonical TURN 2 renderers. Only 2C's continuous geometry is directly
// established by the surviving protocol. Pixel rounding and details of several
// other vocabularies are accepted reconstructions; the record preserves that
// provenance instead of presenting those choices as historically proven.
export function renderTurn2Mark(ctx, x, y, s, level, markId, registration = false) {
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error("TURN 2 level must be 0…4");
  if (level === 0) return; // Canonical 2C rule: L0 is no mark, including at registration.
  const ink = registration ? TURN2_BLUE : TURN2_INK;

  if (markId === "2a") {
    ctx.fillStyle = registration ? TURN2_BLUE : TURN2_RAMP[level];
    ctx.fillRect(x, y, s, s);
    return;
  }
  ctx.fillStyle = ink;
  if (markId === "2b") {
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * level / 8, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (markId === "2c") {
    const rect = centredRect(x, y, s, s * level / 4);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  if (markId === "2d") {
    const rect = centredRect(x, y, s, s * level / 4);
    const line = Math.max(1, s * 3 / 32);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (rect.w > 2 * line) {
      ctx.fillStyle = TURN2_PAPER;
      ctx.fillRect(rect.x + line, rect.y + line, rect.w - 2 * line, rect.h - 2 * line);
    }
    return;
  }
  if (markId === "2e") {
    ctx.fillRect(x, y + s * 10 / 32, s * level / 4, s * 13 / 32);
    return;
  }
  if (markId === "2f") {
    const h = Math.max(1, Math.floor(s / 8));
    for (let k = 0; k < level; k++) ctx.fillRect(x, y + Math.floor(s / 16 + k * s / 4), s, h);
    return;
  }
  if (markId === "2g") {
    ctx.fillStyle = TURN2_RAMP[Math.max(1, level - 1)];
    ctx.fillRect(x, y, s, s);
    const side = Math.max(1, Math.floor((level / 4) * 0.5625 * s));
    const rect = centredRect(x, y, s, side);
    ctx.fillStyle = registration ? TURN2_BLUE : (level <= 2 ? TURN2_INK : TURN2_PAPER);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  if (markId === "2h") {
    if (level === 4) ctx.fillRect(x, y, s, s);
    return;
  }
  throw new Error("Unknown TURN 2 mark " + markId);
}

export function renderTurn2Plate(ctx, size, levels, markId, registration = TURN2_REGISTRATION, upTo = TURN2_CELLS) {
  if (levels.length !== TURN2_CELLS) throw new Error("TURN 2 plate requires 256 levels");
  if (!TURN2_MARKS.some(mark => mark.id === markId)) throw new Error("Unknown TURN 2 mark " + markId);
  const end = Math.max(0, Math.min(TURN2_CELLS, Math.floor(upTo)));
  ctx.fillStyle = TURN2_PAPER;
  ctx.fillRect(0, 0, size, size);
  const s = size / TURN2_N;
  for (let i = 0; i < end; i++) {
    const c = i % TURN2_N, r = (i / TURN2_N) | 0;
    renderTurn2Mark(ctx, c * s, r * s, s, levels[i], markId, c === registration.c && r === registration.r);
  }
  return end;
}
