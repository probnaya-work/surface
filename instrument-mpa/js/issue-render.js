// PROB–MPA–01 · ISSUE PACKAGE RENDERER
//
// The one consumer of the display lists in issue-package.js. It maps sheet
// millimetres onto pixels at a given density and draws the primitives; it holds
// no layout of its own. The issued-screen preview and, later, the archive sheet
// images are the same lists at different densities — never two implementations.
//
// Mark geometry is drawn by renderTurn2Plate, so turn2.js remains the sole mark
// authority. A plate is rendered at its own native pixel size and placed 1:1;
// it is never cropped from a sheet or scaled by a non-integer factor.

import { renderTurn2Plate } from "./turn2.js";
import { PAPER, PT } from "./issue-package.js";

// Four pixels per millimetre. The only densities this system uses are multiples
// of four, because 108 mm and 36 mm must both land on a whole number of 16-cell
// edges: 108 × 4 = 432 = 16 × 27, and 36 × 4 = 144 = 16 × 9.
export const PREVIEW_PX_PER_MM = 4;

export function sheetPixels(trim, pxPerMm) {
  return { width: Math.round(trim.w * pxPerMm), height: Math.round(trim.h * pxPerMm) };
}

// True when every cell edge of a square placed at this size lands on a whole
// pixel, which is what keeps mark geometry free of anti-aliasing.
export function cellsAreWhole(sizeMm, pxPerMm) {
  const px = sizeMm * pxPerMm;
  return Number.isInteger(px) && px % 16 === 0;
}

function fontOf(item, pxPerMm) {
  const px = item.size * PT * pxPerMm;
  return item.font === "display"
    ? { css: `500 ${px}px Archivo, Helvetica, sans-serif`, spacing: item.track * px }
    : { css: `400 ${px}px "Geist Mono", ui-monospace, Menlo, monospace`, spacing: item.track * px };
}

function drawPlate(ctx, item, pxPerMm) {
  const size = Math.round(item.size * pxPerMm);
  const surface = document.createElement("canvas");
  surface.width = surface.height = size;
  renderTurn2Plate(surface.getContext("2d"), size, item.levels, item.markId);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(surface, Math.round(item.x * pxPerMm), Math.round(item.y * pxPerMm), size, size);
  ctx.imageSmoothingEnabled = smoothing;
  surface.width = surface.height = 0;
}

export function drawList(ctx, items, pxPerMm) {
  ctx.textBaseline = "alphabetic";
  for (const item of items) {
    if (item.type === "rect") {
      ctx.fillStyle = item.fill;
      ctx.fillRect(item.x * pxPerMm, item.y * pxPerMm, item.w * pxPerMm, item.h * pxPerMm);
      continue;
    }
    if (item.type === "plate") { drawPlate(ctx, item, pxPerMm); continue; }
    const font = fontOf(item, pxPerMm);
    ctx.font = font.css;
    ctx.fillStyle = item.fill;
    ctx.textAlign = item.align || "left";
    if ("letterSpacing" in ctx) ctx.letterSpacing = font.spacing + "px";
    ctx.fillText(item.value, item.x * pxPerMm, item.y * pxPerMm);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }
}

// Draw one complete face onto a canvas, sizing the canvas to the trim.
export function drawFace(canvas, face, pxPerMm = PREVIEW_PX_PER_MM) {
  if (!canvas) return null;
  const { width, height } = sheetPixels(face.trim, pxPerMm);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  drawList(ctx, face.items, pxPerMm);
  return { width, height };
}
