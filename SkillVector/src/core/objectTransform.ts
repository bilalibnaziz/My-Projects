// On-canvas object transform: the bounding box the Selection tool draws around the selected
// objects, with handles to resize and rotate them directly.
//
// Every edit stays as editable as the layer allows:
// - shapes change geometry and keep a live `rotation` (still shapes, still editable),
// - text changes point size (or wraps width for paragraph text) and keeps a live rotation,
// - smart objects change their stored transform (re-rendered from the original pixels),
// - pixel layers are resampled once, when the drag ends.
//
// A drag always starts again from the layers as they were when it began, so nothing accumulates
// rounding while the pointer moves.

import type { Layer, Rect } from './types';
import { withLayer } from './types';
import { store } from './store';
import { layerBounds, MAX_CANVAS_SIDE } from './align';
import { descendants, isGroup } from './groups';
import { rerenderSmart } from './smart';
import { syncTextBounds } from './render';
import { createCanvas, ctx2d, releaseScratch, scratch, touch } from './canvas';

type Pt = { x: number; y: number };

/** An oriented box: centre, size, and rotation (radians, clockwise). */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export type FrameHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type FrameHit = FrameHandle | 'rotate' | 'move' | null;

const HANDLES: [FrameHandle, number, number][] = [
  ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0],
  ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0],
];

const DEG = Math.PI / 180;

const rot = (x: number, y: number, a: number): Pt => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });

/** Document point → the frame's local (unrotated, centred) coordinates. */
export function toLocal(f: Frame, p: Pt): Pt {
  return rot(p.x - f.cx, p.y - f.cy, -f.angle);
}

/** Frame-local point → document coordinates. */
export function toDoc(f: Frame, x: number, y: number): Pt {
  const r = rot(x, y, f.angle);
  return { x: f.cx + r.x, y: f.cy + r.y };
}

/** Corners nw, ne, se, sw in document space. */
export function frameCorners(f: Frame): Pt[] {
  return [toDoc(f, -f.w / 2, -f.h / 2), toDoc(f, f.w / 2, -f.h / 2), toDoc(f, f.w / 2, f.h / 2), toDoc(f, -f.w / 2, f.h / 2)];
}

/** Where each of the 8 handles sits, in document space. */
export function frameHandles(f: Frame): { id: FrameHandle; x: number; y: number }[] {
  return HANDLES.map(([id, sx, sy]) => ({ id, ...toDoc(f, (sx * f.w) / 2, (sy * f.h) / 2) }));
}

export function frameAabb(f: Frame): Rect {
  const c = frameCorners(f);
  const x = Math.min(...c.map((p) => p.x));
  const y = Math.min(...c.map((p) => p.y));
  return { x, y, width: Math.max(...c.map((p) => p.x)) - x, height: Math.max(...c.map((p) => p.y)) - y };
}

const rectFrame = (r: Rect): Frame => ({ cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height, angle: 0 });

/** Layers that take part in an object transform: groups contribute their contents. */
export function transformTargets(picked: Layer[]): Layer[] {
  const doc = store.doc;
  if (!doc) return [];
  const out = new Map<string, Layer>();
  for (const l of picked) {
    const list = isGroup(l) ? descendants(doc.layers, l.id) : [l];
    for (const d of list) if (!isGroup(d) && d.kind !== 'adjustment' && !d.locked && d.visible) out.set(d.id, d);
  }
  return [...out.values()];
}

/** The oriented box of one layer: shapes and text use their live geometry, others their pixels. */
export function layerFrame(l: Layer): Frame | null {
  if ((l.kind === 'shape' && l.shape) || (l.kind === 'text' && l.text)) {
    return {
      cx: l.x + l.width / 2,
      cy: l.y + l.height / 2,
      w: Math.abs(l.width),
      h: Math.abs(l.height),
      angle: (l.rotation ?? 0) * DEG,
    };
  }
  if (l.smart && !l.smart.quad && !l.smart.mesh) {
    const s = l.smart;
    return { cx: l.x + s.ax, cy: l.y + s.ay, w: s.source.width * Math.abs(s.scaleX), h: s.source.height * Math.abs(s.scaleY), angle: s.angle };
  }
  const b = layerBounds(l);
  return b ? rectFrame(b) : null;
}

/** The box drawn around a selection: oriented for one object, axis-aligned around several. */
export function selectionFrame(picked: Layer[]): Frame | null {
  const doc = store.doc;
  if (!doc) return null;
  const movable = picked.filter((l) => l.kind !== 'adjustment' && !l.locked);
  if (!movable.length) return null;
  if (movable.length === 1 && !isGroup(movable[0])) return layerFrame(movable[0]);
  let box: Rect | null = null;
  for (const l of transformTargets(movable)) {
    const f = layerFrame(l);
    if (!f) continue;
    const r = frameAabb(f);
    box = box ? union(box, r) : r;
  }
  return box ? rectFrame(box) : null;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/**
 * What the pointer is over: a resize handle, the rotate zone just outside a corner, the box
 * itself (move), or nothing. Tolerances are in screen pixels.
 */
export function frameHit(f: Frame, p: Pt, zoom: number): FrameHit {
  const tol = 6 / zoom;
  const q = toLocal(f, p);
  const hw = f.w / 2;
  const hh = f.h / 2;
  // Tiny boxes: keep the corners grabbable, edge handles would overlap them
  const small = Math.min(f.w, f.h) * zoom < 24;
  for (const [id, sx, sy] of HANDLES) {
    if (small && (sx === 0 || sy === 0)) continue;
    if (Math.abs(q.x - sx * hw) <= tol && Math.abs(q.y - sy * hh) <= tol) return id;
  }
  const inside = Math.abs(q.x) <= hw + tol && Math.abs(q.y) <= hh + tol;
  if (inside) {
    // Edges of large boxes resize along their whole length, like Figma
    if (!small) {
      if (Math.abs(q.y + hh) <= tol / 2) return 'n';
      if (Math.abs(q.y - hh) <= tol / 2) return 's';
      if (Math.abs(q.x + hw) <= tol / 2) return 'w';
      if (Math.abs(q.x - hw) <= tol / 2) return 'e';
    }
    return 'move';
  }
  // Rotate zone: a band just outside each corner
  const band = 22 / zoom;
  for (const [, sx, sy] of HANDLES) {
    if (sx === 0 || sy === 0) continue;
    const dx = (q.x - sx * hw) * sx;
    const dy = (q.y - sy * hh) * sy;
    if (dx >= -tol && dy >= -tol && dx <= band && dy <= band && (dx > 0 || dy > 0)) return 'rotate';
  }
  return null;
}

/** A CSS cursor for a handle, turned to match the box's rotation. */
export function handleCursor(hit: FrameHit, f: Frame | null): string {
  if (!hit) return 'default';
  if (hit === 'move') return 'move';
  if (hit === 'rotate') return ROTATE_CURSOR;
  const base: Record<FrameHandle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const deg = (((base[hit] + (f ? f.angle / DEG : 0)) % 180) + 180) % 180;
  const names = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return names[Math.round(deg / 45) % 4];
}

const ROTATE_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M5 13a7 7 0 1 0 2.5-6.2' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/><path d='M5 13a7 7 0 1 0 2.5-6.2' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/><path d='M3 4.5 8.5 6 6 10.5z' fill='black' stroke='white' stroke-width='1'/></svg>\") 12 12, crosshair";

// ================================================================ dragging

export interface ObjectDrag {
  handle: FrameHandle | 'rotate';
  start: Pt;
  frame: Frame;
  /** Layers exactly as they were when the drag began. */
  layers: Layer[];
  /** Width / height of the starting frame. */
  aspect: number;
  moved: boolean;
}

export interface DragMods {
  /** Keep proportions. */
  ratio: boolean;
  /** Scale about the centre. */
  center: boolean;
  /** Rotation: snap to 15° steps. */
  snap: boolean;
}

export function beginObjectDrag(handle: FrameHandle | 'rotate', start: Pt, picked: Layer[]): ObjectDrag | null {
  const frame = selectionFrame(picked);
  const layers = transformTargets(picked);
  if (!frame || !layers.length) return null;
  return { handle, start, frame, layers, aspect: frame.h ? frame.w / frame.h : 1, moved: false };
}

/** An affine map from the drag's starting frame to where the pointer has taken it. */
interface Mapping {
  apply(p: Pt): Pt;
  /** Rotation added to every object (radians). */
  da: number;
  /** Scale along the frame's own axes. */
  sx: number;
  sy: number;
  /** The frame's axis angle (scales happen along it). */
  axis: number;
  frame: Frame;
}

export function dragMapping(d: ObjectDrag, p: Pt, m: DragMods): Mapping {
  const f = d.frame;
  if (d.handle === 'rotate') {
    let da = Math.atan2(p.y - f.cy, p.x - f.cx) - Math.atan2(d.start.y - f.cy, d.start.x - f.cx);
    if (m.snap) da = Math.round((f.angle + da) / (15 * DEG)) * (15 * DEG) - f.angle;
    return {
      apply: (q) => {
        const r = rot(q.x - f.cx, q.y - f.cy, da);
        return { x: f.cx + r.x, y: f.cy + r.y };
      },
      da,
      sx: 1,
      sy: 1,
      axis: f.angle,
      frame: { ...f, angle: f.angle + da },
    };
  }
  const h = d.handle;
  const delta = rot(p.x - d.start.x, p.y - d.start.y, -f.angle);
  let l = -f.w / 2;
  let r = f.w / 2;
  let t = -f.h / 2;
  let b = f.h / 2;
  if (h.includes('e')) r += delta.x;
  if (h.includes('w')) l += delta.x;
  if (h.includes('s')) b += delta.y;
  if (h.includes('n')) t += delta.y;
  if (m.center) {
    if (h.includes('e')) l -= delta.x;
    if (h.includes('w')) r -= delta.x;
    if (h.includes('s')) t -= delta.y;
    if (h.includes('n')) b -= delta.y;
  }
  // Never collapse or turn inside out
  const minW = Math.min(1, f.w);
  const minH = Math.min(1, f.h);
  if (r - l < minW) {
    if (h.includes('w')) l = r - minW;
    else r = l + minW;
  }
  if (b - t < minH) {
    if (h.includes('n')) t = b - minH;
    else b = t + minH;
  }
  let w = r - l;
  let hh = b - t;
  if (m.ratio && f.w > 0 && f.h > 0) {
    const corner = h.length === 2;
    let k: number;
    if (corner) k = Math.max(w / f.w, hh / f.h);
    else k = h === 'e' || h === 'w' ? w / f.w : hh / f.h;
    const nw = f.w * k;
    const nh = f.h * k;
    // Grow away from the anchored side (or about the centre)
    if (m.center) {
      l = -nw / 2;
      r = nw / 2;
      t = -nh / 2;
      b = nh / 2;
    } else {
      if (h.includes('w')) l = r - nw;
      else if (h.includes('e')) r = l + nw;
      else {
        l = -nw / 2;
        r = nw / 2;
      }
      if (h.includes('n')) t = b - nh;
      else if (h.includes('s')) b = t + nh;
      else {
        t = -nh / 2;
        b = nh / 2;
      }
    }
    w = nw;
    hh = nh;
  }
  const sx = f.w > 0.5 ? w / f.w : 1;
  const sy = f.h > 0.5 ? hh / f.h : 1;
  const c = toDoc(f, (l + r) / 2, (t + b) / 2);
  return {
    apply: (q) => {
      const loc = toLocal(f, q);
      const out = rot(loc.x * sx, loc.y * sy, f.angle);
      return { x: c.x + out.x, y: c.y + out.y };
    },
    da: 0,
    sx,
    sy,
    axis: f.angle,
    frame: { cx: c.x, cy: c.y, w: f.w * sx, h: f.h * sy, angle: f.angle },
  };
}

/** How a layer's own width / height scale when the frame scales by (sx, sy) along `axis`. */
function ownScale(layerAngle: number, map: Mapping): { kx: number; ky: number } {
  const th = layerAngle - map.axis;
  const c = Math.cos(th);
  const s = Math.sin(th);
  // Length of the layer's local axes after the frame's scale (exact when the axes line up)
  return { kx: Math.hypot(map.sx * c, map.sy * s), ky: Math.hypot(map.sx * s, map.sy * c) };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const normDeg = (deg: number) => {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Math.abs(d) < 1e-6 ? undefined : r2(d);
};

/** The layer `l` (as it was when the drag began) put through the mapping. */
export function mappedLayer(l: Layer, map: Mapping, final: boolean, handle: ObjectDrag['handle'] = 'se', single = false): { layer: Layer; preview?: { canvas: HTMLCanvasElement; x: number; y: number } } {
  const f = layerFrame(l);
  if (!f) return { layer: l };
  const c = map.apply({ x: f.cx, y: f.cy });
  const { kx, ky } = ownScale(f.angle, map);
  const angle = f.angle + map.da;
  if (l.kind === 'shape' && l.shape) {
    const width = l.width * kx;
    const height = l.height * ky;
    return { layer: withLayer(l, { x: c.x - width / 2, y: c.y - height / 2, width, height, rotation: normDeg(angle / DEG) }) };
  }
  if (l.kind === 'text' && l.text) {
    const t = l.text;
    let text = t;
    if (map.da === 0) {
      // A paragraph box dragged by a side handle re-wraps; everything else scales the type
      if (single && t.boxWidth && (handle === 'e' || handle === 'w')) text = { ...t, boxWidth: Math.max(8, Math.round(t.boxWidth * kx)) };
      else {
        const k = handle === 'e' || handle === 'w' ? kx : handle === 'n' || handle === 's' ? ky : Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky;
        text = {
          ...t,
          size: Math.max(1, r2(t.size * k)),
          tracking: r2(t.tracking * k),
          stroke: r2(t.stroke * k),
          boxPad: t.boxPad !== undefined ? r2(t.boxPad * k) : undefined,
          boxRadius: t.boxRadius !== undefined ? r2(t.boxRadius * k) : undefined,
          boxWidth: t.boxWidth ? Math.max(8, Math.round(t.boxWidth * k)) : undefined,
        };
      }
    }
    const sized = withLayer(l, { text });
    const { width, height } = syncTextBounds(sized);
    return { layer: withLayer(sized, { width, height, x: c.x - width / 2, y: c.y - height / 2, rotation: normDeg(angle / DEG) }) };
  }
  if (l.smart) {
    const s = l.smart;
    const shift = (pts?: Pt[]) => pts?.map((p) => {
      const q = map.apply({ x: p.x + l.x, y: p.y + l.y });
      return { x: q.x - l.x, y: q.y - l.y };
    });
    const smart = s.quad || s.mesh
      ? { ...s, ax: c.x - l.x, ay: c.y - l.y, quad: shift(s.quad), mesh: shift(s.mesh) }
      : { ...s, scaleX: s.scaleX * kx, scaleY: s.scaleY * ky, angle, ax: c.x - l.x, ay: c.y - l.y };
    return { layer: rerenderSmart(l, smart) };
  }
  if (l.kind === 'raster' && l.canvas) {
    const out = map.da === 0 && Math.abs(Math.sin(map.axis * 2)) < 1e-9
      ? scalePixels(l, map, final ? null : `objxf:${l.id}`)
      : transformPixels(l.canvas, l.x, l.y, map, final ? null : `objxf:${l.id}`);
    if (!final) return { layer: l, preview: out };
    const patch: Partial<Layer> = { canvas: out.canvas, x: out.x, y: out.y, width: out.canvas.width, height: out.canvas.height };
    if (l.mask) {
      const m = transformPixels(l.mask.canvas, l.mask.x, l.mask.y, map, null);
      patch.mask = { ...l.mask, canvas: m.canvas, x: m.x, y: m.y };
    }
    return { layer: withLayer(l, patch) };
  }
  return { layer: l };
}

/**
 * Plain scaling of a pixel layer: only its visible pixels are resampled, into a box of whole
 * pixels, so the result is exactly the size asked for (resampling the whole canvas would let
 * smoothing bleed a soft pixel past each edge).
 */
function scalePixels(l: Layer, map: Mapping, scratchKey: string | null): { canvas: HTMLCanvasElement; x: number; y: number } {
  const box = layerBounds(l);
  if (!box || !l.canvas) return transformPixels(l.canvas!, l.x, l.y, map, scratchKey);
  const a = map.apply({ x: box.x, y: box.y });
  const b = map.apply({ x: box.x + box.width, y: box.y + box.height });
  const x0 = Math.round(Math.min(a.x, b.x));
  const y0 = Math.round(Math.min(a.y, b.y));
  const w = Math.max(1, Math.round(Math.abs(b.x - a.x)));
  const h = Math.max(1, Math.round(Math.abs(b.y - a.y)));
  const c = scratchKey ? scratch(scratchKey, w, h) : createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(l.canvas, box.x - l.x, box.y - l.y, box.width, box.height, 0, 0, w, h);
  ctx.restore();
  touch(c);
  return { canvas: c, x: x0, y: y0 };
}

/** Pixels at (x, y) drawn through the mapping into a new canvas (or a reused preview canvas). */
function transformPixels(src: HTMLCanvasElement, x: number, y: number, map: Mapping, scratchKey: string | null): { canvas: HTMLCanvasElement; x: number; y: number } {
  const corners = [map.apply({ x, y }), map.apply({ x: x + src.width, y }), map.apply({ x: x + src.width, y: y + src.height }), map.apply({ x, y: y + src.height })];
  const x0 = Math.floor(Math.min(...corners.map((p) => p.x)));
  const y0 = Math.floor(Math.min(...corners.map((p) => p.y)));
  const w = Math.max(1, Math.ceil(Math.max(...corners.map((p) => p.x))) - x0);
  const h = Math.max(1, Math.ceil(Math.max(...corners.map((p) => p.y))) - y0);
  const c = scratchKey ? scratch(scratchKey, w, h) : createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  // The affine part of the mapping, from where the pixels' origin lands and where its axes go
  const o = map.apply({ x, y });
  const ux = map.apply({ x: x + 1, y });
  const uy = map.apply({ x, y: y + 1 });
  ctx.setTransform(ux.x - o.x, ux.y - o.y, uy.x - o.x, uy.y - o.y, o.x - x0, o.y - y0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  touch(c);
  return { canvas: c, x: x0, y: y0 };
}

/** Live preview of a drag: vector layers change, pixel layers show through overrides. */
export function previewObjectDrag(d: ObjectDrag, p: Pt, m: DragMods): Mapping {
  const map = dragMapping(d, p, m);
  const doc = store.doc!;
  const single = d.layers.length === 1;
  const changed = new Map<string, Layer>();
  for (const l of d.layers) {
    const r = mappedLayer(l, map, false, d.handle, single);
    if (r.preview) store.overrides.set(l.id, r.preview);
    else changed.set(l.id, r.layer);
  }
  d.moved = true;
  store.live({ layers: doc.layers.map((l) => changed.get(l.id) ?? l) });
  return map;
}

/** Finishes a drag as one undoable step. */
export function commitObjectDrag(d: ObjectDrag, p: Pt, m: DragMods, label?: string) {
  const doc = store.doc;
  for (const l of d.layers) {
    store.overrides.delete(l.id);
    releaseScratch(`objxf:${l.id}`);
  }
  if (!doc) return;
  if (!d.moved) {
    store.requestRender();
    return;
  }
  const map = dragMapping(d, p, m);
  const single = d.layers.length === 1;
  const next = new Map(d.layers.map((l) => [l.id, mappedLayer(l, map, true, d.handle, single).layer]));
  store.invalidateRender();
  const kind = d.handle === 'rotate' ? 'Rotate' : 'Scale';
  store.commit(label ?? (d.layers.length > 1 ? `${kind} ${d.layers.length} Objects` : kind), { layers: doc.layers.map((l) => next.get(l.id) ?? l) }, { icon: 'transform' });
}

/** Sets the live rotation of the selected objects (degrees), about their shared centre. */
export function rotateSelectionTo(deg: number) {
  const doc = store.doc;
  if (!doc) return;
  const picked = store.selectedLayers;
  const f = selectionFrame(picked);
  if (!f) return;
  const d = beginObjectDrag('rotate', { x: f.cx + 100, y: f.cy }, picked);
  if (!d) return;
  const target = deg * DEG - f.angle;
  const end = { x: f.cx + 100 * Math.cos(target), y: f.cy + 100 * Math.sin(target) };
  d.moved = true;
  commitObjectDrag(d, end, { ratio: false, center: false, snap: false });
}

/** Rotates the selected objects by `deg` about their shared centre. */
export function rotateSelectionBy(deg: number) {
  const f = selectionFrame(store.selectedLayers);
  if (f) rotateSelectionTo(f.angle / DEG + deg);
}

/** The selection's rotation in degrees (0 for several objects or pixel layers). */
export function selectionAngle(): number {
  const f = selectionFrame(store.selectedLayers);
  return f ? r2(f.angle / DEG) : 0;
}

// ================================================================ "nothing selected"

/**
 * Layers always have an active one, but clicking empty canvas should still deselect, like any
 * design app. The selection is "hidden" while it is unchanged since that click: no box, no
 * handles, and Delete does nothing.
 */
export const objectSelection = { hiddenSig: null as string | null };

export function selectionSig(): string {
  const d = store.doc;
  return d ? `${d.id}:${d.activeId}:${(d.selectedIds ?? []).join(',')}` : '';
}

/** False right after a click on empty canvas, until something is selected again. */
export function frameVisible(): boolean {
  return objectSelection.hiddenSig !== selectionSig();
}

export function hideObjectSelection() {
  objectSelection.hiddenSig = selectionSig();
  store.requestRender();
}

export function showObjectSelection() {
  objectSelection.hiddenSig = null;
}

// ================================================================ typed values (options bar, Properties)

/** The selection's geometry for the X / Y / W / H / angle fields: position is the top-left of its box. */
export function selectionGeometry(): { x: number; y: number; w: number; h: number; angle: number } | null {
  const f = selectionFrame(store.selectedLayers);
  if (!f) return null;
  const r = frameAabb(f);
  return { x: r.x, y: r.y, w: f.w, h: f.h, angle: r2(((((f.angle / DEG + 180) % 360) + 360) % 360) - 180) };
}

/** Resizes the selection to w × h (either may be left out), keeping its top-left corner (in its own frame). */
export function resizeSelectionTo(w?: number, h?: number, keepRatio = false) {
  const picked = store.selectedLayers;
  const f = selectionFrame(picked);
  if (!f || (w === undefined && h === undefined)) return;
  let nw = Math.max(1, w ?? f.w);
  let nh = Math.max(1, h ?? f.h);
  if (keepRatio && f.w > 0 && f.h > 0) {
    if (w !== undefined && h === undefined) nh = (f.h * nw) / f.w;
    else if (h !== undefined && w === undefined) nw = (f.w * nh) / f.h;
  }
  // Pixel layers must stay within what a browser canvas can hold
  const k = Math.max(nw / (f.w || 1), nh / (f.h || 1));
  const tooBig = transformTargets(picked).some((l) => {
    const lf = l.kind === 'raster' ? layerFrame(l) : null;
    return !!lf && Math.max(lf.w, lf.h) * k > MAX_CANVAS_SIDE;
  });
  if (tooBig) return store.toast(`That size is too large — layers can be at most ${MAX_CANVAS_SIDE} px on a side`, 'error');
  const start = toDoc(f, f.w / 2, f.h / 2);
  const end = toDoc(f, f.w / 2 + (nw - f.w), f.h / 2 + (nh - f.h));
  const d = beginObjectDrag('se', start, picked);
  if (!d) return;
  d.moved = true;
  commitObjectDrag(d, end, { ratio: false, center: false, snap: false }, 'Resize Layer');
}

/** Moves the selection so the top-left of its box lands on (x, y). */
export function moveSelectionTo(x?: number, y?: number) {
  const doc = store.doc;
  const g = selectionGeometry();
  if (!doc || !g) return;
  const dx = x === undefined ? 0 : x - g.x;
  const dy = y === undefined ? 0 : y - g.y;
  if (!dx && !dy) return;
  const ids = new Set(transformTargets(store.selectedLayers).map((l) => l.id));
  const layers = doc.layers.map((l) =>
    ids.has(l.id) ? withLayer(l, { x: l.x + dx, y: l.y + dy, mask: l.mask ? { ...l.mask, x: l.mask.x + dx, y: l.mask.y + dy } : undefined }) : l
  );
  store.commit('Move Layer', { layers }, { icon: 'move', coalesce: `pos:${[...ids].join(',')}` });
}
