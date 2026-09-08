// Source admission is deliberately separate from photographic measurement.
// These limits bound browser memory work without changing registration,
// luminance reading, ranking or rendering for admitted photographs. 32 MiB
// caps the encoded buffer before decode; 12000 px rejects pathological long
// edges; 80 MP admits normal 12/24/48/61 MP phone and camera captures while
// bounding the decoded RGBA surface to roughly 320 MiB before canvas overhead.

export const SOURCE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png"]);
export const SOURCE_MAX_BYTES = 32 * 1024 * 1024;
export const SOURCE_MIN_SIDE = 512;
export const SOURCE_MAX_SIDE = 12000;
export const SOURCE_MAX_PIXELS = 80_000_000;

export function sourceFileRejection(file) {
  if (!file || !SOURCE_MIME_TYPES.includes(file.type)) return "JPEG OR PNG ONLY";
  if (!Number.isFinite(file.size) || file.size <= 0) return "EMPTY FILE";
  if (file.size > SOURCE_MAX_BYTES) return "FILE EXCEEDS 32 MIB";
  return null;
}

export function sourceDimensionRejection(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "INVALID IMAGE DIMENSIONS";
  }
  if (Math.min(width, height) < SOURCE_MIN_SIDE) {
    return `${width} × ${height} PX · ${SOURCE_MIN_SIDE} PX MINIMUM`;
  }
  if (width > SOURCE_MAX_SIDE || height > SOURCE_MAX_SIDE) {
    return `IMAGE EXCEEDS ${SOURCE_MAX_SIDE} PX SIDE`;
  }
  if (width * height > SOURCE_MAX_PIXELS) return "IMAGE EXCEEDS 80 MP";
  return null;
}

export function sourceDimensionsAdmissible(width, height) {
  return sourceDimensionRejection(width, height) === null;
}
