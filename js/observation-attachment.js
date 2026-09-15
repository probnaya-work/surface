// Prepares the one attachment an Observation may carry so the whole request fits
// the Vercel Function body limit (4.5 MB; the endpoint refuses above 4.4 MB).
//
// Files within the budget are sent exactly as chosen. Only images over the budget
// are prepared, and the strategy follows what the image is:
//
//   photographs (JPEG, WebP, HEIC where the browser decodes it) are resized to a
//   3,000 px long edge and re-encoded as JPEG, stepping quality down if needed;
//
//   screenshots (PNG) keep sharp text first: lossless PNG at full size, then
//   lossless PNG at gentle reductions that keep a readable resolution, and only
//   then high-quality lossy encodings at full size before any smaller one.
//
// Nothing is uploaded anywhere else, and no file is kept. Re-encoding in a canvas
// drops embedded metadata as a side effect; publication still sanitises media.
(function () {
  'use strict';

  const BUDGET = 3_100_000;            // decoded bytes; mirrors api/observations.js
  const MAX_CANVAS_PIXELS = 16_777_216; // mobile Safari's canvas area limit (4096 × 4096)
  const SCREENSHOT_MIN_EDGE = 1_600;    // lossless reductions stop here

  const PHOTO_STEPS = [
    { edge: 3000, type: 'image/jpeg', quality: 0.86 },
    { edge: 3000, type: 'image/jpeg', quality: 0.78 },
    { edge: 2400, type: 'image/jpeg', quality: 0.80 },
    { edge: 2000, type: 'image/jpeg', quality: 0.78 },
  ];

  // Screenshot steps, ordered by legibility rather than by size.
  const SCREENSHOT_STEPS = [
    { scale: 1,     type: 'image/png' },
    { scale: 0.75,  type: 'image/png' },
    { scale: 2 / 3, type: 'image/png' },
    { scale: 1,     type: 'image/webp', quality: 0.95 },
    { scale: 1,     type: 'image/jpeg', quality: 0.95 },
    { scale: 0.5,   type: 'image/png' },
    { scale: 0.75,  type: 'image/webp', quality: 0.95 },
    { scale: 0.75,  type: 'image/jpeg', quality: 0.95 },
    { scale: 2 / 3, type: 'image/jpeg', quality: 0.92 },
    { scale: 0.5,   type: 'image/jpeg', quality: 0.92 },
  ];

  const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  async function sniff(file) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const ascii = (from, to) => String.fromCharCode(...head.slice(from, to));
    const starts = (bytes) => bytes.every((value, i) => head[i] === value);
    if (starts([0xff, 0xd8, 0xff])) return 'jpeg';
    if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
    if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return 'heic';
    if (ascii(0, 5) === '%PDF-') return 'pdf';
    if (await looksLikeText(file)) return 'text';
    return null;
  }

  async function looksLikeText(file) {
    const sample = new Uint8Array(await file.slice(0, 64_000).arrayBuffer());
    if (sample.includes(0)) return false;
    try {
      // A multi-byte character cut at the sample boundary is not a failure.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: file.size > sample.length });
      return !/[\u0001-\u0008\u000e-\u001f\u007f]/.test(text);
    } catch {
      return false;
    }
  }

  async function decode(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function dimensions(source) {
    return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
  }

  function encode(source, width, height, type, quality) {
    if (width * height > MAX_CANVAS_PIXELS) return Promise.resolve(null);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: type === 'image/png' });
    if (type === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob((blob) => {
      // A browser that cannot encode the requested type returns PNG instead; skip that step.
      resolve(blob && blob.type === type ? blob : null);
    }, type, quality));
  }

  function renamed(name, type) {
    const base = String(name || 'attachment').replace(/\.[^./\\]*$/, '') || 'attachment';
    return `${base}.${EXTENSIONS[type]}`;
  }

  async function tryPhoto(source, file) {
    const { width, height } = dimensions(source);
    for (const step of PHOTO_STEPS) {
      const scale = Math.min(1, step.edge / Math.max(width, height));
      const w = Math.round(width * scale), h = Math.round(height * scale);
      const blob = await encode(source, w, h, step.type, step.quality);
      if (blob && blob.size <= BUDGET) return { blob, name: renamed(file.name, step.type), width: w, height: h, method: `photograph · ${w}×${h} · ${step.type} ${step.quality}` };
    }
    return null;
  }

  async function tryScreenshot(source, file) {
    const { width, height } = dimensions(source);
    const longEdge = Math.max(width, height);
    for (const step of SCREENSHOT_STEPS) {
      const lossless = step.type === 'image/png';
      if (lossless && step.scale < 1 && longEdge * step.scale < SCREENSHOT_MIN_EDGE) continue;
      const w = Math.round(width * step.scale), h = Math.round(height * step.scale);
      const blob = await encode(source, w, h, step.type, step.quality);
      if (blob && blob.size <= BUDGET) return { blob, name: renamed(file.name, step.type), width: w, height: h, method: `screenshot · ${w}×${h} · ${step.type}${step.quality ? ' ' + step.quality : ''}` };
    }
    return null;
  }

  // Resolves to { ok: true, blob, name, prepared, kind, originalBytes, method }
  // or { ok: false, reason: 'empty' | 'unsupported' | 'too_large' }.
  async function prepare(file) {
    if (!file || file.size === 0) return { ok: false, reason: 'empty' };
    const kind = await sniff(file);
    if (!kind) return { ok: false, reason: 'unsupported' };
    if (file.size <= BUDGET) return { ok: true, blob: file, name: file.name, prepared: false, kind, originalBytes: file.size, method: 'unchanged' };
    if (kind === 'pdf' || kind === 'text' || kind === 'gif') return { ok: false, reason: 'too_large', kind };

    let source;
    try {
      source = await decode(file);
    } catch {
      return { ok: false, reason: 'too_large', kind };
    }
    try {
      const result = kind === 'png' ? await tryScreenshot(source, file) : await tryPhoto(source, file);
      if (!result) return { ok: false, reason: 'too_large', kind };
      return { ok: true, prepared: true, kind, originalBytes: file.size, ...result };
    } finally {
      if (source && typeof source.close === 'function') source.close();
    }
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  window.ObservationAttachment = Object.freeze({ BUDGET, prepare, toBase64, sniff });
})();
