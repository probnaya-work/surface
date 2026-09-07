// PROB–MPA–01 · ISSUE ARCHIVE
//
// The complete issued material in practical digital form, assembled in the
// browser after a verified issuance and nowhere else. One archive per issue:
// the canonical record, nine standalone square masters, the three printed
// faces, the wrapper front panel, a manifest and a print sheet.
//
// Two rules shape it. The masters come straight from the canonical measurement
// through turn2.js, and the sheet images are the same Phase 1 display lists at
// a higher density — nothing is cropped or scaled out of anything else. And no
// image carries metadata: record.json is the only place the record lives, and
// the only file exempt from public terminology.
//
// Assembly is sequential and each surface is released as soon as it is encoded,
// so peak memory is one canvas rather than fourteen.

import { renderTurn2Plate } from "./turn2.js";
import { insertPngChunkAfterIHDR, physChunk } from "./record.js";
import {
  ARCHIVE_ENTRIES, ARCHIVE_PATHS, ARCHIVE_PIXELS_PER_METRE, ARCHIVE_PX_PER_MM,
  MANIFEST_PATH, MASTER_PX, archiveRoot, formatManifest, issueView, issuedFaces,
  printAndAssembly, wrapperFront
} from "./issue-package.js";
import { drawFace } from "./issue-render.js";
import { zipStore } from "./zip.js";

const utf8 = new TextEncoder();

// The one serialisation of the canonical record. The archive copy and the
// direct RECORD · JSON download are the same bytes because they are the same
// call; neither sanitises, and there is no second schema.
export const RECORD_JSON_INDENT = 2;
export function recordJson(record) {
  return JSON.stringify(record, null, RECORD_JSON_INDENT);
}

function release(canvas) {
  canvas.width = canvas.height = 0;
}

async function encodePng(canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("the browser could not encode a PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

// A standalone square master: 16 × 16 cells edge to edge, paper ground
// included, no label, rule, caption, margin or padding inside its bounds.
async function masterPng(levels, markId) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = MASTER_PX;
  renderTurn2Plate(canvas.getContext("2d"), MASTER_PX, levels, markId);
  const bytes = await encodePng(canvas);
  release(canvas);
  return bytes;
}

// A complete printed face at trim, carrying its true physical size so a bureau
// placing it at 100 % gets exactly the frozen millimetres.
async function facePng(face) {
  const canvas = document.createElement("canvas");
  drawFace(canvas, face, ARCHIVE_PX_PER_MM);
  const bytes = await encodePng(canvas);
  release(canvas);
  return insertPngChunkAfterIHDR(bytes, physChunk(ARCHIVE_PIXELS_PER_METRE));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildArchive(record, onProgress = () => {}) {
  const view = issueView(record);
  const [portrait, recordSheet, marks] = issuedFaces(view);
  const faces = { portrait, record: recordSheet, marks };
  const wrapper = wrapperFront(view);

  const files = new Map();
  const total = ARCHIVE_PATHS.length;
  let done = 0;
  const add = (path, bytes) => { files.set(path, bytes); onProgress(++done, total, path); };

  for (const entry of ARCHIVE_ENTRIES) {
    if (entry.kind === "record") add(entry.path, utf8.encode(recordJson(record)));
    else if (entry.kind === "master") add(entry.path, await masterPng(view.levels, entry.mark));
    else if (entry.kind === "sheet") add(entry.path, await facePng(faces[entry.face]));
    else if (entry.kind === "wrapper") add(entry.path, await facePng(wrapper));
    else if (entry.kind === "print") add(entry.path, utf8.encode(printAndAssembly(view)));
  }

  // The manifest describes every other file, so it is written last and placed
  // back in its declared position.
  const listed = [];
  for (const path of ARCHIVE_PATHS) {
    if (path === MANIFEST_PATH) continue;
    const bytes = files.get(path);
    listed.push({ path, bytes: bytes.length, sha256: await sha256Hex(bytes) });
  }
  add(MANIFEST_PATH, utf8.encode(formatManifest(view, listed)));

  const root = archiveRoot(view);
  const entries = ARCHIVE_PATHS.map(path => ({ name: `${root}/${path}`, bytes: files.get(path) }));
  return { root, filename: `${root}.zip`, entries, bytes: zipStore(entries, { isoDate: view.date }) };
}
