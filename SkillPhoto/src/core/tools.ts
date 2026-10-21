import type { Layer, Rect, ShapeProps, TextProps, TextStyle } from './types';
import { ancestors, shownInDoc } from './groups';
import { remapRuns, styleRange } from './text';
import { isConvexQuad, pointInQuad } from './warp';
import { meshPoint } from './transform';
import { makeLayer, withLayer } from './types';
import { cloneCanvas, createCanvas, ctx2d, scratch, touch, unionRect } from './canvas';
import { Stroke } from './brush';
import type { BrushKind, BrushParams } from './brush';
import { layerSurface, renderDocument, syncTextBounds } from './render';
import * as sel from './selection';
import type { SelOp } from './selection';
import { store, pixelsChanged } from './store';
import type { ToolId } from './store';
import * as ops from './ops';
import { contentAwareFill } from './fill';
import { snapMove, snapPoint, snapTargets } from './snap';
import { layoutSnap } from './gridOps';
import { snapStep } from './grids';
import type { SnapTargets } from './snap';
import * as pro from './proTools';
import * as smart from './smartSelect';
import * as tune from './tuneOps';
import { layerBounds } from './align';
import { extrasFor } from './shapeGeometry';
import { dragWidget, nextCornerStyle, sharpenPathCorner, widgetAt, widgetTarget, WIDGET_LABELS } from './shapeWidgets';
import type { ShapeWidget } from './shapeWidgets';
import { appearanceOf, applyAppearance } from './appearanceCopy';
import {
  beginObjectDrag, commitObjectDrag, frameAabb, frameHit, frameVisible, handleCursor, hideObjectSelection,
  layerFrame, previewObjectDrag, selectionFrame, showObjectSelection, transformTargets,
} from './objectTransform';
import type { DragMods, Frame, ObjectDrag } from './objectTransform';

export interface PointerInfo {
  x: number; // document coordinates
  y: number;
  pressure: number;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  zoom: number;
  detail: number; // click count
}

type Pt = { x: number; y: number };

/** Transient overlay state the viewport draws on top of the canvas. */
export const interaction = {
  marquee: null as null | { rect: Rect; ellipse: boolean },
  lasso: null as null | { points: Pt[]; poly: boolean; cursor: Pt | null },
  gradient: null as null | { a: Pt; b: Pt },
  shapeDraft: null as null | { a: Pt; b: Pt; center?: boolean },
  pointer: null as null | Pt,
  /** Stabilizer: where paint is being laid while the pointer leads on the string. */
  stringAnchor: null as null | Pt,
  /** Smart guides shown while a move snaps (document coordinates). */
  guides: null as null | { x: number | null; y: number | null },
  /** On-canvas brush resize gesture: the cursor stays where the gesture began. */
  brushResize: null as null | { at: Pt; size: number; hardness: number; sx: number; sy: number },
  /** Red Eye tool drag box. */
  redEyeBox: null as null | Rect,
  /** Type tool: dragging out a paragraph text box. */
  textBox: null as null | { a: Pt; b: Pt },
  /** Move tool: rubber-band box selecting the layers it touches. */
  objectMarquee: null as null | Rect,
  /** Move tool: the layer under the pointer (outlined before it is clicked). */
  hoverId: null as null | string,
  /** Live size / angle readout next to the pointer while resizing or rotating (document point). */
  readout: null as null | { text: string; x: number; y: number },
};

/** Characters selected in the text being edited (rich-text styling applies to these). */
export const textSelection = { id: '', start: 0, end: 0 };

/** The selected character range of a text layer being edited, or null for the whole layer. */
export function activeTextRange(id: string): [number, number] | null {
  return store.state.textEditId === id && textSelection.id === id && textSelection.end > textSelection.start ? [textSelection.start, textSelection.end] : null;
}

/** Puts the caret / selection back in the on-canvas editor after an options-bar change. */
export const textEditorHooks = { refocus: () => {} };

/** Styles characters [start, end) of a text layer (rich text). */
export function styleTextRange(id: string, start: number, end: number, style: TextStyle, label = 'Character Style') {
  const layer = store.doc?.layers.find((l) => l.id === id);
  if (!layer?.text) return;
  updateText(id, { runs: styleRange(layer.text, start, end, style) }, label);
  requestAnimationFrame(() => textEditorHooks.refocus());
}

/** Applies a text style to the selection when editing with a selection, otherwise to the whole layer. */
export function applyTextStyle(id: string, style: TextStyle, label = 'Text Properties') {
  const r = activeTextRange(id);
  if (r) return styleTextRange(id, r[0], r[1], style, label);
  const layer = store.doc?.layers.find((l) => l.id === id);
  if (!layer?.text) return;
  // Whole layer: the base style changes and per-character overrides of those properties go away
  const keys = Object.keys(style) as (keyof TextStyle)[];
  const runs = layer.text.runs
    ?.map((run) => {
      const next = { ...run };
      for (const k of keys) delete next[k];
      return next;
    })
    .filter((run) => Object.keys(run).length > 2);
  updateText(id, { ...style, runs: runs?.length ? runs : undefined }, label);
}

export const PAINT_TOOLS: ToolId[] = [
  'brush', 'pencil', 'eraser', 'clone', 'heal', 'smudge', 'dodge', 'burn', 'sponge', 'blur', 'sharpen',
  'bg-eraser', 'color-replace', 'history-brush', 'heal-brush',
];

export function isBrushTool(t: ToolId) {
  return PAINT_TOOLS.includes(t);
}

function selOp(e: PointerInfo): SelOp {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  // No modifier: the mode chosen in the options bar / Properties (New, Add, Subtract, Intersect)
  return store.state.opts.selMode;
}

function luminance(hex: string) {
  return parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5, 7), 16) * 0.11;
}

// ================================================================ state per gesture

let stroke: Stroke | null = null;
let strokeMeta: { label: string; isMask: boolean; heal: boolean; healBrush: boolean } | null = null;
let dragStart: Pt | null = null;
let currentOp: SelOp = 'replace';
let moveStart: { layers: Layer[]; box: Rect | null; targets: SnapTargets | null } | null = null;
let gradientBase: { canvas: HTMLCanvasElement; base: HTMLCanvasElement; ox: number; oy: number; isMask: boolean } | null = null;
let cropDrag: { mode: string; start: Pt; rect: Rect } | null = null;
let transformDrag: { mode: string; start: Pt; t: NonNullable<typeof store.state.transform> } | null = null;
let cloneOffset: Pt | null = null;
let autoCommitTransform = false;

// ================================================================ helpers

function sampleColor(x: number, y: number): string | null {
  // "Sample Size" averages a square around the pixel, like Photoshop's 3×3 / 5×5 average
  const s = pro.sampleAverage(x, y, store.state.opts.samplerSize);
  return s && s.a > 0 ? pro.toHex(s.rgb) : null;
}

/**
 * Eyedropper with objects selected (Illustrator-style): click another object to copy its whole look
 * (fill, stroke, opacities, gradient, blend, styles) onto the selection; ⌥-click paints the selection's
 * look onto the clicked object; ⇧-click samples just the pixel colour into the selection's fill.
 * Returns false when nothing is selected, so the click samples a colour as usual.
 */
function eyedropperAppearance(e: PointerInfo): boolean {
  const doc = store.doc;
  if (!doc || !frameVisible()) return false;
  const targets = store.selectedLayers.filter((l) => !l.locked && (l.kind === 'shape' || l.kind === 'text'));
  if (!targets.length) return false;
  const hit = topLayerAt(e.x, e.y, { skipLocked: true, tol: 4 / e.zoom });
  const ids = new Set(targets.map((l) => l.id));
  if (e.shift) {
    const hex = sampleColor(e.x, e.y);
    if (!hex) return true;
    const layers = doc.layers.map((l) => {
      if (!ids.has(l.id)) return l;
      if (l.shape) return withLayer(l, { shape: { ...l.shape, fill: hex, fillEnabled: true, gradient: undefined } });
      if (l.text) return withLayer(l, { text: { ...l.text, color: hex, runs: l.text.runs?.map(({ color: _c, ...r }) => r) } });
      return l;
    });
    store.set({ fg: hex });
    store.commit('Eyedropper Colour', { layers });
    return true;
  }
  if (!hit || (hit.kind !== 'shape' && hit.kind !== 'text') || ids.has(hit.id)) return false;
  if (e.alt) {
    // Paint: the active object's look onto the clicked one
    const src = appearanceOf(store.activeLayer && ids.has(store.activeLayer.id) ? store.activeLayer : targets[0]);
    if (!src || hit.locked) return true;
    store.commit('Paint Appearance', { layers: doc.layers.map((l) => (l.id === hit.id ? applyAppearance(l, src) : l)) });
    store.toast(`Appearance painted onto “${hit.name}”`);
    return true;
  }
  const src = appearanceOf(hit);
  if (!src) return false;
  store.commit('Eyedropper', { layers: doc.layers.map((l) => (ids.has(l.id) ? applyAppearance(l, src) : l)) });
  if (src.fill) store.set({ fg: src.fill });
  store.toast(`Copied the look of “${hit.name}” to ${targets.length === 1 ? `“${targets[0].name}”` : `${targets.length} objects`}`);
  return true;
}

export function pickColor(x: number, y: number, toBackground = false) {
  const hex = sampleColor(x, y);
  if (!hex) return;
  if (toBackground) store.set({ bg: hex });
  else store.set({ fg: hex });
}

/**
 * The page itself: the bottom pixel layer covering the whole document (a new document's
 * Background). A click on the canvas never grabs it; pick it in the Layers panel instead.
 */
export function isBackdrop(l: Layer): boolean {
  const doc = store.doc;
  if (!doc || l.kind !== 'raster' || l.parent || doc.layers[0]?.id !== l.id || !l.canvas) return false;
  return l.x <= 0 && l.y <= 0 && l.x + l.canvas.width >= doc.width && l.y + l.canvas.height >= doc.height;
}

function topLayerAt(x: number, y: number, opts: { skipLocked?: boolean; tol?: number } = {}): Layer | null {
  const doc = store.doc;
  if (!doc) return null;
  // A few pixels of slack make thin lines and small type easy to click
  const r = Math.max(0, Math.round(opts.tol ?? 0));
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.kind === 'adjustment' || l.kind === 'group' || !shownInDoc(doc.layers, l)) continue;
    if (opts.skipLocked && (l.locked || isBackdrop(l) || ancestors(doc.layers, l).some((a) => a.locked))) continue;
    const s = layerSurface(l);
    if (!s) continue;
    const lx = Math.floor(x - s.x);
    const ly = Math.floor(y - s.y);
    if (lx + r < 0 || ly + r < 0 || lx - r >= s.canvas.width || ly - r >= s.canvas.height) continue;
    const x0 = Math.max(0, lx - r);
    const y0 = Math.max(0, ly - r);
    const w = Math.min(s.canvas.width, lx + r + 1) - x0;
    const h = Math.min(s.canvas.height, ly + r + 1) - y0;
    if (w <= 0 || h <= 0) continue;
    const data = ctx2d(s.canvas).getImageData(x0, y0, w, h).data;
    for (let k = 3; k < data.length; k += 4) if (data[k] > 10) return l;
  }
  return null;
}

/**
 * The object a Selection-tool click picks: the topmost unlocked layer under the pointer, or the
 * outermost group holding it (Auto-Select: Group). `deep` (⌘) always picks the layer itself.
 */
export function pickObject(x: number, y: number, zoom: number, deep = false): Layer | null {
  const doc = store.doc;
  const hit = topLayerAt(x, y, { skipLocked: true, tol: 3 / zoom });
  if (!doc || !hit) return null;
  const groups = ancestors(doc.layers, hit);
  // Inside a group that is already selected: the group is what gets dragged
  if (!deep && frameVisible()) {
    const picked = new Set(store.selectedLayers.map((l) => l.id));
    const sel = groups.find((g) => picked.has(g.id));
    if (sel) return sel;
  }
  if (deep || store.state.opts.autoSelect === 'layer') return hit;
  return groups.length ? groups[groups.length - 1] : hit;
}

function brushParams(kind: BrushKind, hide = false, color?: string): BrushParams {
  const o = store.state.opts;
  const tool = store.state.tool;
  return {
    kind,
    size: o.size,
    hardness: tool === 'pencil' ? 1 : o.hardness,
    opacity: o.opacity,
    flow: o.flow,
    spacing: o.spacing,
    // Smoothing 0..1 maps to a 0..40 screen-pixel string, converted to document pixels
    smoothRadius: tool === 'pencil' || kind === 'heal-mask' ? 0 : (o.smoothing * 40) / (store.doc?.view.zoom ?? 1),
    pressureSize: o.pressureSize,
    pressureOpacity: o.pressureOpacity,
    color: color ?? store.state.fg,
    aliased: tool === 'pencil',
    hide,
    strength: o.strength,
    exposure: o.exposure,
    range: o.dodgeRange,
    spongeMode: o.spongeMode,
    tolerance: o.tolerance,
    sampling: o.bgSampling,
    protect: o.protectFg ? pro.fromHex(store.state.fg) : null,
    replace: { rgb: pro.fromHex(store.state.fg), mode: o.replaceMode },
  };
}

// ================================================================ crop

export const CROP_RATIOS: Record<string, number | null> = { free: null, '1:1': 1, '4:5': 4 / 5, '3:2': 3 / 2, '2:3': 2 / 3, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '1.91:1': 1.91, '3:1': 3 };

export function startCrop() {
  const doc = store.doc;
  if (!doc) return;
  store.set({ crop: { rect: { x: 0, y: 0, width: doc.width, height: doc.height }, pristine: true } });
}

export function applyCropRatio() {
  const doc = store.doc;
  const crop = store.state.crop;
  if (!doc || !crop) return;
  const key = store.state.opts.cropRatio;
  const ratio = key === 'original' ? doc.width / doc.height : CROP_RATIOS[key];
  if (!ratio) return;
  const r = crop.rect;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  let w = r.width;
  let h = w / ratio;
  if (h > r.height) {
    h = r.height;
    w = h * ratio;
  }
  store.set({ crop: { rect: { x: cx - w / 2, y: cy - h / 2, width: w, height: h } } });
}

export function commitCrop() {
  const c = store.state.crop;
  if (!c) return;
  store.state.crop = null;
  ops.crop(c.rect, store.state.opts.cropDelete);
  store.setTool('move');
}

export function cancelCrop() {
  store.set({ crop: null });
}

function handleHit(r: Rect, p: Pt, zoom: number): string {
  const tol = 9 / zoom;
  const xs = { l: r.x, c: r.x + r.width / 2, r: r.x + r.width };
  const ys = { t: r.y, m: r.y + r.height / 2, b: r.y + r.height };
  const names: [string, number, number][] = [
    ['nw', xs.l, ys.t], ['n', xs.c, ys.t], ['ne', xs.r, ys.t], ['e', xs.r, ys.m],
    ['se', xs.r, ys.b], ['s', xs.c, ys.b], ['sw', xs.l, ys.b], ['w', xs.l, ys.m],
  ];
  for (const [n, hx, hy] of names) if (Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol) return n;
  if (p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height) return 'move';
  return 'new';
}

function resizeRect(start: Rect, mode: string, dx: number, dy: number, ratio: number | null): Rect {
  let { x, y, width: w, height: h } = start;
  if (mode.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (mode.includes('e')) w += dx;
  if (mode.includes('n')) {
    y += dy;
    h -= dy;
  }
  if (mode.includes('s')) h += dy;
  if (ratio) {
    if (mode === 'n' || mode === 's') {
      const nw = h * ratio;
      x += (w - nw) / 2;
      w = nw;
    } else {
      const nh = w / ratio;
      if (mode.includes('n')) y += h - nh;
      else if (!mode.includes('s')) y += (h - nh) / 2;
      h = nh;
    }
  }
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { x, y, width: Math.max(1, w), height: Math.max(1, h) };
}

// ================================================================ transform

export function transformHit(p: Pt, zoom: number): string {
  const t = store.state.transform;
  if (!t) return 'none';
  const corners = ops.transformCorners(t);
  const tol = 9 / zoom;
  if (t.mesh) {
    for (let i = 0; i < 16; i++) if (Math.hypot(p.x - t.mesh[i].x, p.y - t.mesh[i].y) <= tol) return `m${i}`;
    // Inside the warped shape moves it, outside rotates it
    return pointInQuad(corners, p.x, p.y) || pointInQuad(meshOutline(t.mesh), p.x, p.y) ? 'move' : 'rotate';
  }
  const names = ['nw', 'ne', 'se', 'sw'];
  for (let i = 0; i < 4; i++) if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= tol) return names[i];
  const mids = [
    ['n', corners[0], corners[1]],
    ['e', corners[1], corners[2]],
    ['s', corners[2], corners[3]],
    ['w', corners[3], corners[0]],
  ] as const;
  for (const [n, a, b] of mids) if (Math.hypot(p.x - (a.x + b.x) / 2, p.y - (a.y + b.y) / 2) <= tol) return n;
  if (t.quad) return pointInQuad(t.quad, p.x, p.y) ? 'move' : 'rotate';
  // Inside test via inverse matrix
  const inv = ops.transformMatrix(t).inverse();
  const q = inv.transformPoint(new DOMPoint(p.x, p.y));
  if (q.x >= t.sx && q.x <= t.sx + t.source.width && q.y >= t.sy && q.y <= t.sy + t.source.height) return 'move';
  return 'rotate';
}

const CORNERS = ['nw', 'ne', 'se', 'sw'];
const EDGES: Record<string, [number, number]> = { n: [0, 1], e: [1, 2], s: [2, 3], w: [3, 0] };

/**
 * Skew / distort / perspective: moves the box corners freely. Chosen in the options bar, or with
 * Photoshop's modifiers: ⌘-drag a corner = distort, ⌘-drag an edge = skew, ⌘⌥⇧-drag a corner =
 * perspective. Returns false when the drag is an ordinary scale.
 */
function dragQuad(e: PointerInfo, mode: string, t0: NonNullable<typeof store.state.transform>, t: NonNullable<typeof store.state.transform>, dx: number, dy: number): boolean {
  const corner = CORNERS.indexOf(mode);
  const edge = EDGES[mode];
  if (corner < 0 && !edge) return false;
  let kind = t0.mode && t0.mode !== 'free' ? t0.mode : null;
  if (!kind && e.mod) kind = corner >= 0 ? (e.alt && e.shift ? 'perspective' : 'distort') : 'skew';
  if (!kind && t0.quad) kind = 'distort';
  if (!kind) return false;
  const q = (t0.quad ?? ops.transformCorners(t0).map((p) => ({ x: p.x, y: p.y }))).map((p) => ({ ...p }));
  if (edge) {
    const [a, b] = edge;
    if (kind === 'skew' || kind === 'perspective') {
      // Slide the edge along itself
      const ex = q[b].x - q[a].x;
      const ey = q[b].y - q[a].y;
      const len = Math.hypot(ex, ey) || 1;
      const along = (dx * ex + dy * ey) / len;
      for (const k of [a, b]) {
        q[k].x += (along * ex) / len;
        q[k].y += (along * ey) / len;
      }
    } else {
      for (const k of [a, b]) {
        q[k].x += dx;
        q[k].y += dy;
      }
    }
  } else if (kind === 'perspective') {
    // Mirror the move onto the corner sharing the edge the drag runs along
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const partner = horizontal ? [1, 0, 3, 2][corner] : [3, 2, 1, 0][corner];
    if (horizontal) {
      q[corner].x += dx;
      q[partner].x -= dx;
    } else {
      q[corner].y += dy;
      q[partner].y -= dy;
    }
  } else if (kind === 'skew') {
    // A corner slides along the side it is dragged along
    if (Math.abs(dx) >= Math.abs(dy)) q[corner].x += dx;
    else q[corner].y += dy;
  } else {
    q[corner].x += dx;
    q[corner].y += dy;
  }
  // Refuse shapes that fold over themselves
  if (!isConvexQuad(q)) return true;
  t.quad = q;
  return true;
}

/** Outline of a warp mesh as a polygon (sampled boundary of the Bézier patch). */
function meshOutline(mesh: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < 8; k++) out.push(meshPoint(mesh, k / 8, 0));
  for (let k = 0; k < 8; k++) out.push(meshPoint(mesh, 1, k / 8));
  for (let k = 0; k < 8; k++) out.push(meshPoint(mesh, 1 - k / 8, 1));
  for (let k = 0; k < 8; k++) out.push(meshPoint(mesh, 0, 1 - k / 8));
  return out;
}

function dragTransform(e: PointerInfo) {
  if (!transformDrag) return;
  const { mode, start, t: t0 } = transformDrag;
  const t = { ...t0 };
  const dx = e.x - start.x;
  const dy = e.y - start.y;
  if (t0.mesh && /^m\d+$/.test(mode)) {
    const k = +mode.slice(1);
    t.mesh = t0.mesh.map((p, i) => (i === k ? { x: p.x + dx, y: p.y + dy } : p));
  } else if (t0.mesh && mode === 'move') {
    t.mesh = t0.mesh.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  } else if (t0.mesh && mode === 'rotate') {
    const cx = t0.mesh.reduce((s, p) => s + p.x, 0) / 16;
    const cy = t0.mesh.reduce((s, p) => s + p.y, 0) / 16;
    let a = Math.atan2(e.y - cy, e.x - cx) - Math.atan2(start.y - cy, start.x - cx);
    if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const c = Math.cos(a);
    const s = Math.sin(a);
    t.mesh = t0.mesh.map((p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }));
  } else if (dragQuad(e, mode, t0, t, dx, dy)) {
    // handled: corners moved freely
  } else if (mode === 'move' && t0.quad) {
    t.quad = t0.quad.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  } else if (mode === 'rotate' && t0.quad) {
    const cx = t0.quad.reduce((s, p) => s + p.x, 0) / 4;
    const cy = t0.quad.reduce((s, p) => s + p.y, 0) / 4;
    let a = Math.atan2(e.y - cy, e.x - cx) - Math.atan2(start.y - cy, start.x - cx);
    if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const c = Math.cos(a);
    const s = Math.sin(a);
    t.quad = t0.quad.map((p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }));
  } else if (mode === 'move') {
    t.tx = t0.tx + dx;
    t.ty = t0.ty + dy;
  } else if (mode === 'rotate') {
    const c = { x: t0.sx + t0.source.width / 2 + t0.tx, y: t0.sy + t0.source.height / 2 + t0.ty };
    const a0 = Math.atan2(start.y - c.y, start.x - c.x);
    const a1 = Math.atan2(e.y - c.y, e.x - c.x);
    let ang = t0.angle + a1 - a0;
    if (e.shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    t.angle = ang;
  } else {
    // Scale in the layer's local (rotated) frame, anchored at the opposite side
    const cos = Math.cos(-t0.angle);
    const sin = Math.sin(-t0.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const w = t0.source.width * t0.scaleX;
    const h = t0.source.height * t0.scaleY;
    let nw = w;
    let nh = h;
    if (mode.includes('e')) nw = w + lx;
    if (mode.includes('w')) nw = w - lx;
    if (mode.includes('s')) nh = h + ly;
    if (mode.includes('n')) nh = h - ly;
    const corner = mode.length === 2;
    if (corner && !e.shift) {
      // Proportional by default (like modern Photoshop); Shift frees it
      const s = Math.max(Math.abs(nw / w), Math.abs(nh / h));
      nw = w * s * Math.sign(nw || 1);
      nh = h * s * Math.sign(nh || 1);
    }
    t.scaleX = (nw / t0.source.width) || 0.01;
    t.scaleY = (nh / t0.source.height) || 0.01;
    // Keep the anchor fixed: shift center by half the size change, in rotated frame
    const dw = nw - w;
    const dh = nh - h;
    const ox = (mode.includes('e') ? dw / 2 : mode.includes('w') ? -dw / 2 : 0);
    const oy = (mode.includes('s') ? dh / 2 : mode.includes('n') ? -dh / 2 : 0);
    const c2 = Math.cos(t0.angle);
    const s2 = Math.sin(t0.angle);
    t.tx = t0.tx + ox * c2 - oy * s2;
    t.ty = t0.ty + ox * s2 + oy * c2;
  }
  store.state.transform = t;
  ops.updateTransformPreview();
  store.emit();
}

// ================================================================ text

export const DEFAULT_TEXT = 'Your text';

export function createTextAt(x: number, y: number, boxWidth?: number) {
  const o = store.state.opts;
  const text: TextProps = {
    text: DEFAULT_TEXT,
    font: o.font,
    size: o.fontSize,
    weight: o.fontWeight,
    italic: false,
    color: store.state.fg,
    align: o.textAlign,
    lineHeight: 1.2,
    tracking: 0,
    shadow: false,
    stroke: 0,
    strokeColor: '#000000',
    caps: o.textCaps,
    boxColor: '#000000',
    boxPad: Math.round(o.fontSize * 0.3),
    boxRadius: Math.round(o.fontSize * 0.2),
  };
  if (boxWidth) text.boxWidth = Math.round(boxWidth);
  // A click puts the line's middle at the click; a dragged box starts at its top edge
  const layer = makeLayer({ kind: 'text', name: DEFAULT_TEXT, text, x, y: boxWidth ? y : y - o.fontSize * 0.6 });
  const sized = withLayer(layer, syncTextBounds(layer));
  store.insertLayer(sized, undefined, 'New Text');
  store.set({ textEditId: sized.id });
}

export function updateText(id: string, patch: Partial<TextProps>, label = 'Edit Text') {
  const doc = store.doc;
  const layer = doc?.layers.find((l) => l.id === id);
  if (!layer?.text) return;
  const text = { ...layer.text, ...patch };
  // Styled ranges follow the characters they belong to as the text is edited
  if (patch.text !== undefined && patch.runs === undefined) text.runs = remapRuns(layer.text.runs, layer.text.text, patch.text);
  const tmp = withLayer(layer, { text });
  const name = patch.text !== undefined ? text.text.split('\n')[0].slice(0, 32) || 'Text' : layer.name;
  store.updateLayer(id, { text, name, ...syncTextBounds(tmp) }, label, `text:${id}`);
}

// ================================================================ pointer handlers

export function pointerDown(e: PointerInfo) {
  const s = store.state;
  const doc = store.doc;
  if (!doc) return;
  // Widgets are hit where the pointer really is, before any snapping
  if (!s.transform && widgetDown(e)) {
    dragStart = { x: e.x, y: e.y };
    interaction.pointer = dragStart;
    return;
  }
  e = snapDrawPoint(e);
  dragStart = { x: e.x, y: e.y };
  interaction.pointer = dragStart;

  // Free transform owns the pointer while active
  if (s.transform) {
    const mode = transformHit(e, e.zoom);
    transformDrag = { mode, start: dragStart, t: { ...s.transform } };
    return;
  }

  switch (s.tool) {
    case 'move':
      return objectDown(e);
    case 'marquee-row':
    case 'marquee-col':
      return pro.singleLineSelection(s.tool === 'marquee-row' ? 'row' : 'col', e.x, e.y, selOp(e));
    case 'quick-select':
      return pro.quickSelectDown(e);
    case 'magic-eraser':
      return pro.magicErase(e.x, e.y);
    case 'red-eye':
      interaction.redEyeBox = { x: e.x, y: e.y, width: 0, height: 0 };
      return;
    case 'pen':
      return pro.penDown(e);
    case 'ruler':
      return pro.rulerDown(e);
    case 'color-sampler':
      return pro.samplerDown(e);
    case 'marquee-rect':
    case 'marquee-ellipse':
    case 'object-select':
      currentOp = selOp(e);
      if (s.tool === 'object-select') smart.warmUpAI();
      interaction.marquee = { rect: { x: e.x, y: e.y, width: 0, height: 0 }, ellipse: s.tool === 'marquee-ellipse' };
      return;
    case 'lasso':
      currentOp = selOp(e);
      interaction.lasso = { points: [dragStart], poly: false, cursor: null };
      return;
    case 'poly-lasso': {
      const l = interaction.lasso;
      if (!l) {
        currentOp = selOp(e);
        interaction.lasso = { points: [dragStart], poly: true, cursor: dragStart };
      } else {
        const first = l.points[0];
        if (e.detail >= 2 || (l.points.length > 2 && Math.hypot(e.x - first.x, e.y - first.y) < 8 / e.zoom)) finishLasso();
        else l.points.push(dragStart);
      }
      store.requestRender();
      return;
    }
    case 'wand':
      return magicWand(e);
    case 'crop': {
      if (!s.crop) startCrop();
      const r = store.state.crop!.rect;
      let mode = handleHit(r, e, e.zoom);
      if (mode === 'move' && store.state.crop!.pristine) mode = 'new';
      cropDrag = { mode, start: dragStart, rect: mode === 'new' ? { x: e.x, y: e.y, width: 0, height: 0 } : { ...r } };
      return;
    }
    case 'eyedropper':
      if (s.opts.eyedropperMode === 'wb') return tune.whiteBalanceAt(e.x, e.y, Math.max(5, s.opts.samplerSize));
      if (eyedropperAppearance(e)) return;
      return pickColor(e.x, e.y, e.alt);
    case 'bucket':
      return bucketFill(e);
    case 'gradient':
      return startGradient(e);
    case 'text': {
      const hit = topLayerAt(e.x, e.y);
      if (hit?.kind === 'text') {
        store.selectLayer(hit.id);
        store.set({ textEditId: hit.id });
      } else if (s.textEditId) {
        store.set({ textEditId: null });
      } else interaction.textBox = { a: { x: e.x, y: e.y }, b: { x: e.x, y: e.y } };
      return;
    }
    case 'shape':
      interaction.shapeDraft = { a: dragStart, b: dragStart };
      return;
    case 'zoom':
      return; // handled by viewport
    default:
      if (isBrushTool(s.tool)) startStroke(e);
  }
}

/** Starts dragging `layer` (and the rest of the selection, if it is part of it). */
function beginMove(layer: Layer | null) {
  const doc = store.doc!;
  if (!layer || layer.locked) return;
  if (layer.kind === 'raster' && doc.selection) {
    // Pixels inside a marquee move on their own (Photoshop behaviour)
    ops.beginTransform();
    const t = store.state.transform;
    if (t && dragStart) {
      transformDrag = { mode: 'move', start: dragStart, t: { ...t } };
      autoCommitTransform = true;
    }
    return;
  }
  if (layer.kind === 'adjustment') return;
  // Dragging one of several selected layers moves them all; otherwise just this one
  const group = store.selectedLayers.some((l) => l.id === layer.id) ? store.selectedLayers : [layer];
  // A layer inside a group that is also moving moves with the group, not twice
  const movingIds = new Set(group.map((l) => l.id));
  const layers = group.filter((l) => !l.locked && l.kind !== 'adjustment' && !ancestors(doc.layers, l).some((a) => movingIds.has(a.id)));
  // Snap data is gathered once per drag: the moving box and everyone else's
  // Cached bounds: on big images a fresh pixel scan here would delay the start of every drag
  const boxes = layers.map(snapBox).filter((r): r is Rect => !!r);
  const box = boxes.length ? boxes.reduce((a, b) => unionRect(a, b)) : null;
  const ids = new Set(layers.map((l) => l.id));
  const others = box
    ? doc.layers.filter((l) => !ids.has(l.id) && l.visible && l.kind !== 'adjustment' && !ancestors(doc.layers, l).some((a) => ids.has(a.id))).slice(-24).map(snapBox).filter((r): r is Rect => !!r)
    : [];
  moveStart = { layers, box, targets: box ? snapTargets(doc.width, doc.height, others, gridSnapExtra(doc)) : null };
}

/** Box an object snaps by: the true geometry of shapes and text, the visible pixels of the rest. */
function snapBox(l: Layer): Rect | null {
  if (l.kind === 'raster') return layerBounds(l);
  const boxes = (l.kind === 'group' ? transformTargets([l]) : [l]).map(layerFrame).filter((f): f is NonNullable<typeof f> => !!f).map(frameAabb);
  return boxes.length ? boxes.reduce((a, b) => unionRect(a, b)) : null;
}

/** Only pixel layers need whole-pixel moves; type and shapes may sit on fractional grid lines. */
const allVector = (layers: Layer[]) => layers.every((l) => l.kind === 'shape' || l.kind === 'text' || (l.kind === 'group' && transformTargets([l]).every((c) => c.kind === 'shape' || c.kind === 'text')));

/** Grid snap targets: layout-grid lines, plus the document grid when Snap to Grid is on. */
function gridSnapExtra(doc: NonNullable<typeof store.doc>) {
  const l = layoutSnap(doc);
  const xs = [...l.xs];
  const ys = [...l.ys];
  const steps = [...l.steps];
  const g = store.state.docGrid;
  if (g.snap) {
    const step = snapStep(g, doc.view.zoom);
    steps.push({ x: { step, origin: 0 }, y: { step, origin: 0 } });
  }
  return { xs, ys, steps };
}

const SNAP_DRAW_TOOLS = new Set<ToolId>(['shape', 'text', 'marquee-rect', 'marquee-ellipse']);

/** Shapes, type boxes and marquees start and end on grid lines (hold ⌘/Ctrl to draw freely). */
function snapDrawPoint(e: PointerInfo): PointerInfo {
  const doc = store.doc;
  if (!doc || e.mod || !SNAP_DRAW_TOOLS.has(store.state.tool)) return e;
  const extra = gridSnapExtra(doc);
  if (!extra.xs.length && !extra.ys.length && !extra.steps.length) return e;
  const p = snapPoint(e.x, e.y, snapTargets(doc.width, doc.height, [], extra), 6 / e.zoom);
  interaction.guides = p.guideX !== null || p.guideY !== null ? { x: p.guideX, y: p.guideY } : null;
  return p.x === e.x && p.y === e.y ? e : { ...e, x: p.x, y: p.y };
}

/** A resize handle of an upright frame lands on grid lines and other objects' edges. */
function snapHandle(d: ObjectDrag, e: PointerInfo): PointerInfo {
  const doc = store.doc;
  if (!doc || e.mod || d.handle === 'rotate' || d.frame.angle % (Math.PI / 2) !== 0) return e;
  const ids = new Set(d.layers.map((l) => l.id));
  const others = doc.layers.filter((l) => !ids.has(l.id) && l.visible && l.kind !== 'adjustment').slice(-24).map(snapBox).filter((r): r is Rect => !!r);
  const p = snapPoint(e.x, e.y, snapTargets(doc.width, doc.height, others, gridSnapExtra(doc)), 6 / e.zoom);
  const h = d.handle;
  // Edge handles only move along one axis
  const x = h === 'n' || h === 's' ? e.x : p.x;
  const y = h === 'e' || h === 'w' ? e.y : p.y;
  interaction.guides = x !== e.x || y !== e.y ? { x: x !== e.x ? p.guideX : null, y: y !== e.y ? p.guideY : null } : null;
  return { ...e, x, y };
}

let objectDrag: ObjectDrag | null = null;
let marqueeAdd = false;
/** Pressed on one object of a multi-selection: a click without a drag selects just that one. */
let soloOnClick: string | null = null;
/** Second press of a double-click: opens the object if it is released without a drag. */
let enterOnClick: { layer: Layer; e: PointerInfo } | null = null;

/** Resize / rotate modifiers: Shift flips the proportions lock, Alt scales about the centre. */
function dragMods(e: PointerInfo): DragMods {
  return { ratio: store.state.opts.lockAspect !== e.shift, center: e.alt, snap: e.shift };
}

/** CSS cursor while the Selection tool hovers (or drags) at p. */
/** A drag of an on-canvas shape widget (corner radius, sides, star inner radius, pie, hole). */
let widgetDrag: { layer: Layer; w: ShapeWidget; start: Pt; moved: boolean; alt: boolean } | null = null;

/**
 * The shape whose live widgets are shown: the single selected live shape, with the Selection tool
 * (while its box is shown) or any shape-drawing tool.
 */
export function widgetLayer(): Layer | null {
  const s = store.state;
  if (s.transform || store.selectedLayers.length !== 1) return null;
  if (s.tool !== 'move' && s.tool !== 'shape') return null;
  if (s.tool === 'move' && (!s.opts.transformControls || !frameVisible())) return null;
  if (s.opts.liveCorners === false) return null;
  return widgetTarget(store.activeLayer);
}

/** The widget under the pointer, for hover cursors and the viewport's highlight. */
export function widgetHover(p: Pt, zoom: number): ShapeWidget | null {
  if (widgetDrag) return widgetDrag.w;
  const l = widgetLayer();
  return l ? widgetAt(l, p, zoom) : null;
}

function widgetDown(e: PointerInfo): boolean {
  const l = widgetLayer();
  const w = l ? widgetAt(l, e, e.zoom) : null;
  if (!l || !w) return false;
  widgetDrag = { layer: l, w, start: { x: e.x, y: e.y }, moved: false, alt: e.alt };
  interaction.readout = { text: WIDGET_LABELS[w.kind], x: e.x, y: e.y };
  store.requestRender();
  return true;
}

function widgetMove(e: PointerInfo) {
  const d = widgetDrag!;
  if (!d.moved && Math.hypot(e.x - d.start.x, e.y - d.start.y) * e.zoom < 2) return;
  d.moved = true;
  const r = dragWidget(d.layer, d.w, d.start, e, { alt: d.alt || e.alt, shift: e.shift, zoom: e.zoom });
  if (!r) return;
  // Every move restarts from the shape as it was when the drag began; one undo step per drag
  store.updateLayer(d.layer.id, { shape: { ...d.layer.shape!, ...r.patch } }, widgetLabel(d.w), `widget:${d.layer.id}:${dragSerial}`);
  interaction.readout = { text: r.readout, x: e.x, y: e.y };
}

let dragSerial = 0;
const widgetLabel = (w: ShapeWidget) =>
  w.kind === 'corner' || w.kind === 'path-corner' ? 'Corner Radius' : w.kind === 'sides' ? 'Sides' : w.kind === 'point-round' ? 'Round Points' : w.kind === 'star-inner' ? 'Star Inner Radius' : w.kind === 'hole' ? 'Ellipse Hole' : 'Pie Angle';

function widgetUp(e: PointerInfo) {
  const d = widgetDrag!;
  // The release point is the final value, even if the last move event never arrived
  if (Math.hypot(e.x - d.start.x, e.y - d.start.y) * e.zoom >= 2) widgetMove(e);
  widgetDrag = null;
  dragSerial++;
  interaction.readout = null;
  const l = store.doc?.layers.find((x) => x.id === d.layer.id);
  if (!d.moved && d.alt && d.w.kind === 'corner' && l?.shape) {
    // ⌥-click: next corner style
    const patch = nextCornerStyle(l.shape);
    store.updateLayer(l.id, { shape: { ...l.shape, ...patch } }, 'Corner Style', `widget:${l.id}:style:${dragSerial}`);
    store.toast(`Corners: ${patch.cornerStyle}`);
  } else if (!d.moved && d.alt && d.w.kind === 'path-corner' && l?.shape) {
    store.updateLayer(l.id, { shape: { ...l.shape, ...sharpenPathCorner(l.shape, d.w) } }, 'Sharp Corner', `widget:${l.id}:sharp:${dragSerial}`);
  } else if (d.moved && d.w.kind === 'path-corner') {
    // Path corners are per-path; nothing to remember for the next shape
  } else if (d.moved && l?.shape) {
    // Remember the setting for the next shape of this kind, like the Properties controls do
    const r = dragWidget(d.layer, d.w, d.start, e, { alt: d.alt || e.alt, shift: e.shift, zoom: e.zoom });
    if (r) rememberShapeSettings(r.patch);
  }
  store.requestRender();
}

/** Next-shape defaults follow the last live edit (same rule as the Properties panel). */
function rememberShapeSettings(patch: Partial<ShapeProps>) {
  const o = store.state.opts;
  const extras: Partial<ShapeProps> = { ...(o.shapeExtras ?? {}) };
  const next: { shapeRadius?: number; shapeSides?: number } = {};
  for (const [k, v] of Object.entries(patch) as [keyof ShapeProps, unknown][]) {
    if (k === 'radius') next.shapeRadius = v as number;
    else if (k === 'sides') next.shapeSides = v as number;
    else if (v === undefined) delete extras[k];
    else (extras as Record<string, unknown>)[k] = v;
  }
  store.setOpts({ ...next, shapeExtras: extras });
}

/** CSS cursor while the Move tool hovers (or drags) at p. */
export function objectCursor(p: Pt, zoom: number): string | null {
  if (widgetHover(p, zoom)) return 'pointer';
  if (objectDrag) return handleCursor(objectDrag.handle, objectDrag.frame);
  if (!store.state.opts.transformControls || !frameVisible()) return null;
  const f = selectionFrame(store.selectedLayers);
  if (!f) return null;
  const hit = frameHit(f, p, zoom);
  return hit && hit !== 'move' ? handleCursor(hit, f) : null;
}

/** Selection tool press: handles first, then the object under the pointer, then a marquee. */
function objectDown(e: PointerInfo) {
  const doc = store.doc!;
  const s = store.state;
  const active = store.activeLayer;
  interaction.readout = null;
  soloOnClick = null;
  enterOnClick = null;
  // Pixels inside a marquee selection move as pixels
  if (active && active.kind === 'raster' && doc.selection && !active.locked && !e.mod) return beginMove(active);

  const picked = store.selectedLayers;
  const frame = frameVisible() ? selectionFrame(picked) : null;
  const hit = frame ? frameHit(frame, e, e.zoom) : null;
  if (frame && hit && hit !== 'move' && s.opts.transformControls) {
    objectDrag = beginObjectDrag(hit, { x: e.x, y: e.y }, picked);
    return;
  }

  if (s.opts.autoSelect === 'off') {
    // Classic Photoshop: drag moves the active layer; ⌘-click picks what's under the pointer
    const target = e.mod ? pickObject(e.x, e.y, e.zoom, true) : null;
    if (target && !picked.some((l) => l.id === target.id)) store.selectLayer(target.id);
    showObjectSelection();
    return beginMove(target ?? active);
  }

  const target = pickObject(e.x, e.y, e.zoom, e.mod);
  if (target) {
    const wasSelected = picked.some((l) => l.id === target.id);
    if (e.shift) {
      store.selectLayer(target.id, 'toggle');
      showObjectSelection();
      // Shift-click on a selected object takes it out of the selection
      if (wasSelected && picked.length > 1) return;
    } else if (!wasSelected || !frameVisible()) store.selectLayer(target.id);
    else if (picked.length > 1) soloOnClick = target.id;
    showObjectSelection();
    if (e.detail >= 2) enterOnClick = { layer: target, e };
    if (e.alt) {
      // Alt-drag drags a copy, like Illustrator and Figma
      ops.duplicateLayer();
      return beginMove(store.activeLayer);
    }
    return beginMove(target);
  }
  // Empty space inside the selection box still drags the selection
  if (frame && hit === 'move' && !e.shift) return beginMove(active);
  marqueeAdd = e.shift;
  interaction.objectMarquee = { x: e.x, y: e.y, width: 0, height: 0 };
  store.requestRender();
}

/** Double-click: edit the layer's contents (text, a smart object's transform, or the layer inside a group). */
function enterObject(target: Layer, e: PointerInfo) {
  if (target.kind === 'group') {
    const inner = pickObject(e.x, e.y, e.zoom, true);
    if (inner) store.selectLayer(inner.id);
    return;
  }
  if (target.locked) return;
  if (target.kind === 'text') store.set({ textEditId: target.id });
  // Smart objects open Free Transform: skew, distort and warp from the original pixels
  else if (target.smart) ops.beginTransform();
}

function finishObjectMarquee() {
  const doc = store.doc;
  const m = interaction.objectMarquee;
  interaction.objectMarquee = null;
  if (!doc || !m) return;
  const r = { x: Math.min(m.x, m.x + m.width), y: Math.min(m.y, m.y + m.height), width: Math.abs(m.width), height: Math.abs(m.height) };
  const deep = store.state.opts.autoSelect === 'layer';
  // Candidates: top-level objects (groups as a whole), or every layer with Auto-Select: Layer
  const candidates = doc.layers.filter((l) => {
    if (l.kind === 'adjustment' || l.locked || isBackdrop(l) || !shownInDoc(doc.layers, l)) return false;
    if (deep) return l.kind !== 'group';
    return !l.parent;
  });
  const touches = (l: Layer) => {
    const boxes = (l.kind === 'group' ? transformTargets([l]) : [l]).map(layerFrame).filter((f): f is NonNullable<typeof f> => !!f).map(frameAabb);
    return boxes.some((b) => b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y);
  };
  const hits = r.width * doc.view.zoom < 3 && r.height * doc.view.zoom < 3 ? [] : candidates.filter(touches).map((l) => l.id);
  if (marqueeAdd) {
    const ids = [...new Set([...(frameVisible() ? store.selectedLayers.map((l) => l.id) : []), ...hits])];
    if (ids.length) {
      store.setSelectedLayers(ids);
      showObjectSelection();
    }
  } else if (hits.length) {
    store.setSelectedLayers(hits);
    showObjectSelection();
  } else hideObjectSelection();
  store.requestRender();
}

function readoutFor(drag: ObjectDrag, f: Frame, e: PointerInfo): { text: string; x: number; y: number } {
  if (drag.handle === 'rotate') {
    const deg = Math.round(((((f.angle * 180) / Math.PI) % 360) + 540) % 360 * 10) / 10 - 180;
    return { text: `${deg}°`, x: e.x, y: e.y };
  }
  return { text: `W ${Math.round(f.w)}  H ${Math.round(f.h)}`, x: e.x, y: e.y };
}

export function pointerMove(e: PointerInfo, buttons: number) {
  if (buttons) e = snapDrawPoint(e);
  interaction.pointer = { x: e.x, y: e.y };
  const s = store.state;
  if (interaction.lasso?.poly) {
    interaction.lasso.cursor = { x: e.x, y: e.y };
    store.requestRender();
  }
  if (s.tool === 'pen' && pro.pen.path) return pro.penMove(e, dragStart ? buttons : 0);
  if (s.tool === 'move' && !s.transform && !buttons) {
    const over = store.doc && s.opts.autoSelect !== 'off' ? pickObject(e.x, e.y, e.zoom, e.mod)?.id ?? null : null;
    if (over !== interaction.hoverId) interaction.hoverId = over;
  }
  if (!buttons || !dragStart) {
    store.requestRender();
    return;
  }

  if (widgetDrag) return widgetMove(e);
  if (transformDrag) return dragTransform(e);
  if (objectDrag) {
    interaction.hoverId = null;
    e = snapHandle(objectDrag, e);
    const map = previewObjectDrag(objectDrag, e, dragMods(e));
    interaction.readout = readoutFor(objectDrag, map.frame, e);
    return;
  }
  if (interaction.objectMarquee) {
    interaction.hoverId = null;
    interaction.objectMarquee = { x: dragStart.x, y: dragStart.y, width: e.x - dragStart.x, height: e.y - dragStart.y };
    store.requestRender();
    return;
  }

  if (stroke) {
    if (stroke.add(e.x, e.y, e.pressure)) pixelsChanged(stroke.target.canvas);
    interaction.stringAnchor = stroke.p.smoothRadius > 0 ? stroke.anchor : null;
    return;
  }

  switch (s.tool) {
    case 'move': {
      if (!moveStart) return;
      interaction.hoverId = null;
      const doc = store.doc!;
      // Pixel layers move by whole pixels; type and shapes follow the pointer exactly
      const whole = !allVector(moveStart.layers);
      const q = (v: number) => (whole ? Math.round(v) : Math.round(v * 1000) / 1000);
      let dx = q(e.x - dragStart.x);
      let dy = q(e.y - dragStart.y);
      if (e.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      // Smart guides: snap within 6 screen pixels; hold ⌘/Ctrl to move freely
      interaction.guides = null;
      if (moveStart.box && moveStart.targets && !e.mod) {
        const snap = snapMove(moveStart.box, dx, dy, moveStart.targets, 6 / e.zoom, whole);
        if (!e.shift || dy === 0) dx = snap.dx;
        if (!e.shift || dx === 0) dy = snap.dy;
        if (snap.guideX !== null || snap.guideY !== null) interaction.guides = { x: snap.guideX, y: snap.guideY };
      }
      // Offsets apply to each layer's position at drag start, so every layer moves the same whole pixels
      const starts = new Map(moveStart.layers.map((l) => [l.id, l]));
      const layers = doc.layers.map((cur) => {
        const l = starts.get(cur.id);
        if (!l) return cur;
        const patch: Partial<Layer> = { x: l.x + dx, y: l.y + dy };
        if (l.mask) patch.mask = { ...l.mask, x: l.mask.x + dx, y: l.mask.y + dy };
        return withLayer(cur, patch);
      });
      const f2 = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100) / 100}`;
      interaction.readout = { text: `X ${f2(dx)}  Y ${f2(dy)}`, x: e.x, y: e.y };
      store.live({ layers });
      return;
    }
    case 'text':
      if (interaction.textBox) {
        interaction.textBox.b = { x: e.x, y: e.y };
        store.requestRender();
      }
      return;
    case 'quick-select':
      return pro.quickSelectMove(e.x, e.y);
    case 'red-eye':
      if (interaction.redEyeBox) interaction.redEyeBox = sel.rectFromPoints(dragStart, e, e.shift, e.alt);
      store.requestRender();
      return;
    case 'ruler':
      return pro.rulerMove(e);
    case 'color-sampler':
      return pro.samplerMove(e.x, e.y);
    case 'marquee-rect':
    case 'marquee-ellipse':
    case 'object-select':
      if (interaction.marquee) interaction.marquee.rect = sel.rectFromPoints(dragStart, e, e.shift && currentOp === 'replace', e.alt && currentOp === 'replace');
      store.requestRender();
      return;
    case 'lasso':
      interaction.lasso?.points.push({ x: e.x, y: e.y });
      store.requestRender();
      return;
    case 'crop': {
      if (!cropDrag) return;
      const doc = store.doc!;
      const key = s.opts.cropRatio;
      const ratio = key === 'original' ? doc.width / doc.height : CROP_RATIOS[key] ?? null;
      let rect: Rect;
      if (cropDrag.mode === 'move') {
        rect = { ...cropDrag.rect, x: cropDrag.rect.x + e.x - cropDrag.start.x, y: cropDrag.rect.y + e.y - cropDrag.start.y };
      } else if (cropDrag.mode === 'new') {
        // A click without a real drag keeps the current box
        if (Math.hypot(e.x - cropDrag.start.x, e.y - cropDrag.start.y) * e.zoom < 4) return;
        rect = resizeRect({ x: cropDrag.start.x, y: cropDrag.start.y, width: 0, height: 0 }, 'se', e.x - cropDrag.start.x, e.y - cropDrag.start.y, ratio);
        if (e.x < cropDrag.start.x) rect.x = cropDrag.start.x - rect.width;
        if (e.y < cropDrag.start.y) rect.y = cropDrag.start.y - rect.height;
      } else {
        rect = resizeRect(cropDrag.rect, cropDrag.mode, e.x - cropDrag.start.x, e.y - cropDrag.start.y, ratio);
      }
      store.set({ crop: { rect } });
      return;
    }
    case 'eyedropper':
      if (store.state.opts.eyedropperMode === 'wb') return;
      return pickColor(e.x, e.y, e.alt);
    case 'gradient':
      if (interaction.gradient) {
        interaction.gradient.b = constrainAngle(interaction.gradient.a, e, e.shift);
        drawGradient();
      }
      return;
    case 'shape': {
      if (interaction.shapeDraft) {
        const d = interaction.shapeDraft;
        const b = e.shift ? constrainShape(d.a, e) : { x: e.x, y: e.y };
        d.b = b;
        // Alt draws from the centre outwards (not for lines, where Alt has no meaning)
        const t = store.state.opts.shapeType;
        d.center = e.alt && t !== 'line' && t !== 'arrow';
        store.requestRender();
      }
      return;
    }
  }
}

export function pointerUp(e: PointerInfo) {
  const s = store.state;
  const start = dragStart;
  dragStart = null;
  if (widgetDrag) return widgetUp(e);
  e = snapDrawPoint(e);
  if (SNAP_DRAW_TOOLS.has(s.tool)) interaction.guides = null;

  if (objectDrag) {
    const d = objectDrag;
    objectDrag = null;
    interaction.readout = null;
    commitObjectDrag(d, snapHandle(d, e), dragMods(e));
    interaction.guides = null;
    return;
  }
  if (interaction.objectMarquee) return finishObjectMarquee();
  if (interaction.readout) {
    interaction.readout = null;
    store.requestRender();
  }

  if (transformDrag) {
    transformDrag = null;
    // A plain move-tool drag of selected pixels commits immediately
    if (autoCommitTransform) ops.commitTransform();
    autoCommitTransform = false;
    return;
  }

  if (stroke) {
    stroke.release(e.x, e.y);
    return endStroke();
  }

  switch (s.tool) {
    case 'move': {
      if (interaction.guides) {
        interaction.guides = null;
        store.requestRender();
      }
      const solo = soloOnClick;
      const enter = enterOnClick;
      soloOnClick = null;
      enterOnClick = null;
      if (!moveStart) {
        if (enter) enterObject(enter.layer, enter.e);
        return;
      }
      const first = moveStart.layers[0];
      const moved = first && store.doc?.layers.find((l) => l.id === first.id);
      const didMove = !!moved && (moved.x !== first.x || moved.y !== first.y);
      const count = moveStart.layers.length;
      moveStart = null;
      if (didMove) store.commit(count > 1 ? `Move ${count} Layers` : 'Move', {}, { icon: 'move' });
      else if (enter) enterObject(enter.layer, enter.e);
      else if (solo) store.selectLayer(solo);
      return;
    }
    case 'text': {
      const box = interaction.textBox;
      interaction.textBox = null;
      if (!box) return;
      const w = Math.abs(box.b.x - box.a.x);
      // A real drag makes a paragraph box that wraps; a click makes point text
      if (w > 8 / e.zoom && Math.abs(box.b.y - box.a.y) > 4 / e.zoom) createTextAt(Math.min(box.a.x, box.b.x), Math.min(box.a.y, box.b.y), w);
      else createTextAt(box.a.x, box.a.y);
      return;
    }
    case 'quick-select':
      return pro.quickSelectUp();
    case 'red-eye': {
      const box = interaction.redEyeBox;
      interaction.redEyeBox = null;
      if (!box) return;
      // A click searches a brush-sized area around the eye
      const r = box.width >= 4 && box.height >= 4 ? box : { x: e.x - s.opts.size / 2, y: e.y - s.opts.size / 2, width: s.opts.size, height: s.opts.size };
      return pro.fixRedEye(r);
    }
    case 'pen':
      return pro.penUp();
    case 'ruler':
      return pro.rulerUp();
    case 'color-sampler':
      return pro.samplerUp();
    case 'object-select': {
      const m = interaction.marquee;
      interaction.marquee = null;
      store.requestRender();
      if (!m) return;
      // A drag boxes the object; a click picks the object under the cursor
      const boxed = m.rect.width >= 4 && m.rect.height >= 4;
      void smart.selectObject(boxed ? m.rect : null, boxed ? null : { x: e.x, y: e.y }, currentOp);
      return;
    }
    case 'marquee-rect':
    case 'marquee-ellipse': {
      const m = interaction.marquee;
      interaction.marquee = null;
      if (!m) return;
      const doc = store.doc!;
      if (m.rect.width < 2 || m.rect.height < 2) {
        if (currentOp === 'replace' && doc.selection) ops.deselect();
        store.requestRender();
        return;
      }
      const c = sel.drawSelection(doc.width, doc.height, (ctx) => {
        ctx.beginPath();
        if (m.ellipse) ctx.ellipse(m.rect.x + m.rect.width / 2, m.rect.y + m.rect.height / 2, m.rect.width / 2, m.rect.height / 2, 0, 0, Math.PI * 2);
        else ctx.rect(m.rect.x, m.rect.y, m.rect.width, m.rect.height);
        ctx.fill();
      });
      applySelection(c, m.ellipse ? 'Elliptical Marquee' : 'Rectangular Marquee');
      return;
    }
    case 'lasso':
      return finishLasso();
    case 'crop':
      cropDrag = null;
      return;
    case 'gradient':
      return endGradient();
    case 'shape':
      return finishShape();
  }
  void start;
}

function constrainAngle(a: Pt, b: Pt, on: boolean): Pt {
  if (!on) return { x: b.x, y: b.y };
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
}

function constrainShape(a: Pt, b: Pt): Pt {
  const t = store.state.opts.shapeType;
  if (t === 'line' || t === 'arrow') return constrainAngle(a, b, true);
  const m = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * m, y: a.y + Math.sign(b.y - a.y || 1) * m };
}

// ================================================================ selection tools

function applySelection(canvas: HTMLCanvasElement, label: string) {
  const doc = store.doc!;
  let c = canvas;
  const f = store.state.opts.selFeather;
  if (f > 0) {
    const s = sel.selectionFromCanvas(c);
    const fs = s && sel.feather(s, f);
    if (fs) c = fs.canvas;
  }
  store.setSelection(sel.combine(doc.selection, c, currentOp), label);
}

export function finishLasso() {
  const l = interaction.lasso;
  interaction.lasso = null;
  const doc = store.doc;
  if (!l || !doc || l.points.length < 3) {
    store.requestRender();
    return;
  }
  const c = sel.drawSelection(doc.width, doc.height, (ctx) => {
    ctx.beginPath();
    l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  });
  applySelection(c, l.poly ? 'Polygonal Lasso' : 'Lasso');
}

export function cancelLasso() {
  interaction.lasso = null;
  store.requestRender();
}

export function resetGestures() {
  dragStart = null;
  moveStart = null;
  transformDrag = null;
  cropDrag = null;
  interaction.guides = null;
  interaction.readout = null;
  interaction.pointer = null;
  interaction.hoverId = null;
}

function magicWand(e: PointerInfo) {
  const doc = store.doc!;
  currentOp = selOp(e);
  const o = store.state.opts;
  let data: Uint8ClampedArray;
  if (o.sampleAll) {
    const full = createCanvas(doc.width, doc.height);
    renderDocument(doc, full);
    data = ctx2d(full).getImageData(0, 0, doc.width, doc.height).data;
  } else {
    const layer = store.activeLayer;
    const surf = layer && layerSurface(layer);
    if (!surf) return;
    const tmp = createCanvas(doc.width, doc.height);
    ctx2d(tmp).drawImage(surf.canvas, surf.x, surf.y);
    data = ctx2d(tmp).getImageData(0, 0, doc.width, doc.height).data;
  }
  const mask = sel.floodMask(data, doc.width, doc.height, e.x, e.y, o.tolerance, o.contiguous);
  applySelection(sel.maskToCanvas(mask, doc.width, doc.height), 'Magic Wand');
}

// ================================================================ painting

function startStroke(e: PointerInfo) {
  const s = store.state;
  const doc = store.doc!;
  const tool = s.tool;

  // Alt+click: sample color (brush) or set clone source (clone stamp)
  if (e.alt && (tool === 'brush' || tool === 'pencil')) return pickColor(e.x, e.y);
  if ((tool === 'clone' || tool === 'heal-brush') && e.alt) {
    store.set({ cloneSource: { x: e.x, y: e.y, docId: doc.id } });
    cloneOffset = null;
    store.toast('Clone source set — now paint to clone');
    return;
  }

  const target = store.beginPixelEdit();
  if (!target) return;
  const isMask = target.isMask;

  let kind: BrushKind;
  let hide = false;
  let color = s.fg;
  switch (tool) {
    case 'brush':
    case 'pencil':
      kind = 'paint';
      if (isMask) {
        hide = luminance(s.fg) < 128;
        color = '#ffffff';
      }
      break;
    case 'eraser':
      kind = 'erase';
      break;
    case 'clone':
      kind = 'clone';
      break;
    case 'heal':
      kind = 'heal-mask';
      break;
    case 'heal-brush':
      kind = 'clone'; // paints source texture; tone is matched on release
      break;
    case 'bg-eraser':
      kind = 'bg-erase';
      break;
    case 'history-brush':
      kind = 'history';
      break;
    default:
      kind = tool as BrushKind;
  }
  if (isMask && !['paint', 'erase'].includes(kind)) {
    store.revert();
    store.toast('That tool works on pixels — click the layer thumbnail to leave mask editing', 'error');
    return;
  }
  const params = brushParams(kind, hide, color);
  if (!isMask && target.layer.lockAlpha) {
    if (kind === 'erase' || kind === 'bg-erase') {
      store.revert();
      store.toast('Transparency is locked on this layer', 'error');
      return;
    }
    params.lockAlpha = true;
  }

  if (kind === 'history') {
    const h = pro.historyPixels(target.layer.id, target);
    if (!h) {
      store.revert();
      store.toast('This layer did not exist at the History Brush source state', 'error');
      return;
    }
    params.history = h;
  }

  if (kind === 'clone') {
    const src = s.cloneSource;
    if (!src || src.docId !== doc.id) {
      store.revert();
      store.toast('Alt/Option-click to set a clone source first', 'error');
      return;
    }
    if (!s.opts.cloneAligned || !cloneOffset) cloneOffset = { x: src.x - e.x, y: src.y - e.y };
    let sourceCanvas: HTMLCanvasElement;
    let sx = 0;
    let sy = 0;
    if (s.opts.sampleAll) {
      sourceCanvas = createCanvas(doc.width, doc.height);
      renderDocument(doc, sourceCanvas);
    } else {
      sourceCanvas = cloneCanvas(target.canvas);
      sx = target.ox;
      sy = target.oy;
    }
    params.cloneSource = { canvas: sourceCanvas, x: sx, y: sy, dx: cloneOffset.x, dy: cloneOffset.y };
  }

  stroke = new Stroke(params, { canvas: target.canvas, ox: target.ox, oy: target.oy }, doc.selection?.canvas ?? null, doc.width, doc.height);
  const labels: Partial<Record<ToolId, string>> = {
    brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser', clone: 'Clone Stamp', heal: 'Spot Healing', smudge: 'Smudge',
    dodge: 'Dodge', burn: 'Burn', sponge: 'Sponge', blur: 'Blur', sharpen: 'Sharpen',
    'bg-eraser': 'Background Eraser', 'color-replace': 'Color Replacement', 'history-brush': 'History Brush', 'heal-brush': 'Healing Brush',
  };
  strokeMeta = { label: `${labels[tool] ?? 'Paint'}${isMask ? ' (Mask)' : ''}`, isMask, heal: kind === 'heal-mask', healBrush: tool === 'heal-brush' };
  stroke.add(e.x, e.y, e.pressure);
  pixelsChanged(target.canvas);
}

async function endStroke() {
  const st = stroke!;
  const meta = strokeMeta!;
  stroke = null;
  strokeMeta = null;
  interaction.stringAnchor = null;
  st.finish();
  touch(st.target.canvas);
  if (meta.heal && st.mask) {
    const original = st.original;
    const hole = st.mask;
    st.restoreOriginal();
    pixelsChanged(st.target.canvas);
    const result = await store.task('Healing', () => contentAwareFill(original, hole, 3));
    if (!result) return store.revert();
    const ctx = ctx2d(st.target.canvas);
    ctx.clearRect(0, 0, st.target.canvas.width, st.target.canvas.height);
    if (store.doc?.selection) {
      // Respect the selection: only healed pixels inside it
      ctx.drawImage(original, 0, 0);
      const tmp = createCanvas(result.width, result.height);
      const t = ctx2d(tmp);
      t.drawImage(result, 0, 0);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(store.doc.selection.canvas, -st.target.ox, -st.target.oy);
      ctx.drawImage(tmp, 0, 0);
    } else ctx.drawImage(result, 0, 0);
    touch(st.target.canvas);
  }
  if (meta.healBrush && st.mask && st.touched.r && st.p.cloneSource) {
    pro.healStroke({
      target: st.target.canvas,
      original: st.original,
      cover: st.mask,
      touched: st.touched.r,
      source: st.p.cloneSource,
      ox: st.target.ox,
      oy: st.target.oy,
      size: st.p.size,
      opacity: st.p.opacity,
      selection: store.doc?.selection?.canvas ?? null,
    });
    pixelsChanged(st.target.canvas);
  }
  store.commit(meta.label, {}, { icon: 'brush' });
}

// ================================================================ fill & gradient

function bucketFill(e: PointerInfo) {
  const doc = store.doc!;
  const target = store.beginPixelEdit();
  if (!target) return;
  const c = target.canvas;
  const lx = e.x - target.ox;
  const ly = e.y - target.oy;
  const o = store.state.opts;
  const ctx = ctx2d(c);
  let mask: Uint8Array;
  if (target.isMask) {
    mask = sel.floodMask(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, lx, ly, o.tolerance, o.contiguous);
  } else if (o.sampleAll) {
    const full = createCanvas(doc.width, doc.height);
    renderDocument(doc, full);
    const region = scratch('bucketRegion', c.width, c.height);
    ctx2d(region).drawImage(full, -target.ox, -target.oy);
    mask = sel.floodMask(ctx2d(region).getImageData(0, 0, c.width, c.height).data, c.width, c.height, lx, ly, o.tolerance, o.contiguous);
  } else {
    mask = sel.floodMask(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, lx, ly, o.tolerance, o.contiguous);
  }
  const fillC = sel.maskToCanvas(mask, c.width, c.height);
  const f = ctx2d(fillC);
  f.globalCompositeOperation = 'source-in';
  f.fillStyle = target.isMask ? '#ffffff' : store.state.fg;
  f.fillRect(0, 0, c.width, c.height);
  if (doc.selection) {
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(doc.selection.canvas, -target.ox, -target.oy);
  }
  ctx.save();
  ctx.globalAlpha = o.opacity;
  if (target.isMask && luminance(store.state.fg) < 128) ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(fillC, 0, 0);
  ctx.restore();
  pixelsChanged(c);
  store.commit('Paint Bucket', {}, { icon: 'fill' });
}

function startGradient(e: PointerInfo) {
  const target = store.beginPixelEdit();
  if (!target) return;
  gradientBase = { canvas: target.canvas, base: cloneCanvas(target.canvas), ox: target.ox, oy: target.oy, isMask: target.isMask };
  interaction.gradient = { a: { x: e.x, y: e.y }, b: { x: e.x, y: e.y } };
}

function drawGradient() {
  const g = interaction.gradient;
  const gb = gradientBase;
  const doc = store.doc;
  if (!g || !gb || !doc) return;
  const o = store.state.opts;
  const c = gb.canvas;
  const ctx = ctx2d(c);
  const a = { x: g.a.x - gb.ox, y: g.a.y - gb.oy };
  const b = { x: g.b.x - gb.ox, y: g.b.y - gb.oy };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let grad: CanvasGradient;
  if (o.gradientType === 'radial') grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, len);
  else if (o.gradientType === 'reflected') grad = ctx.createLinearGradient(a.x - (b.x - a.x), a.y - (b.y - a.y), b.x, b.y);
  else grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);

  let c0: string, c1: string;
  if (gb.isMask) {
    const l0 = luminance(store.state.fg) / 255;
    const l1 = o.gradientMode === 'fg-transparent' ? 0 : luminance(store.state.bg) / 255;
    c0 = `rgba(255,255,255,${l0})`;
    c1 = `rgba(255,255,255,${l1})`;
  } else {
    c0 = store.state.fg;
    c1 = o.gradientMode === 'fg-transparent' ? hexA(store.state.fg, 0) : store.state.bg;
  }
  if (o.gradientReverse) [c0, c1] = [c1, c0];
  if (o.gradientType === 'reflected') {
    grad.addColorStop(0, c1);
    grad.addColorStop(0.5, c0);
    grad.addColorStop(1, c1);
  } else {
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
  }

  const layerTmp = scratch('gradTmp', c.width, c.height);
  const t = ctx2d(layerTmp);
  t.fillStyle = grad;
  t.fillRect(0, 0, c.width, c.height);
  if (doc.selection) {
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(doc.selection.canvas, -gb.ox, -gb.oy);
  }
  ctx.save();
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(gb.base, 0, 0);
  if (gb.isMask) {
    // Mask gradients replace the masked area (classic graduated filter)
    ctx.globalCompositeOperation = 'destination-out';
    if (doc.selection) ctx.drawImage(doc.selection.canvas, -gb.ox, -gb.oy);
    else ctx.clearRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
  } else ctx.globalAlpha = o.opacity;
  ctx.drawImage(layerTmp, 0, 0);
  ctx.restore();
  pixelsChanged(c);
}

function hexA(hex: string, a: number) {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
}

function endGradient() {
  const g = interaction.gradient;
  interaction.gradient = null;
  const gb = gradientBase;
  gradientBase = null;
  if (!g || !gb) return;
  if (Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) < 2) {
    store.revert();
    return;
  }
  drawGradient();
  store.commit(gb.isMask ? 'Gradient (Mask)' : 'Gradient', {}, { icon: 'gradient' });
}

// ================================================================ shapes

/** The draft's geometry: corner-to-corner, or centre-out while Alt is held. */
export function shapeDraftRect(d: { a: Pt; b: Pt; center?: boolean }): { x: number; y: number; w: number; h: number } {
  if (d.center) return { x: 2 * d.a.x - d.b.x, y: 2 * d.a.y - d.b.y, w: 2 * (d.b.x - d.a.x), h: 2 * (d.b.y - d.a.y) };
  return { x: d.a.x, y: d.a.y, w: d.b.x - d.a.x, h: d.b.y - d.a.y };
}

function finishShape() {
  const d = interaction.shapeDraft;
  interaction.shapeDraft = null;
  const doc = store.doc;
  if (!d || !doc) return;
  const o = store.state.opts;
  const isLine = o.shapeType === 'line' || o.shapeType === 'arrow';
  const r = shapeDraftRect(d);
  let { x, y, w, h } = r;
  // A press that barely moves on screen is a click (measured in screen pixels, so tiny shapes
  // can be drawn at a high zoom): it makes a default-size shape centred on the click, 200 px on screen
  const zoom = doc.view.zoom;
  if (Math.abs(w) * zoom < 3 && Math.abs(h) * zoom < 3) {
    const size = zoom > 1 ? 200 / zoom : 200;
    w = size;
    h = isLine ? 0 : size;
    if (!isLine) {
      x = d.a.x - size / 2;
      y = d.a.y - size / 2;
    }
  }
  if (!isLine) {
    x = Math.min(x, x + w);
    y = Math.min(y, y + h);
    w = Math.abs(w);
    h = Math.abs(h);
  }
  const shape: ShapeProps = {
    shape: o.shapeType,
    fill: store.state.fg,
    fillEnabled: o.shapeFill,
    stroke: o.shapeFill ? o.shapeStrokeColor : store.state.fg,
    strokeWidth: isLine ? Math.max(2, o.shapeStrokeWidth || 6) : o.shapeFill ? o.shapeStrokeWidth : Math.max(2, o.shapeStrokeWidth || 4),
    radius: o.shapeRadius,
    sides: o.shapeSides,
    ...extrasFor(o.shapeType, o.shapeExtras),
  };
  const names: Record<string, string> = { rectangle: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', polygon: 'Polygon', star: 'Star', line: 'Line', arrow: 'Arrow', spiral: 'Spiral' };
  const layer = makeLayer({ kind: 'shape', name: names[o.shapeType], shape, x, y, width: w, height: h });
  store.insertLayer(layer, undefined, `New ${names[o.shapeType]}`);
}

export function cursorFor(tool: ToolId): string {
  switch (tool) {
    case 'move':
      return 'move';
    case 'hand':
      return 'grab';
    case 'zoom':
      return 'zoom-in';
    case 'text':
      return 'text';
    case 'eyedropper':
    case 'color-sampler':
      return 'copy';
    case 'pen':
    case 'ruler':
    case 'red-eye':
    case 'magic-eraser':
    case 'marquee-row':
    case 'marquee-col':
      return 'crosshair';
    default:
      return 'crosshair';
  }
}
