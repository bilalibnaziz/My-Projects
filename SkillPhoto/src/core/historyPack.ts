// Tile-delta history. Every history step is a full snapshot whose layers share pixel buffers with the
// steps around them, so an unchanged layer costs nothing, but a brush stroke on a 24 MP layer keeps a
// whole second copy (96 MB) for undo. Once a step is no longer current, each of its layers whose pixels
// differ from the next step keeps only the 128 px tiles that differ, plus a reference to that layer in
// the next step. Reading the step's `layers` (undo, redo, the History Brush, Transform Again) rebuilds it
// in place, so callers never see the difference.
//
// This relies on a committed canvas never being drawn into afterwards (edits work on a clone, see
// beginPixelEdit). A checksum of the reference is kept and checked on rebuild to catch a violation.

import type { Layer, Snapshot } from './types';
import { cloneCanvas, ctx2d } from './canvas';
import { createTileDelta, applyTileDelta, type PixelBufferDelta } from './pixels';

export const TILE = 128;
/** Layers smaller than this are kept whole (packing them saves little). */
const MIN_PIXELS = 256 * 256;
/** A layer with more than this share of tiles changed is kept whole. */
const MAX_CHANGED = 0.6;

interface PackedPixels {
  layerId: string;
  field: 'canvas' | 'mask';
  /** The step holding the reference pixels (the next newer step at packing time). */
  ref: Snapshot;
  w: number;
  h: number;
  tiles: { x: number; y: number; data: ImageData }[];
  /** Checksum of the reference pixels at packing time. */
  sum: number;
}

interface PackedPixelBuffer {
  layerId: string;
  ref: Snapshot;
  delta: PixelBufferDelta;
}

interface Packed {
  raw: Layer[]; // The step's layers, packed ones without their pixels
  pixels: PackedPixels[];
  pixelBuffers?: PackedPixelBuffer[];
  bytes: number;
}

const packs = new WeakMap<Snapshot, Packed>();

export const isPacked = (s: Snapshot) => packs.has(s);

/** Memory a packed step holds itself: its tiles (its unchanged layers are shared with other steps). */
export const packedBytes = (s: Snapshot) => packs.get(s)?.bytes ?? 0;

/** The raw (still packed) layers of a step, for memory accounting without rebuilding. */
export const rawLayers = (s: Snapshot): Layer[] => packs.get(s)?.raw ?? s.layers;

function checksum(d: Uint32Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 0x01000193);
  return h >>> 0;
}

const pixelsOf = (c: HTMLCanvasElement) => new Uint32Array(ctx2d(c).getImageData(0, 0, c.width, c.height).data.buffer);

/**
 * Packs `older` against `newer` (the next step). Returns true when at least one layer was packed.
 * Never call it on the current step or on one whose pixels might still be drawn into.
 */
export function packStep(older: Snapshot, newer: Snapshot): boolean {
  if (packs.has(older)) return false;
  const next = new Map(rawLayers(newer).map((l) => [l.id, l]));
  const pixels: PackedPixels[] = [];
  const pixelBuffers: PackedPixelBuffer[] = [];
  let bytes = 0;
  const raw = older.layers.map((l) => {
    const n = next.get(l.id);
    if (!n) return l;
    let out = l;
    if (l.pixels && n.pixels) {
      const delta = createTileDelta(l.pixels, n.pixels, MAX_CHANGED);
      if (delta) {
        pixelBuffers.push({ layerId: l.id, ref: newer, delta });
        bytes += delta.tiles.reduce((s, t) => s + t.data.byteLength, 0);
        out = { ...out, pixels: undefined };
      }
    }
    for (const field of ['canvas', 'mask'] as const) {
      const oc = field === 'canvas' ? l.canvas : l.mask?.canvas;
      const nc = field === 'canvas' ? n.canvas : n.mask?.canvas;
      if (!oc || !nc || oc === nc || oc.width !== nc.width || oc.height !== nc.height || oc.width * oc.height < MIN_PIXELS) continue;
      if (field === 'canvas' && (l.x !== n.x || l.y !== n.y)) continue;
      if (field === 'mask' && (l.mask!.x !== n.mask!.x || l.mask!.y !== n.mask!.y)) continue;
      const tiles = changedTiles(oc, nc);
      if (!tiles) continue;
      pixels.push({ layerId: l.id, field, ref: newer, w: oc.width, h: oc.height, tiles: tiles.list, sum: tiles.sum });
      bytes += tiles.list.reduce((s, t) => s + t.data.width * t.data.height * 4, 0);
      out = field === 'canvas' ? { ...out, canvas: undefined } : { ...out, mask: { ...out.mask!, canvas: undefined as unknown as HTMLCanvasElement } };
    }
    return out;
  });
  if (!pixels.length && !pixelBuffers.length) return false;
  packs.set(older, { raw, pixels, pixelBuffers, bytes });
  Object.defineProperty(older, 'layers', {
    configurable: true,
    enumerable: true,
    get(this: Snapshot) {
      return unpack(this);
    },
  });
  return true;
}

// Tiles of `oc` that differ from `nc`, or null when too much changed to be worth it
function changedTiles(oc: HTMLCanvasElement, nc: HTMLCanvasElement): { list: PackedPixels['tiles']; sum: number } | null {
  const w = oc.width;
  const h = oc.height;
  const a = pixelsOf(oc);
  const b = pixelsOf(nc);
  const cols = Math.ceil(w / TILE);
  const rows = Math.ceil(h / TILE);
  const changed: [number, number][] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x1 = Math.min(w, (tx + 1) * TILE);
      const y1 = Math.min(h, (ty + 1) * TILE);
      scan: for (let y = ty * TILE; y < y1; y++) {
        for (let i = y * w + tx * TILE, end = y * w + x1; i < end; i++) {
          if (a[i] !== b[i]) {
            changed.push([tx, ty]);
            break scan;
          }
        }
      }
    }
  }
  if (changed.length > cols * rows * MAX_CHANGED) return null;
  const octx = ctx2d(oc);
  const list = changed.map(([tx, ty]) => {
    const x = tx * TILE;
    const y = ty * TILE;
    return { x, y, data: octx.getImageData(x, y, Math.min(TILE, w - x), Math.min(TILE, h - y)) };
  });
  return { list, sum: checksum(b) };
}

/** Rebuilds a packed step's pixels and turns `layers` back into a plain property. */
function unpack(s: Snapshot): Layer[] {
  const p = packs.get(s);
  if (!p) return (Object.getOwnPropertyDescriptor(s, 'layers')?.value as Layer[]) ?? [];
  const byId = new Map(p.raw.map((l) => [l.id, l]));
  for (const px of p.pixels) {
    const refLayer = px.ref.layers.find((l) => l.id === px.layerId); // May rebuild the reference first
    const refCanvas = px.field === 'canvas' ? refLayer?.canvas : refLayer?.mask?.canvas;
    if (!refCanvas || refCanvas.width !== px.w || refCanvas.height !== px.h) {
      console.error(`history: reference pixels of layer ${px.layerId} are gone; the step can't be rebuilt exactly`);
      continue;
    }
    if (checksum(pixelsOf(refCanvas)) !== px.sum) console.error(`history: reference pixels of layer ${px.layerId} were changed in place`);
    const c = cloneCanvas(refCanvas);
    const ctx = ctx2d(c);
    for (const t of px.tiles) ctx.putImageData(t.data, t.x, t.y);
    const l = byId.get(px.layerId)!;
    byId.set(px.layerId, px.field === 'canvas' ? { ...l, canvas: c } : { ...l, mask: { ...l.mask!, canvas: c } });
  }
  if (p.pixelBuffers) {
    for (const pb of p.pixelBuffers) {
      const refLayer = pb.ref.layers.find((l) => l.id === pb.layerId);
      if (!refLayer?.pixels) {
        console.error(`history: reference pixel buffer of layer ${pb.layerId} is gone`);
        continue;
      }
      const restored = applyTileDelta(refLayer.pixels, pb.delta);
      const l = byId.get(pb.layerId)!;
      byId.set(pb.layerId, { ...l, pixels: restored });
    }
  }
  const layers = p.raw.map((l) => byId.get(l.id)!);
  packs.delete(s);
  Object.defineProperty(s, 'layers', { configurable: true, enumerable: true, writable: true, value: layers });
  return layers;
}

/**
 * Packs the steps from 1 to `keepFrom` − 1 (step 0 is the default History Brush source; the caller keeps
 * the current step and the one before it whole), each against the step after it, skipping `keep`.
 * Oldest first, so each is packed while the step it points at still has its pixels; after every commit
 * only the step that just became old enough is new work.
 */
export function packHistory(history: Snapshot[], keep: Set<Snapshot>, keepFrom: number) {
  for (let i = 1; i < Math.min(keepFrom, history.length - 1); i++) {
    const s = history[i];
    if (keep.has(s) || packs.has(s)) continue;
    packStep(s, history[i + 1]);
  }
}
