// Alignment and numeric placement of the active layer (Layer ▸ Align, move-tool X/Y/W/H fields).
//
// Everything works on a layer's *visible* bounds, so a text layer's highlight box or a shape's
// stroke lines up exactly with the canvas edge or the selection, the way it looks on screen.

import type { Layer, Rect } from './types';
import { withLayer } from './types';
import { alphaBounds, createCanvas, ctx2d, rev, unionRect } from './canvas';
import { contentBounds } from './snap';
import { syncTextBounds } from './render';
import { store } from './store';
import { descendants } from './groups';

/** Largest canvas side every browser engine supports. */
export const MAX_CANVAS_SIDE = 16384;

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export const ALIGN_LABELS: Record<AlignEdge, string> = {
  left: 'Align Left Edges',
  hcenter: 'Align Horizontal Centers',
  right: 'Align Right Edges',
  top: 'Align Top Edges',
  vcenter: 'Align Vertical Centers',
  bottom: 'Align Bottom Edges',
};

/** Offset that moves `box` so the given edge (or centre) lines up with `target`. Whole pixels. */
export function alignDelta(box: Rect, target: Rect, edge: AlignEdge): { dx: number; dy: number } {
  switch (edge) {
    case 'left':
      return { dx: Math.round(target.x - box.x), dy: 0 };
    case 'right':
      return { dx: Math.round(target.x + target.width - (box.x + box.width)), dy: 0 };
    case 'hcenter':
      return { dx: Math.round(target.x + target.width / 2 - (box.x + box.width / 2)), dy: 0 };
    case 'top':
      return { dx: 0, dy: Math.round(target.y - box.y) };
    case 'bottom':
      return { dx: 0, dy: Math.round(target.y + target.height - (box.y + box.height)) };
    case 'vcenter':
      return { dx: 0, dy: Math.round(target.y + target.height / 2 - (box.y + box.height / 2)) };
  }
}

/** Patch that translates a layer (and its mask) by whole pixels. */
export function offsetPatch(layer: Layer, dx: number, dy: number): Partial<Layer> {
  return {
    x: layer.x + dx,
    y: layer.y + dy,
    mask: layer.mask ? { ...layer.mask, x: layer.mask.x + dx, y: layer.mask.y + dy } : undefined,
  };
}

// Bounds scan every pixel, so cache them. Pixel layers cache per canvas + revision in *layer-local*
// coordinates, so moving a layer (a new record, same pixels) costs nothing; vector layers per record.
const localBounds = new WeakMap<HTMLCanvasElement, { rev: number; rect: Rect | null }>();
const vectorBounds = new WeakMap<Layer, Rect | null>();

export function layerBounds(layer: Layer | null): Rect | null {
  if (!layer) return null;
  if (layer.kind === 'group') {
    // A group's bounds are its contents', shifted by any pending group offset
    const doc = store.doc;
    if (!doc) return null;
    let box: Rect | null = null;
    for (const d of descendants(doc.layers, layer.id)) {
      const b = d.kind === 'group' ? null : layerBounds(d);
      if (b) box = unionRect(box, b);
    }
    return box ? { ...box, x: box.x + layer.x, y: box.y + layer.y } : null;
  }
  if (layer.kind === 'raster' && layer.canvas) {
    const c = layer.canvas;
    let hit = localBounds.get(c);
    if (!hit || hit.rev !== rev(c)) {
      hit = { rev: rev(c), rect: alphaBounds(c, 8) };
      localBounds.set(c, hit);
    }
    return hit.rect ? { x: hit.rect.x + layer.x, y: hit.rect.y + layer.y, width: hit.rect.width, height: hit.rect.height } : null;
  }
  if (!vectorBounds.has(layer)) vectorBounds.set(layer, contentBounds(layer));
  return vectorBounds.get(layer) ?? null;
}

/** What alignment is relative to: the selection if there is one, otherwise the whole canvas. */
export function alignTarget(): Rect | null {
  const doc = store.doc;
  if (!doc) return null;
  return doc.selection?.bounds ?? { x: 0, y: 0, width: doc.width, height: doc.height };
}

function movable(): Layer | null {
  const layer = store.activeLayer;
  if (!layer) return null;
  if (layer.kind === 'adjustment') {
    store.toast('Adjustment layers cover the whole canvas — nothing to align', 'error');
    return null;
  }
  if (layer.locked) {
    store.toast('Layer is locked', 'error');
    return null;
  }
  return layer;
}

/** Selected layers that can be moved, with their visible bounds. */
function movableSelection(): { layer: Layer; box: Rect }[] {
  return store.selectedLayers
    .filter((l) => l.kind !== 'adjustment' && !l.locked)
    .map((layer) => ({ layer, box: layerBounds(layer) }))
    .filter((x): x is { layer: Layer; box: Rect } => !!x.box);
}

/** Applies per-layer offsets as one undoable step. */
function moveLayers(moves: { layer: Layer; dx: number; dy: number }[], label: string) {
  const doc = store.doc;
  const real = moves.filter((m) => m.dx || m.dy);
  if (!doc || !real.length) return;
  const by = new Map(real.map((m) => [m.layer.id, m]));
  const layers = doc.layers.map((l) => {
    const m = by.get(l.id);
    return m ? withLayer(l, offsetPatch(l, m.dx, m.dy)) : l;
  });
  store.commit(label, { layers }, { icon: 'move' });
}

/**
 * Aligns the active layer to the selection or canvas. With several layers selected (and no pixel
 * selection) they align to each other — the edge of their combined bounds — like Photoshop.
 */
export function alignActive(edge: AlignEdge) {
  const doc = store.doc;
  const many = movableSelection();
  if (doc && many.length > 1 && !doc.selection) {
    const union = many.map((m) => m.box).reduce((a, b) => unionRect(a, b));
    moveLayers(many.map((m) => ({ layer: m.layer, ...alignDelta(m.box, union, edge) })), ALIGN_LABELS[edge]);
    return;
  }
  const layer = movable();
  const target = alignTarget();
  if (!layer || !target) return;
  const box = layerBounds(layer);
  if (!box) return store.toast('Layer is empty', 'error');
  const { dx, dy } = alignDelta(box, target, edge);
  if (!dx && !dy) return;
  store.updateLayer(layer.id, offsetPatch(layer, dx, dy), ALIGN_LABELS[edge], `align:${layer.id}:${Date.now()}`);
}

export type DistributeKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hspace' | 'vspace';

export const DISTRIBUTE_LABELS: Record<DistributeKind, string> = {
  left: 'Distribute Left Edges',
  hcenter: 'Distribute Horizontal Centers',
  right: 'Distribute Right Edges',
  top: 'Distribute Top Edges',
  vcenter: 'Distribute Vertical Centers',
  bottom: 'Distribute Bottom Edges',
  hspace: 'Distribute Horizontal Spacing',
  vspace: 'Distribute Vertical Spacing',
};

/**
 * Offsets that space boxes evenly. The outermost two stay put; the rest move so the chosen edge,
 * centre or gap is equal. Positions round once from the exact value, so error never accumulates.
 * Pure, tested.
 */
export function distributeDeltas(boxes: Rect[], kind: DistributeKind): { dx: number; dy: number }[] {
  const horizontal = kind === 'left' || kind === 'hcenter' || kind === 'right' || kind === 'hspace';
  const pos = (r: Rect) => (horizontal ? r.x : r.y);
  const size = (r: Rect) => (horizontal ? r.width : r.height);
  const key = (r: Rect) => {
    if (kind === 'left' || kind === 'top' || kind === 'hspace' || kind === 'vspace') return pos(r);
    if (kind === 'right' || kind === 'bottom') return pos(r) + size(r);
    return pos(r) + size(r) / 2;
  };
  const order = boxes.map((_, i) => i).sort((a, b) => key(boxes[a]) - key(boxes[b]) || a - b);
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  const n = order.length;
  if (n < 3) return out;
  const first = boxes[order[0]];
  const last = boxes[order[n - 1]];
  const set = (i: number, d: number) => (horizontal ? (out[i].dx = d) : (out[i].dy = d));
  if (kind === 'hspace' || kind === 'vspace') {
    const total = pos(last) + size(last) - pos(first);
    const gap = (total - order.reduce((acc, i) => acc + size(boxes[i]), 0)) / (n - 1);
    let cursor = pos(first);
    for (let k = 0; k < n; k++) {
      const i = order[k];
      if (k > 0 && k < n - 1) set(i, Math.round(cursor) - pos(boxes[i]));
      cursor += size(boxes[i]) + gap;
    }
    return out;
  }
  const a = key(first);
  const step = (key(last) - a) / (n - 1);
  for (let k = 1; k < n - 1; k++) {
    const i = order[k];
    set(i, Math.round(a + step * k - key(boxes[i])));
  }
  return out;
}

export function distributeSelected(kind: DistributeKind) {
  const many = movableSelection();
  if (many.length < 3) return store.toast('Select 3 or more layers to distribute (⌘/Ctrl-click in Layers)', 'error');
  const deltas = distributeDeltas(many.map((m) => m.box), kind);
  moveLayers(many.map((m, i) => ({ layer: m.layer, ...deltas[i] })), DISTRIBUTE_LABELS[kind]);
}

/** Centres the layer (or the selected layers as a group) on both axes. */
export function centerActive() {
  const doc = store.doc;
  const many = movableSelection();
  if (doc && many.length > 1) {
    const union = many.map((m) => m.box).reduce((a, b) => unionRect(a, b));
    const target = alignTarget()!;
    const dx = alignDelta(union, target, 'hcenter').dx;
    const dy = alignDelta(union, target, 'vcenter').dy;
    moveLayers(many.map((m) => ({ layer: m.layer, dx, dy })), 'Center Layers');
    return;
  }
  const layer = movable();
  const target = alignTarget();
  if (!layer || !target) return;
  const box = layerBounds(layer);
  if (!box) return store.toast('Layer is empty', 'error');
  const dx = alignDelta(box, target, 'hcenter').dx;
  const dy = alignDelta(box, target, 'vcenter').dy;
  if (dx || dy) store.updateLayer(layer.id, offsetPatch(layer, dx, dy), 'Center Layer', `align:${layer.id}:${Date.now()}`);
}

function scaleCanvas(src: HTMLCanvasElement, sx: number, sy: number): HTMLCanvasElement {
  const c = createCanvas(Math.max(1, Math.round(src.width * sx)), Math.max(1, Math.round(src.height * sy)));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/**
 * Resizes a layer so its visible bounds become `w`×`h`, keeping the top-left corner fixed.
 * Vector layers stay vector: shapes change geometry, text changes point size. Pixel layers are
 * trimmed to their visible bounds (pixels under 3% opacity are dropped) and resampled.
 */
export function resizedLayer(layer: Layer, box: Rect, w: number, h: number): Layer | null {
  const sx = w / box.width;
  const sy = h / box.height;
  if (!(sx > 0) || !(sy > 0)) return null;
  // Pixel layers (and masks) must stay within what a browser canvas can allocate
  if (layer.kind === 'raster' && Math.max(w, h) > MAX_CANVAS_SIDE) return null;
  if (layer.mask && Math.max(layer.mask.canvas.width * sx, layer.mask.canvas.height * sy) > MAX_CANVAS_SIDE) return null;
  const about = (v: number, s: number, o: number) => o + (v - o) * s;
  const mask = layer.mask
    ? { ...layer.mask, canvas: scaleCanvas(layer.mask.canvas, sx, sy), x: Math.round(about(layer.mask.x, sx, box.x)), y: Math.round(about(layer.mask.y, sy, box.y)) }
    : undefined;
  if (layer.kind === 'shape') {
    return withLayer(layer, { x: about(layer.x, sx, box.x), y: about(layer.y, sy, box.y), width: layer.width * sx, height: layer.height * sy, mask });
  }
  if (layer.kind === 'text' && layer.text) {
    // Type scales uniformly; then re-anchor so the visible top-left stays put
    const s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
    const t = layer.text;
    const text = { ...t, size: t.size * s, tracking: t.tracking * s, stroke: t.stroke * s, boxPad: (t.boxPad ?? 0) * s, boxRadius: (t.boxRadius ?? 0) * s };
    let next = withLayer(layer, { text, mask });
    next = withLayer(next, syncTextBounds(next));
    const nb = contentBounds(next);
    return nb ? withLayer(next, { x: next.x + Math.round(box.x - nb.x), y: next.y + Math.round(box.y - nb.y) }) : next;
  }
  if (layer.kind === 'raster' && layer.canvas) {
    // Resample just the visible pixels into an exact w×h box: scaling the whole canvas would let
    // smoothing bleed a soft pixel past each edge and make the typed size come out 1–2 px off
    const canvas = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    const ctx = ctx2d(canvas);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer.canvas, box.x - layer.x, box.y - layer.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
    return withLayer(layer, { canvas, x: box.x, y: box.y, width: canvas.width, height: canvas.height, mask });
  }
  return null;
}

/** Applies typed X/Y/W/H values from the options bar. */
export function setActiveBounds(patch: Partial<Rect>) {
  const many = movableSelection();
  if (many.length > 1) {
    // Several layers: X / Y move the group's combined bounds
    const union = many.map((m) => m.box).reduce((a, b) => unionRect(a, b));
    const dx = patch.x !== undefined ? Math.round(patch.x - union.x) : 0;
    const dy = patch.y !== undefined ? Math.round(patch.y - union.y) : 0;
    moveLayers(many.map((m) => ({ layer: m.layer, dx, dy })), 'Move Layers');
    return;
  }
  const layer = movable();
  if (!layer) return;
  const box = layerBounds(layer);
  if (!box) return;
  const doc = store.doc!;
  let next: Layer | null = layer;
  if (patch.width !== undefined || patch.height !== undefined) {
    if (layer.kind === 'group') return store.toast('Resize the layers inside the group, or merge it first (⌘E)');
    let w = patch.width ?? box.width;
    let h = patch.height ?? box.height;
    if (store.state.opts.lockAspect) {
      if (patch.width !== undefined) h = (box.height * w) / box.width;
      else w = (box.width * h) / box.height;
    }
    next = resizedLayer(layer, box, Math.max(1, w), Math.max(1, h));
    if (!next) return store.toast(`That size is too large — layers can be at most ${MAX_CANVAS_SIDE} px on a side`, 'error');
    store.commit('Resize Layer', { layers: store.replaceLayer(next, doc.layers) }, { coalesce: `resize:${layer.id}` });
    return;
  }
  const dx = patch.x !== undefined ? Math.round(patch.x - box.x) : 0;
  const dy = patch.y !== undefined ? Math.round(patch.y - box.y) : 0;
  if (dx || dy) store.updateLayer(layer.id, offsetPatch(layer, dx, dy), 'Move Layer', `pos:${layer.id}`);
}

/** Combined bounds of the selected layers (what the options bar shows with several selected). */
export function selectionBounds(): Rect | null {
  const many = movableSelection();
  return many.length ? many.map((m) => m.box).reduce((a, b) => unionRect(a, b)) : null;
}
