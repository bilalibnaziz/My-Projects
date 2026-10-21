import type { Layer, Rect, ShapeProps, TextProps, TextStyle, PathAnchor } from './types';
import * as traceTool from './studio/trace';
import { ancestors, groupLayers, shownInDoc } from './groups';
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
import { cutPathAt } from './pathCut';
import { toDoc as toFrameDoc, toLocal as toFrameLocal } from './objectTransform';
import { layoutSnap, gridPages } from './gridOps';
import { snapStep } from './grids';
import type { SnapTargets } from './snap';
import * as pro from './proTools';
import { layerBounds } from './align';
import {
  beginObjectDrag, commitObjectDrag, frameAabb, frameHit, frameVisible, handleCursor, hideObjectSelection,
  layerFrame, previewObjectDrag, selectionFrame, showObjectSelection, transformTargets,
} from './objectTransform';
import type { DragMods, Frame, ObjectDrag } from './objectTransform';
import {
  convertToEditablePath, getActiveArtboard, addArtboard, updateArtboard,
  solveHarmonicCurvature, toggleAnchorSmooth, dist, shapeBuilderRegions, regionAt, applyShapeBuilder, livePaintRegion,
  addAnchorToLayerPath, deleteAnchorFromLayerPath,
  joinPaths
} from './vectorOps';
import * as vt from './vectorTools';
import { extrasFor } from './shapeGeometry';
import { dragWidget, nextCornerStyle, sharpenPathCorner, widgetAt, widgetTarget, WIDGET_LABELS } from './shapeWidgets';
import type { ShapeWidget } from './shapeWidgets';
import { appearanceOf, applyAppearance } from './appearanceCopy';
import { BOX_TYPE_LABELS, dielineLayers, generateDieline, type PackagingSpec } from './dieline';
import { graphTypeOfTool, lastGraphSpec } from './graphOps';
import { setTileOrigin, tileOrigin, tilingArea } from './printTiling';
import {
  StreamLineStabilizer,
  detectQuickShape,
  editPathWithStroke,
  fitStroke,
  normalizeAnchors,
  type QuickShapeResult,
} from './pencilEngine';

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
  /** Direct selection active anchor index on selected layer */
  selectedAnchorIndex: null as null | number,
  /** Layer the selected anchor belongs to (the index means nothing on another layer). */
  selectedAnchorLayer: null as null | string,
  /** Curvature tool working path */
  curvaturePath: null as null | { points: Pt[]; cursor: Pt | null },
  /** Artboard tool drag box */
  artboardDraft: null as null | { a: Pt; b: Pt },
  /** Shape Builder: region under the pointer, and the regions collected by the current drag. */
  shapeBuilder: null as null | { hover: number; picked: number[]; erase: boolean },
  /** Print Tiling tool drag: moves the page origin. */
  printDrag: null as null | { start: Pt; origin: Pt },
  /** Selection tool: rubber-band box selecting the objects it touches. */
  objectMarquee: null as null | Rect,
  /** Selection tool: the object under the pointer (outlined before it is clicked). */
  hoverId: null as null | string,
  /** Live size / angle readout next to the pointer while resizing or rotating (document point). */
  readout: null as null | { text: string; x: number; y: number },
  /** Super Vector Pencil draft overlay */
  pencilDraft: null as null | {
    points: Pt[];
    rawCursor: Pt | null;
    isNearStart: boolean;
    ropeLead: Pt | null;
    quickShapeKind?: string | null;
    /** QuickShape found while the pen is held still at the end of the stroke (previewed, used on release). */
    quickShape?: QuickShapeResult | null;
    /** Where the pen last came to rest and when (for the hold-to-QuickShape gesture). */
    holdAt?: Pt;
  },
  /** Freehand drag of a path tool (Paintbrush, Blob Brush, Eraser, Path Eraser, Knife, Shaper). */
  toolPath: null as null | { tool: ToolId; points: Pt[] },
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
  'brush', 'blob-brush', 'eraser', 'clone', 'heal', 'smudge', 'dodge', 'burn', 'sponge', 'blur', 'sharpen',
  'bg-eraser', 'color-replace', 'history-brush', 'heal-brush',
];

export function isBrushTool(t: ToolId) {
  return PAINT_TOOLS.includes(t);
}

export function isShapeTool(tool: ToolId): boolean {
  return (
    tool === 'shape' ||
    tool === 'shape-rect' ||
    tool === 'shape-round-rect' ||
    tool === 'shape-ellipse' ||
    tool === 'shape-polygon' ||
    tool === 'shape-star' ||
    tool === 'line' ||
    tool === 'arc' ||
    tool === 'spiral' ||
    tool === 'rect-grid' ||
    tool === 'polar-grid' ||
    tool === 'flare' ||
    tool.startsWith('graph-')
  );
}

export function getToolShapeType(tool: ToolId, optType: ShapeProps['shape']): ShapeProps['shape'] {
  switch (tool) {
    case 'shape-rect':
      return 'rectangle';
    case 'shape-round-rect':
      return 'round-rect';
    case 'shape-ellipse':
      return 'ellipse';
    case 'shape-polygon':
      return 'polygon';
    case 'shape-star':
      return 'star';
    case 'line':
      return 'line';
    case 'arc':
      return 'arc';
    case 'spiral':
      return 'spiral';
    case 'rect-grid':
      return 'grid';
    case 'polar-grid':
      return 'polar-grid';
    case 'flare':
      return 'flare';
    default:
      if (tool.startsWith('graph-')) return 'graph';
      return optType;
  }
}

export function isLiquifyTool(tool: ToolId): boolean {
  return ['warp', 'twirl', 'pucker', 'bloat', 'scallop', 'crystallize', 'wrinkle'].includes(tool);
}

function selOp(e: PointerInfo): SelOp {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return 'replace';
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

let directSelectDrag: {
  layerId: string;
  anchorIndex: number;
  handle: 'anchor' | 'in' | 'out';
  startPt: Pt;
  originalAnchors: PathAnchor[];
  box: Rect;
} | null = null;

let artboardDrag: {
  mode: 'new' | 'move' | string;
  id: string;
  start: Pt;
  rect: Rect;
  /** Moving: the artwork on the artboard, as it was when the drag began (it moves along). */
  riders?: Layer[];
} | null = null;

/** Top-level, unlocked layers whose centre sits on the artboard (they travel with it). */
function artboardRiders(r: Rect): Layer[] {
  const doc = store.doc;
  if (!doc) return [];
  return doc.layers.filter((l) => {
    if (l.parent || l.locked || l.kind === 'adjustment' || isBackdrop(l)) return false;
    const f = l.kind === 'group' ? selectionFrame([l]) : layerFrame(l);
    return !!f && f.cx >= r.x && f.cx <= r.x + r.width && f.cy >= r.y && f.cy <= r.y + r.height;
  });
}

// ================================================================ helpers

function sampleColor(x: number, y: number): string | null {
  // "Sample Size" averages a square around the pixel, like Photoshop's 3×3 / 5×5 average
  const s = pro.sampleAverage(x, y, store.state.opts.samplerSize);
  return s && s.a > 0 ? pro.toHex(s.rgb) : null;
}

export function pickColor(x: number, y: number, toBackground = false) {
  const hex = sampleColor(x, y);
  if (!hex) return;
  if (toBackground) store.set({ bg: hex });
  else store.set({ fg: hex });
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

/**
 * The page itself: the bottom pixel layer covering the whole document (a new document's
 * Background). A click on the canvas never grabs it; pick it in the Layers panel instead.
 */
export function isBackdrop(l: Layer): boolean {
  const doc = store.doc;
  if (!doc || l.kind !== 'raster' || l.parent || doc.layers[0]?.id !== l.id || !l.canvas) return false;
  return l.x <= 0 && l.y <= 0 && l.x + l.canvas.width >= doc.width && l.y + l.canvas.height >= doc.height;
}

export function topLayerAt(x: number, y: number, opts: { skipLocked?: boolean; tol?: number } = {}): Layer | null {
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

export const CROP_RATIOS: Record<string, number | null> = { free: null, '1:1': 1, '4:5': 4 / 5, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16 };

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

export function createTextAt(x: number, y: number, boxWidth?: number, extra: Partial<TextProps> = {}) {
  const o = store.state.opts;
  const text: TextProps = {
    ...baseText(),
    ...extra,
  };
  if (boxWidth) text.boxWidth = Math.round(boxWidth);
  // A click puts the line's middle at the click; a dragged box starts at its top edge (vertical: the column's top)
  const layer = makeLayer({
    kind: 'text',
    name: DEFAULT_TEXT,
    text,
    x: text.vertical ? x - (boxWidth ? 0 : o.fontSize * 0.6) : x,
    y: boxWidth || text.vertical ? y : y - o.fontSize * 0.6,
  });
  const sized = withLayer(layer, syncTextBounds(layer));
  // Vertical area type grows leftwards from the right edge of the dragged box
  const placed = text.vertical && boxWidth ? withLayer(sized, { x: x - sized.width }) : sized;
  store.insertLayer(placed, undefined, 'New Text');
  store.set({ textEditId: placed.id });
}

/** Type on a path: the text runs along `points` (document space) from its start. */
export function createPathText(points: Pt[], closed: boolean, vertical = false) {
  const o = store.state.opts;
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const x = minX - o.fontSize;
  const y = minY - o.fontSize;
  const text: TextProps = { ...baseText(), vertical, path: { points: points.map((p) => ({ x: p.x - x, y: p.y - y })), closed } };
  const layer = makeLayer({ kind: 'text', name: DEFAULT_TEXT, text, x, y });
  const sized = withLayer(layer, syncTextBounds(layer));
  store.insertLayer(sized, undefined, 'Type on a Path');
  store.set({ textEditId: sized.id });
}

/** Text settings for new type, from the options bar. */
function baseText(): TextProps {
  const o = store.state.opts;
  return {
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

// ================================================================ Super Vector Pencil

let pencilStabilizer = new StreamLineStabilizer(12);
let pencilHoldTimer: ReturnType<typeof setTimeout> | null = null;
let pencilZoom = 1;
/** Holding the pen still this long at the end of a stroke snaps it to a QuickShape (as in Procreate). */
const PENCIL_HOLD_MS = 450;

function clearPencilHold() {
  if (pencilHoldTimer) clearTimeout(pencilHoldTimer);
  pencilHoldTimer = null;
}

/** The selected, editable path a pencil stroke may reshape, extend or close (document-space anchors). */
function pencilTarget(): { layer: Layer; anchors: PathAnchor[]; closed: boolean } | null {
  const l = store.activeLayer;
  if (!l || l.kind !== 'shape' || l.locked || !l.visible || l.shape?.shape !== 'path') return null;
  if (!store.selectedLayers.some((s) => s.id === l.id)) return null;
  const pts = l.shape.points;
  if (!pts || pts.length < 2 || l.shape.compoundPoints?.length || (l.rotation ?? 0) % 360 !== 0) return null;
  const X = (v: number) => l.x + v * l.width;
  const Y = (v: number) => l.y + v * l.height;
  return {
    layer: l,
    anchors: pts.map((p) => ({ ...p, x: X(p.x), y: Y(p.y), ix: X(p.ix), iy: Y(p.iy), ox: X(p.ox), oy: Y(p.oy) })),
    closed: !!l.shape.closed,
  };
}

export function pencilDown(e: PointerInfo) {
  const opts = store.state.opts;
  clearPencilHold();
  pencilZoom = e.zoom || 1;
  // StreamLine is measured on screen, so the rope feels the same at every zoom
  pencilStabilizer = new StreamLineStabilizer(opts.pencilStreamline / pencilZoom);
  const stab = pencilStabilizer.update({ x: e.x, y: e.y });
  interaction.pencilDraft = {
    points: [{ x: stab.point.x, y: stab.point.y }],
    rawCursor: { x: e.x, y: e.y },
    isNearStart: false,
    ropeLead: null,
    quickShape: null,
    quickShapeKind: null,
    holdAt: { x: e.x, y: e.y },
  };
  store.requestRender();
}

export function pencilMove(e: PointerInfo) {
  const draft = interaction.pencilDraft;
  if (!draft) return;
  const opts = store.state.opts;
  const stab = pencilStabilizer.update({ x: e.x, y: e.y });
  const last = draft.points[draft.points.length - 1];
  if (stab.point.x !== last.x || stab.point.y !== last.y) draft.points.push({ x: stab.point.x, y: stab.point.y });
  draft.rawCursor = { x: e.x, y: e.y };
  draft.ropeLead = stab.ropeActive && Math.hypot(e.x - stab.point.x, e.y - stab.point.y) > 0.5 / pencilZoom ? { x: e.x, y: e.y } : null;

  const pts = draft.points;
  draft.isNearStart = !!opts.pencilAutoClose && pts.length > 5 && pathLen(pts) > (opts.pencilCloseThreshold * 3) / pencilZoom &&
    Math.hypot(e.x - pts[0].x, e.y - pts[0].y) <= opts.pencilCloseThreshold / pencilZoom;

  // Hold-to-QuickShape: moving more than a few screen pixels cancels the snap and restarts the hold timer
  const hold = draft.holdAt ?? { x: e.x, y: e.y };
  if (Math.hypot(e.x - hold.x, e.y - hold.y) > 4 / pencilZoom) {
    draft.holdAt = { x: e.x, y: e.y };
    draft.quickShape = null;
    draft.quickShapeKind = null;
    clearPencilHold();
    if (opts.pencilQuickShape) {
      pencilHoldTimer = setTimeout(() => {
        const d = interaction.pencilDraft;
        if (!d || d !== draft) return;
        const qs = detectQuickShape([...d.points, d.rawCursor ?? d.points[d.points.length - 1]], opts.pencilCloseThreshold / pencilZoom);
        d.quickShape = qs;
        d.quickShapeKind = qs?.kind ?? null;
        store.requestRender();
      }, PENCIL_HOLD_MS);
    }
  }
  store.requestRender();
}

function pathLen(pts: Pt[]) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** A QuickShape result as a layer (live rectangle / ellipse / line / triangle where possible, else exact path). */
export function quickShapeLayer(qs: QuickShapeResult, name: string): Layer {
  const o = store.state.opts;
  const isLine = qs.shapeType === 'line';
  const open = isLine || !qs.closed;
  const shape: ShapeProps = {
    shape: qs.shapeType,
    fill: store.state.fg,
    fillEnabled: !open && o.shapeFill,
    stroke: !open && o.shapeFill ? o.shapeStrokeColor : store.state.fg,
    strokeWidth: open ? Math.max(1, o.shapeStrokeWidth || 3) : o.shapeFill ? o.shapeStrokeWidth : Math.max(1, o.shapeStrokeWidth || 3),
    radius: 0,
    strokeCap: 'round',
    strokeJoin: qs.anchors ? 'miter' : 'round',
  };
  if (qs.shapeType === 'path' && qs.anchors) {
    const { layerRect, points } = normalizeAnchors(qs.anchors);
    return makeLayer({ kind: 'shape', name, shape: { ...shape, points, closed: qs.closed }, x: layerRect.x, y: layerRect.y, width: layerRect.width, height: layerRect.height });
  }
  if (isLine && qs.from && qs.to) {
    // A line keeps its direction: its box runs from the first point to the last
    return makeLayer({ kind: 'shape', name, shape, x: qs.from.x, y: qs.from.y, width: qs.to.x - qs.from.x, height: qs.to.y - qs.from.y });
  }
  return makeLayer({
    kind: 'shape', name, shape,
    x: qs.rect.x, y: qs.rect.y, width: Math.max(1e-3, qs.rect.width), height: Math.max(1e-3, qs.rect.height),
    ...(qs.rotation ? { rotation: qs.rotation } : {}),
  });
}

export function pencilUp(e: PointerInfo) {
  const draft = interaction.pencilDraft;
  interaction.pencilDraft = null;
  clearPencilHold();
  const doc = store.doc;
  if (!draft || !doc) {
    store.requestRender();
    return;
  }
  const opts = store.state.opts;
  const zoom = pencilZoom;
  const finalPt = pencilStabilizer.flush({ x: e.x, y: e.y });
  const pts = [...draft.points];
  const tail = pts[pts.length - 1];
  if (Math.hypot(finalPt.x - tail.x, finalPt.y - tail.y) > 0.25 / zoom) pts.push({ x: finalPt.x, y: finalPt.y });
  // A click (no real movement on screen) draws nothing
  if (pts.length < 2 || pathLen(pts) * zoom < 3) {
    store.requestRender();
    return;
  }

  // 1. QuickShape: only when the pen was held still at the end (a quick lift keeps the freehand line)
  if (opts.pencilQuickShape && draft.quickShape) {
    const qs = detectQuickShape(pts, opts.pencilCloseThreshold / zoom) ?? draft.quickShape;
    const label = qs.kind.charAt(0).toUpperCase() + qs.kind.slice(1);
    store.insertLayer(quickShapeLayer(qs, label), undefined, `QuickShape ${label}`);
    return;
  }

  // Fidelity is in screen pixels: the same hand gives the same smoothness at every zoom
  const tol = Math.max(0.25, opts.pencilFidelity) / zoom;
  const fit = { minStep: 0.75 / zoom, reach: Math.max(tol * 2.5, 6 / zoom) };

  // 2. Edit the selected path: reshape between two points on it, extend from an open end, or close it
  const target = opts.pencilSculpt ? pencilTarget() : null;
  if (target) {
    const r = editPathWithStroke(target.anchors, target.closed, pts, 12 / zoom, tol, fit);
    if (r) {
      const { layerRect, points } = normalizeAnchors(r.anchors);
      const shape: ShapeProps = { ...target.layer.shape!, points, closed: r.closed };
      if (r.mode === 'close' && opts.shapeFill) shape.fillEnabled = true;
      const updated = withLayer(target.layer, { ...layerRect, shape });
      const label = r.mode === 'close' ? 'Close Path' : r.mode === 'extend' ? 'Extend Path' : 'Reshape Path';
      store.commit(label, { layers: doc.layers.map((l) => (l.id === updated.id ? updated : l)) });
      return;
    }
  }

  // 3. A new freehand path, closed when it ends on its start
  const closeTol = opts.pencilCloseThreshold / zoom;
  const isClosed = !!opts.pencilAutoClose && pathLen(pts) > closeTol * 3 &&
    Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) <= closeTol;
  const anchors = fitStroke(pts, tol, { ...fit, closed: isClosed });
  if (anchors.length < 2) {
    store.requestRender();
    return;
  }
  const { layerRect, points } = normalizeAnchors(anchors);
  const shape: ShapeProps = {
    shape: 'path',
    points,
    closed: isClosed,
    fill: store.state.fg,
    fillEnabled: isClosed && opts.shapeFill,
    stroke: opts.shapeFill ? opts.shapeStrokeColor : store.state.fg,
    strokeWidth: Math.max(0.1, opts.shapeStrokeWidth || 3),
    radius: 0,
    strokeCap: 'round',
    strokeJoin: 'round',
  };
  const layer = makeLayer({ kind: 'shape', name: isClosed ? 'Pencil Shape' : 'Pencil Path', shape, ...layerRect });
  store.insertLayer(layer, undefined, isClosed ? 'New Pencil Shape' : 'New Pencil Path');
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
  e = snapDrawPoint(e, true);
  dragStart = { x: e.x, y: e.y };
  interaction.pointer = dragStart;

  // Free transform owns the pointer while active
  if (s.transform) {
    const mode = transformHit(e, e.zoom);
    transformDrag = { mode, start: dragStart, t: { ...s.transform } };
    return;
  }

  if (s.tool === 'image-trace') return traceTool.traceToolDown(e, e.alt);
  if (vectorDown(e)) return;

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
    case 'pencil':
      return pencilDown(e);
    case 'ruler':
      return pro.rulerDown(e);
    case 'color-sampler':
      return pro.samplerDown(e);
    case 'marquee-rect':
    case 'marquee-ellipse':
      currentOp = selOp(e);
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
      if (eyedropperAppearance(e)) return;
      return pickColor(e.x, e.y, e.alt);
    case 'bucket':
      return bucketFill(e);
    case 'gradient':
      return startGradient(e);
    case 'path-type':
    case 'vertical-path-type': {
      const hit = topLayerAt(e.x, e.y, { skipLocked: true, tol: 6 / e.zoom });
      if (hit?.kind === 'text') {
        store.selectLayer(hit.id);
        store.set({ textEditId: hit.id });
        return;
      }
      const path = hit?.kind === 'shape' && hit.shape ? hit : vt.isEditableShape(store.activeLayer) ? store.activeLayer : null;
      if (!path) {
        store.toast('Type on a Path: click on a path or shape');
        return;
      }
      const { subs, closed } = vt.docSubpaths(path);
      let pts = vt.samplePath(subs[0], closed, 2);
      // Closed paths start where they were clicked
      if (closed && pts.length > 2) {
        let k = 0;
        pts.forEach((q, i) => {
          if (Math.hypot(q.x - e.x, q.y - e.y) < Math.hypot(pts[k].x - e.x, pts[k].y - e.y)) k = i;
        });
        pts = [...pts.slice(k), ...pts.slice(0, k)];
      }
      createPathText(pts, closed, s.tool === 'vertical-path-type');
      return;
    }
    case 'text':
    case 'area-type':
    case 'touch-type':
    case 'vertical-type':
    case 'vertical-area-type': {
      const hit = topLayerAt(e.x, e.y);
      if (hit?.kind === 'text') {
        store.selectLayer(hit.id);
        store.set({ textEditId: hit.id });
      } else if (s.textEditId) {
        store.set({ textEditId: null });
      } else interaction.textBox = { a: { x: e.x, y: e.y }, b: { x: e.x, y: e.y } };
      return;
    }
    case 'direct-select':
      return directSelectDown(e);
    case 'group-select': {
      const target = topLayerAt(e.x, e.y);
      if (target) {
        if (store.state.docs.find((d) => d.id === store.state.activeDocId)?.activeId === target.id) {
          const ancs = ancestors(store.doc!.layers, target);
          if (ancs.length > 0) store.selectLayer(ancs[0].id);
        } else {
          store.selectLayer(target.id);
        }
      }
      return;
    }
    case 'curvature':
      return curvatureDown(e);
    case 'anchor-point':
      return anchorPointDown(e);
    case 'add-anchor': {
      const active = store.activeLayer;
      const tol = 8 / e.zoom;
      const target = active && active.kind === 'shape' ? active : topLayerAt(e.x, e.y, { skipLocked: true, tol });
      if (target && target.kind === 'shape') {
        const updated = addAnchorToLayerPath(target, e.x, e.y);
        store.commit('Add Anchor Point', { layers: store.doc!.layers.map((l) => (l.id === updated.id ? updated : l)), activeId: updated.id });
      }
      return;
    }
    case 'delete-anchor': {
      const active = store.activeLayer;
      const tol = 8 / e.zoom;
      const target = active && active.kind === 'shape' ? active : topLayerAt(e.x, e.y, { skipLocked: true, tol });
      if (target && target.kind === 'shape') {
        const updated = deleteAnchorFromLayerPath(target, e.x, e.y);
        store.commit('Delete Anchor Point', { layers: store.doc!.layers.map((l) => (l.id === updated.id ? updated : l)), activeId: updated.id });
      }
      return;
    }
    case 'scissors': {
      // Cut at the clicked point on the path (any path under the cursor, the selected one first)
      const doc = store.doc!;
      const tol = 8 / e.zoom;
      const active = store.activeLayer;
      const target = active?.kind === 'shape' && cutPathAt(active, e.x, e.y, tol) ? active : doc.layers.slice().reverse().find((l) => l.kind === 'shape' && l.visible && !l.locked && cutPathAt(l, e.x, e.y, tol));
      const pieces = target ? cutPathAt(target, e.x, e.y, tol) : null;
      if (!target || !pieces) {
        store.toast('Click on a path to cut it there');
        return;
      }
      const at = doc.layers.findIndex((l) => l.id === target.id);
      const layers = [...doc.layers.slice(0, at), ...pieces, ...doc.layers.slice(at + 1)];
      store.commit(pieces.length === 1 ? 'Open Path' : 'Split Path', { layers, activeId: pieces[0].id });
      return;
    }
    case 'join': {
      joinPaths();
      return;
    }
    case 'rotate':
    case 'scale': {
      // Illustrator: drag anywhere to rotate / scale the selection about its centre. Vectors stay
      // live (rotation and size, no pixels); ⇧ snaps the angle / keeps proportions.
      const picked = store.selectedLayers.filter((l) => !l.locked && l.kind !== 'adjustment');
      const f = picked.length ? selectionFrame(picked) : null;
      if (!f) {
        store.toast(`Select an object to ${s.tool}`);
        return;
      }
      if (s.tool === 'rotate') {
        objectDrag = beginObjectDrag('rotate', { x: e.x, y: e.y }, picked);
      } else {
        // Scale is a centred corner drag whose corner follows the pointer's distance from the centre
        const corner = toFrameDoc(f, f.w / 2, f.h / 2);
        objectDrag = beginObjectDrag('se', corner, picked);
        scaleTool = { f, start: toFrameLocal(f, { x: e.x, y: e.y }) };
      }
      return;
    }
    case 'free-transform':
      ops.beginTransform();
      return;
    case 'reflect':
      ops.flipLayer(e.alt ? 'v' : 'h');
      return;
    case 'artboard':
      return artboardDown(e);
    case 'shape-builder': {
      const b = shapeBuilderRegions();
      if (!b) {
        store.toast('Select the shapes to build from first');
        return;
      }
      const hit = regionAt(b.regions, e.x, e.y);
      interaction.shapeBuilder = { hover: hit, picked: hit >= 0 ? [hit] : [], erase: e.alt };
      store.requestRender();
      return;
    }
    case 'zoom':
      return; // handled by viewport
    default:
      if (isShapeTool(s.tool)) {
        interaction.shapeDraft = { a: dragStart, b: dragStart };
        return;
      }
      if (isBrushTool(s.tool)) startStroke(e);
  }
}

/** Brush radius of the path tools, in document pixels. */
const pathToolRadius = () => Math.max(0.5, (store.state.opts.size || 10) / 2);

/** Presses of the vector geometry tools (vectorTools.ts). True when the press was handled. */
function vectorDown(e: PointerInfo): boolean {
  const s = store.state;
  const tool = s.tool;
  const doc = store.doc!;
  const active = store.activeLayer;
  const p = { x: e.x, y: e.y };
  const shapeAt = () => {
    const h = topLayerAt(e.x, e.y, { skipLocked: true, tol: 4 / e.zoom });
    return h && h.kind === 'shape' && h.shape ? h : null;
  };
  // The shape under the pointer (selecting it), else the active shape
  const target = () => {
    const h = shapeAt();
    if (h) {
      if (h.id !== active?.id) store.selectLayer(h.id);
      return h;
    }
    return vt.isEditableShape(active) ? active : null;
  };
  // On a pixel layer (not the page itself) the Paintbrush and Eraser work on pixels
  const pixelTarget = active?.kind === 'raster' && !isBackdrop(active) && !store.selectedLayers.some((l) => l.kind === 'shape');
  switch (tool) {
    case 'brush':
      if (pixelTarget) return false;
      if (e.alt) return pickColor(e.x, e.y), true;
      interaction.toolPath = { tool, points: [p] };
      store.requestRender();
      return true;
    case 'blob-brush':
    case 'path-eraser':
    case 'knife':
    case 'shaper':
      interaction.toolPath = { tool, points: [p] };
      store.requestRender();
      return true;
    case 'eraser':
      if (pixelTarget) return false;
      interaction.toolPath = { tool, points: [p] };
      store.requestRender();
      return true;
    case 'shear': {
      let targets = store.selectedLayers.filter(vt.isEditableShape);
      if (!targets.length) {
        const h = shapeAt();
        if (h) {
          store.selectLayer(h.id);
          targets = [h];
        }
      }
      if (!vt.shearDown(p, targets)) store.toast('Shear: select a shape first');
      return true;
    }
    case 'reshape': {
      const l = vt.isEditableShape(active) ? active : target();
      if (!l || !vt.reshapeDown(p, l, e.zoom)) store.toast('Reshape: drag a point on the selected path');
      return true;
    }
    case 'puppet-warp': {
      const l = vt.vectorOverlay.pins?.layerId === active?.id && vt.isEditableShape(active) ? active : target();
      if (!l || !vt.puppetDown(p, l, e.zoom, e.alt)) store.toast('Puppet Warp: click a shape to pin it, then drag a pin');
      return true;
    }
    case 'warp':
    case 'twirl':
    case 'pucker':
    case 'bloat':
    case 'scallop':
    case 'crystallize':
    case 'wrinkle': {
      const l = vt.isEditableShape(active) ? active : target();
      if (!l || !vt.liquifyDown(p, l, tool, Math.max(20, s.opts.size || 60))) store.toast('Select a shape to reshape with this tool');
      return true;
    }
    case 'gradient': {
      let targets = store.selectedLayers.filter((l) => vt.isEditableShape(l) && l.shape!.fillEnabled);
      if (!targets.length) {
        const h = shapeAt();
        if (h && h.shape!.fillEnabled) targets = [h];
      }
      return vt.gradientDown(p, targets, e.alt, e.zoom);
    }
    case 'smooth': {
      // Smooth tool: brush over a path to smooth that part; a click smooths the whole path
      const h = shapeAt();
      const l = h ?? (vt.isEditableShape(active) ? active : null);
      if (h && h.id !== active?.id) store.selectLayer(h.id);
      if (!l || !vt.smoothDown(p, l, Math.max(8, (s.opts.size || 30) / 2))) store.toast('Smooth: brush over a path to smooth it');
      return true;
    }
    case 'width': {
      // Width tool: add / drag / ⌥-delete width points on the stroke under the pointer
      const h = shapeAt();
      const l = h ?? (vt.isEditableShape(active) ? active : null);
      if (h && h.id !== active?.id) store.selectLayer(h.id);
      if (!l || !vt.widthDown(p, l, e.zoom, e.alt)) store.toast('Width tool: drag on a stroked path to change its width there');
      return true;
    }
    case 'mesh': {
      const l = target();
      if (!l || !vt.meshDown(p, l, e.zoom, e.alt)) store.toast('Mesh: click inside a filled shape to add a colour point');
      return true;
    }
    case 'blend':
      return vt.blendClick(shapeAt(), Math.max(1, Math.round(s.opts.blendSteps || 5)));
    case 'bucket':
      // Overlapping shapes selected: paint the region under the pointer, not the whole shape
      if (livePaintRegion(e.x, e.y, s.fg, e.alt)) return true;
      return vt.paintBucket(shapeAt(), e.alt);
    case 'print-tiling': {
      // Drag moves the page grid; double-click opens the paper settings
      if (e.detail >= 2) {
        store.set({ dialog: { type: 'printTiling' } });
        return true;
      }
      interaction.printDrag = { start: p, origin: tileOrigin(doc.id, tilingArea(doc)) };
      return true;
    }
    case 'live-paint-select': {
      // Picks single regions (faces) of a Live Paint Group: ⇧ adds/removes, double-click selects every region of that colour
      const h = shapeAt();
      if (!h) {
        if (!e.shift) store.setSelectedLayers([]);
        return true;
      }
      if (e.detail >= 2) {
        const same = doc.layers.filter((l) => l.kind === 'shape' && l.parent === h.parent && l.shape?.fill === h.shape!.fill && l.visible && !l.locked);
        store.setSelectedLayers(same.map((l) => l.id));
      } else store.selectLayer(h.id, e.shift ? 'toggle' : 'replace');
      return true;
    }
    case 'slice':
    case 'slice-select':
      return vt.sliceDown(p, tool);
    case 'perspective-grid':
      return vt.gridDown(p, e.zoom, e.shift);
    case 'perspective-select': {
      const h = shapeAt();
      if (h) store.selectLayer(h.id);
      return vt.perspDown(p, h);
    }
    case 'packaging': {
      // A click places the box from the options bar, centred on the pointer
      const o = s.opts;
      const spec: PackagingSpec = {
        type: o.packagingBoxType ?? 'reverse-tuck',
        length: o.packagingLength ?? 60,
        width: o.packagingWidth ?? 30,
        depth: o.packagingDepth ?? 120,
        glue: o.packagingGlue ?? 15,
        tuck: o.packagingTuck ?? 15,
        ppi: o.packagingPpi ?? 300,
        foldStyle: o.packagingFoldStyle ?? 'dotted',
        bleed: o.packagingBleed ?? 3,
        includeBleed: o.packagingIncludeBleed,
      };
      const d = generateDieline(spec);
      const parts = dielineLayers(d, Math.round(e.x - d.width / 2), Math.round(e.y - d.height / 2), Math.max(1, Math.round((spec.ppi ?? 300) / 150)), spec);
      const grouped = groupLayers([...doc.layers, ...parts], parts.map((l) => l.id), `Dieline · ${BOX_TYPE_LABELS[spec.type!]} (${spec.length}×${spec.width}×${spec.depth} mm)`);
      if (grouped) store.commit('Add Packaging Dieline', { layers: grouped.layers, activeId: grouped.group.id }, { icon: 'shape' });
      return true;
    }
    case 'symbol-sprayer':
    case 'symbol-shifter':
    case 'symbol-scruncher':
    case 'symbol-sizer':
    case 'symbol-spinner':
    case 'symbol-stainer':
    case 'symbol-screener':
    case 'symbol-styler':
      return vt.symbolDown(p, tool, e.alt);
  }
  void doc;
  return false;
}

/** Release of a freehand path tool: turns the drag into geometry. */
function finishToolPath(e: PointerInfo) {
  const tp = interaction.toolPath!;
  interaction.toolPath = null;
  const pts = [...tp.points, { x: e.x, y: e.y }];
  const r = pathToolRadius();
  switch (tp.tool) {
    case 'brush':
      vt.paintbrushPath(pts, r * 2, e.zoom);
      break;
    case 'blob-brush':
      vt.blobBrushPath(pts, r);
      break;
    case 'eraser':
      vt.eraseAlong(pts, r);
      break;
    case 'path-eraser':
      vt.pathEraseAlong(pts, Math.max(2, r));
      break;
    case 'knife':
      if (!vt.knifeAlong(pts, e.zoom)) store.toast('Knife: drag all the way across a shape');
      break;
    case 'shaper':
      vt.shaperGesture(pts, e.zoom);
      break;
  }
  store.requestRender();
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

/** Box an object snaps by: the true geometry of shapes and text (not their anti-aliased pixels). */
function snapBox(l: Layer): Rect | null {
  const boxes = (l.kind === 'group' ? transformTargets([l]) : [l]).map(layerFrame).filter((f): f is NonNullable<typeof f> => !!f).map(frameAabb);
  return boxes.length ? boxes.reduce((a, b) => unionRect(a, b)) : null;
}

/** Only pixel layers need whole-pixel moves; vectors may sit on fractional grid lines. */
const allVector = (layers: Layer[]) => layers.every((l) => l.kind === 'shape' || l.kind === 'text' || (l.kind === 'group' && transformTargets([l]).every((c) => c.kind === 'shape' || c.kind === 'text')));

/**
 * Grid snap targets: layout-grid lines and artboard edges / centres, plus the document grid when
 * Snap to Grid is on (at the finest grid level visible at this zoom — super zoom snaps finer).
 */
function gridSnapExtra(doc: NonNullable<typeof store.doc>) {
  const l = layoutSnap(doc);
  const xs = [...l.xs];
  const ys = [...l.ys];
  for (const p of gridPages(doc)) {
    xs.push(p.box.x, p.box.x + p.box.w / 2, p.box.x + p.box.w);
    ys.push(p.box.y, p.box.y + p.box.h / 2, p.box.y + p.box.h);
  }
  const steps = [...l.steps];
  const g = store.state.docGrid;
  if (g.snap) {
    const step = snapStep(g, doc.view.zoom);
    steps.push({ x: { step, origin: 0 }, y: { step, origin: 0 } });
  }
  return { xs, ys, steps };
}

const SNAP_DRAW_TOOLS = new Set<ToolId>(['pen', 'curvature', 'line', 'arc', 'spiral', 'rect-grid', 'polar-grid', 'artboard', 'slice', 'text', 'area-type']);

/** Tools whose drag pulls out a Bézier handle: only the pressed anchor snaps, never the handle. */
const HANDLE_TOOLS = new Set<ToolId>(['pen', 'curvature']);

/** Drawing tools put new corners and anchors on grids and artboard lines (hold ⌘/Ctrl to draw freely). */
function snapDrawPoint(e: PointerInfo, press = false): PointerInfo {
  const doc = store.doc;
  const tool = store.state.tool;
  if (!doc || e.mod || !(isShapeTool(tool) || SNAP_DRAW_TOOLS.has(tool))) return e;
  if (HANDLE_TOOLS.has(tool) && !press) return e;
  const p = snapPoint(e.x, e.y, snapTargets(doc.width, doc.height, [], gridSnapExtra(doc)), 6 / e.zoom);
  interaction.guides = p.guideX !== null || p.guideY !== null ? { x: p.guideX, y: p.guideY } : null;
  return p.x === e.x && p.y === e.y ? e : { ...e, x: p.x, y: p.y };
}

let objectDrag: ObjectDrag | null = null;
/** Scale tool drag: the frame at the start and where the pointer started, in frame space. */
let scaleTool: { f: Frame; start: { x: number; y: number } } | null = null;

/** Scale tool: the pointer's distance from the centre (vs. where it started) moves the corner. */
function scaleToolPoint(e: PointerInfo): PointerInfo {
  if (!scaleTool) return e;
  const { f, start } = scaleTool;
  const p = toFrameLocal(f, { x: e.x, y: e.y });
  const k = (v: number, v0: number) => (Math.abs(v0) < 1e-6 ? 1 : v / v0);
  let kx = k(p.x, start.x);
  let ky = k(p.y, start.y);
  // Uniform unless ⇧ (Illustrator's scale tool keeps proportions by default along the drag)
  if (!e.shift) {
    const u = Math.hypot(p.x, p.y) / Math.max(1e-6, Math.hypot(start.x, start.y));
    kx = ky = u;
  }
  const c = toFrameDoc(f, (f.w / 2) * kx, (f.h / 2) * ky);
  // Centred (⌥); proportions follow kx / ky as computed, whatever the Lock Aspect option says
  return { ...e, x: c.x, y: c.y, alt: true, shift: e.shift ? !!store.state.opts.lockAspect : false };
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
  interaction.guides = (x !== e.x || y !== e.y) ? { x: x !== e.x ? p.guideX : null, y: y !== e.y ? p.guideY : null } : null;
  return { ...e, x, y };
}
let marqueeAdd = false;
/** Pressed on one object of a multi-selection: a click without a drag selects just that one. */
let soloOnClick: string | null = null;
/** Second press of a double-click: opens the object if it is released without a drag. */
let enterOnClick: { layer: Layer; e: PointerInfo } | null = null;

/** Resize / rotate modifiers: Shift flips the proportions lock, Alt scales about the centre. */
function dragMods(e: PointerInfo): DragMods {
  return { ratio: store.state.opts.lockAspect !== e.shift, center: e.alt, snap: e.shift };
}

// ---------------------------------------------------------------- live shape widgets

/** A drag of an on-canvas shape widget (corner radius, sides, star inner radius, pie, hole). */
let widgetDrag: { layer: Layer; w: ShapeWidget; start: Pt; moved: boolean; alt: boolean } | null = null;

/**
 * The shape whose live widgets are shown: the single selected live shape, with the Selection tool
 * (while its box is shown) or any shape-drawing tool.
 */
export function widgetLayer(): Layer | null {
  const s = store.state;
  if (s.transform || store.selectedLayers.length !== 1) return null;
  const drawing = isShapeTool(s.tool) && !s.tool.startsWith('graph-');
  if (s.tool !== 'move' && s.tool !== 'direct-select' && !drawing) return null;
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

/** CSS cursor while the Selection tool hovers (or drags) at p. */
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

/** Double-click: edit the object's contents (anchor points, text, or the layer inside a group). */
function enterObject(target: Layer, e: PointerInfo) {
  const doc = store.doc!;
  if (target.kind === 'group') {
    const inner = pickObject(e.x, e.y, e.zoom, true);
    if (inner) store.selectLayer(inner.id);
    return;
  }
  if (target.kind === 'text' && !target.locked) {
    store.set({ textEditId: target.id });
    return;
  }
  if (target.kind === 'shape' && !target.locked && doc) {
    store.setTool('direct-select');
    store.toast('Editing anchor points — drag a point or a handle (V returns to Selection)');
  }
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
  if (widgetDrag && buttons) {
    interaction.pointer = { x: e.x, y: e.y };
    return widgetMove(e);
  }
  if (buttons) e = snapDrawPoint(e);
  interaction.pointer = { x: e.x, y: e.y };
  const s = store.state;
  if (interaction.lasso?.poly) {
    interaction.lasso.cursor = { x: e.x, y: e.y };
    store.requestRender();
  }
  if (s.tool === 'image-trace') return traceTool.traceToolMove(e, dragStart ? buttons : 0);
  if (s.tool === 'pen' && pro.pen.path) return pro.penMove(e, dragStart ? buttons : 0);
  if (s.tool === 'pencil' && interaction.pencilDraft) return pencilMove(e);
  // Live Paint Bucket over 2+ selected shapes: highlight the region a click would paint
  if (s.tool === 'bucket' && !buttons && store.selectedLayers.filter((l) => l.kind === 'shape').length >= 2) {
    const b = shapeBuilderRegions();
    const hit = b && b.sources.length >= 2 ? regionAt(b.regions, e.x, e.y) : -1;
    interaction.shapeBuilder = hit >= 0 ? { hover: hit, picked: [], erase: false } : null;
    store.requestRender();
  }
  if (s.tool === 'shape-builder') {
    const b = shapeBuilderRegions();
    const hit = b ? regionAt(b.regions, e.x, e.y) : -1;
    const sb = (interaction.shapeBuilder ??= { hover: -1, picked: [], erase: false });
    sb.hover = hit;
    if (buttons && dragStart && hit >= 0 && !sb.picked.includes(hit)) sb.picked.push(hit);
    store.requestRender();
    return;
  }
  if (s.tool === 'move' && !s.transform && !buttons) {
    const over = store.doc && s.opts.autoSelect !== 'off' ? pickObject(e.x, e.y, e.zoom, e.mod)?.id ?? null : null;
    if (over !== interaction.hoverId) interaction.hoverId = over;
  }
  if (!buttons || !dragStart) {
    store.requestRender();
    return;
  }

  if (transformDrag) return dragTransform(e);
  if (interaction.printDrag && store.doc) {
    const d = interaction.printDrag;
    setTileOrigin(store.doc.id, { x: Math.round(d.origin.x + e.x - d.start.x), y: Math.round(d.origin.y + e.y - d.start.y) });
    store.requestRender();
    return;
  }
  if (interaction.toolPath) {
    const pts = interaction.toolPath.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(e.x - last.x, e.y - last.y) * e.zoom >= 1) pts.push({ x: e.x, y: e.y });
    store.requestRender();
    return;
  }
  if (vt.sessionMove({ x: e.x, y: e.y }, e)) return;
  if (objectDrag) {
    interaction.hoverId = null;
    e = scaleTool ? scaleToolPoint(e) : snapHandle(objectDrag, e);
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
      // Pixel layers move by whole pixels; vectors follow the pointer exactly (smooth at any zoom)
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
    case 'area-type':
    case 'touch-type':
    case 'vertical-type':
    case 'vertical-area-type':
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
      return pickColor(e.x, e.y, e.alt);
    case 'gradient':
      if (interaction.gradient) {
        interaction.gradient.b = constrainAngle(interaction.gradient.a, e, e.shift);
        drawGradient();
      }
      return;
    case 'direct-select':
      return directSelectMove(e);
    case 'curvature':
      return curvatureMove(e);
    case 'artboard':
      return artboardMove(e);
    default:
      if (isShapeTool(s.tool)) {
        if (interaction.shapeDraft) {
          const d = interaction.shapeDraft;
          const b = e.shift ? constrainShape(d.a, e) : { x: e.x, y: e.y };
          d.b = b;
          const t = getToolShapeType(s.tool, store.state.opts.shapeType);
          d.center = e.alt && t !== 'line' && t !== 'arrow' && t !== 'arc' && t !== 'spiral';
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
  if (s.tool === 'image-trace') {
    void traceTool.traceToolUp(e.zoom);
    return;
  }
  e = snapDrawPoint(e);
  if (isShapeTool(s.tool) || SNAP_DRAW_TOOLS.has(s.tool)) interaction.guides = null;

  if (objectDrag) {
    const d = objectDrag;
    objectDrag = null;
    interaction.readout = null;
    const end = scaleTool ? scaleToolPoint(e) : snapHandle(d, e);
    scaleTool = null;
    commitObjectDrag(d, end, dragMods(end));
    interaction.guides = null;
    return;
  }
  if (interaction.objectMarquee) return finishObjectMarquee();
  if (interaction.readout) {
    interaction.readout = null;
    store.requestRender();
  }

  if (interaction.printDrag) {
    interaction.printDrag = null;
    return;
  }
  if (interaction.toolPath) return finishToolPath(e);
  if (vt.sessionUp({ x: e.x, y: e.y })) return;

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

  if (s.tool === 'direct-select') return directSelectUp();
  if (s.tool === 'curvature') return curvatureUp(e);
  if (s.tool === 'artboard') return artboardUp();
  if (s.tool === 'shape-builder') {
    const sb = interaction.shapeBuilder;
    if (sb?.picked.length) applyShapeBuilder(sb.picked, sb.erase);
    interaction.shapeBuilder = sb ? { hover: -1, picked: [], erase: false } : null;
    store.requestRender();
    return;
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
    case 'text':
    case 'area-type':
    case 'touch-type':
    case 'vertical-type':
    case 'vertical-area-type': {
      const box = interaction.textBox;
      interaction.textBox = null;
      if (!box) return;
      const w = Math.abs(box.b.x - box.a.x);
      const h = Math.abs(box.b.y - box.a.y);
      const dragged = w > 8 / e.zoom && h > 4 / e.zoom;
      if (s.tool.startsWith('vertical')) {
        // Vertical: a dragged box wraps columns at its height, starting from its right edge
        if (dragged) createTextAt(Math.max(box.a.x, box.b.x), Math.min(box.a.y, box.b.y), h, { vertical: true });
        else createTextAt(box.a.x, box.a.y, undefined, { vertical: true });
        return;
      }
      // A real drag makes a paragraph box that wraps; a click makes point text
      if (dragged) createTextAt(Math.min(box.a.x, box.b.x), Math.min(box.a.y, box.b.y), w);
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
    case 'pencil':
      return pencilUp(e);
    case 'ruler':
      return pro.rulerUp();
    case 'color-sampler':
      return pro.samplerUp();
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
    default:
      if (isShapeTool(s.tool)) return finishShape();
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
  objectDrag = null;
  transformDrag = null;
  cropDrag = null;
  widgetDrag = null;
  directSelectDrag = null;
  artboardDrag = null;
  scaleTool = null;
  soloOnClick = null;
  enterOnClick = null;
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
  const actualType = getToolShapeType(store.state.tool, o.shapeType);
  const isLine = actualType === 'line' || actualType === 'arrow' || actualType === 'arc' || actualType === 'spiral';
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
  // Graph tools: the box gets its data first (a click makes a 400 × 300 graph centred on it)
  if (store.state.tool.startsWith('graph-')) {
    if (Math.abs(r.w) * zoom < 3 && Math.abs(r.h) * zoom < 3) {
      const k = zoom > 1 ? 1 / zoom : 1;
      ({ x, y, w, h } = { x: d.a.x - 200 * k, y: d.a.y - 150 * k, w: 400 * k, h: 300 * k });
    }
    const spec = { ...lastGraphSpec(), type: graphTypeOfTool(store.state.tool) };
    store.set({ dialog: { type: 'graph', spec, box: { x, y, w, h } } });
    return;
  }
  const shape: ShapeProps = {
    shape: actualType,
    fill: store.state.fg,
    fillEnabled: o.shapeFill,
    stroke: o.shapeFill ? o.shapeStrokeColor : store.state.fg,
    strokeWidth: isLine ? Math.max(2, o.shapeStrokeWidth || 6) : o.shapeFill ? o.shapeStrokeWidth : Math.max(2, o.shapeStrokeWidth || 4),
    radius: actualType === 'round-rect' ? (o.shapeRadius || 24) : o.shapeRadius,
    sides: actualType === 'grid' || actualType === 'polar-grid' ? (o.shapeSides || 5) : o.shapeSides,
    strokeCap: o.strokeCap,
    strokeJoin: o.strokeJoin,
    ...extrasFor(actualType, o.shapeExtras),
  };
  const names: Record<string, string> = {
    rectangle: 'Rectangle',
    'round-rect': 'Rounded Rectangle',
    ellipse: 'Ellipse',
    polygon: 'Polygon',
    star: 'Star',
    line: 'Line Segment',
    arrow: 'Arrow',
    arc: 'Arc',
    spiral: 'Spiral',
    grid: 'Rectangular Grid',
    'polar-grid': 'Polar Grid',
    flare: 'Flare',
    graph: 'Vector Graph',
  };
  const name = names[actualType] ?? 'Shape';
  const layer = makeLayer({ kind: 'shape', name, shape, x, y, width: w, height: h });
  store.insertLayer(layer, undefined, `New ${name}`);
}

export function cursorFor(tool: ToolId): string {
  switch (tool) {
    case 'move':
      return 'default';
    case 'rotate':
    case 'scale':
    case 'shear':
    case 'free-transform':
      return 'move';
    case 'hand':
      return 'grab';
    case 'zoom':
      return 'zoom-in';
    case 'text':
    case 'area-type':
    case 'path-type':
    case 'vertical-type':
    case 'vertical-area-type':
    case 'vertical-path-type':
    case 'touch-type':
      return 'text';
    case 'eyedropper':
    case 'color-sampler':
      return 'copy';
    case 'direct-select':
    case 'group-select':
      return 'default';
    case 'scissors':
    case 'knife':
      return 'crosshair';
    case 'artboard':
      return 'crosshair';
    case 'curvature':
    case 'anchor-point':
    case 'add-anchor':
    case 'delete-anchor':
    case 'shape-builder':
    case 'pen':
    case 'ruler':
      return 'crosshair';
    default:
      return 'crosshair';
  }
}

// ================================================================ direct selection

export function directSelectDown(e: PointerInfo) {
  const doc = store.doc;
  if (!doc) return;
  const tol = 12 / e.zoom;
  dragStart = { x: e.x, y: e.y };

  let layer = store.activeLayer;
  if (!layer || layer.kind !== 'shape' || !layer.shape) {
    const hit = topLayerAt(e.x, e.y);
    if (hit && hit.kind === 'shape') {
      store.selectLayer(hit.id);
      layer = hit;
    }
  }

  if (!layer || layer.kind !== 'shape' || !layer.shape) {
    interaction.selectedAnchorIndex = null;
    store.requestRender();
    return;
  }

  // Live shapes become editable paths only once an anchor or handle is actually grabbed, so a
  // click that misses keeps the live corners, pie, sides…
  const live = layer;
  if (!layer.shape.points || layer.rotation) layer = convertToEditablePath(layer, true, true);
  const adopt = () => {
    if (layer !== live) doc.layers = doc.layers.map((l) => (l.id === live.id ? layer! : l));
  };
  const pickAnchor = (i: number | null) => {
    const changed = interaction.selectedAnchorIndex !== i || interaction.selectedAnchorLayer !== live.id;
    interaction.selectedAnchorIndex = i;
    interaction.selectedAnchorLayer = i === null ? null : live.id;
    // The Properties panel shows the selected anchor
    if (changed) store.emit();
  };

  const s = layer.shape;
  if (!s) return;
  const pts = s.points ?? [];
  const W = layer.width || 1;
  const H = layer.height || 1;
  const X = (v: number) => layer!.x + v * W;
  const Y = (v: number) => layer!.y + v * H;

  const selIdx = interaction.selectedAnchorLayer === live.id ? interaction.selectedAnchorIndex : null;
  // A handle that still sits on its anchor (a corner) is not grabbable: pressing there moves the
  // anchor, like Illustrator. Pull a handle out with the Anchor Point tool or ⌥-drag.
  const out = (a: PathAnchor, hx: number, hy: number) => dist(X(hx), Y(hy), X(a.x), Y(a.y)) > tol / 2;
  if (selIdx !== null && pts[selIdx]) {
    const a = pts[selIdx];
    if (out(a, a.ix, a.iy) && dist(e.x, e.y, X(a.ix), Y(a.iy)) <= tol) {
      adopt();
      directSelectDrag = {
        layerId: layer.id,
        anchorIndex: selIdx,
        handle: 'in',
        startPt: { x: e.x, y: e.y },
        originalAnchors: JSON.parse(JSON.stringify(pts)),
        box: { x: layer.x, y: layer.y, width: W, height: H },
      };
      return;
    }
    if (out(a, a.ox, a.oy) && dist(e.x, e.y, X(a.ox), Y(a.oy)) <= tol) {
      adopt();
      directSelectDrag = {
        layerId: layer.id,
        anchorIndex: selIdx,
        handle: 'out',
        startPt: { x: e.x, y: e.y },
        originalAnchors: JSON.parse(JSON.stringify(pts)),
        box: { x: layer.x, y: layer.y, width: W, height: H },
      };
      return;
    }
  }

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (dist(e.x, e.y, X(a.x), Y(a.y)) <= tol) {
      adopt();
      pickAnchor(i);
      directSelectDrag = {
        layerId: layer.id,
        anchorIndex: i,
        handle: 'anchor',
        startPt: { x: e.x, y: e.y },
        originalAnchors: JSON.parse(JSON.stringify(pts)),
        box: { x: layer.x, y: layer.y, width: W, height: H },
      };
      store.requestRender();
      return;
    }
  }

  const lx = e.x - layer.x;
  const ly = e.y - layer.y;
  if (lx < -tol || lx > W + tol || ly < -tol || ly > H + tol) pickAnchor(null);
  store.requestRender();
}

export function directSelectMove(e: PointerInfo) {
  if (!directSelectDrag) return;
  const doc = store.doc;
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === directSelectDrag!.layerId);
  if (!layer || !layer.shape || !layer.shape.points) return;

  const { anchorIndex, handle, startPt, originalAnchors, box } = directSelectDrag;
  const dx = (e.x - startPt.x) / box.width;
  const dy = (e.y - startPt.y) / box.height;
  const orig = originalAnchors[anchorIndex];
  if (!orig) return;

  const pts: PathAnchor[] = originalAnchors.map((p, i) => {
    if (i !== anchorIndex) return { ...p };
    const next = { ...p };
    if (handle === 'anchor') {
      next.x = orig.x + dx;
      next.y = orig.y + dy;
      next.ix = orig.ix + dx;
      next.iy = orig.iy + dy;
      next.ox = orig.ox + dx;
      next.oy = orig.oy + dy;
    } else if (handle === 'in') {
      next.ix = orig.ix + dx;
      next.iy = orig.iy + dy;
      if (!e.alt && orig.type === 'smooth') {
        next.ox = 2 * next.x - next.ix;
        next.oy = 2 * next.y - next.iy;
      }
    } else if (handle === 'out') {
      next.ox = orig.ox + dx;
      next.oy = orig.oy + dy;
      if (!e.alt && orig.type === 'smooth') {
        next.ix = 2 * next.x - next.ox;
        next.iy = 2 * next.y - next.oy;
      }
    }
    return next;
  });

  // Points are relative to the box the drag started with; refit so the box follows the new path
  const updated = refitPathBox(withLayer(layer, { x: box.x, y: box.y, width: box.width, height: box.height, shape: { ...layer.shape, points: pts } }));
  store.live({ layers: doc.layers.map((l) => (l.id === layer.id ? updated : l)) });
}

/**
 * Path points are stored relative to the layer box (0..1). After anchors or handles move outside
 * it, the box no longer matches the art: renders clip it, and selection, snapping and alignment
 * use stale bounds. This refits the box to the anchors and handles without moving anything.
 */
export function refitPathBox(layer: Layer): Layer {
  const s = layer.shape;
  const subs = s?.compoundPoints?.length ? s.compoundPoints : s?.points ? [s.points] : null;
  if (!s || !subs || !subs.some((p) => p.length)) return layer;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sub of subs)
    for (const a of sub)
      for (const [u, v] of [[a.x, a.y], [a.ix, a.iy], [a.ox, a.oy]]) {
        x0 = Math.min(x0, u); x1 = Math.max(x1, u);
        y0 = Math.min(y0, v); y1 = Math.max(y1, v);
      }
  if (x0 === 0 && y0 === 0 && x1 === 1 && y1 === 1) return layer;
  const W = layer.width || 1;
  const H = layer.height || 1;
  // A flat path (a horizontal or vertical line) keeps a non-zero extent so points stay finite
  const nw = Math.max((x1 - x0) * W, 1e-6);
  const nh = Math.max((y1 - y0) * H, 1e-6);
  const nx = layer.x + x0 * W;
  const ny = layer.y + y0 * H;
  const map = (a: PathAnchor): PathAnchor => {
    const fx = (u: number) => (layer.x + u * W - nx) / nw;
    const fy = (v: number) => (layer.y + v * H - ny) / nh;
    return { ...a, x: fx(a.x), y: fy(a.y), ix: fx(a.ix), iy: fy(a.iy), ox: fx(a.ox), oy: fy(a.oy) };
  };
  const shape = s.compoundPoints?.length ? { ...s, compoundPoints: s.compoundPoints.map((sub) => sub.map(map)) } : { ...s, points: s.points!.map(map) };
  return withLayer(layer, { x: nx, y: ny, width: nw, height: nh, shape });
}

export function directSelectUp() {
  if (!directSelectDrag) return;
  const doc = store.doc;
  if (doc) store.commit('Move Anchor Point', { layers: doc.layers });
  directSelectDrag = null;
}

// ================================================================ anchor point tool

export function anchorPointDown(e: PointerInfo) {
  const doc = store.doc;
  if (!doc) return;
  const tol = 12 / e.zoom;
  let layer = store.activeLayer;
  if (!layer || layer.kind !== 'shape' || !layer.shape) return;
  if (!layer.shape.points || layer.rotation) layer = convertToEditablePath(layer, true, true);
  if (!layer.shape) return;
  const s = layer.shape;
  const pts = s.points ?? [];
  const W = layer.width || 1;
  const H = layer.height || 1;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const ax = layer.x + a.x * W;
    const ay = layer.y + a.y * H;
    if (dist(e.x, e.y, ax, ay) <= tol) {
      const toggled = toggleAnchorSmooth(a);
      const newPts = pts.map((p, idx) => (idx === i ? toggled : p));
      const updated = withLayer(layer, {
        shape: { ...s, points: newPts },
      });
      store.commit('Toggle Anchor Point', {
        layers: doc.layers.map((l) => (l.id === layer!.id ? updated : l)),
      });
      interaction.selectedAnchorIndex = i;
      interaction.selectedAnchorLayer = layer.id;
      store.requestRender();
      return;
    }
  }
}

// ================================================================ curvature tool

export function curvatureDown(e: PointerInfo) {
  const doc = store.doc;
  if (!doc) return;
  const cur = interaction.curvaturePath;
  const pt = { x: e.x, y: e.y };
  if (!cur) {
    interaction.curvaturePath = { points: [pt], cursor: null };
  } else {
    const first = cur.points[0];
    if (cur.points.length > 2 && dist(e.x, e.y, first.x, first.y) <= 12 / e.zoom) {
      commitCurvature(true);
      return;
    }
    cur.points.push(pt);
  }
  store.requestRender();
}

export function curvatureMove(e: PointerInfo) {
  if (interaction.curvaturePath) {
    interaction.curvaturePath.cursor = { x: e.x, y: e.y };
    store.requestRender();
  }
}

export function curvatureUp(_e: PointerInfo) {
  store.requestRender();
}

export function commitCurvature(closed = false) {
  const cur = interaction.curvaturePath;
  interaction.curvaturePath = null;
  const doc = store.doc;
  if (!cur || !doc || cur.points.length < 2) {
    store.requestRender();
    return;
  }
  const anchors = solveHarmonicCurvature(cur.points, closed);
  const b = pro.anchorsBounds(anchors);
  const norm = (v: number, o0: number, s: number) => (v - o0) / s;
  const points: PathAnchor[] = anchors.map((a) => ({
    x: norm(a.x, b.x, b.width),
    y: norm(a.y, b.y, b.height),
    ix: norm(a.ix, b.x, b.width),
    iy: norm(a.iy, b.y, b.height),
    ox: norm(a.ox, b.x, b.width),
    oy: norm(a.oy, b.y, b.height),
    type: 'smooth',
  }));

  const o = store.state.opts;
  const shape: ShapeProps = {
    shape: 'path',
    points,
    closed,
    fill: store.state.fg,
    fillEnabled: closed && o.shapeFill,
    stroke: o.shapeStrokeColor || store.state.fg,
    strokeWidth: Math.max(1, o.shapeStrokeWidth || 2),
    strokeCap: o.strokeCap,
    strokeJoin: o.strokeJoin,
    radius: 0,
    sides: 0,
  };
  const layer = makeLayer({
    kind: 'shape',
    name: closed ? 'Curvature Shape' : 'Curvature Path',
    shape,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
  });
  store.insertLayer(layer, undefined, 'New Curvature Path');
}

// ================================================================ artboards

export function artboardDown(e: PointerInfo) {
  const doc = store.doc;
  if (!doc) return;
  const artboards = doc.artboards && doc.artboards.length > 0 ? doc.artboards : [getActiveArtboard(doc)];

  const active = artboards.find((a) => a.id === doc.activeArtboardId) ?? artboards[0];
  if (active) {
    const mode = handleHit(active, e, e.zoom);
    if (mode && mode !== 'move') {
      artboardDrag = { mode, id: active.id, start: { x: e.x, y: e.y }, rect: { ...active } };
      return;
    }
  }

  for (let i = artboards.length - 1; i >= 0; i--) {
    const a = artboards[i];
    if (e.x >= a.x && e.x <= a.x + a.width && e.y >= a.y && e.y <= a.y + a.height) {
      doc.activeArtboardId = a.id;
      artboardDrag = { mode: 'move', id: a.id, start: { x: e.x, y: e.y }, rect: { ...a }, riders: e.alt ? [] : artboardRiders(a) };
      store.emit();
      return;
    }
  }

  artboardDrag = { mode: 'new', id: '', start: { x: e.x, y: e.y }, rect: { x: e.x, y: e.y, width: 0, height: 0 } };
  interaction.artboardDraft = { a: { x: e.x, y: e.y }, b: { x: e.x, y: e.y } };
  store.requestRender();
}

export function artboardMove(e: PointerInfo) {
  if (!artboardDrag) return;
  const doc = store.doc;
  if (!doc) return;
  if (artboardDrag.mode === 'new') {
    const rect = {
      x: Math.min(artboardDrag.start.x, e.x),
      y: Math.min(artboardDrag.start.y, e.y),
      width: Math.abs(e.x - artboardDrag.start.x),
      height: Math.abs(e.y - artboardDrag.start.y),
    };
    artboardDrag.rect = rect;
    interaction.artboardDraft = { a: artboardDrag.start, b: { x: e.x, y: e.y } };
    store.requestRender();
  } else if (artboardDrag.mode === 'move') {
    const dx = e.x - artboardDrag.start.x;
    const dy = e.y - artboardDrag.start.y;
    const mx = Math.round(artboardDrag.rect.x + dx) - artboardDrag.rect.x;
    const my = Math.round(artboardDrag.rect.y + dy) - artboardDrag.rect.y;
    updateArtboard(doc, artboardDrag.id, { x: artboardDrag.rect.x + mx, y: artboardDrag.rect.y + my });
    const riders = new Map((artboardDrag.riders ?? []).map((l) => [l.id, l]));
    if (riders.size) {
      store.live({
        layers: doc.layers.map((cur) => {
          const l = riders.get(cur.id);
          return l ? withLayer(cur, { x: l.x + mx, y: l.y + my, mask: l.mask ? { ...l.mask, x: l.mask.x + mx, y: l.mask.y + my } : undefined }) : cur;
        }),
      });
    } else store.emit();
  } else {
    const r = resizeRect(artboardDrag.rect, artboardDrag.mode, e.x - artboardDrag.start.x, e.y - artboardDrag.start.y, null);
    updateArtboard(doc, artboardDrag.id, r);
    store.emit();
  }
}

export function artboardUp() {
  if (!artboardDrag) return;
  const doc = store.doc;
  if (doc && artboardDrag.mode === 'new') {
    interaction.artboardDraft = null;
    const r = artboardDrag.rect;
    if (r.width > 30 && r.height > 30) {
      addArtboard(doc, undefined, r);
      store.commit('New Artboard', {});
    }
  } else if (doc) {
    store.commit('Edit Artboard', {});
  }
  artboardDrag = null;
  store.requestRender();
}

