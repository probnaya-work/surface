// PROB–MPA–01 · APPARATUS
//
// Active generator: canonical TURN 2. One source photograph and two manual
// pupil registrations produce a fixed registered 1024 px read, one 16 × 16
// luminance lattice, and two independently ranked matrices:
// MEASURED / AS-READ and RECONSTRUCTED / ANFAS.
//
// Five operations in fixed order: INPUT · REGISTRATION · MEASUREMENT ·
// INSPECTION · ISSUE. Payment authorises issuance only. The source image and
// all measurement stay in this browser; Stripe receives only a commitment hash
// and attempt id.
//
// The issue is digital. PORTRAIT / RECORD / MARKS are shown as the three A4
// faces of the printable issue package; the apparatus neither prints nor posts
// them, and production package assembly is separate infrastructure.

import {
  TURN2_BLUE, TURN2_CELLS, TURN2_DERIVATION_VERSION, TURN2_INK,
  TURN2_INTERNAL_SIZE, TURN2_MARKS, TURN2_N, TURN2_PAPER, TURN2_RAMP,
  TURN2_REGISTRATION, TURN2_WINDOW_IPD, TURN2_EYE_Y, framingGeometry,
  registerAndRead, registrationCell as turn2RegistrationCell, renderTurn2Plate
} from "./turn2.js";
import {
  ISSUANCE_PROTOCOL, buildDraft, buildRecord, canonicalJson, embedRecord,
  issueId, parseMatrix, stampDate
} from "./record.js";

const OUTPUT_PX = 1024;
const PRINCIPAL_MARK = "2c";

// Which canonical framings production presents. RECONSTRUCTED / ANFAS is a
// dormant capability, not a removed one: the generator still derives it, the
// draft still commits it, and the issued record still carries it. Only its
// presentation is withheld. Restore this to ["asread", "anfas"] to re-expose
// the framing control, the RECONSTRUCTED verso faces and the divergence rows.
const PUBLIC_FRAMINGS = ["asread"];
const framingPublic = key => PUBLIC_FRAMINGS.includes(key);
const PENDING_KEY = "prob-mpa-pending-issuance-turn2-v1";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const EXPECTED_POPULATION = [52, 51, 51, 51, 51];

// A4 proportion at the resolution the issued faces are previewed with.
const SHEET_W = 630, SHEET_H = 891, SHEET_M = 58;

// Canvas cannot resolve CSS custom properties. The two secondary rules of the
// composed faces are the canonical TURN 2 ramp, not separate colour values.
const TURN2_BORDER = TURN2_RAMP[1];
const TURN2_GREY = TURN2_RAMP[3];

const MARK_NOTES = {
  "2a": "FLAT CELL · TONE = LEVEL",
  "2b": "DISC · DIAMETER = LEVEL",
  "2c": "CENTRED SQUARE · SIDE = LEVEL",
  "2d": "SQUARE OUTLINE · SIDE = LEVEL",
  "2e": "BAR FROM LEFT · LENGTH = LEVEL",
  "2f": "STACKED RULES · COUNT = LEVEL",
  "2g": "TWO-TONE PANEL · INNER SQUARE",
  "2h": "INK ONLY AT LEVEL 4"
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const setText = (name, value) => {
  for (const element of $$('[data-t="' + name + '"]')) element.textContent = value;
};

const page = $("#page");

const state = {
  phase: "ready",
  specimen: null,
  pupils: { right: null, left: null },
  result: null,
  run: null,
  framing: PUBLIC_FRAMINGS[0],
  mark: PRINCIPAL_MARK,
  session: null,
  hover: null,
  fit: null
};

const framingLabel = key => (key === "asread" ? "MEASURED" : "RECONSTRUCTED");
const levelsOf = key => state.result && state.result.framings[key].levels;
const populationOf = key => Array.from(state.result.framings[key].population).join(" / ");

function divergence() {
  const measured = levelsOf("asread"), reconstructed = levelsOf("anfas");
  if (!measured || !reconstructed) return 0;
  let count = 0;
  for (let i = 0; i < TURN2_CELLS; i++) if (measured[i] !== reconstructed[i]) count++;
  return count;
}

// Every representation is rendered from a canonical matrix, never by scaling a
// plate bitmap. This is the offscreen surface the composed A4 faces draw from.
function plateCanvas(levels, markId, pixels) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = pixels;
  renderTurn2Plate(canvas.getContext("2d"), pixels, levels, markId);
  return canvas;
}

// ---- source presentation and manual pupil registration ----------------------

function pupilsObject() {
  const { right, left } = state.pupils;
  if (!right || !left) throw new Error("place both pupil registrations first");
  return { rx: right.x, ry: right.y, lx: left.x, ly: left.y };
}

function sourceCanvasSize(canvas, image) {
  const width = Math.max(200, Math.round(canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 420));
  const ratio = Math.min(1.2, Math.max(0.6, image.height / image.width));
  return { width, height: Math.round(width * ratio) };
}

// The window drawn over the photograph is the geometry the engine reads with:
// a square of 4.2 × IPD, rotated so the interpupillary line is horizontal, with
// the eye line at 0.40 of its height.
function windowFrame(a, b) {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const side = TURN2_WINDOW_IPD * Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [Math.cos(angle), Math.sin(angle)];
  const v = [-Math.sin(angle), Math.cos(angle)];
  const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const origin = [
    midpoint[0] - (side / 2) * u[0] - TURN2_EYE_Y * side * v[0],
    midpoint[1] - (side / 2) * u[1] - TURN2_EYE_Y * side * v[1]
  ];
  const at = (along, down) => [origin[0] + along * u[0] + down * v[0], origin[1] + along * u[1] + down * v[1]];
  return { side, at };
}

function strokeWindow(ctx, frame) {
  const { side, at } = frame;
  ctx.strokeStyle = "rgba(22,24,28,0.13)";
  ctx.lineWidth = 1;
  for (let i = 1; i < TURN2_N; i++) {
    const t = i * side / TURN2_N;
    const [ax, ay] = at(t, 0), [bx, by] = at(t, side);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const [cx, cy] = at(0, t), [dx, dy] = at(side, t);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dx, dy); ctx.stroke();
  }
  ctx.strokeStyle = TURN2_INK;
  ctx.beginPath();
  const corners = [at(0, 0), at(side, 0), at(side, side), at(0, side)];
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = TURN2_BLUE;
  const [ex, ey] = at(0, TURN2_EYE_Y * side), [fx, fy] = at(side, TURN2_EYE_Y * side);
  ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(fx, fy); ctx.stroke();
}

function paintSource(canvas, live) {
  const image = state.specimen && state.specimen.source;
  if (!canvas || !image) return;
  const { width: W, height: H } = sourceCanvasSize(canvas, image);
  if (canvas.width !== W * 2 || canvas.height !== H * 2) { canvas.width = W * 2; canvas.height = H * 2; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.fillStyle = TURN2_PAPER;
  ctx.fillRect(0, 0, W, H);
  const pad = live ? 20 : 14;
  const scale = Math.min((W - pad * 2) / image.width, (H - pad * 2) / image.height);
  const w = image.width * scale, h = image.height * scale;
  const dx = Math.round((W - w) / 2), dy = Math.round((H - h) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, dx, dy, w, h);
  ctx.strokeStyle = TURN2_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(dx + 0.5, dy + 0.5, w - 1, h - 1);
  state.fit = { dx, dy, w, h };

  const marked = [state.pupils.right, state.pupils.left].filter(Boolean);
  const points = marked.map(point => [dx + point.x * w, dy + point.y * h]);

  // While registering, a precise crosshair only. The pupil is a point, not a
  // region of the photograph, so nothing about the composition is shaded.
  if (live && points.length < 2 && state.hover) {
    const [hx, hy] = state.hover;
    ctx.strokeStyle = "rgba(34,51,204,0.40)";
    ctx.beginPath();
    ctx.moveTo(dx, Math.round(hy) + 0.5); ctx.lineTo(dx + w, Math.round(hy) + 0.5);
    ctx.moveTo(Math.round(hx) + 0.5, dy); ctx.lineTo(Math.round(hx) + 0.5, dy + h);
    ctx.stroke();
    ctx.strokeStyle = TURN2_BLUE;
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.stroke();
  }

  const complete = points.length === 2;
  if (complete) {
    const frame = windowFrame(points[0], points[1]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, w, h);
    const corners = [frame.at(0, 0), frame.at(frame.side, 0), frame.at(frame.side, frame.side), frame.at(0, frame.side)];
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath();
    ctx.fillStyle = "rgba(239,240,242,0.60)";
    ctx.fill("evenodd");
    ctx.restore();
    strokeWindow(ctx, frame);
  }

  // Ordinals only while one point is still outstanding; once both are placed
  // the window itself carries the meaning.
  points.forEach((point, index) => {
    ctx.strokeStyle = TURN2_BLUE;
    ctx.fillStyle = TURN2_BLUE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(point[0], point[1], complete ? 4.5 : 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(point[0], point[1], 1.4, 0, Math.PI * 2); ctx.fill();
    if (complete) return;
    ctx.beginPath();
    ctx.moveTo(point[0] - 15, point[1]); ctx.lineTo(point[0] - 4, point[1]);
    ctx.moveTo(point[0] + 4, point[1]); ctx.lineTo(point[0] + 15, point[1]);
    ctx.moveTo(point[0], point[1] - 15); ctx.lineTo(point[0], point[1] - 4);
    ctx.moveTo(point[0], point[1] + 4); ctx.lineTo(point[0], point[1] + 15);
    ctx.stroke();
    monoFont(ctx, 10, TURN2_BLUE, 1.4);
    const label = index === 0 ? "01" : "02";
    const textWidth = ctx.measureText(label).width;
    const lx = Math.min(Math.max(point[0] + 13, dx + 4), dx + w - textWidth - 4);
    ctx.fillText(label, lx, Math.max(dy + 14, point[1] - 13));
  });
}

// The registered window as the engine produced it: the same rotated, resampled
// 1024 px surface the 256 readings were taken from.
function paintWindowPanel() {
  const canvas = $("#winPanel");
  const registered = state.result && state.result.canvas;
  if (!canvas || !registered) return;
  const size = canvas.width;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TURN2_PAPER;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(registered, 0, 0, size, size);
  ctx.strokeStyle = "rgba(22,24,28,0.16)";
  ctx.lineWidth = 2;
  for (let i = 1; i < TURN2_N; i++) {
    const t = Math.round(i * size / TURN2_N) + 0.5;
    ctx.beginPath(); ctx.moveTo(t, 0); ctx.lineTo(t, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, t); ctx.lineTo(size, t); ctx.stroke();
  }
  ctx.strokeStyle = TURN2_BLUE;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(size * TURN2_EYE_Y) + 0.5);
  ctx.lineTo(size, Math.round(size * TURN2_EYE_Y) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = TURN2_INK;
  ctx.strokeRect(1, 1, size - 2, size - 2);
}

function placePupil(event) {
  if (!state.fit || !state.specimen || !state.specimen.source) return;
  const { right, left } = state.pupils;
  if (right && left) return;
  const canvas = event.currentTarget;
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * (canvas.width / 2 / bounds.width);
  const y = (event.clientY - bounds.top) * (canvas.height / 2 / bounds.height);
  const point = { x: (x - state.fit.dx) / state.fit.w, y: (y - state.fit.dy) / state.fit.h };
  if (![point.x, point.y].every(value => value >= 0 && value <= 1)) return;
  if (right && point.x <= right.x) {
    setText("srcNote", "ORDER REVERSED · 01 MUST BE IMAGE-LEFT");
    return;
  }
  state.hover = null;
  if (!right) state.pupils.right = point; else state.pupils.left = point;
  renderPhase();
}

function measure() {
  if (!state.specimen || !state.specimen.source) return;
  try {
    const result = registerAndRead(state.specimen.source, pupilsObject());
    const cell = turn2RegistrationCell(result.geometry);
    if (cell.c !== TURN2_REGISTRATION.c || cell.r !== TURN2_REGISTRATION.r) throw new Error("registered pupil did not resolve to [9,6]");
    state.result = result;
    state.framing = PUBLIC_FRAMINGS[0];
    state.mark = PRINCIPAL_MARK;
    setPhase("measured");
  } catch (error) {
    setText("srcNote", "REGISTRATION ERROR · " + (error.message || "CHECK PUPIL POSITIONS").toUpperCase());
  }
}

// ---- mounting ---------------------------------------------------------------

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function admissible(width, height) {
  return Math.min(width, height) >= 512;
}

async function readSpecimen(file) {
  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const source = await createImageBitmap(new Blob([bytes], { type: file.type }), {
    imageOrientation: "from-image",
    colorSpaceConversion: "none",
    premultiplyAlpha: "none"
  });
  if (!admissible(source.width, source.height)) {
    const rejected = `${source.width} × ${source.height} PX · 512 PX MINIMUM`;
    source.close();
    return { rejected };
  }
  return { source, hash, type: file.type, width: source.width, height: source.height };
}

function setStageNote(message, blue = false) {
  const note = $("#stageNote");
  note.textContent = message;
  note.className = blue ? "m10 ls14 c-blue" : "m10 ls14 c-faint";
}

async function mount(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    setStageNote("NOT ADMITTED · NOT AN IMAGE FILE", true);
    return;
  }
  setStageNote("DECODING", true);
  let specimen;
  try { specimen = await readSpecimen(file); }
  catch { specimen = { rejected: "COULD NOT BE DECODED" }; }
  if (specimen.rejected) {
    setStageNote("NOT ADMITTED · " + specimen.rejected, true);
    return;
  }
  clearSpecimen();
  state.specimen = specimen;
  setStageNote("NO SPECIMEN MOUNTED");
  setPhase("source");
}

function clearSpecimen() {
  if (state.specimen && state.specimen.source && typeof state.specimen.source.close === "function") state.specimen.source.close();
  if (state.result && state.result.canvas) state.result.canvas.width = state.result.canvas.height = 0;
  state.specimen = null;
  state.result = null;
  state.pupils = { right: null, left: null };
  state.hover = null;
  state.fit = null;
}

function withdraw() {
  clearPending();
  clearSpecimen();
  state.run = null;
  state.session = null;
  state.framing = PUBLIC_FRAMINGS[0];
  state.mark = PRINCIPAL_MARK;
  setStageNote("NO SPECIMEN MOUNTED");
  setPaymentNote("");
  setAuthorising(false);
  setPhase("ready");
}

// ---- retained issuance draft ------------------------------------------------

function readPending() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY));
    const created = pending && Date.parse(pending.createdAt);
    const validAttempt = pending && typeof pending.attemptId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.attemptId);
    const validSession = pending && (pending.sessionId === null || (typeof pending.sessionId === "string" && pending.sessionId.length <= 255));
    const validHash = pending && typeof pending.draftHash === "string" && /^[a-f0-9]{64}$/.test(pending.draftHash);
    const age = Date.now() - created;
    if (!pending || !validAttempt || !validSession || !validHash || !pending.draft || !Number.isFinite(created) || age < -5 * 60 * 1000 || age > PENDING_TTL_MS) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return pending;
  } catch {
    try { localStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
    return null;
  }
}

function writePending(pending) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  if (!localStorage.getItem(PENDING_KEY)) throw new Error("pending issuance was not retained");
}

function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
}

function setPaymentNote(message, kind = "error") {
  const note = $("#paymentNote");
  note.textContent = message;
  note.dataset.kind = kind;
  note.hidden = !message;
}

function setAuthorising(active) {
  $("#toStripe").hidden = active;
  $("#hold").hidden = !active;
  $("#cancelIssue").disabled = active;
}

async function requestApi(body) {
  const response = await fetch("/api/machine-portrait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !data) {
    const error = new Error(data && data.error ? data.error : "The payment service did not answer.");
    error.code = data && data.code;
    throw error;
  }
  return data;
}

async function draftHash(draft) {
  return sha256Hex(new TextEncoder().encode(canonicalJson(draft)));
}

function exactPopulation(value) {
  return Array.isArray(value) && value.length === 5 && value.every((count, index) => count === EXPECTED_POPULATION[index]);
}

function specimenFromDraft(draft) {
  if (!draft || draft.issuanceProtocol !== ISSUANCE_PROTOCOL || draft.apparatus !== "PROB-MPA-01" || draft.derivationVersion !== TURN2_DERIVATION_VERSION) throw new Error("invalid draft");
  if (!draft.source || !Number.isInteger(draft.source.width) || !Number.isInteger(draft.source.height) || !admissible(draft.source.width, draft.source.height)) throw new Error("invalid source dimensions");
  if (!/^[a-f0-9]{64}$/.test(draft.source.sha256 || "") || typeof draft.source.mediaType !== "string" || draft.source.mediaType.length > 100 || draft.source.retained !== false) throw new Error("invalid source record");
  if (!draft.generator || draft.generator.protocol !== "TURN 2" || draft.generator.deterministic !== true) throw new Error("invalid generator");
  if (!draft.lattice || draft.lattice.n !== TURN2_N || draft.lattice.cells !== TURN2_CELLS) throw new Error("invalid lattice");
  if (!draft.registration || !draft.registration.pupils || !draft.registration.window) throw new Error("invalid registration");
  const right = draft.registration.pupils.subjectRight, left = draft.registration.pupils.subjectLeft;
  if (![right, left].every(point => Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1))) throw new Error("invalid pupils");
  if (draft.registration.window.ipdMultiplier !== TURN2_WINDOW_IPD || draft.registration.window.eyeLine !== TURN2_EYE_Y || draft.registration.window.internalSize !== TURN2_INTERNAL_SIZE) throw new Error("invalid framing");
  if (!Array.isArray(draft.registration.cell) || draft.registration.cell[0] !== TURN2_REGISTRATION.c || draft.registration.cell[1] !== TURN2_REGISTRATION.r) throw new Error("invalid registration cell");
  if (!draft.matrices || !draft.matrices.measured || !draft.matrices.reconstructed) throw new Error("invalid matrices");
  if (draft.matrices.measured.framing !== "AS-READ" || draft.matrices.reconstructed.framing !== "ANFAS" || !exactPopulation(draft.matrices.measured.population) || !exactPopulation(draft.matrices.reconstructed.population)) throw new Error("invalid ranking");
  const measured = parseMatrix(draft.matrices.measured.matrix);
  const reconstructed = parseMatrix(draft.matrices.reconstructed.matrix);
  if (measured.length !== TURN2_CELLS || reconstructed.length !== TURN2_CELLS) throw new Error("invalid matrix size");
  const pupils = { rx: right[0], ry: right[1], lx: left[0], ly: left[1] };
  const geometry = framingGeometry(draft.source.width, draft.source.height, pupils);
  return {
    specimen: { source: null, hash: draft.source.sha256, type: draft.source.mediaType, width: draft.source.width, height: draft.source.height },
    pupils,
    result: {
      canvas: null,
      geometry,
      framings: {
        asread: { levels: measured, population: Uint16Array.from(draft.matrices.measured.population) },
        anfas: { levels: reconstructed, population: Uint16Array.from(draft.matrices.reconstructed.population) }
      }
    }
  };
}

// A draft restored after Checkout carries the canonical matrices but no source
// pixels, so registration and the "what was measured" figures stay unavailable.
function restoreDraft(draft) {
  clearSpecimen();
  const restored = specimenFromDraft(draft);
  state.specimen = restored.specimen;
  state.pupils = {
    right: { x: restored.pupils.rx, y: restored.pupils.ry },
    left: { x: restored.pupils.lx, y: restored.pupils.ly }
  };
  state.result = restored.result;
  return restored;
}

function currentDraft() {
  if (!state.specimen || !state.result) throw new Error("canonical reading is incomplete");
  return buildDraft({
    sourceHash: state.specimen.hash,
    sourceType: state.specimen.type,
    pupils: pupilsObject(),
    result: state.result
  });
}

async function createCheckout() {
  if (!state.result || state.phase !== "checkout") return;
  setPaymentNote("");
  setAuthorising(true);
  try {
    const draft = currentDraft();
    const commitment = await draftHash(draft);
    const retained = readPending();
    const sameAttempt = retained && retained.draft && retained.draft.issuanceProtocol === ISSUANCE_PROTOCOL && retained.draftHash === commitment;
    const pending = {
      attemptId: sameAttempt ? retained.attemptId : crypto.randomUUID(),
      sessionId: sameAttempt ? retained.sessionId : null,
      draftHash: commitment,
      draft,
      createdAt: sameAttempt ? retained.createdAt : new Date().toISOString()
    };
    writePending(pending);
    const result = await requestApi({ action: "create-checkout", attemptId: pending.attemptId, draftHash: pending.draftHash, protocol: ISSUANCE_PROTOCOL });
    if (typeof result.sessionId !== "string" || typeof result.checkoutUrl !== "string") throw new Error("The payment service returned an invalid Checkout Session.");
    pending.sessionId = result.sessionId;
    writePending(pending);
    location.assign(result.checkoutUrl);
  } catch (error) {
    setPaymentNote(error.message || "Checkout could not be opened. Retry with the same issuance.");
    setAuthorising(false);
  }
}

function setVerifyProgress() {
  const note = $("#verifyNote");
  note.textContent = "DO NOT LEAVE THE APPARATUS · THE RECORD IS HELD AND NOTHING IS ISSUED UNTIL THE SESSION VERIFIES";
  note.dataset.kind = "notice";
  $("#verifyActions").hidden = true;
  $$("#verifySteps .stage-row")[1].dataset.state = "now";
  setText("verifyNote2", "IN PROGRESS");
  setText("verifyHead", "RETURNED FROM CHECKOUT · VERIFYING PAID SESSION");
  setText("verifyLine", "THE RECORD IS STILL HELD · NOTHING IS ISSUED UNTIL THE SESSION VERIFIES");
}

function setVerifyFailure(message) {
  const note = $("#verifyNote");
  note.textContent = message;
  note.dataset.kind = "error";
  $("#verifyActions").hidden = false;
  const rows = $$("#verifySteps .stage-row");
  rows[1].dataset.state = "wait";
  setText("verifyNote2", "NOT VERIFIED");
  setText("verifyHead", "VERIFICATION INCOMPLETE · THE RECORD IS STILL HELD");
  setText("verifyLine", "NO ISSUE WAS CREATED · THE PAID SESSION CAN BE VERIFIED AGAIN");
}

async function verifyIssuance(pending, sessionId) {
  if (!pending || !sessionId || state.phase !== "verifying") return;
  setVerifyProgress();
  try {
    if (pending.sessionId && pending.sessionId !== sessionId) throw new Error("Checkout Session does not match the retained issuance.");
    const commitment = await draftHash(pending.draft);
    if (commitment !== pending.draftHash) throw new Error("The retained issuance no longer matches its commitment.");
    pending.sessionId = sessionId;
    writePending(pending);
    const result = await requestApi({ action: "verify-issuance", sessionId, draftHash: commitment, protocol: ISSUANCE_PROTOCOL });
    if (!result.authorized || result.protocol !== ISSUANCE_PROTOCOL || result.draftHash !== commitment || !/^[a-f0-9]{64}$/.test(result.issueDigest || "")) throw new Error("The issuance authorisation was invalid.");
    const issuedAt = new Date(result.issuedAt);
    if (!Number.isFinite(issuedAt.getTime())) throw new Error("The issuance timestamp was invalid.");
    completeIssue(pending.draft, commitment, result.issueDigest, issuedAt);
  } catch (error) {
    setVerifyFailure((error.message || "Payment could not be verified. No issue was created.").toUpperCase());
  }
}

function completeIssue(draft, commitment, identity, issuedAt) {
  if (!state.result) restoreDraft(draft);
  const record = buildRecord({ draft, draftHash: commitment, issueDigest: identity, issuedAt });
  state.run = { id: issueId(identity), issued: stampDate(issuedAt), record };
  setPhase("issued");
}

// ---- issued object faces ----------------------------------------------------

function monoFont(ctx, size, colour, spacing = 1.4) {
  ctx.font = '500 ' + size + 'px "Geist Mono", ui-monospace, Menlo, monospace';
  ctx.fillStyle = colour;
  if ("letterSpacing" in ctx) ctx.letterSpacing = spacing + "px";
}

function sheet(canvas, draw) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TURN2_PAPER;
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  ctx.textBaseline = "alphabetic";
  draw(ctx);
}

function sheetChrome(ctx, left, right, foot) {
  monoFont(ctx, 9.5, TURN2_INK, 1.7);
  ctx.fillText(left, SHEET_M, SHEET_M + 8);
  monoFont(ctx, 9.5, TURN2_GREY, 1.7);
  ctx.fillText(right, SHEET_W - SHEET_M - ctx.measureText(right).width, SHEET_M + 8);
  ctx.fillStyle = TURN2_INK;
  ctx.fillRect(SHEET_M, SHEET_M + 20, SHEET_W - 2 * SHEET_M, 1);
  ctx.fillStyle = TURN2_BORDER;
  ctx.fillRect(SHEET_M, SHEET_H - SHEET_M - 22, SHEET_W - 2 * SHEET_M, 1);
  monoFont(ctx, 8, TURN2_GREY, 1.3);
  ctx.fillText(foot, SHEET_M, SHEET_H - SHEET_M - 8);
}

function runId() {
  return state.run ? state.run.id : "MPA–01";
}

function portraitFace(canvas, framing) {
  const label = framingLabel(framing);
  sheet(canvas, ctx => {
    sheetChrome(ctx, "PORTRAIT · " + label, runId(), "PROBNAYA · MPA–01 · MACHINE PORTRAIT");
    const side = 290;
    const x = Math.round((SHEET_W - side) / 2), top = 262;
    ctx.drawImage(plateCanvas(levelsOf(framing), PRINCIPAL_MARK, OUTPUT_PX), x, top, side, side);
    monoFont(ctx, 8, TURN2_GREY, 1.3);
    ctx.fillText("CONCENTRIC", x, top + side + 26);
    const meta = "4.2 × IPD · EYE LINE 0.40 H";
    ctx.fillText(meta, x + side - ctx.measureText(meta).width, top + side + 26);
    ctx.fillStyle = TURN2_BORDER;
    ctx.fillRect(x, top + side + 36, side, 1);
    monoFont(ctx, 8, TURN2_GREY, 1.3);
    ctx.fillText(label, x, top + side + 54);
  });
}

function matrixBlock(ctx, levels, x, y, title, columnWidth) {
  monoFont(ctx, 8, TURN2_BLUE, 1.4);
  ctx.fillText(title, x, y);
  ctx.fillStyle = TURN2_BORDER;
  ctx.fillRect(x, y + 8, columnWidth, 1);
  monoFont(ctx, 8, TURN2_INK, 0);
  const step = columnWidth / TURN2_N;
  for (let r = 0; r < TURN2_N; r++) {
    for (let c = 0; c < TURN2_N; c++) ctx.fillText(String(levels[r * TURN2_N + c]), x + c * step, y + 26 + r * 14);
  }
}

// RECORD is one printed face. Both matrices and the provenance that interprets
// them share it, so the issue is five faces across three objects.
function recordFace(canvas) {
  sheet(canvas, ctx => {
    sheetChrome(ctx, "RECORD · MATRICES AND PROVENANCE", runId(), "TWO FRAMINGS OF ONE MEASUREMENT · MACHINE RECORD, NOT A LIKENESS");
    const columnWidth = 210, top = SHEET_M + 72;
    if (framingPublic("anfas")) {
      matrixBlock(ctx, levelsOf("asread"), SHEET_M, top, "MEASURED", columnWidth);
      matrixBlock(ctx, levelsOf("anfas"), SHEET_W - SHEET_M - columnWidth, top, "RECONSTRUCTED", columnWidth);
    } else {
      matrixBlock(ctx, levelsOf("asread"), Math.round((SHEET_W - columnWidth) / 2), top, "MEASURED", columnWidth);
    }
    ctx.fillStyle = TURN2_BORDER;
    ctx.fillRect(SHEET_M, 384, SHEET_W - 2 * SHEET_M, 1);
    const rows = [
      ["ISSUE", runId()],
      ["APPARATUS", "MPA–01 · MACHINE PORTRAIT APPARATUS"],
      ["ISSUED", state.run ? state.run.issued : "—"],
      ["SOURCE", "ONE PHOTOGRAPH · READ, DERIVED FROM, DISCARDED"],
      ["REGISTRATION", "HUMAN · BOTH PUPILS MARKED ON THE PHOTOGRAPH"],
      ["WINDOW", "4.2 × IPD · SQUARE"],
      ["EYE LINE", "0.40 H"],
      ["GRID", "16 × 16 · 256 READINGS"],
      ["LEVELS", "5 · RANK QUANTISED · NEAR-EQUAL"],
      ["POPULATIONS", populationOf("asread")],
      ...(framingPublic("anfas")
        ? [["DIVERGENCE", divergence() + " OF 256 CELLS"], ["FRAMINGS", "MEASURED · RECONSTRUCTED"]]
        : [["FRAMING", "MEASURED"]]),
      ["PRINCIPAL MARK", "CONCENTRIC"],
      ["MARKS", "08 · COMPLETE SET"],
      ["REGISTER", `POINT [${TURN2_REGISTRATION.c}, ${TURN2_REGISTRATION.r}] · ONE SIGNAL REGISTER`],
      ["OBJECTS", "PORTRAIT · RECORD · MARKS"],
      ["DELIVERY", "DIGITAL · PRINTABLE BY THE HOLDER"],
      ["DETERMINISM", "SAME PHOTOGRAPH, SAME REGISTRATION, SAME RECORD"]
    ];
    rows.forEach((row, index) => {
      const y = 402 + index * 18;
      monoFont(ctx, 8, TURN2_GREY, 1.3); ctx.fillText(row[0], SHEET_M, y);
      monoFont(ctx, 8, TURN2_INK, 1.3); ctx.fillText(row[1], SHEET_M + 136, y);
      ctx.fillStyle = TURN2_BORDER;
      ctx.fillRect(SHEET_M, y + 7, SHEET_W - 2 * SHEET_M, 1);
    });
    monoFont(ctx, 8, TURN2_GREY, 1.3);
    ctx.fillText("THE PORTRAIT IS A DERIVATIVE OF ONE PHOTOGRAPH,", SHEET_M, SHEET_H - SHEET_M - 62);
    ctx.fillText("NOT A PICTURE OF A PERSON.", SHEET_M, SHEET_H - SHEET_M - 48);
  });
}

function marksFace(canvas, framing) {
  const label = framingLabel(framing);
  sheet(canvas, ctx => {
    sheetChrome(ctx, "MARKS · " + label, runId(), "EIGHT MARKS · ONE MEASUREMENT · NO MARK HOLDS INFORMATION THE OTHERS LACK");
    const columns = 3, gap = 22;
    const side = Math.floor((SHEET_W - 2 * SHEET_M - gap * (columns - 1)) / columns);
    TURN2_MARKS.forEach((mark, index) => {
      const x = SHEET_M + (index % columns) * (side + gap);
      const y = 150 + Math.floor(index / columns) * (side + 34);
      ctx.drawImage(plateCanvas(levelsOf(framing), mark.id, 512), x, y, side, side);
      ctx.strokeStyle = TURN2_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
      monoFont(ctx, 8, mark.id === PRINCIPAL_MARK ? TURN2_BLUE : TURN2_GREY, 1.3);
      ctx.fillText(mark.name, x, y + side + 14);
    });
  });
}

// ---- export -----------------------------------------------------------------

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// The current web export remains one record-bearing PNG of the principal
// portrait recto. The embedded canonical record contains both matrices and the
// complete PORTRAIT / RECORD / MARKS issue model; production package assembly
// is separate.
async function save() {
  if (!state.run || !state.result) return;
  const blob = await new Promise(resolve => plateCanvas(levelsOf("asread"), PRINCIPAL_MARK, OUTPUT_PX).toBlob(resolve, "image/png"));
  const png = new Uint8Array(await blob.arrayBuffer());
  const output = embedRecord(png, state.run.record);
  download(new Blob([output], { type: "image/png" }), `${state.run.id.replace(/–/g, "-")}_portrait_concentric_measured_recto_${OUTPUT_PX}.png`);
  clearPending();
}

function saveRecord() {
  if (!state.run) return;
  download(new Blob([JSON.stringify(state.run.record, null, 2)], { type: "application/json" }), `${state.run.id.replace(/–/g, "-")}_record.json`);
}

// ---- mark strip -------------------------------------------------------------

function buildMarkStrip() {
  const strip = $("#markStrip");
  for (const mark of TURN2_MARKS) {
    const item = document.createElement("div");
    item.className = "reading pick";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.dataset.mark = mark.id;
    item.title = "Enlarge " + mark.name;
    item.innerHTML =
      '<div class="thumb"><canvas width="256" height="256"></canvas></div>' +
      '<div class="lab"><span class="name"><span class="dot"></span></span><span class="sub"></span></div>';
    item.querySelector(".name").append(document.createTextNode(""));
    strip.append(item);
    const choose = () => { state.mark = mark.id; renderPhase(); };
    item.addEventListener("click", choose);
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); }
    });
  }
}

function paintMarkStrip() {
  for (const item of $$("#markStrip .reading")) {
    const id = item.dataset.mark;
    const mark = TURN2_MARKS.find(entry => entry.id === id);
    const selected = id === state.mark;
    item.setAttribute("aria-pressed", String(selected));
    item.querySelector(".name").lastChild.textContent = mark.id === PRINCIPAL_MARK ? mark.name + " · PRINCIPAL" : mark.name;
    item.querySelector(".sub").textContent = MARK_NOTES[id];
    const thumb = item.querySelector(".thumb");
    let selection = thumb.querySelector(".sel");
    if (selected && !selection) { selection = document.createElement("div"); selection.className = "sel"; thumb.append(selection); }
    if (!selected && selection) selection.remove();
    const canvas = item.querySelector("canvas");
    renderTurn2Plate(canvas.getContext("2d"), canvas.width, levelsOf(state.framing), id);
  }
}

// ---- phases and rendering ---------------------------------------------------

const HEAD_RIGHT = {
  ready: "MPA–01 · OPERATIONAL",
  source: "MPA–01 · SPECIMEN MOUNTED",
  measured: "MPA–01 · RECORD HELD · UNISSUED",
  checkout: "MPA–01 · AWAITING PAYMENT",
  verifying: "MPA–01 · VERIFYING PAYMENT",
  issued: "MPA–01 · ISSUE COMPLETE"
};

const STATUS_WORD = {
  ready: "OPERATIONAL",
  source: "REGISTERING",
  measured: "MEASURED · UNISSUED",
  checkout: "AWAITING PAYMENT",
  verifying: "VERIFYING",
  issued: "ISSUED · PAID"
};

function renderReady() {
  setText("barLeft", "AWAITING INPUT");
}

function renderSource() {
  const { right, left } = state.pupils;
  const placed = (right ? 1 : 0) + (left ? 1 : 0);
  const complete = placed === 2;
  setText("sourceHead", complete ? "REGISTRATION COMPLETE · 2 OF 2" : "REGISTRATION · POINT " + (placed + 1) + " OF 2");
  setText("regInstruction", complete
    ? "Both pupils are marked. The apparatus can now take its single measurement."
    : placed === 1
      ? "Now click the centre of the subject's left pupil."
      : "Click the centre of the subject's right pupil, directly on the photograph.");
  setText("regNowLabel", complete ? "BOTH PUPILS MARKED" : placed === 1 ? "CLICK NOW · 02 SUBJECT LEFT PUPIL" : "CLICK NOW · 01 SUBJECT RIGHT PUPIL");
  setText("regNowSide", complete ? "WINDOW FIXED AT 4.2 × IPD" : "THE SUBJECT'S OWN " + (placed === 1 ? "LEFT" : "RIGHT") + " EYE");
  setText("regState", complete ? "2 OF 2 · COMPLETE" : placed + " OF 2");
  setText("regNote1", right ? "MARKED" : "CLICK NOW");
  setText("regNote2", left ? "MARKED" : right ? "CLICK NOW" : "AWAITING");
  setText("regProse", complete
    ? "The interpupillary line is rotated horizontal and the window is scaled to it. Nothing else is adjustable."
    : "The points are named from the subject's own left and right, so they read mirrored to you. This registration is the only thing the apparatus takes from you.");
  setText("measureGate", placed === 1 ? "AVAILABLE WHEN THE SECOND PUPIL IS MARKED" : "AVAILABLE WHEN BOTH PUPILS ARE MARKED");
  setText("undoLabel", placed === 1 ? "UNDO POINT 01" : "CLEAR REGISTRATION");
  if (complete) setText("srcNote", "TWO POINTS · REGISTERED WINDOW");
  const rows = $$("#regSteps .stage-row");
  rows[0].dataset.state = right ? "done" : "now";
  rows[1].dataset.state = left ? "done" : right ? "now" : "wait";
  $("#measure").hidden = !complete;
  $("#measureGate").hidden = complete;
  $("#undoReg").hidden = placed === 0;
  setText("barLeft", complete ? "REGISTERED · READY TO MEASURE" : "AWAITING REGISTRATION");
  paintSource($("#srcMain"), true);
}

function renderMeasured() {
  const mark = TURN2_MARKS.find(entry => entry.id === state.mark);
  setText("recordLine", "16 × 16 · 256 READINGS · FIVE LEVELS · " + populationOf(state.framing));
  setText("markWord", mark.name);
  setText("readingWord", framingLabel(state.framing));
  setText("levelsRow", "5 · " + populationOf(state.framing));
  setText("registerRow", `POINT [${TURN2_REGISTRATION.c}, ${TURN2_REGISTRATION.r}]`);
  setText("workNote", state.framing === "anfas"
    ? "MIRROR-AVERAGED · " + divergence() + " OF 256 CELLS DIFFER"
    : "ORIENTATION AS MEASURED · ASYMMETRY PRESERVED");
  setText("barLeft", "RECORD HELD · UNISSUED");
  for (const button of $$("#framingSeg button")) button.setAttribute("aria-pressed", String(button.dataset.framing === state.framing));
  const work = $("#workPlate");
  renderTurn2Plate(work.getContext("2d"), work.width, levelsOf(state.framing), state.mark);
  paintMarkStrip();
  const hasSource = Boolean(state.specimen && state.specimen.source);
  $("#measuredSource").hidden = !hasSource;
  $("#backToSource").hidden = !hasSource;
  if (hasSource) {
    paintSource($("#srcPanel"), false);
    paintWindowPanel();
  }
}

function renderCheckout() {
  const hold = $("#holdPlate");
  renderTurn2Plate(hold.getContext("2d"), hold.width, levelsOf("asread"), PRINCIPAL_MARK);
  setText("barLeft", "AWAITING PAYMENT · UNISSUED");
}

function renderVerifying() {
  setText("sessionRef", state.session || "—");
  setText("barLeft", "VERIFYING PAID SESSION");
}

function renderIssued() {
  setText("runId", state.run.id);
  setText("issued", state.run.issued);
  setText("registerRow", `POINT [${TURN2_REGISTRATION.c}, ${TURN2_REGISTRATION.r}]`);
  setText("measuredPop", populationOf("asread"));
  setText("reconstructedPop", populationOf("anfas"));
  setText("divergence", divergence() + " OF 256 CELLS");
  setText("barLeft", "ISSUE COMPLETE · PAID");
  const done = $("#donePlate");
  renderTurn2Plate(done.getContext("2d"), done.width, levelsOf("asread"), PRINCIPAL_MARK);
  portraitFace($("#sheetPortraitA"), "asread");
  recordFace($("#sheetRecord"));
  marksFace($("#sheetMarksA"), "asread");
  if (!framingPublic("anfas")) return;
  portraitFace($("#sheetPortraitB"), "anfas");
  marksFace($("#sheetMarksB"), "anfas");
}

function renderPhase() {
  setText("headRight", HEAD_RIGHT[state.phase]);
  setText("statusWord", STATUS_WORD[state.phase]);
  if (state.phase === "ready") renderReady();
  else if (state.phase === "source") renderSource();
  else if (state.result && state.phase === "measured") renderMeasured();
  else if (state.result && state.phase === "checkout") renderCheckout();
  else if (state.phase === "verifying") renderVerifying();
  else if (state.result && state.run && state.phase === "issued") renderIssued();
}

function setPhase(phase) {
  state.phase = phase;
  page.dataset.phase = phase;
  for (const element of $$(".screen")) element.hidden = element.dataset.screen !== phase;
  $("#barIdle").hidden = phase === "measured";
  $("#barLive").hidden = phase !== "measured";
  renderPhase();
}

// ---- wiring -----------------------------------------------------------------

buildMarkStrip();

// Withholds every presentation of a framing production does not expose. Nothing
// is removed: the gated markup stays in the document and the gated faces stay in
// the code, so widening PUBLIC_FRAMINGS restores all of it.
function applyFramingExposure() {
  const both = framingPublic("anfas");
  for (const element of $$('[data-framing-gate="anfas"]')) element.hidden = !both;
  for (const recto of $$("#sheetPortraitA, #sheetMarksA")) recto.closest(".object-faces").classList.toggle("single", !both);
  setText("introProse", both
    ? "The subject is measured once. That single measurement is held in two framings — the orientation as measured, and the same reading averaged against its own mirror — and each framing is drawn eight ways. Nothing about the record is adjustable."
    : "The subject is measured once. Those 256 readings are ranked against themselves into five levels and drawn eight ways. Nothing about the record is adjustable.");
  setText("footTag", "PROBNAYA · MPA–01 · ONE MEASUREMENT · " + (both ? "TWO FRAMINGS" : "ONE RECORD") + " · EIGHT MARKS");
  setText("faceCount", "THREE A4 OBJECTS · " + (both ? "FIVE" : "THREE") + " PRINTED FACES");
  setText("specStripRecord", both ? "A4 · BOTH MATRICES" : "A4 · MEASURED MATRIX");
  setText("specPortrait", "A4 · CONCENTRIC" + (both ? " · BOTH FACES" : " · MEASURED"));
  setText("specRecord", both ? "A4 · BOTH MATRICES · PROVENANCE" : "A4 · MEASURED MATRIX · PROVENANCE");
  setText("specMarks", "A4 · EIGHT MARKS" + (both ? " · BOTH FACES" : " · MEASURED"));
}

applyFramingExposure();

const stage = $("#stage"), fileInput = $("#file");
stage.addEventListener("click", () => fileInput.click());
stage.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", event => {
  mount(event.target.files && event.target.files[0]);
  event.target.value = "";
});
stage.addEventListener("dragover", event => { event.preventDefault(); stage.classList.add("over"); });
stage.addEventListener("dragleave", event => { event.preventDefault(); stage.classList.remove("over"); });
stage.addEventListener("drop", event => {
  event.preventDefault();
  stage.classList.remove("over");
  mount(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
});

const sourceMain = $("#srcMain");
sourceMain.addEventListener("click", placePupil);
sourceMain.addEventListener("mousemove", event => {
  if (state.phase !== "source" || !state.fit || (state.pupils.right && state.pupils.left)) return;
  const bounds = sourceMain.getBoundingClientRect();
  state.hover = [
    (event.clientX - bounds.left) * (sourceMain.width / 2 / bounds.width),
    (event.clientY - bounds.top) * (sourceMain.height / 2 / bounds.height)
  ];
  paintSource(sourceMain, true);
});
sourceMain.addEventListener("mouseleave", () => {
  if (!state.hover) return;
  state.hover = null;
  paintSource(sourceMain, true);
});

$("#measure").addEventListener("click", measure);
$("#undoReg").addEventListener("click", () => {
  if (state.pupils.left) state.pupils.left = null;
  else state.pupils.right = null;
  setText("srcNote", "");
  renderPhase();
});
$("#backToSource").addEventListener("click", () => {
  if (state.specimen && state.specimen.source) setPhase("source");
});
for (const button of $$("#framingSeg button")) button.addEventListener("click", () => {
  if (!framingPublic(button.dataset.framing)) return;
  state.framing = button.dataset.framing;
  renderPhase();
});
for (const button of $$('[data-act="toIssue"]')) button.addEventListener("click", () => {
  if (state.result && state.phase === "measured") setPhase("checkout");
});
for (const button of $$('[data-act="withdraw"]')) button.addEventListener("click", withdraw);
$("#toStripe").addEventListener("click", createCheckout);
$("#cancelIssue").addEventListener("click", () => { if (state.phase === "checkout") setPhase("measured"); });
$("#retryVerify").addEventListener("click", () => {
  if (state.phase === "verifying") verifyIssuance(readPending(), state.session);
});
$("#save").addEventListener("click", save);
$("#saveRecord").addEventListener("click", saveRecord);
$("#again").addEventListener("click", () => { withdraw(); window.scrollTo(0, 0); });

// Both photograph canvases are sized from their measured box, so a layout
// change has to repaint them.
const sourceResize = new ResizeObserver(() => {
  if (state.phase === "source") paintSource(sourceMain, true);
  else if (state.phase === "measured" && state.specimen && state.specimen.source) paintSource($("#srcPanel"), false);
});
sourceResize.observe(sourceMain);
sourceResize.observe($("#srcPanel"));

function cleanCheckoutQuery(params) {
  params.delete("session_id");
  params.delete("checkout");
  const query = params.toString();
  history.replaceState(history.state, "", location.pathname + (query ? "?" + query : "") + location.hash);
}

async function resumeCheckout() {
  const params = new URLSearchParams(location.search);
  const returnedSession = params.get("session_id");
  const cancelled = params.get("checkout") === "cancelled";
  if (returnedSession || cancelled) cleanCheckoutQuery(params);
  const pending = readPending();
  if (!pending) {
    if (returnedSession) setStageNote("PAYMENT RETURNED · LOCAL ISSUANCE STATE UNAVAILABLE · CONTACT SUPPORT", true);
    return;
  }
  try { restoreDraft(pending.draft); }
  catch {
    clearPending();
    setStageNote("RETAINED ISSUANCE COULD NOT BE READ · CONTACT SUPPORT", true);
    return;
  }
  const sessionId = returnedSession || pending.sessionId;
  if (cancelled || !sessionId) {
    setPhase("checkout");
    if (cancelled) setPaymentNote("CHECKOUT CANCELLED · THE RECORD IS HELD", "notice");
    return;
  }
  state.session = sessionId;
  setPhase("verifying");
  await verifyIssuance(pending, sessionId);
}

setText("stamp", "PROB–" + stampDate(new Date()));
setPhase("ready");
resumeCheckout();

// Composed A4 faces set type on canvas; repaint once the mono face is ready.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderPhase());
