// PROB–MPA–01 · APPARATUS
//
// The page controller. Mounts a specimen, runs the derivation once, shows the
// preliminary reading reduced from the issued matrix, freezes the selection at
// authorisation, constructs the plate from the stored matrix, and exports it.
//
// Nothing here measures. The derivation lives in derivation.js and runs exactly
// once per mounted specimen; everything shown afterwards is that matrix or a
// reduction of it. The construction count is the number of cells committed to
// the visible plate on the frame in which it is shown.

import {
  N, CELLS, PN, cropRect, cellEdges, newAccumulator, accumulateStrip, finishMeans,
  derive, admissible, MIN_SIDE
} from "./derivation.js";
import {
  PAPER, DERIVATION_WORD, DERIVATION_NAME, renderPlate, renderConstruction, inspect
} from "./geometry.js";
import { buildRecord, embedRecord, issueId, stampDate } from "./record.js";

const OUTPUT_PX = 1024;
const STRIP_ROWS = 256;          // source rows read per pass; bounds canvas memory, never changes the sums
const CONSTRUCTION_MS = 3400;    // presentation pace for 1024 cells; not a computation time
const REVEAL_MS = 900;           // presentation pace for the preliminary readings
const SEQ_KEY = "prob-mpa-seq";  // local counter, not a ledger

// Review-only pace multiplier: ?pace=2 draws twice as fast. Changes when marks
// appear, never which marks appear.
const PACE = (() => {
  const v = parseFloat(new URLSearchParams(location.search).get("pace"));
  return v > 0 ? v : 1;
})();

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const setText = (name, value) => { for (const el of $$('[data-t="' + name + '"]')) el.textContent = value; };

const page = $("#page");

// ---- state ------------------------------------------------------------------

let revealRaf = 0, constructRaf = 0;   // animation frame handles, presentation only

const state = {
  phase: "ready",            // ready | acquired | auth | running | done
  deriv: "centric",
  field: "light",
  specimen: null,            // { result, hash, type, width, height }
  run: null                  // { seq, id, issued, deriv, field, inspection, record, drawn }
};

// ---- canvases ---------------------------------------------------------------

const surfaces = new Map();  // canvas → { ctx, size }

function fitCanvas(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.min(w, h);
  const px = Math.round(size * dpr);
  if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = { ctx, size };
  surfaces.set(canvas, s);
  return s;
}

const ro = new ResizeObserver(entries => {
  for (const e of entries) { fitCanvas(e.target); paintCanvas(e.target); }
});
for (const c of $$("canvas[data-preview], #plateRunning, #plateDone")) ro.observe(c);

function surface(canvas) { return surfaces.get(canvas) || fitCanvas(canvas); }

function paintCanvas(canvas) {
  if (canvas.dataset.preview) paintPreview(canvas);
  else if (canvas.id === "plateRunning") paintRunning();
  else if (canvas.id === "plateDone") paintDone();
}

// ---- preliminary readings -----------------------------------------------------

let reveal = 1; // 0…1 fraction of the preliminary reveal, presentation only

function paintPreview(canvas) {
  const spec = state.specimen;
  const s = surface(canvas);
  if (!spec || !s) return;
  const key = canvas.dataset.preview;
  const dark = state.field === "dark";
  if (key === "selected") {
    renderPlate(s.ctx, s.size, spec.result.preliminary, PN, state.deriv, dark, null, false);
    return;
  }
  const offset = { centric: 0, skyline: 0.12, raster: 0.24 }[key];
  const t = Math.max(0, Math.min(1, (reveal - offset) / 0.68));
  renderPlate(s.ctx, s.size, spec.result.preliminary, PN, key, dark, Math.round(PN * PN * t), false);
}

function paintPreviews() { for (const c of $$("canvas[data-preview]")) paintPreview(c); }

// The one moment the apparatus draws its preliminary readings: real marks laid
// down in scan order from the already-derived matrix. No loader.
function revealPreviews() {
  cancelAnimationFrame(revealRaf);
  const t0 = performance.now(), span = REVEAL_MS / PACE;
  const step = now => {
    reveal = Math.max(0, Math.min(1, (now - t0) / span));
    paintPreviews();
    if (reveal < 1) revealRaf = requestAnimationFrame(step);
  };
  reveal = 0;
  revealRaf = requestAnimationFrame(step);
}

// ---- mounting -----------------------------------------------------------------

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// Decode → orientation → crop → explicit box filter over the crop's pixels, read
// in horizontal strips at 1:1 so no browser resampling touches the measurement.
// Decoded pixels exist only inside this function.
async function readSpecimen(file) {
  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }), {
    imageOrientation: "from-image",   // EXIF orientation applied explicitly
    colorSpaceConversion: "none",     // encoded values taken as 8-bit sRGB; no profile conversion
    premultiplyAlpha: "none"
  });
  try {
    const width = bitmap.width, height = bitmap.height;
    if (!admissible(width, height)) {
      return { rejected: width + " × " + height + " PX · " + MIN_SIDE + " PX MINIMUM" };
    }
    const crop = cropRect(width, height);
    const edges = cellEdges(crop.side, N);
    const acc = newAccumulator(N);

    const strip = document.createElement("canvas");
    strip.width = crop.side;
    strip.height = Math.min(STRIP_ROWS, crop.side);
    const sctx = strip.getContext("2d", { willReadFrequently: true, colorSpace: "srgb", alpha: true });
    sctx.imageSmoothingEnabled = false;
    const local = { x: 0, y: crop.y, side: crop.side };
    for (let y0 = crop.y; y0 < crop.y + crop.side; y0 += STRIP_ROWS) {
      const rows = Math.min(STRIP_ROWS, crop.y + crop.side - y0);
      sctx.fillStyle = PAPER;                 // transparency composites over the paper ground
      sctx.fillRect(0, 0, crop.side, rows);
      sctx.drawImage(bitmap, crop.x, y0, crop.side, rows, 0, 0, crop.side, rows); // 1:1, no scaling
      const data = sctx.getImageData(0, 0, crop.side, rows).data;
      accumulateStrip(acc, data, crop.side, y0, rows, local, edges);
    }
    strip.width = strip.height = 0;

    const result = derive(finishMeans(acc), crop, width, height);

    // Display-only thumbnail of the read window. Not on the measurement path.
    const thumb = $("#specimen");
    const tctx = thumb.getContext("2d");
    tctx.fillStyle = PAPER; tctx.fillRect(0, 0, thumb.width, thumb.height);
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = "high";
    tctx.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, thumb.width, thumb.height);

    return { result, hash, type: file.type, width, height };
  } finally {
    bitmap.close();
  }
}

async function mount(file) {
  if (!file) return;
  const note = $("#stageNote");
  if (!/^image\//.test(file.type)) {
    note.textContent = "NOT ADMITTED · NOT AN IMAGE FILE"; note.className = "m10 ls14 c-blue";
    return;
  }
  note.textContent = "READING"; note.className = "m10 ls14 c-blue";
  let spec;
  try { spec = await readSpecimen(file); }
  catch (e) { spec = { rejected: "COULD NOT BE DECODED" }; }
  if (spec.rejected) {
    note.textContent = "NOT ADMITTED · " + spec.rejected; note.className = "m10 ls14 c-blue";
    return;
  }
  note.textContent = "NO SPECIMEN MOUNTED"; note.className = "m10 ls14 c-faint";
  state.specimen = spec;
  setText("srcDims", spec.width + " × " + spec.height + " PX");
  const p = spec.result.preliminaryPopulation;
  setText("prelimLine", "16 × 16 · REDUCED FROM THE 32 × 32 CLASSIFICATION · " + p[0] + " / " + p[1] + " / " + p[2]);
  setPhase("acquired");
  revealPreviews();
}

function withdraw() {
  cancelAnimationFrame(constructRaf);
  cancelAnimationFrame(revealRaf);
  state.specimen = null;
  state.run = null;
  reveal = 1;
  const thumb = $("#specimen");
  thumb.getContext("2d").clearRect(0, 0, thumb.width, thumb.height);
  const note = $("#stageNote");
  note.textContent = "NO SPECIMEN MOUNTED"; note.className = "m10 ls14 c-faint";
  setPhase("ready");
}

// ---- selection ----------------------------------------------------------------

function setDeriv(d) {
  state.deriv = d;
  for (const el of $$(".reading.pick")) {
    const on = el.dataset.deriv === d;
    el.setAttribute("aria-pressed", String(on));
    el.querySelector(".sel").hidden = !on;
  }
  setText("derivWord", DERIVATION_WORD[d]);
  paintPreviews();
}

function setField(f) {
  state.field = f;
  for (const b of $$(".seg button")) b.setAttribute("aria-pressed", String(b.dataset.field === f));
  setText("fieldWord", f === "dark" ? "DARK" : "LIGHT");
  paintPreviews();
}

// ---- issuance -----------------------------------------------------------------

function nextSeq() {
  let seq = 0;
  try { seq = parseInt(localStorage.getItem(SEQ_KEY) || "0", 10) || 0; } catch (e) { /* no storage: counter restarts */ }
  seq += 1;
  try { localStorage.setItem(SEQ_KEY, String(seq)); } catch (e) { /* ignore */ }
  return seq;
}

// Authorised issuance measures nothing. It freezes the selection, takes the
// stored matrix, reads its inspection figures, and begins drawing.
function authorise() {
  const spec = state.specimen;
  if (!spec || state.phase !== "auth") return;
  const seq = nextSeq();
  const issuedAt = new Date();
  const deriv = state.deriv, field = state.field;
  const inspection = inspect(spec.result.bands, spec.result.population, deriv, OUTPUT_PX, N);
  const record = buildRecord({ seq, issuedAt, derivation: deriv, field, sourceHash: spec.hash, sourceType: spec.type, result: spec.result });
  state.run = { seq, id: issueId(seq), issued: stampDate(issuedAt), deriv, field, inspection, record, drawn: 0 };

  setText("runId", state.run.id);
  setText("runDeriv", DERIVATION_WORD[deriv]);
  setText("runField", field === "dark" ? "DARK" : "LIGHT");
  setText("issued", state.run.issued);
  setText("markName", DERIVATION_NAME[deriv]);
  const m = inspection;
  setText("popLine", m.population.join(" / "));
  setText("rangeLine", spec.result.clip.lo.toFixed(3) + " → " + spec.result.clip.hi.toFixed(3) + " · CLIPPED 2–98 %");
  setText("covLine", m.coverage.toFixed(3) + " OF THE PLATE");
  setText("sepLine", m.separation.toFixed(3) + " · " + Math.round(m.separationPx) + " PX OF " + m.cellPx + " PER CELL");
  setText("verdict", m.separable ? "PLATE ACCEPTED · BANDS SEPARABLE AT ISSUE SIZE" : "PLATE ACCEPTED · LOWEST STEP UNDER TWO PIXELS PER CELL");

  setPhase("running");
  construct();
}

// ---- construction -------------------------------------------------------------

// Reports exactly what is on the visible plate: the count comes back from the
// renderer as the number of cells it committed on this frame.
function paintRunning() {
  const run = state.run, spec = state.specimen;
  const s = surface($("#plateRunning"));
  if (!run || !spec || !s) return;
  const committed = renderConstruction(s.ctx, s.size, spec.result.bands, N, run.deriv, run.field === "dark", run.drawn);
  setText("cellLine", "CONSTRUCTING PLATE / " + committed + " OF " + CELLS);
  setText("drawnLine", committed + " / " + CELLS);
  return committed;
}

function paintDone() {
  const run = state.run, spec = state.specimen;
  const s = surface($("#plateDone"));
  if (!run || !spec || !s) return;
  renderPlate(s.ctx, s.size, spec.result.bands, N, run.deriv, run.field === "dark");
}

function construct() {
  cancelAnimationFrame(constructRaf);
  const t0 = performance.now(), span = CONSTRUCTION_MS / PACE;
  const step = now => {
    const run = state.run;
    if (!run || state.phase !== "running") return;
    run.drawn = Math.min(CELLS, Math.floor(CELLS * (now - t0) / span));
    const committed = paintRunning();
    if (committed >= CELLS) { setPhase("done"); return; }
    constructRaf = requestAnimationFrame(step);
  };
  state.run.drawn = 0;
  paintRunning();
  constructRaf = requestAnimationFrame(step);
}

// ---- export -------------------------------------------------------------------

// The 1024 px representation is re-rendered from the matrix, never scaled from
// the screen. The issued record rides inside the PNG as a text chunk.
async function save() {
  const run = state.run, spec = state.specimen;
  if (!run || !spec) return;
  const c = document.createElement("canvas");
  c.width = c.height = OUTPUT_PX;
  renderPlate(c.getContext("2d"), OUTPUT_PX, spec.result.bands, N, run.deriv, run.field === "dark");
  const blob = await new Promise(res => c.toBlob(res, "image/png"));
  const png = new Uint8Array(await blob.arrayBuffer());
  const out = embedRecord(png, run.record);
  const url = URL.createObjectURL(new Blob([out], { type: "image/png" }));
  const a = document.createElement("a");
  a.download = run.id.replace(/–/g, "-") + "_" + run.deriv + "_" + run.field + "_" + OUTPUT_PX + ".png";
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- phases -------------------------------------------------------------------

function setPhase(phase) {
  state.phase = phase;
  page.dataset.phase = phase;
  for (const el of $$(".screen")) el.hidden = el.dataset.screen !== phase;
  $("#preRun").hidden = !(phase === "ready" || phase === "acquired" || phase === "auth");
  $("#barIdle").hidden = phase !== "ready";
  $("#barLive").hidden = phase !== "acquired";
  setText("headRight", phase === "running" ? "MPA–01 · ISSUING" : phase === "done" ? "MPA–01 · ISSUE CLOSED" : "MPA–01 · OPERATIONAL");
  // Surfaces that just became visible need a fit before their first paint.
  requestAnimationFrame(() => {
    for (const c of $$("canvas[data-preview], #plateRunning, #plateDone")) {
      if (c.offsetParent !== null || c.getClientRects().length) { fitCanvas(c); paintCanvas(c); }
    }
  });
}

// ---- wiring -------------------------------------------------------------------

const stage = $("#stage"), fileInput = $("#file");
stage.addEventListener("click", () => fileInput.click());
stage.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", e => { mount(e.target.files && e.target.files[0]); e.target.value = ""; });
stage.addEventListener("dragover", e => { e.preventDefault(); stage.classList.add("over"); });
stage.addEventListener("dragleave", e => { e.preventDefault(); stage.classList.remove("over"); });
stage.addEventListener("drop", e => {
  e.preventDefault(); stage.classList.remove("over");
  mount(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
});

for (const el of $$(".reading.pick")) {
  el.addEventListener("click", () => setDeriv(el.dataset.deriv));
  el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDeriv(el.dataset.deriv); } });
}
for (const b of $$(".seg button")) b.addEventListener("click", () => setField(b.dataset.field));

for (const b of $$('[data-act="toAuth"]')) b.addEventListener("click", () => { if (state.specimen && state.phase === "acquired") setPhase("auth"); });
for (const b of $$('[data-act="cancelAuth"]')) b.addEventListener("click", () => { if (state.phase === "auth") setPhase("acquired"); });
$("#authorise").addEventListener("click", authorise);
$("#withdraw").addEventListener("click", withdraw);
$("#save").addEventListener("click", save);
$("#again").addEventListener("click", () => { withdraw(); window.scrollTo(0, 0); });

setText("stamp", "PROB–" + stampDate(new Date()));
setDeriv(state.deriv);
setField(state.field);
setPhase("ready");
