// Additional tools: single row/column marquee, quick selection, magic eraser, red eye, pen,
// ruler, color sampler, healing-brush tone matching and history-brush sources.
//
// Every tool here works in exact document pixels. Pure math (measurements, color conversions,
// path geometry) is exported separately and unit tested.

import type { Layer, PathAnchor, Rect, Selection, ShapeProps } from './types';
import { makeLayer } from './types';
import { blurChannel, createCanvas, ctx2d, intersectRect, touch, unionRect } from './canvas';
import { colorMatch } from './brush';
import { layerSurface, renderDocument } from './render';
import * as sel from './selection';
import type { SelOp } from './selection';
import { store, pixelsChanged } from './store';
import * as ops from './ops';

type Pt = { x: number; y: number };
type RGB = [number, number, number];

// ================================================================ shared

/** The composite image as RGBA (what the user sees, minus guides). */
function compositeData(): { data: Uint8ClampedArray; w: number; h: number } | null {
  const doc = store.doc;
  if (!doc) return null;
  const c = createCanvas(doc.width, doc.height);
  renderDocument(doc, c);
  return { data: ctx2d(c).getImageData(0, 0, doc.width, doc.height).data, w: doc.width, h: doc.height };
}

/** Average color of a size×size square centred on a pixel of the composite (Eyedropper "Sample Size"). Works anywhere on the workable canvas. */
export function sampleAverage(x: number, y: number, size = 1): { rgb: RGB; a: number } | null {
  const doc = store.doc;
  if (!doc) return null;
  const px = Math.floor(x);
  const py = Math.floor(y);
  const half = Math.floor(size / 2);
  const view = { s: 1, ox: px - half, oy: py - half, w: Math.max(1, size), h: Math.max(1, size) };
  const out = store.viewRenderer.render(doc, store.overrides, view);
  const d = ctx2d(out).getImageData(0, 0, out.width, out.height).data;
  // Average premultiplied so transparent pixels don't drag the color toward black
  let R = 0, G = 0, B = 0, A = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    R += d[i] * a;
    G += d[i + 1] * a;
    B += d[i + 2] * a;
    A += a;
  }
  const n = d.length / 4;
  if (!A) return null;
  return { rgb: [Math.round(R / A), Math.round(G / A), Math.round(B / A)], a: Math.round(A / n) };
}

export const toHex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** HSB (hue °, saturation %, brightness %). Pure, tested. */
export function rgbToHsb([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(max ? (d / max) * 100 : 0), Math.round((max / 255) * 100)];
}

/** CIE L*a*b* (D65) from sRGB. Pure, tested. */
export function rgbToLab([r, g, b]: RGB): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  // `+ 0` turns -0 into 0 so readouts never show "-0"
  return [Math.round(116 * fy - 16) + 0, Math.round(500 * (fx - fy)) + 0, Math.round(200 * (fy - fz)) + 0];
}

/** Device CMYK % (uncalibrated: no ICC profile). Pure, tested. */
export function rgbToCmyk([r, g, b]: RGB): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - r / 255 - k) / (1 - k);
  const m = (1 - g / 255 - k) / (1 - k);
  const y = (1 - b / 255 - k) / (1 - k);
  return [Math.round(c * 100), Math.round(m * 100), Math.round(y * 100), Math.round(k * 100)];
}

// ================================================================ single row / column marquee

/** A 1-pixel row or column across the whole canvas through the clicked pixel. */
export function singleLineSelection(kind: 'row' | 'col', x: number, y: number, op: SelOp) {
  const doc = store.doc;
  if (!doc) return;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if ((kind === 'row' && (py < 0 || py >= doc.height)) || (kind === 'col' && (px < 0 || px >= doc.width))) return;
  const c = sel.drawSelection(doc.width, doc.height, (ctx) => (kind === 'row' ? ctx.fillRect(0, py, doc.width, 1) : ctx.fillRect(px, 0, 1, doc.height)));
  store.setSelection(sel.combine(doc.selection, c, op), kind === 'row' ? 'Single Row Marquee' : 'Single Column Marquee');
}

// ================================================================ quick selection

interface QuickState {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  mask: Uint8Array;
  palette: RGB[];
  op: SelOp;
  base: Selection | null;
  last: Pt | null;
  /** Live selection canvas, updated only where pixels were added (cheap on large images). */
  canvas: HTMLCanvasElement;
  added: Rect | null; // bounds of everything added so far
  dirty: Rect | null; // added since the last preview
  flushAt: number;
  cost: number; // ms the last preview took (including the outline it triggers)
}
let quick: QuickState | null = null;

export function quickSelectDown(e: { x: number; y: number; alt: boolean; shift: boolean }) {
  const doc = store.doc;
  const img = compositeData();
  if (!doc || !img) return;
  // After the first stroke Quick Selection adds by default; ⌥ subtracts
  const op: SelOp = e.alt ? 'subtract' : doc.selection ? 'add' : 'replace';
  const canvas = createCanvas(img.w, img.h);
  if (op !== 'replace' && doc.selection) ctx2d(canvas).drawImage(doc.selection.canvas, 0, 0);
  quick = { ...img, mask: new Uint8Array(img.w * img.h), palette: [], op, base: doc.selection, last: null, canvas, added: null, dirty: null, flushAt: 0, cost: 0 };
  quickSelectMove(e.x, e.y);
}

export function quickSelectMove(x: number, y: number) {
  const q = quick;
  if (!q) return;
  const r = Math.max(1, store.state.opts.size / 2);
  // Interpolate dabs so fast drags leave no gaps
  const from = q.last ?? { x, y };
  const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / Math.max(1, r / 2)));
  for (let i = q.last ? 1 : 0; i <= steps; i++) {
    const got = quickDab(q, from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps, r);
    if (got) {
      q.dirty = q.dirty ? unionRect(q.dirty, got) : got;
      q.added = q.added ? unionRect(q.added, got) : got;
    }
  }
  q.last = { x, y };
  const now = performance.now();
  // Preview as often as the image size allows: wait at least 3× what the last preview cost
  if (q.dirty && now - q.flushAt > Math.max(50, q.cost * 3)) {
    flushQuick(q);
    q.flushAt = performance.now();
    q.cost = q.flushAt - now;
  }
}

/** Copies newly added mask pixels into the live selection canvas and shows it. */
function flushQuick(q: QuickState) {
  const r = q.dirty;
  q.dirty = null;
  if (r) {
    const tmp = createCanvas(r.width, r.height);
    const tctx = ctx2d(tmp);
    const img = tctx.createImageData(r.width, r.height);
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const m = q.mask[(r.y + y) * q.w + r.x + x];
        if (!m) continue;
        const i = (y * r.width + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = m;
      }
    tctx.putImageData(img, 0, 0);
    const ctx = ctx2d(q.canvas);
    ctx.globalCompositeOperation = q.op === 'subtract' ? 'destination-out' : 'source-over';
    ctx.drawImage(tmp, r.x, r.y);
    ctx.globalCompositeOperation = 'source-over';
    touch(q.canvas);
  }
  const bounds = q.op === 'subtract' ? q.base?.bounds ?? null : q.op === 'add' && q.base ? unionRect(q.base.bounds, q.added!) : q.added;
  store.live({ selection: bounds ? { canvas: q.canvas, bounds } : null });
}

/**
 * One brush dab: learn the colors under the brush, then grow into connected similar pixels.
 * Returns the bounds of newly selected pixels. Pure apart from `q`, tested.
 */
export function quickDab(q: Pick<QuickState, 'data' | 'w' | 'h' | 'mask' | 'palette'>, cx: number, cy: number, r: number, tolerance = store.state.opts.tolerance): Rect | null {
  const { data, w, h, mask, palette } = q;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  const seeds: number[] = [];
  let R = 0, G = 0, B = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      const p = y * w + x;
      seeds.push(p);
      R += data[p * 4];
      G += data[p * 4 + 1];
      B += data[p * 4 + 2];
    }
  if (!seeds.length) return null;
  const mean: RGB = [R / seeds.length, G / seeds.length, B / seeds.length];
  if (!palette.some((c) => colorMatch(c[0], c[1], c[2], mean, tolerance / 2) === 1)) {
    palette.push(mean);
    if (palette.length > 24) palette.shift();
  }
  const pal = palette.flat();
  const similar = (p: number) => {
    const i = p * 4;
    const r0 = data[i], g0 = data[i + 1], b0 = data[i + 2];
    for (let k = 0; k < pal.length; k += 3)
      if (Math.abs(r0 - pal[k]) <= tolerance && Math.abs(g0 - pal[k + 1]) <= tolerance && Math.abs(b0 - pal[k + 2]) <= tolerance) return true;
    return false;
  };
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const mark = (p: number) => {
    mask[p] = 255;
    const x = p % w;
    const y = (p - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  // Brushed pixels are always selected; growth spreads only through similar neighbours
  const stack: number[] = [];
  for (const p of seeds)
    if (!mask[p]) {
      mark(p);
      stack.push(p);
    }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0 && !mask[p - 1] && similar(p - 1)) mark(p - 1), stack.push(p - 1);
    if (x < w - 1 && !mask[p + 1] && similar(p + 1)) mark(p + 1), stack.push(p + 1);
    if (p >= w && !mask[p - w] && similar(p - w)) mark(p - w), stack.push(p - w);
    if (p + w < w * h && !mask[p + w] && similar(p + w)) mark(p + w), stack.push(p + w);
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function quickSelectUp() {
  const q = quick;
  quick = null;
  const doc = store.doc;
  if (!q || !doc) return;
  if (q.dirty) flushQuick(q);
  const result = sel.selectionFromCanvas(q.canvas);
  doc.selection = q.base; // the live preview isn't a history step
  store.setSelection(result, 'Quick Selection');
}

// ================================================================ magic eraser

export function magicErase(x: number, y: number) {
  const doc = store.doc;
  if (!doc) return;
  const layer = store.activeLayer;
  if (layer?.locked) return store.toast('Layer is locked', 'error');
  const target = store.beginPixelEdit('pixels');
  if (!target) return;
  const o = store.state.opts;
  const c = target.canvas;
  const ctx = ctx2d(c);
  let data: Uint8ClampedArray;
  if (o.sampleAll) {
    const full = createCanvas(doc.width, doc.height);
    renderDocument(doc, full);
    const region = createCanvas(c.width, c.height);
    ctx2d(region).drawImage(full, -target.ox, -target.oy);
    data = ctx2d(region).getImageData(0, 0, c.width, c.height).data;
  } else data = ctx.getImageData(0, 0, c.width, c.height).data;
  const mask = sel.floodMask(data, c.width, c.height, x - target.ox, y - target.oy, o.tolerance, o.contiguous);
  const erase = sel.maskToCanvas(mask, c.width, c.height);
  if (doc.selection) {
    const ectx = ctx2d(erase);
    ectx.globalCompositeOperation = 'destination-in';
    ectx.drawImage(doc.selection.canvas, -target.ox, -target.oy);
  }
  ctx.save();
  ctx.globalAlpha = o.opacity;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(erase, 0, 0);
  ctx.restore();
  pixelsChanged(c);
  store.commit('Magic Eraser', {}, { icon: 'brush' });
}

// ================================================================ red eye

/** How strongly a pixel reads as red-eye (0..1). Pure, tested. */
export function redness(r: number, g: number, b: number): number {
  if (r < 50) return 0;
  return Math.max(0, (r - Math.max(g, b)) / r);
}

/** Removes red eye inside the ellipse inscribed in `rect` (document coordinates). */
export function fixRedEye(rect: Rect) {
  const doc = store.doc;
  const layer = store.activeLayer;
  if (!doc) return;
  if (layer?.locked) return store.toast('Layer is locked', 'error');
  const target = store.beginPixelEdit('pixels');
  if (!target) return;
  const o = store.state.opts;
  const c = target.canvas;
  const local = intersectRect({ x: Math.floor(rect.x - target.ox), y: Math.floor(rect.y - target.oy), width: Math.ceil(rect.width), height: Math.ceil(rect.height) }, { x: 0, y: 0, width: c.width, height: c.height });
  if (!local) return store.revert();
  const ctx = ctx2d(c);
  const img = ctx.getImageData(local.x, local.y, local.width, local.height);
  const d = img.data;
  const selData = doc.selection ? ctx2d(doc.selection.canvas).getImageData(local.x + target.ox, local.y + target.oy, local.width, local.height).data : null;
  // Pupil size → how red a pixel must be to count (bigger pupil = more lenient)
  const t = 0.45 - o.redEyePupil * 0.3;
  const cx = rect.x + rect.width / 2 - target.ox - local.x;
  const cy = rect.y + rect.height / 2 - target.oy - local.y;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  let changed = 0;
  for (let y = 0; y < local.height; y++)
    for (let x = 0; x < local.width; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const i = (y * local.width + x) * 4;
      const red = redness(d[i], d[i + 1], d[i + 2]);
      // Smooth ramp around the threshold keeps the pupil edge soft
      let k = Math.max(0, Math.min(1, (red - t) / 0.12));
      if (selData) k *= selData[i + 3] / 255;
      if (k <= 0) continue;
      const neutral = (d[i + 1] + d[i + 2]) / 2;
      const dark = 1 - o.redEyeDarken * 0.6 * k;
      d[i] = (d[i] + (neutral - d[i]) * k) * dark;
      d[i + 1] *= dark;
      d[i + 2] *= dark;
      changed++;
    }
  if (!changed) {
    store.revert();
    return store.toast('No red eye found there — drag a box around the eye, or raise Pupil Size');
  }
  ctx.putImageData(img, local.x, local.y);
  pixelsChanged(c);
  store.commit('Red Eye', {}, { icon: 'brush' });
}

// ================================================================ pen

export interface PenState {
  docId: string;
  anchors: PathAnchor[];
  closed: boolean;
  drag: number | null; // anchor whose handles follow the pointer
  cursor: Pt | null;
}
export const pen: { path: PenState | null } = { path: null };

export function penDown(e: { x: number; y: number; zoom: number }) {
  const p = pen.path;
  const pt = { x: e.x, y: e.y };
  if (!p || p.docId !== store.doc?.id) {
    pen.path = { docId: store.doc!.id, anchors: [corner(pt)], closed: false, drag: 0, cursor: null };
  } else {
    const first = p.anchors[0];
    if (p.anchors.length > 1 && Math.hypot(e.x - first.x, e.y - first.y) <= 8 / e.zoom) {
      p.closed = true;
      p.drag = 0;
    } else {
      p.anchors.push(corner(pt));
      p.drag = p.anchors.length - 1;
    }
  }
  store.requestRender();
}

const corner = (p: Pt): PathAnchor => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y });

/** Drag pulls out symmetric handles (a smooth point). Shift snaps the handle to 45°. */
export function penMove(e: { x: number; y: number; shift: boolean }, buttons: number) {
  const p = pen.path;
  if (!p) return;
  p.cursor = { x: e.x, y: e.y };
  if (buttons && p.drag !== null) {
    const a = p.anchors[p.drag];
    let hx = e.x, hy = e.y;
    if (e.shift) {
      const ang = Math.round(Math.atan2(hy - a.y, hx - a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(hx - a.x, hy - a.y);
      hx = a.x + Math.cos(ang) * len;
      hy = a.y + Math.sin(ang) * len;
    }
    // Closing on the first point drags its incoming side, which shapes the closing segment
    const closing = p.closed && p.drag === 0;
    const out = closing ? { x: 2 * a.x - hx, y: 2 * a.y - hy } : { x: hx, y: hy };
    a.ox = out.x;
    a.oy = out.y;
    a.ix = 2 * a.x - out.x;
    a.iy = 2 * a.y - out.y;
  }
  store.requestRender();
}

export function penUp() {
  const p = pen.path;
  if (!p) return;
  p.drag = null;
  if (p.closed) commitPen();
}

/** Builds the path in document coordinates. */
export function anchorsPath(anchors: PathAnchor[], closed: boolean, map = (x: number, y: number): [number, number] => [x, y]): Path2D {
  const path = new Path2D();
  anchors.forEach((a, i) => {
    const [x, y] = map(a.x, a.y);
    if (i === 0) return path.moveTo(x, y);
    const prev = anchors[i - 1];
    path.bezierCurveTo(...map(prev.ox, prev.oy), ...map(a.ix, a.iy), x, y);
  });
  if (closed && anchors.length > 1) {
    const last = anchors[anchors.length - 1];
    const first = anchors[0];
    path.bezierCurveTo(...map(last.ox, last.oy), ...map(first.ix, first.iy), ...map(first.x, first.y));
    path.closePath();
  }
  return path;
}

/** Bounding box of anchors and handles (the curve always lies inside it). Pure, tested. */
export function anchorsBounds(anchors: PathAnchor[]): Rect {
  const xs = anchors.flatMap((a) => [a.x, a.ix, a.ox]);
  const ys = anchors.flatMap((a) => [a.y, a.iy, a.oy]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}

/** Enter: turns the path into a shape layer or a selection, per the pen mode. */
export function commitPen() {
  const p = pen.path;
  pen.path = null;
  const doc = store.doc;
  if (!p || !doc || p.docId !== doc.id || p.anchors.length < 2) {
    store.requestRender();
    return;
  }
  const o = store.state.opts;
  if (o.penMode === 'selection') {
    const path = anchorsPath(p.anchors, true);
    const c = sel.drawSelection(doc.width, doc.height, (ctx) => ctx.fill(path));
    store.setSelection(sel.combine(doc.selection, c, 'replace'), 'Path to Selection');
    return;
  }
  const b = anchorsBounds(p.anchors);
  const norm = (v: number, o0: number, s: number) => (v - o0) / s;
  const points: PathAnchor[] = p.anchors.map((a) => ({
    x: norm(a.x, b.x, b.width), y: norm(a.y, b.y, b.height),
    ix: norm(a.ix, b.x, b.width), iy: norm(a.iy, b.y, b.height),
    ox: norm(a.ox, b.x, b.width), oy: norm(a.oy, b.y, b.height),
  }));
  const shape: ShapeProps = {
    shape: 'path',
    points,
    closed: p.closed,
    fill: store.state.fg,
    fillEnabled: p.closed && o.shapeFill,
    stroke: p.closed && o.shapeFill ? o.shapeStrokeColor : store.state.fg,
    strokeWidth: p.closed && o.shapeFill ? o.shapeStrokeWidth : Math.max(2, o.shapeStrokeWidth || 4),
    radius: 0,
    sides: 0,
  };
  const layer = makeLayer({ kind: 'shape', name: p.closed ? 'Path' : 'Open Path', shape, x: b.x, y: b.y, width: b.width, height: b.height });
  store.insertLayer(layer, undefined, 'New Path');
}

export function cancelPen() {
  pen.path = null;
  store.requestRender();
}

/** Backspace while drawing removes the last anchor. Returns false when there is no path. */
export function penDeleteLast(): boolean {
  const p = pen.path;
  if (!p) return false;
  p.anchors.pop();
  if (!p.anchors.length) pen.path = null;
  store.requestRender();
  return true;
}

// ================================================================ ruler

const rulerState: { line: { a: Pt; b: Pt; docId: string } | null; dragEnd: 'a' | 'b' | null } = { line: null, dragEnd: null };

/** The measurement belongs to the document it was drawn on; other documents see no ruler. */
export const ruler = {
  get line() {
    const l = rulerState.line;
    return l && l.docId === store.doc?.id ? l : null;
  },
  set line(v: { a: Pt; b: Pt; docId?: string } | null) {
    rulerState.line = v ? { ...v, docId: v.docId ?? store.doc?.id ?? '' } : null;
  },
  get dragEnd() {
    return rulerState.dragEnd;
  },
  set dragEnd(v: 'a' | 'b' | null) {
    rulerState.dragEnd = v;
  },
};

/** Distance and angle like Photoshop's Info: angle counter-clockwise from the +x axis. Pure, tested. */
export function measure(a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // dy === 0 must not become -0, or a leftward line would read -180° instead of 180°
  return { dx, dy, length: Math.hypot(dx, dy), angle: (Math.atan2(dy === 0 ? 0 : -dy, dx) * 180) / Math.PI };
}

/** Rotation (radians, canvas convention) that makes the line exactly horizontal or vertical. Pure, tested. */
export function straightenAngle(a: Pt, b: Pt): number {
  const theta = Math.atan2(b.y - a.y, b.x - a.x);
  const target = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);
  return target - theta;
}

export function rulerDown(e: { x: number; y: number; zoom: number }) {
  const l = ruler.line;
  const tol = 8 / e.zoom;
  if (l && Math.hypot(e.x - l.a.x, e.y - l.a.y) <= tol) ruler.dragEnd = 'a';
  else if (l && Math.hypot(e.x - l.b.x, e.y - l.b.y) <= tol) ruler.dragEnd = 'b';
  else {
    ruler.line = { a: { x: e.x, y: e.y }, b: { x: e.x, y: e.y } };
    ruler.dragEnd = 'b';
  }
  store.emit();
}

export function rulerMove(e: { x: number; y: number; shift: boolean }) {
  const l = ruler.line;
  if (!l || !ruler.dragEnd) return;
  const fixed = ruler.dragEnd === 'a' ? l.b : l.a;
  let p = { x: e.x, y: e.y };
  if (e.shift) {
    const ang = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(p.x - fixed.x, p.y - fixed.y);
    p = { x: fixed.x + Math.cos(ang) * len, y: fixed.y + Math.sin(ang) * len };
  }
  rulerState.line![ruler.dragEnd] = p;
  store.emit();
}

export function rulerUp() {
  ruler.dragEnd = null;
  const l = ruler.line;
  if (l && Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) < 0.5) ruler.line = null;
  store.emit();
}

export function clearRuler() {
  ruler.line = null;
  store.emit();
}

/** Rotates the active layer so the measured line becomes level (or plumb). */
export function straightenLayer() {
  const l = ruler.line;
  if (!l) return store.toast('Drag along something that should be level first', 'error');
  const angle = straightenAngle(l.a, l.b);
  if (Math.abs(angle) < 1e-6) return store.toast('Already straight');
  ops.beginTransform();
  const t = store.state.transform;
  if (!t) return;
  store.state.transform = { ...t, angle };
  ops.commitTransform();
  ruler.line = null;
  store.setTool('ruler');
  store.toast(`Straightened by ${((angle * 180) / Math.PI).toFixed(2)}°`, 'success');
}

// ================================================================ color sampler

export const MAX_SAMPLERS = 10;
let samplerDrag: number | null = null;

export function samplerDown(e: { x: number; y: number; zoom: number; alt: boolean }) {
  const doc = store.doc;
  if (!doc) return;
  const list = (doc.samplers ??= []);
  const hit = list.findIndex((s) => Math.hypot(e.x - (s.x + 0.5), e.y - (s.y + 0.5)) <= 8 / e.zoom);
  if (hit >= 0) {
    if (e.alt) list.splice(hit, 1);
    else samplerDrag = hit;
  } else if (!e.alt) {
    if (list.length >= MAX_SAMPLERS) return store.toast(`Up to ${MAX_SAMPLERS} color samplers — ⌥-click one to remove it`, 'error');
    const x = Math.floor(e.x);
    const y = Math.floor(e.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    list.push({ x, y });
    samplerDrag = list.length - 1;
  }
  store.emit();
}

export function samplerMove(x: number, y: number) {
  const doc = store.doc;
  if (samplerDrag === null || !doc?.samplers) return;
  doc.samplers[samplerDrag] = { x: Math.max(0, Math.min(doc.width - 1, Math.floor(x))), y: Math.max(0, Math.min(doc.height - 1, Math.floor(y))) };
  store.emit();
}

export function samplerUp() {
  samplerDrag = null;
}

export function clearSamplers() {
  const doc = store.doc;
  if (doc) doc.samplers = [];
  store.emit();
}

// ================================================================ history brush

/** RGBA of the active layer as it was at the History Brush source state, aligned to `target`. */
export function historyPixels(layerId: string, target: { canvas: HTMLCanvasElement; ox: number; oy: number }): Uint8ClampedArray | null {
  const doc = store.doc;
  if (!doc) return null;
  const snap = store.state.historySource && doc.history.includes(store.state.historySource) ? store.state.historySource : doc.history[0];
  const then: Layer | undefined = snap?.layers.find((l) => l.id === layerId);
  if (!then) return null;
  const surf = layerSurface(then);
  const c = createCanvas(target.canvas.width, target.canvas.height);
  if (surf) ctx2d(c).drawImage(surf.canvas, surf.x - target.ox, surf.y - target.oy);
  return ctx2d(c).getImageData(0, 0, c.width, c.height).data;
}

// ================================================================ healing brush

/**
 * Healing Brush finish: the stroke cloned texture from the source; now match its tone to the
 * destination. Low frequencies come from the pixels *around* the stroke (normalised convolution),
 * so the result takes the surrounding color and light while keeping the source's detail.
 */
export function healStroke(opts: {
  target: HTMLCanvasElement;
  original: HTMLCanvasElement;
  cover: HTMLCanvasElement; // stroke buffer: alpha = how much was painted
  touched: Rect;
  source: { canvas: HTMLCanvasElement; x: number; y: number; dx: number; dy: number };
  ox: number;
  oy: number;
  size: number;
  opacity: number;
  selection: HTMLCanvasElement | null;
}) {
  const { target, original, cover, touched, source, ox, oy } = opts;
  const R = Math.max(3, opts.size * 0.8);
  const pad = Math.ceil(R * 2);
  const box = intersectRect({ x: touched.x - pad, y: touched.y - pad, width: touched.width + pad * 2, height: touched.height + pad * 2 }, { x: 0, y: 0, width: target.width, height: target.height });
  if (!box) return;
  const { x: bx, y: by, width: W, height: H } = box;
  const T = ctx2d(original).getImageData(bx, by, W, H).data;
  const sc = createCanvas(W, H);
  ctx2d(sc).drawImage(source.canvas, source.x - (bx + ox + source.dx), source.y - (by + oy + source.dy));
  const S = ctx2d(sc).getImageData(0, 0, W, H).data;
  const M = ctx2d(cover).getImageData(bx, by, W, H).data;
  const Sel = opts.selection ? ctx2d(opts.selection).getImageData(bx + ox, by + oy, W, H).data : null;
  const n = W * H;
  const m = new Float32Array(n);
  const outside = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    m[i] = (M[i * 4 + 3] / 255) * opts.opacity * (Sel ? Sel[i * 4 + 3] / 255 : 1);
    outside[i] = M[i * 4 + 3] > 0 ? 0 : 1;
  }
  const wsum = new Float32Array(outside);
  blurChannel(wsum, W, H, R);
  const out = ctx2d(target).getImageData(bx, by, W, H);
  const d = out.data;
  for (let ch = 0; ch < 3; ch++) {
    const t = new Float32Array(n);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      t[i] = T[i * 4 + ch] * outside[i];
      s[i] = S[i * 4 + ch] * outside[i];
    }
    blurChannel(t, W, H, R);
    blurChannel(s, W, H, R);
    for (let i = 0; i < n; i++) {
      if (m[i] <= 0) continue;
      const k = wsum[i] > 1e-4 ? 1 / wsum[i] : 0;
      const healed = S[i * 4 + ch] + (t[i] - s[i]) * k;
      d[i * 4 + ch] = T[i * 4 + ch] + (healed - T[i * 4 + ch]) * m[i];
    }
  }
  for (let i = 0; i < n; i++) if (m[i] > 0) d[i * 4 + 3] = T[i * 4 + 3] + (S[i * 4 + 3] - T[i * 4 + 3]) * m[i];
  ctx2d(target).putImageData(out, bx, by);
  touch(target);
}
