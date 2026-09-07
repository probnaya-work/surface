// PROB–MPA–01 · STORE-ONLY ZIP
//
// The ISSUE ARCHIVE is a container, not a compressor: its PNGs are already
// deflated and its text is small, so every entry is stored uncompressed. That
// also keeps the archive byte-reproducible — deflate output is implementation
// defined, stored bytes are not.
//
// Deterministic by construction: entry order is the caller's order, timestamps
// come from the issue date rather than the clock, and nothing else varies.
//
// Pure. No DOM, no browser, no clock.

import { crc32 } from "./record.js";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const VERSION = 20;     // 2.0 · the floor for a stored entry
const STORED = 0;

// MS-DOS date and time. The archive is stamped with the issue date at midnight,
// so two builds of the same issue produce the same bytes.
export function dosStamp(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
  if (!match) throw new Error("archive timestamp needs an ISO date");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1980 || year > 2107) throw new Error("archive timestamp is outside the DOS epoch");
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error("archive timestamp is not a date");
  return { date: ((year - 1980) << 9) | (month << 5) | day, time: 0 };
}

function asciiBytes(value) {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x7f) throw new Error("archive entry names must be ASCII: " + value);
    out[i] = code;
  }
  return out;
}

class Writer {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.at = 0;
  }
  u16(value) { this.view.setUint16(this.at, value, true); this.at += 2; }
  u32(value) { this.view.setUint32(this.at, value >>> 0, true); this.at += 4; }
  raw(chunk) { this.bytes.set(chunk, this.at); this.at += chunk.length; }
}

// entries: [{ name, bytes }] in the order they should appear.
export function zipStore(entries, { isoDate }) {
  const stamp = dosStamp(isoDate);
  const prepared = entries.map(entry => {
    const name = asciiBytes(entry.name);
    return { name, bytes: entry.bytes, crc: crc32(entry.bytes) };
  });

  const localSize = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.bytes.length, 0);
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const writer = new Writer(localSize + centralSize + 22);

  const offsets = [];
  for (const entry of prepared) {
    offsets.push(writer.at);
    writer.u32(LOCAL_SIG);
    writer.u16(VERSION);
    writer.u16(0);                    // no flags; names are ASCII
    writer.u16(STORED);
    writer.u16(stamp.time);
    writer.u16(stamp.date);
    writer.u32(entry.crc);
    writer.u32(entry.bytes.length);   // stored: compressed equals uncompressed
    writer.u32(entry.bytes.length);
    writer.u16(entry.name.length);
    writer.u16(0);                    // no extra field
    writer.raw(entry.name);
    writer.raw(entry.bytes);
  }

  const centralStart = writer.at;
  prepared.forEach((entry, index) => {
    writer.u32(CENTRAL_SIG);
    writer.u16(VERSION);              // version made by
    writer.u16(VERSION);              // version needed
    writer.u16(0);
    writer.u16(STORED);
    writer.u16(stamp.time);
    writer.u16(stamp.date);
    writer.u32(entry.crc);
    writer.u32(entry.bytes.length);
    writer.u32(entry.bytes.length);
    writer.u16(entry.name.length);
    writer.u16(0);                    // extra
    writer.u16(0);                    // comment
    writer.u16(0);                    // disk number
    writer.u16(0);                    // internal attributes
    writer.u32(0);                    // external attributes
    writer.u32(offsets[index]);
    writer.raw(entry.name);
  });

  const centralBytes = writer.at - centralStart;
  writer.u32(END_SIG);
  writer.u16(0);
  writer.u16(0);
  writer.u16(prepared.length);
  writer.u16(prepared.length);
  writer.u32(centralBytes);
  writer.u32(centralStart);
  writer.u16(0);
  return writer.bytes;
}

// Read an archive back through its central directory, verifying every CRC.
// Used by the tests; the apparatus never reads an archive.
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_SIG) end--;
  if (end < 0) throw new Error("no end of central directory");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL_SIG) throw new Error("bad central directory entry");
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = String.fromCharCode(...bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(offset, true) !== LOCAL_SIG) throw new Error("bad local header for " + name);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    const content = bytes.subarray(start, start + size);
    if (crc32(content) !== crc) throw new Error("CRC mismatch for " + name);
    entries.push({ name, bytes: content, crc, compression: view.getUint16(at + 10, true), date: view.getUint16(at + 14, true) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
