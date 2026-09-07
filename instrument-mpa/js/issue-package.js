// PROB–MPA–01 · ISSUE PACKAGE · REV C
//
// The frozen physical package expressed once, in millimetres, as pure data.
// Authority is the REV C engineering handoff: ONE MEASUREMENT · ONE RECORD ·
// EIGHT MARKS. Three issued objects — PORTRAIT, RECORD, MARKS — one printed
// face each, every reverse blank, MEASURED only. The wrapper is packaging and
// is modelled here because it shares this geometry; it is not a fourth object.
//
// Every face is a display list: an array of {rect | text | plate} primitives in
// sheet millimetres. One renderer consumes them, so the screen preview and the
// eventual archive sheets are the same artwork at different scales, never two
// implementations. Mark geometry is not restated here — a plate primitive names
// a mark and the renderer draws it through turn2.js, which remains the sole
// mark-geometry authority.
//
// This module is pure. No DOM, no canvas, no browser, no payment state, no
// storage, no clock. Given a record it returns the same lists every time.
//
// Three accepted decisions override REV C's unresolved placeholders, and only
// those:
//
//   C3  The issue identifier is the existing deterministic PROB–MPA–<20 HEX>,
//       not REV C's sequential example MPA-01-0001. No registry is implied.
//   C9  The canonical record keeps its internal schema and terminology; it is
//       exempt from the public-terminology rule. Nothing in this module emits
//       internal terminology, so the exemption stays confined to record.json.
//   C12 The wrapper square is the measured fiducial mark at the wrapper
//       registration position. At level 0 its area is zero and no primitive is
//       emitted. That is agreement, not a missing element.

import {
  TURN2_BLUE, TURN2_INK, TURN2_MARKS, TURN2_N, TURN2_PAPER, TURN2_RAMP
} from "./turn2.js";
import { parseMatrix } from "./record.js";

export const PACKAGE_REVISION = "MPA-01 ISSUE PACKAGE / REV C";

// ---- sheet grid · identical on all three A4 faces ---------------------------

export const TRIM = Object.freeze({ w: 210, h: 297 });
export const MARGIN = Object.freeze({ left: 24, right: 24, head: 24, foot: 27 });
export const LIVE = Object.freeze({ x: 24, y: 24, w: 162, h: 246 });
export const MODULE = 6;
export const CONTENT_ORIGIN = 78;

export const RUNNING_HEAD_BASELINE = 16.5;
export const HEAD_RULE_Y = 24;
export const TITLE_BASELINE = 29;
export const FOOT_RULE_Y = 270;
export const FOOT_BASELINE = 273.5;

// Three weights, no others.
export const RULE = Object.freeze({ head: 0.35, section: 0.20, hair: 0.10 });

export const RUNNING_HEAD_LEFT = "PROBNAYA · INDEPENDENT COMPUTATIONAL LABORATORY";
export const RUNNING_HEAD_RIGHT = "MACHINE PORTRAIT APPARATUS · MPA-01";
export const FRAMING_WORD = "MEASURED";

// ---- typography · two families, six sizes -----------------------------------

export const PT = 25.4 / 72;
const LINE_BOX = 1.2;   // default line box, as the reference artwork sets none
const CAP = 0.72;       // baseline offset from the top of a line box
const MONO_ADVANCE = 0.6;

export const em = pt => pt * PT;
export const lineBox = pt => pt * PT * LINE_BOX;
export const capOffset = pt => pt * PT * CAP;
export const monoCharWidth = (pt, track) => (MONO_ADVANCE + track) * pt * PT;

export const TYPE = Object.freeze({
  title:           Object.freeze({ font: "display", size: 10,  track: 0.06 }),
  framing:         Object.freeze({ font: "mono",    size: 7,   track: 0.16 }),
  columnTitle:     Object.freeze({ font: "mono",    size: 6.5, track: 0.16 }),
  runningHead:     Object.freeze({ font: "mono",    size: 6,   track: 0.18 }),
  foot:            Object.freeze({ font: "mono",    size: 6,   track: 0.16 }),
  caption:         Object.freeze({ font: "mono",    size: 6,   track: 0.12 }),
  markLabel:       Object.freeze({ font: "mono",    size: 6,   track: 0.12 }),
  fieldValue:      Object.freeze({ font: "mono",    size: 6,   track: 0.04 }),
  prose:           Object.freeze({ font: "mono",    size: 6,   track: 0.10 }),
  provenanceLabel: Object.freeze({ font: "mono",    size: 5.5, track: 0.14 }),
  levelKeyLabel:   Object.freeze({ font: "mono",    size: 5.5, track: 0.14 }),
  matrixDigit:     Object.freeze({ font: "mono",    size: 7.5, track: 0 }),
  tableIndex:      Object.freeze({ font: "mono",    size: 5,   track: 0 }),
  principalTag:    Object.freeze({ font: "mono",    size: 4.5, track: 0.14 })
});

// ---- colour · two inks, paper is substrate ----------------------------------

export const PAPER = TURN2_PAPER;
export const INK = TURN2_INK;
export const BLUE = TURN2_BLUE;

const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const INK_RGB = channels(TURN2_INK);
const PAPER_RGB = channels(TURN2_PAPER);

// A flat tint of ink 1 over the substrate. REV C specifies the type greys as
// percentages (40 % muted, 15 % reading aids); the level ramp stays canonical.
export function tint(fraction) {
  if (!(fraction >= 0 && fraction <= 1)) throw new Error("tint fraction must be 0…1");
  const mix = i => Math.round(fraction * INK_RGB[i] + (1 - fraction) * PAPER_RGB[i]);
  return "#" + [0, 1, 2].map(i => mix(i).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const GREY_TYPE = tint(0.40);   // muted labels and indices
export const GREY_AID = tint(0.15);    // reading-aid rules only

// Printed level-key percentages. The swatches themselves are the canonical
// TURN 2 ramp; this series only labels them.
export const LEVEL_TINTS = Object.freeze([0, 0.125, 0.319, 0.542, 1]);

// ---- primitives -------------------------------------------------------------

const rect = (x, y, w, h, fill) => ({ type: "rect", x, y, w, h, fill });
const text = (x, y, value, style, fill, align = "left") =>
  ({ type: "text", x, y, value, font: style.font, size: style.size, track: style.track, fill, align });
const plate = (x, y, size, markId, levels) => ({ type: "plate", x, y, size, markId, levels });

// Wrap a monospace string to a column width, breaking on spaces only. Exact and
// deterministic because the measure is a declared advance, not a font query.
export function wrapMono(value, widthMm, style) {
  const charWidth = monoCharWidth(style.size, style.track);
  const capacity = Math.max(1, Math.floor(widthMm / charWidth));
  const lines = [];
  let line = "";
  for (const word of String(value).split(" ")) {
    const candidate = line ? line + " " + word : word;
    if (candidate.length <= capacity) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

// ---- the issue view ---------------------------------------------------------

// The one place the canonical record is read. Everything downstream sees public
// values only, which is what keeps the C9 exemption confined to record.json.
export function issueView(record) {
  if (!record || !record.matrices || !record.matrices.measured) throw new Error("record has no measured matrix");
  const levels = parseMatrix(record.matrices.measured.matrix);
  if (levels.length !== TURN2_N * TURN2_N) throw new Error("measured matrix is not 16 × 16");
  const cell = record.registration && record.registration.cell;
  if (!Array.isArray(cell) || cell.length !== 2 || !cell.every(Number.isInteger)) throw new Error("record has no fiducial address");
  const [c, r] = cell;
  if (!(c >= 0 && c < TURN2_N && r >= 0 && r < TURN2_N)) throw new Error("fiducial address is outside the lattice");
  if (typeof record.issue !== "string" || !record.issue) throw new Error("record has no issue identifier");
  if (typeof record.issued !== "string" || !record.issued) throw new Error("record has no issue date");
  return Object.freeze({
    // C3 · the deterministic production identifier, exactly as generated.
    id: record.issue,
    // Presentation transform only; the canonical record keeps its own stamp.
    date: record.issued.replace(/\./g, "-"),
    levels,
    populations: Array.from(record.matrices.measured.population || []),
    fiducial: Object.freeze({ c, r }),
    fiducialLevel: levels[r * TURN2_N + c],
    sourceDigest: String(record.source && record.source.sha256 || "").toUpperCase()
  });
}

const fiducialAddress = view => `FIDUCIAL COL ${view.fiducial.c} · ROW ${view.fiducial.r}`;
const footLeft = view => `${view.id} · ${view.date}`;

// ---- shared sheet furniture -------------------------------------------------

function chrome(view, objectName) {
  return [
    text(LIVE.x, RUNNING_HEAD_BASELINE, RUNNING_HEAD_LEFT, TYPE.runningHead, GREY_TYPE),
    text(LIVE.x + LIVE.w, RUNNING_HEAD_BASELINE, RUNNING_HEAD_RIGHT, TYPE.runningHead, GREY_TYPE, "right"),
    rect(LIVE.x, HEAD_RULE_Y, LIVE.w, RULE.head, INK),
    text(LIVE.x, TITLE_BASELINE, objectName, TYPE.title, INK),
    text(LIVE.x + LIVE.w, TITLE_BASELINE, FRAMING_WORD, TYPE.framing, INK, "right"),
    rect(LIVE.x, FOOT_RULE_Y, LIVE.w, RULE.section, INK),
    text(LIVE.x, FOOT_BASELINE, footLeft(view), TYPE.foot, GREY_TYPE),
    text(LIVE.x + LIVE.w, FOOT_BASELINE, objectName, TYPE.foot, GREY_TYPE, "right")
  ];
}

// ---- 01 PORTRAIT ------------------------------------------------------------

export const PORTRAIT_PLATE = Object.freeze({ x: 51, y: CONTENT_ORIGIN, size: 108 });
export const PORTRAIT_CELL = PORTRAIT_PLATE.size / TURN2_N;          // 6.75 mm
export const PORTRAIT_CAPTION_BASELINE = PORTRAIT_PLATE.y + PORTRAIT_PLATE.size + 4.5;
const PRINCIPAL_MARK_ID = "2c";

export function portraitFace(view) {
  const items = chrome(view, "PORTRAIT");
  items.push(plate(PORTRAIT_PLATE.x, PORTRAIT_PLATE.y, PORTRAIT_PLATE.size, PRINCIPAL_MARK_ID, view.levels));
  items.push(text(PORTRAIT_PLATE.x, PORTRAIT_CAPTION_BASELINE, "CONCENTRIC", TYPE.caption, INK));
  items.push(text(PORTRAIT_PLATE.x + PORTRAIT_PLATE.size, PORTRAIT_CAPTION_BASELINE, fiducialAddress(view), TYPE.caption, BLUE, "right"));
  return { id: "01-portrait", name: "PORTRAIT", trim: TRIM, items };
}

// ---- 02 RECORD --------------------------------------------------------------

export const MATRIX = Object.freeze({
  x: LIVE.x, y: CONTENT_ORIGIN, columnWidth: 78, gutter: 6, indexGutter: 6,
  pitch: 4.5, indexRow: 4.5, height: 76.5
});
export const MATRIX_DATA_TOP = MATRIX.y + MATRIX.indexRow;                       // 82.5
export const MATRIX_DATA_X = MATRIX.x + MATRIX.indexGutter;                      // 30
export const LEVEL_KEY = Object.freeze({
  x: LIVE.x + MATRIX.columnWidth + MATRIX.gutter, y: MATRIX_DATA_TOP, swatch: 9, pitch: 13.5, gap: 1.8
});
export const RECORD_SECTION_RULE_Y = 164;
export const PROVENANCE = Object.freeze({ y: 170, columnWidth: 50, gutter: 6, titleGap: 4, rowGap: 4, labelGap: 1 });
export const RECORD_PROSE = "LEVELS ARE RANKS, NOT MEASUREMENTS. 0 LIGHTEST · 4 DARKEST.";
const PROVENANCE_VALUE_LINE = em(TYPE.fieldValue.size) * 1.5;

const columnTitle = (x, left, right) => [
  text(x, 70, left, TYPE.columnTitle, INK),
  text(x + MATRIX.columnWidth, 70, right, TYPE.columnTitle, GREY_TYPE, "right")
];

function matrixTable(view) {
  const items = [];
  // Column indices above a hairline, then sixteen data rows.
  for (let c = 0; c < TURN2_N; c++) {
    items.push(text(MATRIX_DATA_X + c * MATRIX.pitch + MATRIX.pitch / 2,
      MATRIX.y + (MATRIX.indexRow - lineBox(TYPE.tableIndex.size)) / 2 + capOffset(TYPE.tableIndex.size),
      String(c).padStart(2, "0"), TYPE.tableIndex, GREY_TYPE, "center"));
  }
  items.push(rect(MATRIX.x, MATRIX_DATA_TOP, MATRIX.columnWidth, RULE.hair, GREY_TYPE));

  // Quadrant guides every four cells. Reading aid, no data.
  for (let i = 1; i < 4; i++) {
    items.push(rect(MATRIX_DATA_X + i * 4 * MATRIX.pitch, MATRIX_DATA_TOP, RULE.hair, TURN2_N * MATRIX.pitch, GREY_AID));
    items.push(rect(MATRIX_DATA_X, MATRIX_DATA_TOP + i * 4 * MATRIX.pitch, TURN2_N * MATRIX.pitch, RULE.hair, GREY_AID));
  }

  const digitBaseline = r => MATRIX_DATA_TOP + r * MATRIX.pitch
    + (MATRIX.pitch - lineBox(TYPE.matrixDigit.size)) / 2 + capOffset(TYPE.matrixDigit.size);
  const indexBaseline = r => MATRIX_DATA_TOP + r * MATRIX.pitch
    + (MATRIX.pitch - lineBox(TYPE.tableIndex.size)) / 2 + capOffset(TYPE.tableIndex.size);

  for (let r = 0; r < TURN2_N; r++) {
    items.push(text(MATRIX_DATA_X - 1.5, indexBaseline(r), String(r).padStart(2, "0"), TYPE.tableIndex, GREY_TYPE, "right"));
    for (let c = 0; c < TURN2_N; c++) {
      const isFiducial = c === view.fiducial.c && r === view.fiducial.r;
      items.push(text(MATRIX_DATA_X + c * MATRIX.pitch + MATRIX.pitch / 2, digitBaseline(r),
        String(view.levels[r * TURN2_N + c]), TYPE.matrixDigit, isFiducial ? BLUE : INK, "center"));
    }
  }
  return items;
}

function levelKey() {
  const items = [];
  const labelBaseline = LEVEL_KEY.y + LEVEL_KEY.swatch + LEVEL_KEY.gap + capOffset(TYPE.levelKeyLabel.size);
  for (let i = 0; i < TURN2_RAMP.length; i++) {
    const x = LEVEL_KEY.x + i * LEVEL_KEY.pitch;
    items.push(rect(x, LEVEL_KEY.y, LEVEL_KEY.swatch, LEVEL_KEY.swatch, TURN2_RAMP[i]));
    if (i === 0) {
      // L0 is paper; a hairline frame keeps the swatch present on the sheet.
      items.push(rect(x, LEVEL_KEY.y, LEVEL_KEY.swatch, RULE.hair, GREY_TYPE));
      items.push(rect(x, LEVEL_KEY.y + LEVEL_KEY.swatch - RULE.hair, LEVEL_KEY.swatch, RULE.hair, GREY_TYPE));
      items.push(rect(x, LEVEL_KEY.y, RULE.hair, LEVEL_KEY.swatch, GREY_TYPE));
      items.push(rect(x + LEVEL_KEY.swatch - RULE.hair, LEVEL_KEY.y, RULE.hair, LEVEL_KEY.swatch, GREY_TYPE));
    }
    // The reference artwork sets these labels in flex columns that widen past
    // the pitch; REV C freezes 13.5 mm centres, so the label closes up to fit.
    items.push(text(x, labelBaseline, `L${i} · ${Math.round(LEVEL_TINTS[i] * 100)}%`, TYPE.levelKeyLabel, GREY_TYPE));
  }
  const proseTop = LEVEL_KEY.y + LEVEL_KEY.swatch + LEVEL_KEY.gap + lineBox(TYPE.levelKeyLabel.size) + 7;
  items.push(text(LEVEL_KEY.x, proseTop + capOffset(TYPE.prose.size), RECORD_PROSE, TYPE.prose, GREY_TYPE));
  return items;
}

export function provenanceColumns(view) {
  const digest = view.sourceDigest.match(/.{1,8}/g) || [];
  return [
    { title: "REGISTRATION", rows: [
      { label: "WINDOW", value: "SQUARE · 4.2 × IPD", fill: INK },
      { label: "EYE LINE", value: "0.40 OF WINDOW HEIGHT", fill: INK },
      { label: "FIDUCIAL", value: `COL ${view.fiducial.c} · ROW ${view.fiducial.r}`, fill: BLUE },
      { label: "FIDUCIAL RULE", value: "THE CELL OF THE SUBJECT'S LEFT PUPIL", fill: INK }
    ] },
    { title: "READING", rows: [
      { label: "LATTICE", value: "16 × 16 · 256 CELLS", fill: INK },
      { label: "PER CELL", value: "MEAN REC.709 RELATIVE LUMINANCE", fill: INK },
      { label: "LEVELS", value: `RANK · FIVE · ${view.populations.join(" / ")}`, fill: INK }
    ] },
    { title: "ISSUE", rows: [
      { label: "ISSUE", value: view.id, fill: INK },
      { label: "ISSUED", value: view.date, fill: INK },
      { label: "SOURCE DIGEST", value: `SHA-256 ${digest.join(" ")}`, fill: INK },
      { label: "PRINCIPAL", value: "CONCENTRIC", fill: INK }
    ] }
  ];
}

function provenance(view) {
  const items = [];
  provenanceColumns(view).forEach((column, index) => {
    const x = LIVE.x + index * (PROVENANCE.columnWidth + PROVENANCE.gutter);
    items.push(text(x, PROVENANCE.y + capOffset(TYPE.runningHead.size), column.title, TYPE.runningHead, INK));
    let top = PROVENANCE.y + lineBox(TYPE.runningHead.size) + PROVENANCE.titleGap;
    for (const row of column.rows) {
      items.push(text(x, top + capOffset(TYPE.provenanceLabel.size), row.label, TYPE.provenanceLabel, GREY_TYPE));
      const valueTop = top + lineBox(TYPE.provenanceLabel.size) + PROVENANCE.labelGap;
      const lines = wrapMono(row.value, PROVENANCE.columnWidth, TYPE.fieldValue);
      lines.forEach((line, k) => {
        const baseline = valueTop + k * PROVENANCE_VALUE_LINE
          + (PROVENANCE_VALUE_LINE - lineBox(TYPE.fieldValue.size)) / 2 + capOffset(TYPE.fieldValue.size);
        items.push(text(x, baseline, line, TYPE.fieldValue, row.fill));
      });
      top = valueTop + lines.length * PROVENANCE_VALUE_LINE + PROVENANCE.rowGap;
    }
  });
  return items;
}

export function recordFace(view) {
  const items = chrome(view, "RECORD");
  items.push(...columnTitle(MATRIX.x, "MEASURED", "CANONICAL MATRIX"));
  items.push(...columnTitle(LEVEL_KEY.x, "LEVEL KEY", "FIVE RANKS"));
  items.push(...matrixTable(view));
  items.push(...levelKey());
  items.push(rect(LIVE.x, RECORD_SECTION_RULE_Y, LIVE.w, RULE.section, INK));
  items.push(...provenance(view));
  return { id: "02-record", name: "RECORD", trim: TRIM, items };
}

// ---- 03 MARKS ---------------------------------------------------------------

export const MARKS_FIELD = Object.freeze({ x: LIVE.x, y: CONTENT_ORIGIN, w: 162, h: 96 });
export const MARKS_CELL = Object.freeze({ w: 40.5, h: 48, cols: 4, rows: 2 });
export const MARK_SIZE = 36;
export const MARK_PAD = Object.freeze({ side: 2.25, top: 3, label: 2.8 });
export const PRINCIPAL_TAG = "PRINCIPAL";
const TAG_PAD = Object.freeze({ x: 1, y: 0.5 });

export function marksFace(view) {
  const items = chrome(view, "MARKS");

  // Nine rules on the cell boundaries, consuming no cell width.
  for (let c = 0; c <= MARKS_CELL.cols; c++) {
    items.push(rect(MARKS_FIELD.x + c * MARKS_CELL.w, MARKS_FIELD.y, RULE.hair, MARKS_FIELD.h, GREY_TYPE));
  }
  for (let r = 0; r <= MARKS_CELL.rows; r++) {
    items.push(rect(MARKS_FIELD.x, MARKS_FIELD.y + r * MARKS_CELL.h, MARKS_FIELD.w, RULE.hair, GREY_TYPE));
  }

  TURN2_MARKS.forEach((mark, index) => {
    const cellX = MARKS_FIELD.x + (index % MARKS_CELL.cols) * MARKS_CELL.w;
    const cellY = MARKS_FIELD.y + Math.floor(index / MARKS_CELL.cols) * MARKS_CELL.h;
    const markX = cellX + MARK_PAD.side, markY = cellY + MARK_PAD.top;
    const labelBaseline = markY + MARK_SIZE + MARK_PAD.label;
    items.push(plate(markX, markY, MARK_SIZE, mark.id, view.levels));
    items.push(text(markX, labelBaseline, mark.name, TYPE.markLabel, INK));
    if (mark.id !== PRINCIPAL_MARK_ID) return;
    // The only differentiation CONCENTRIC carries: a blue-ruled tag.
    const tagWidth = PRINCIPAL_TAG.length * monoCharWidth(TYPE.principalTag.size, TYPE.principalTag.track) + 2 * TAG_PAD.x;
    const tagHeight = lineBox(TYPE.principalTag.size) + 2 * TAG_PAD.y;
    const tagRight = cellX + MARKS_CELL.w - MARK_PAD.side;
    const tagX = tagRight - tagWidth;
    const tagY = labelBaseline - capOffset(TYPE.principalTag.size) - TAG_PAD.y;
    items.push(rect(tagX, tagY, tagWidth, RULE.hair, BLUE));
    items.push(rect(tagX, tagY + tagHeight - RULE.hair, tagWidth, RULE.hair, BLUE));
    items.push(rect(tagX, tagY, RULE.hair, tagHeight, BLUE));
    items.push(rect(tagX + tagWidth - RULE.hair, tagY, RULE.hair, tagHeight, BLUE));
    items.push(text(tagRight - TAG_PAD.x, labelBaseline, PRINCIPAL_TAG, TYPE.principalTag, BLUE, "right"));
  });
  return { id: "03-marks", name: "MARKS", trim: TRIM, items };
}

// ---- WRAPPER · packaging, not a fourth issued object ------------------------

export const WRAPPER = Object.freeze({
  flat: Object.freeze({ w: 454, h: 303 }),
  folded: Object.freeze({ w: 216, h: 303 }),
  panels: Object.freeze([
    Object.freeze({ name: "FRONT", w: 216 }), Object.freeze({ name: "EDGE", w: 2 }),
    Object.freeze({ name: "BACK", w: 216 }), Object.freeze({ name: "EDGE", w: 2 }),
    Object.freeze({ name: "LAP", w: 18 })
  ]),
  scores: Object.freeze([216, 218, 434, 436]),
  glue: Object.freeze({ w: 18, h: 303 }),
  cavity: Object.freeze({ w: 216, h: 303, depth: 2 }),
  clearance: 3,
  identityInset: 27,
  identityGap: 2,
  stack: Object.freeze(["PORTRAIT", "RECORD", "MARKS"])
});

export const WRAPPER_IDENTITY_LINE = "PROBNAYA · MACHINE PORTRAIT APPARATUS · MPA-01";

// C12 · the fiducial mark's exact place and size on the PORTRAIT sheet within,
// offset by the stack clearance. At level 0 the mark has no area, so the square
// has none either. No minimum, placeholder or substitute is introduced.
export function fiducialSquare(view) {
  const side = PORTRAIT_CELL * view.fiducialLevel / 4;
  const centre = offset => offset + PORTRAIT_CELL / 2 + WRAPPER.clearance;
  return {
    side,
    x: centre(PORTRAIT_PLATE.x + view.fiducial.c * PORTRAIT_CELL) - side / 2,
    y: centre(PORTRAIT_PLATE.y + view.fiducial.r * PORTRAIT_CELL) - side / 2
  };
}

export function wrapperFront(view) {
  const items = [];
  const square = fiducialSquare(view);
  if (square.side > 0) items.push(rect(square.x, square.y, square.side, square.side, BLUE));

  // No head rule, no foot rule, no running head: the wrapper must not read as a
  // sheet. Two lines only, the last sitting on the same 27 mm foot margin.
  const secondBottom = WRAPPER.folded.h - WRAPPER.identityInset;
  const secondTop = secondBottom - lineBox(TYPE.foot.size);
  const firstTop = secondTop - WRAPPER.identityGap - lineBox(TYPE.foot.size);
  items.push(text(WRAPPER.identityInset, firstTop + capOffset(TYPE.foot.size), WRAPPER_IDENTITY_LINE, TYPE.foot, INK));
  items.push(text(WRAPPER.identityInset, secondTop + capOffset(TYPE.foot.size), footLeft(view), TYPE.foot, GREY_TYPE));
  return { id: "04-wrapper-front", name: "WRAPPER", trim: WRAPPER.folded, items };
}

// ---- the package ------------------------------------------------------------

export const ISSUED_FACES = Object.freeze(["portrait", "record", "marks"]);

export function issuedFaces(view) {
  return [portraitFace(view), recordFace(view), marksFace(view)];
}

export function issuePackage(record) {
  const view = issueView(record);
  return { view, faces: issuedFaces(view), wrapper: wrapperFront(view) };
}

// ---- the issue archive ------------------------------------------------------
//
// One archive per verified issue. The standalone masters are drawn straight
// from the canonical measurement through turn2.js; the sheet and wrapper images
// are these same display lists at a higher density. Nothing here is a second
// rendering system, and nothing is cropped or scaled out of anything else.

export const MASTER_PX = 2048;              // every geometry is pixel-exact here
export const ARCHIVE_PX_PER_MM = 12;        // 12 000 px/m, declared in pHYs
export const ARCHIVE_PIXELS_PER_METRE = ARCHIVE_PX_PER_MM * 1000;

const px = (widthMm, heightMm) => ({ w: Math.round(widthMm * ARCHIVE_PX_PER_MM), h: Math.round(heightMm * ARCHIVE_PX_PER_MM) });

export const ARCHIVE_ENTRIES = Object.freeze([
  Object.freeze({ path: "record.json", kind: "record" }),
  Object.freeze({ path: "portrait-concentric.png", kind: "master", mark: PRINCIPAL_MARK_ID, pixels: { w: MASTER_PX, h: MASTER_PX } }),
  ...TURN2_MARKS.map((mark, index) => Object.freeze({
    path: `marks/${index + 1}-${mark.name.toLowerCase()}.png`,
    kind: "master", mark: mark.id, pixels: { w: MASTER_PX, h: MASTER_PX }
  })),
  Object.freeze({ path: "sheets/01-portrait.png", kind: "sheet", face: "portrait", pixels: px(TRIM.w, TRIM.h), physical: TRIM }),
  Object.freeze({ path: "sheets/02-record.png", kind: "sheet", face: "record", pixels: px(TRIM.w, TRIM.h), physical: TRIM }),
  Object.freeze({ path: "sheets/03-marks.png", kind: "sheet", face: "marks", pixels: px(TRIM.w, TRIM.h), physical: TRIM }),
  Object.freeze({ path: "wrapper/wrapper-front.png", kind: "wrapper", pixels: px(WRAPPER.folded.w, WRAPPER.folded.h), physical: WRAPPER.folded }),
  Object.freeze({ path: "MANIFEST.txt", kind: "manifest" }),
  Object.freeze({ path: "PRINT-AND-ASSEMBLY.txt", kind: "print" })
]);

export const ARCHIVE_PATHS = Object.freeze(ARCHIVE_ENTRIES.map(entry => entry.path));
export const MANIFEST_PATH = "MANIFEST.txt";
export const RECORD_PATH = "record.json";

// The archive root is the issue identifier in its filename form. The identifier
// itself keeps its en dashes wherever it is printed or displayed.
export function archiveRoot(view) {
  return view.id.replace(/–/g, "-");
}

const dimension = value => value ? `${value.w} × ${value.h}` : "-";
const pad = (value, width) => String(value) + " ".repeat(Math.max(0, width - String(value).length));

// entries: [{ path, bytes, sha256 }] for every archive file except the manifest.
export function formatManifest(view, entries) {
  const described = entries.map(entry => {
    const known = ARCHIVE_ENTRIES.find(candidate => candidate.path === entry.path);
    return {
      path: entry.path,
      bytes: entry.bytes,
      sha256: entry.sha256,
      pixels: dimension(known && known.pixels),
      physical: known && known.physical ? `${known.physical.w} × ${known.physical.h} MM` : "-"
    };
  });
  const pathWidth = Math.max(...described.map(e => e.path.length));
  const byteWidth = Math.max(...described.map(e => String(e.bytes).length));
  const pixelWidth = Math.max(...described.map(e => e.pixels.length));
  return [
    "PROBNAYA · MPA-01 · ISSUE ARCHIVE",
    `ISSUE     ${view.id}`,
    `ISSUED    ${view.date}`,
    `ENTRIES   ${described.length}`,
    "FIELDS    PATH · BYTES · SHA-256 · PIXELS · PHYSICAL",
    "",
    "This manifest lists every file in the archive except itself.",
    "",
    ...described.map(e =>
      `${pad(e.path, pathWidth)}  ${pad(e.bytes, byteWidth)}  ${e.sha256}  ${pad(e.pixels, pixelWidth)}  ${e.physical}`),
    ""
  ].join("\n");
}

export function printAndAssembly(view) {
  return `PROBNAYA · MPA-01 · PRINT AND ASSEMBLY
ISSUE ${view.id} · ${view.date}

WHAT TO PRINT
  Three sheets, one side each. Every reverse stays blank.

    sheets/01-portrait.png      PORTRAIT   A4 210 × 297 mm   300 gsm uncoated off-white, matt
    sheets/02-record.png        RECORD     A4 210 × 297 mm   170 gsm uncoated off-white, matt
    sheets/03-marks.png         MARKS      A4 210 × 297 mm   170 gsm uncoated off-white, matt
    wrapper/wrapper-front.png   WRAPPER    front panel 216 × 303 mm on a 454 × 303 mm flat
                                           170 gsm as above, grain parallel to the scores

PRINTING
  100 % scale. No fit-to-page, no shrink-to-fit, no scaling at plate, press or proof.
    A scaled sheet is a reject.
  Single-sided. Simplex. If the press runs duplex by default, disable it.
    A printed reverse is a reject.
  No bleed anywhere. The nearest element to any trim is 16.5 mm. Trim four sides to size.
  Matt uncoated throughout. No coating, varnish, foil, emboss, deboss, die-cut,
    perforation, corner rounding or edge treatment.
  Two inks: black #16181C and registration blue #2233CC. The off-white paper is the
    substrate, never a white flood.
  Every image declares its physical size at ${ARCHIVE_PIXELS_PER_METRE} pixels per metre.
    Place at 100 % and an A4 sheet measures exactly 210 × 297 mm.

WRAPPER
  Flat ${WRAPPER.flat.w} × ${WRAPPER.flat.h} mm, landscape. Print the front panel artwork at the left edge;
    the rest of the flat, the whole inner surface and the lap carry no print.
  Panels left to right: ${WRAPPER.panels.map(panel => `${panel.name} ${panel.w}`).join(" · ")} mm.
  Score four lines at ${WRAPPER.scores.join(", ")} mm from the left trim, full ${WRAPPER.flat.h} mm height.
    Score only; do not perforate or crease by hand.
  Fold all four the same way, printed face outward. Fold 1 and 2 first, carrying the
    back panel behind the front; then fold 3 and 4, carrying the lap onto the inside
    of the front panel.
  Glue one line, ${WRAPPER.glue.w} × ${WRAPPER.glue.h} mm, on the lap's inner face only. No adhesive anywhere
    else and none in contact with a printed sheet.
  Finished ${WRAPPER.folded.w} × ${WRAPPER.folded.h} mm. Cavity ${WRAPPER.cavity.depth} mm deep, open at head and foot.

ASSEMBLY
  Stack from the front panel inward: ${WRAPPER.stack.join(", then ")}.
  All three head-up, all three printed face toward the wrapper's printed front panel.
  Stack square, then slide in from the head opening.
  Loose: no binding, tape, tissue or interleaving.

TOLERANCES
  Scale          0 %. Any deviation from 100 % is a reject.
  Trim           ± 0.5 mm on every edge of every object.
  Registration   ± 0.15 mm between the two inks. The blue must sit inside its cell
                 without touching neighbouring geometry.
  Scores         ± 0.3 mm. Outside that the ${WRAPPER.panels[1].w} mm edge panels and the cavity close up.
`;
}
