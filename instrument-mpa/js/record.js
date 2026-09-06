// PROB–MPA–01 · ISSUED OBJECT RECORD
//
// The canonical data of an issued Machine Portrait: enough to re-render every
// representation without the source photograph. The record travels inside the
// saved PNG as a text chunk, so the plate carries its own derivation data.
//
//   SOURCE → DERIVATION → AUTHORITATIVE MATRIX → SELECTED PARAMETERS
//   → ISSUED OBJECT RECORD → DERIVED REPRESENTATIONS

import { DERIVATION_VERSION } from "./derivation.js";
import { REGISTRATION } from "./geometry.js";

export const APPARATUS = "PROB-MPA-01";
export const OBJECT_TYPE = "MACHINE PORTRAIT";
export const PNG_KEYWORD = "PROBNAYA.MPA-01.RECORD";
export const ISSUANCE_PROTOCOL = "MPA-ISSUANCE/1";

// Presentation only. PROB–MPA is the apparatus' current visible convention,
// not an authoritative global PROBNAYA object namespace. The complete digest
// remains in the record independently of this label.
export function issueId(digest) {
  return "PROB–MPA–" + digest.slice(0, 20).toUpperCase();
}

export function stampDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, ".");
}

// The matrix as a string of 1024 band digits, row-major. Exact and compact.
export function matrixString(bands) {
  let s = "";
  for (let i = 0; i < bands.length; i++) s += bands[i];
  return s;
}

export function parseMatrix(str) {
  if (typeof str !== "string" || !/^[0-4]+$/.test(str)) throw new Error("invalid matrix");
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) - 48;
  return out;
}

// Canonical JSON is used only to commit the locally held issued-object draft.
// Object keys sort recursively; array order is retained.
export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite canonical number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  throw new Error("unsupported canonical value");
}

export function buildDraft({ derivation, field, sourceHash, sourceType, result }) {
  return {
    object: OBJECT_TYPE,
    apparatus: APPARATUS,
    issuanceProtocol: ISSUANCE_PROTOCOL,
    derivationVersion: DERIVATION_VERSION,
    source: {
      sha256: sourceHash,
      mediaType: sourceType,
      width: result.source.width,
      height: result.source.height,
      retained: false
    },
    crop: { x: result.crop.x, y: result.crop.y, side: result.crop.side },
    lattice: { n: result.n, cells: result.n * result.n },
    bands: 5,
    clip: { percentiles: [2, 98], lo: result.clip.lo, hi: result.clip.hi },
    matrix: matrixString(result.bands),
    population: Array.from(result.population),
    parameters: { derivation, field, registration: [REGISTRATION.c, REGISTRATION.r] },
    representations: { web: "1024 PX PNG" }
  };
}

export function buildRecord({ draft, draftHash, issueDigest, issuedAt }) {
  return {
    object: draft.object,
    apparatus: draft.apparatus,
    issue: issueId(issueDigest),
    issueDigest,
    issued: stampDate(issuedAt),
    issuanceProtocol: draft.issuanceProtocol,
    draftHash,
    derivationVersion: draft.derivationVersion,
    source: draft.source,
    crop: draft.crop,
    lattice: draft.lattice,
    bands: draft.bands,
    clip: draft.clip,
    matrix: draft.matrix,
    population: draft.population,
    parameters: draft.parameters,
    representations: draft.representations
  };
}

// ---- PNG text chunk ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

// A PNG iTXt chunk (UTF-8 text) carrying `text` under `keyword`.
export function textChunk(keyword, text) {
  const key = latin1(keyword);
  const body = new TextEncoder().encode(text);
  // keyword, NUL, compression flag 0, compression method 0, language tag "", NUL, translated keyword "", NUL, text
  const data = new Uint8Array(key.length + 1 + 2 + 1 + 1 + body.length);
  let p = 0;
  data.set(key, p); p += key.length;
  data[p++] = 0; data[p++] = 0; data[p++] = 0; data[p++] = 0; data[p++] = 0;
  data.set(body, p);
  const type = latin1("iTXt");
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(type, 0); crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

// Insert a text chunk before IEND. Returns a new byte array; the image data is untouched.
export function embedRecord(pngBytes, record) {
  for (let i = 0; i < 8; i++) if (pngBytes[i] !== PNG_SIG[i]) throw new Error("not a PNG");
  const iend = pngBytes.length - 12; // IEND is always the final 12 bytes
  const chunk = textChunk(PNG_KEYWORD, JSON.stringify(record));
  const out = new Uint8Array(pngBytes.length + chunk.length);
  out.set(pngBytes.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(pngBytes.subarray(iend), iend + chunk.length);
  return out;
}

// Read the record back out of a PNG produced by embedRecord. Returns null if absent.
export function extractRecord(pngBytes) {
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let p = 8;
  while (p + 12 <= pngBytes.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...pngBytes.subarray(p + 4, p + 8));
    if (type === "iTXt") {
      const data = pngBytes.subarray(p + 8, p + 8 + len);
      let k = 0;
      while (k < data.length && data[k] !== 0) k++;
      const keyword = String.fromCharCode(...data.subarray(0, k));
      if (keyword === PNG_KEYWORD) {
        let q = k + 1 + 2; // NUL, flag, method
        while (q < data.length && data[q] !== 0) q++; q++; // language tag
        while (q < data.length && data[q] !== 0) q++; q++; // translated keyword
        return JSON.parse(new TextDecoder().decode(data.subarray(q)));
      }
    }
    p += 12 + len;
  }
  return null;
}
