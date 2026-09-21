'use strict';

// Reads what the publisher needs from an image file without decoding it: the
// format (from its content, not its name), the displayed width and height, and
// whether it still carries metadata that could identify a person, a place, or a
// device. Nothing here changes a file.

const SUPPORTED = { jpeg: ['.jpg', '.jpeg'], png: ['.png'], webp: ['.webp'] };

function detectFormat(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'heif-or-avif';
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

// --- EXIF (TIFF) ------------------------------------------------------------

// Tags that identify a device, a person, a time, or a place. Orientation,
// resolution, and colour tags are harmless and are what the documented exiftool
// command deliberately keeps.
const IFD0_IDENTIFYING = {
  0x010e: 'image description', 0x010f: 'camera make', 0x0110: 'camera model', 0x0131: 'software',
  0x0132: 'date and time', 0x013b: 'artist', 0x013c: 'host computer', 0x8298: 'copyright',
  0x8825: 'GPS position', 0x9c9b: 'title', 0x9c9c: 'comment', 0x9c9d: 'author', 0x9c9e: 'keywords',
};
const EXIF_IDENTIFYING = {
  0x9003: 'original date and time', 0x9004: 'digitised date and time', 0x927c: 'maker note',
  0x9286: 'user comment', 0xa430: 'camera owner', 0xa431: 'camera serial number',
  0xa433: 'lens make', 0xa434: 'lens model', 0xa435: 'lens serial number',
};

function readTiff(tiff) {
  const found = new Set();
  let orientation = 1;
  if (tiff.length < 8) return { orientation, found };
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return { orientation, found };
  const le = order === 'II';
  const u16 = (o) => (o + 2 <= tiff.length ? (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o)) : null);
  const u32 = (o) => (o + 4 <= tiff.length ? (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o)) : null);

  function ifd(offset, names, onEntry) {
    const count = u16(offset);
    if (count === null || count > 1000) return;
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12;
      const tag = u16(at);
      if (tag === null) return;
      if (names[tag]) found.add(names[tag]);
      onEntry(tag, at);
    }
  }

  const first = u32(4);
  if (first !== null) {
    ifd(first, IFD0_IDENTIFYING, (tag, at) => {
      if (tag === 0x0112) orientation = u16(at + 8) || 1;
      if (tag === 0x8769) {
        const sub = u32(at + 8);
        if (sub !== null) ifd(sub, EXIF_IDENTIFYING, () => {});
      }
    });
  }
  return { orientation, found };
}

// --- per format ---------------------------------------------------------------

function probeJpeg(buf) {
  let width = null, height = null, orientation = 1;
  const found = new Set();
  let o = 2;
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) break;
    const marker = buf[o + 1];
    if (marker === 0xff) { o += 1; continue; }
    if (marker === 0xd9 || marker === 0xda) break;          // end of image, start of scan
    if (marker >= 0xd0 && marker <= 0xd7) { o += 2; continue; }
    const len = buf.readUInt16BE(o + 2);
    const seg = buf.subarray(o + 4, o + 2 + len);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && seg.length >= 5) {
      height = seg.readUInt16BE(1);
      width = seg.readUInt16BE(3);
    } else if (marker === 0xe1 && seg.toString('latin1', 0, 6) === 'Exif\0\0') {
      const t = readTiff(seg.subarray(6));
      orientation = t.orientation;
      for (const f of t.found) found.add(f);
    } else if (marker === 0xe1 && seg.toString('latin1', 0, 28).startsWith('http://ns.adobe.com/xap/1.0/')) {
      found.add('XMP metadata');
    } else if (marker === 0xed) {
      found.add('IPTC or Photoshop metadata');
    } else if (marker === 0xfe) {
      found.add('embedded comment');
    }
    o += 2 + len;
  }
  return { width, height, orientation, found };
}

function probePng(buf) {
  const found = new Set();
  let width = null, height = null, orientation = 1;
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR' && data.length >= 8) { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === 'eXIf') { const t = readTiff(data); orientation = t.orientation; for (const f of t.found) found.add(f); }
    else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const key = data.toString('latin1', 0, Math.max(0, data.indexOf(0)));
      found.add(key === 'XML:com.adobe.xmp' ? 'XMP metadata' : `text chunk "${key}"`);
    } else if (type === 'tIME') found.add('modification time');
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  return { width, height, orientation, found };
}

function probeWebp(buf) {
  const found = new Set();
  let width = null, height = null, orientation = 1;
  let o = 12;
  while (o + 8 <= buf.length) {
    const type = buf.toString('latin1', o, o + 4);
    const len = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'VP8X' && data.length >= 10) {
      width = 1 + data.readUIntLE(4, 3);
      height = 1 + data.readUIntLE(7, 3);
    } else if (type === 'VP8 ' && width === null && data.length >= 10) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && width === null && data.length >= 5) {
      const bits = data.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    } else if (type === 'EXIF') {
      const tiff = data.toString('latin1', 0, 6) === 'Exif\0\0' ? data.subarray(6) : data;
      const t = readTiff(tiff);
      orientation = t.orientation;
      for (const f of t.found) found.add(f);
    } else if (type === 'XMP ') found.add('XMP metadata');
    o += 8 + len + (len % 2);
  }
  return { width, height, orientation, found };
}

// Returns { format, width, height, metadata[] } with width and height as the
// image is displayed (EXIF orientations 5–8 turn it a quarter), or
// { format, error } when the file cannot be published.
function probeImage(buf) {
  const format = detectFormat(buf);
  if (!format) return { format: null, error: 'is not a recognisable image' };
  if (!SUPPORTED[format]) return { format, error: `is ${format.toUpperCase()}, which is not published; use JPEG, PNG, or WebP` };
  const probe = { jpeg: probeJpeg, png: probePng, webp: probeWebp }[format](buf);
  if (!probe.width || !probe.height) return { format, error: 'has no readable dimensions' };
  const turned = probe.orientation >= 5 && probe.orientation <= 8;
  return {
    format,
    width: turned ? probe.height : probe.width,
    height: turned ? probe.width : probe.height,
    metadata: [...probe.found].sort(),
  };
}

module.exports = { SUPPORTED, detectFormat, probeImage };
