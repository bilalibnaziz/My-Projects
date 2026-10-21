import { useSyncExternalStore } from 'react';
import type { Doc, Layer, Rect, Selection, Snapshot } from './types';
import { makeLayer, uid, withLayer } from './types';
import { cloneCanvas, createCanvas, ctx2d, touch } from './canvas';
import type { Overrides } from './render';
import { DocRenderer } from './render';
import type { DocGridPrefs } from './grids';
import { loadDocGrid, saveDocGrid } from './grids';
import { bakeGroupOffsets, normalize } from './groups';
import { applyHugs } from './hug';

export type ToolId =
  | 'move'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'poly-lasso'
  | 'wand'
  | 'crop'
  | 'eyedropper'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'clone'
  | 'heal'
  | 'smudge'
  | 'dodge'
  | 'burn'
  | 'sponge'
  | 'blur'
  | 'sharpen'
  | 'bucket'
  | 'gradient'
  | 'text'
  | 'shape'
  | 'hand'
  | 'zoom'
  // Added tools
  | 'marquee-row'
  | 'marquee-col'
  | 'quick-select'
  | 'object-select'
  | 'magic-eraser'
  | 'bg-eraser'
  | 'color-replace'
  | 'red-eye'
  | 'history-brush'
  | 'heal-brush'
  | 'pen'
  | 'ruler'
  | 'color-sampler';

export interface ToolOptions {
  size: number;
  hardness: number; // 0..1
  opacity: number; // 0..1
  flow: number; // 0..1
  spacing: number; // fraction of diameter
  smoothing: number; // 0..1 stabilizer strength (0 = paint exactly under the pointer)
  pressureSize: boolean;
  pressureOpacity: boolean;
  selFeather: number;
  tolerance: number; // 0..255
  contiguous: boolean;
  sampleAll: boolean;
  cropRatio: 'free' | 'original' | '1:1' | '4:5' | '3:2' | '2:3' | '4:3' | '16:9' | '9:16' | '1.91:1' | '3:1';
  cropDelete: boolean;
  gradientType: 'linear' | 'radial' | 'reflected';
  gradientReverse: boolean;
  gradientMode: 'fg-bg' | 'fg-transparent';
  dodgeRange: 'shadows' | 'midtones' | 'highlights';
  exposure: number; // 0..1
  strength: number; // 0..1 smudge/blur/sharpen/sponge
  spongeMode: 'saturate' | 'desaturate';
  cloneAligned: boolean;
  font: string;
  fontSize: number;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  shapeType: 'rectangle' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line' | 'arrow' | 'spiral';
  shapeFill: boolean;
  shapeStrokeWidth: number;
  shapeRadius: number;
  shapeSides: number;
  shapeStrokeColor: string;
  textCaps: boolean;
  lockAspect: boolean; // move-tool W/H fields keep proportions
  bgSampling: 'continuous' | 'once'; // background eraser / color replacement
  protectFg: boolean; // background eraser never erases the foreground color
  replaceMode: 'color' | 'hue' | 'saturation' | 'luminosity';
  redEyePupil: number; // 0..1 how much red counts as pupil
  redEyeDarken: number; // 0..1
  penMode: 'shape' | 'selection';
  samplerSize: 1 | 3 | 5 | 11; // eyedropper / sampler averaging
  /** Move tool: what a click on the canvas selects — the layer under it, its whole group, or nothing (⌘-click picks). */
  autoSelect: 'group' | 'layer' | 'off';
  /** Move tool: show the bounding box with resize / rotate handles (Photoshop's "Show Transform Controls"). */
  transformControls: boolean;
  /** Quick Selection snaps the stroke to the object's edges (graph cut) on release. */
  quickEdge: boolean;
  /** Selection tools without modifier keys: New, Add, Subtract or Intersect. */
  selMode: 'replace' | 'add' | 'subtract' | 'intersect';
  /** Eyedropper: pick a colour, or click something neutral to set white balance. */
  eyedropperMode: 'color' | 'wb';
  /** Next-shape extras: per-corner radii, corner style, star inner ratio, pie, hole, spiral turns… (shapeGeometry.ts). */
  shapeExtras?: Partial<import('./types').ShapeProps>;
  /** On-canvas corner / sides / pie widgets on the selected live shape (View ▸ Shape Widgets). */
  liveCorners?: boolean;
  /** The Active Toolbox strip beside the dock (Window ▸ Active Toolbox). */
  activeToolbox: boolean;
}

export const DEFAULT_OPTIONS: ToolOptions = {
  size: 40,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  spacing: 0.12,
  smoothing: 0,
  pressureSize: true,
  pressureOpacity: false,
  selFeather: 0,
  tolerance: 32,
  contiguous: true,
  sampleAll: true,
  cropRatio: 'free',
  cropDelete: false,
  gradientType: 'linear',
  gradientReverse: false,
  gradientMode: 'fg-bg',
  dodgeRange: 'midtones',
  exposure: 0.5,
  strength: 0.5,
  spongeMode: 'desaturate',
  cloneAligned: true,
  font: 'Inter',
  fontSize: 72,
  fontWeight: 700,
  textAlign: 'left',
  shapeType: 'rectangle',
  shapeFill: true,
  shapeStrokeWidth: 0,
  shapeRadius: 0,
  shapeSides: 6,
  shapeStrokeColor: '#ffffff',
  textCaps: false,
  lockAspect: true,
  bgSampling: 'continuous',
  protectFg: false,
  replaceMode: 'color',
  redEyePupil: 0.5,
  redEyeDarken: 0.5,
  penMode: 'shape',
  samplerSize: 1,
  autoSelect: 'layer',
  transformControls: true,
  quickEdge: true,
  selMode: 'replace',
  eyedropperMode: 'color',
  activeToolbox: true,
};

export type DialogState =
  | { type: 'new'; tab?: 'presets' | 'templates' }
  | { type: 'export' }
  | { type: 'batchExport' }
  | { type: 'imageSize' }
  | { type: 'canvasSize' }
  | { type: 'filter'; filterId: string; smartIndex?: number; params?: Record<string, number> }
  | { type: 'number'; title: string; label: string; value: number; min: number; max: number; unit?: string; onOk: (v: number) => void }
  | { type: 'shortcuts' }
  | { type: 'preferences' }
  | { type: 'about' }
  | { type: 'layerStyle' }
  | { type: 'colorPicker'; target: 'fg' | 'bg' }
  | { type: 'batch'; actionId: string }
  | { type: 'liquify' }
  | { type: 'selectMask' }
  | { type: 'transformEach' }
  | { type: 'recolor'; ids: string[] }
  | { type: 'socialStudio' };

export type Theme = 'vscode' | 'dark' | 'midnight' | 'light';

export interface Prefs {
  theme: Theme;
  accent: string;
  pasteboard: 'theme' | 'black' | 'dark' | 'mid' | 'light';
  historyLimit?: number;
  maxHistoryMb?: number;
  /** Interface size: 0.75 (compact) … 1.5 (large). The canvas keeps its own zoom. */
  uiScale: number;
}

/** Default look: VS Code's Dark Modern theme and its button blue. */
export const DEFAULT_PREFS: Prefs = { theme: 'vscode', accent: '#0078d4', pasteboard: 'theme', historyLimit: 50, maxHistoryMb: 256, uiScale: 1 };

// Bump when the default look changes so earlier defaults are replaced
const PREFS_VERSION = 2;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface CropState {
  rect: Rect;
  /** Still the untouched full-canvas box: a drag inside draws a new crop instead of moving it. */
  pristine?: boolean;
}

export interface TransformState {
  layerId: string;
  source: HTMLCanvasElement; // untransformed pixels
  sx: number; // source origin in doc space
  sy: number;
  lifted: boolean; // selected pixels were cut out of the layer
  // Affine: translate(tx,ty) rotate(angle) scale(scaleX,scaleY) around source center
  tx: number;
  ty: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  /** Free corner positions (doc space, nw ne se sw) once the box is skewed or distorted. */
  quad?: { x: number; y: number }[];
  /** Several layers transformed together (a group's contents or a multi-selection). */
  multi?: string[];
  /** Warp: 16 Bézier control points (doc space, rows top → bottom). */
  mesh?: { x: number; y: number }[];
  /** What handle drags do: scale (default), skew / distort / perspective the corners, or warp. */
  mode?: TransformMode;
}

export type TransformMode = 'free' | 'skew' | 'distort' | 'perspective' | 'warp';

export interface State {
  docs: Doc[];
  activeDocId: string | null;
  tool: ToolId;
  lastTools: Partial<Record<string, ToolId>>;
  opts: ToolOptions;
  fg: string;
  bg: string;
  recentColors: string[];
  cloneSource: { x: number; y: number; docId: string } | null;
  crop: CropState | null;
  transform: TransformState | null;
  textEditId: string | null;
  dialog: DialogState | null;
  paletteOpen: boolean;
  toasts: Toast[];
  busy: string | null;
  showRulers: boolean;
  showPixelGrid: boolean;
  showGrid: boolean;
  /** Document grid look and snapping, plus layout-grid visibility (remembered across sessions). */
  docGrid: DocGridPrefs;
  showSafeZones: boolean;
  /** View ▸ Proof Colors (CMYK print simulation) and Gamut Warning: display only. */
  proof: 'off' | 'cmyk' | 'gamut';
  prefs: Prefs;
  /** History Brush paints from this snapshot (null = the document's opening state). */
  historySource: Snapshot | null;
  compare: boolean; // before/after: hides adjustment layers
  rightTab: 'adjust' | 'layers' | 'history';
  focusMode: boolean;
  /** Quick Mask mode (Q): visualizes selection as a classic Photoshop ruby-red rubylith mask */
  quickMask: boolean;
}

const HISTORY_LIMIT = 60;

/**
 * Memory held by the history. Steps share every layer they didn't change, so each pixel buffer
 * is counted once, however many steps reference it.
 */
export function historyBytes(history: Snapshot[]): number {
  const seen = new Set<HTMLCanvasElement>();
  let bytes = 0;
  const add = (c: HTMLCanvasElement | undefined) => {
    if (!c || seen.has(c)) return;
    seen.add(c);
    bytes += c.width * c.height * 4;
  };
  for (const h of history) {
    for (const l of h.layers) {
      add(l.canvas);
      add(l.mask?.canvas);
    }
  }
  return bytes;
}

type Listener = () => void;

class Store {
  state: State = {
    docs: [],
    activeDocId: null,
    tool: 'brush',
    lastTools: {},
    opts: loadOptions(),
    fg: '#ff6b00',
    bg: '#ffffff',
    recentColors: [],
    cloneSource: null,
    crop: null,
    transform: null,
    textEditId: null,
    dialog: null,
    paletteOpen: false,
    toasts: [],
    busy: null,
    showRulers: true,
    showPixelGrid: true,
    showGrid: false,
    docGrid: loadDocGrid(),
    showSafeZones: true,
    proof: 'off',
    prefs: loadPrefs(),
    historySource: null,
    compare: false,
    rightTab: 'layers',
    focusMode: false,
    quickMask: false,
  };

  version = 0;
  private listeners = new Set<Listener>();
  private renderListeners = new Set<Listener>();
  readonly renderer = new DocRenderer();
  /** Renders the visible part of the document at the viewport's zoom (sharp type and shapes). */
  readonly viewRenderer = new DocRenderer();

  /** Drops the render caches (document- and view-resolution) after an out-of-band pixel change. */
  invalidateRender() {
    this.renderer.invalidate();
    this.viewRenderer.invalidate();
  }

  /** The whole document at document resolution (navigator, histogram, colour readouts). */
  docPixels(): HTMLCanvasElement {
    return this.doc ? this.renderer.render(this.doc, this.overrides) : this.renderer.output;
  }
  /** Live preview pixel replacements (free transform, filter previews). */
  overrides: Overrides = new Map();

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  onRender(l: Listener) {
    this.renderListeners.add(l);
    return () => {
      this.renderListeners.delete(l);
    };
  }

  /** State changed: re-render React and the canvas. */
  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
    this.requestRender();
  }

  /** Pixels changed but UI didn't: only repaint the canvas. */
  requestRender() {
    this.renderListeners.forEach((l) => l());
  }

  set(patch: Partial<State>) {
    Object.assign(this.state, patch);
    if (patch.opts) saveOptions(this.state.opts);
    if (patch.prefs) savePrefs(this.state.prefs);
    if (patch.docGrid) saveDocGrid(this.state.docGrid);
    this.emit();
  }

  setOpts(patch: Partial<ToolOptions>) {
    this.state.opts = { ...this.state.opts, ...patch };
    saveOptions(this.state.opts);
    this.emit();
  }

  // ------------------------------------------------------------ documents

  get doc(): Doc | null {
    return this.state.docs.find((d) => d.id === this.state.activeDocId) ?? null;
  }

  get activeLayer(): Layer | null {
    const d = this.doc;
    return d ? d.layers.find((l) => l.id === d.activeId) ?? null : null;
  }

  addDoc(init: { title: string; width: number; height: number; layers: Layer[]; sourceName?: string; safeZone?: string }): Doc {
    const top = init.layers[init.layers.length - 1];
    const doc: Doc = {
      id: uid('doc'),
      title: init.title,
      width: init.width,
      height: init.height,
      layers: init.layers,
      activeId: top.id,
      selection: null,
      lastSelection: null,
      editMask: false,
      history: [],
      hIndex: -1,
      dirty: false,
      view: { zoom: 1, panX: 0, panY: 0, fitted: false },
      sourceName: init.sourceName,
      safeZone: init.safeZone,
    };
    doc.history.push(this.snapshot(doc, init.sourceName ? 'Open' : 'New Document', 'file'));
    doc.hIndex = 0;
    this.state.docs = [...this.state.docs, doc];
    this.state.activeDocId = doc.id;
    this.cancelModes();
    this.emit();
    return doc;
  }

  closeDoc(id: string) {
    const docs = this.state.docs.filter((d) => d.id !== id);
    const wasActive = this.state.activeDocId === id;
    this.state.docs = docs;
    if (wasActive) this.state.activeDocId = docs.length ? docs[docs.length - 1].id : null;
    this.cancelModes();
    this.invalidateRender();
    this.emit();
  }

  switchDoc(id: string) {
    this.cancelModes();
    this.state.activeDocId = id;
    this.invalidateRender();
    this.emit();
    import('./tools').then((m) => m.resetGestures?.()).catch(() => {});
  }

  reorderDocs(fromId: string, toId: string, placeAfter = false) {
    const fromIdx = this.state.docs.findIndex((d) => d.id === fromId);
    const toIdx = this.state.docs.findIndex((d) => d.id === toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const docs = [...this.state.docs];
    const [moved] = docs.splice(fromIdx, 1);
    const insertIdx = placeAfter ? (toIdx > fromIdx ? toIdx : toIdx + 1) : (toIdx > fromIdx ? toIdx - 1 : toIdx);
    docs.splice(Math.max(0, Math.min(docs.length, insertIdx)), 0, moved);
    this.state.docs = docs;
    this.emit();
  }

  addLayersToDoc(targetDocId: string, newLayers: Layer[], at?: { x: number; y: number }) {
    const doc = this.state.docs.find((d) => d.id === targetDocId);
    if (!doc || !newLayers.length) return;

    let dx = 0;
    let dy = 0;
    if (at && newLayers.length > 0) {
      const minX = Math.min(...newLayers.map((l) => l.x));
      const minY = Math.min(...newLayers.map((l) => l.y));
      dx = at.x - minX;
      dy = at.y - minY;
    }

    const idMap = new Map<string, string>();
    for (const l of newLayers) {
      idMap.set(l.id, uid('layer'));
    }

    const cloned = newLayers.map((orig) => {
      const newId = idMap.get(orig.id) || uid('layer');
      const newParent = orig.parent ? idMap.get(orig.parent) : undefined;
      return makeLayer({
        ...orig,
        id: newId,
        parent: newParent,
        name: orig.name,
        x: orig.x + dx,
        y: orig.y + dy,
        canvas: orig.canvas ? cloneCanvas(orig.canvas) : undefined,
        mask: orig.mask ? { ...orig.mask, canvas: cloneCanvas(orig.mask.canvas) } : undefined,
        adjust: orig.adjust ? structuredClone(orig.adjust) : undefined,
        shape: orig.shape ? structuredClone(orig.shape) : undefined,
        text: orig.text ? structuredClone(orig.text) : undefined,
        fx: orig.fx ? structuredClone(orig.fx) : undefined,
      });
    });

    const activeIdx = doc.layers.findIndex((l) => l.id === doc.activeId);
    const insertIdx = activeIdx >= 0 ? activeIdx + 1 : doc.layers.length;
    const nextLayers = [...doc.layers];
    nextLayers.splice(insertIdx, 0, ...cloned);

    const top = cloned[cloned.length - 1];
    const newSelectedIds = cloned.map((l) => l.id);

    doc.layers = nextLayers;
    doc.activeId = top.id;
    doc.selectedIds = newSelectedIds.length > 1 ? newSelectedIds : undefined;
    doc.dirty = true;
    doc.history.push(this.snapshot(doc, `Add ${cloned.length > 1 ? `${cloned.length} Layers` : cloned[0].name}`, 'layer'));
    doc.hIndex = doc.history.length - 1;

    this.switchDoc(targetDocId);
    this.invalidateRender();
    this.emit();
  }

  private snapshot(doc: Doc, label: string, icon: string): Snapshot {
    return {
      label,
      icon,
      layers: doc.layers,
      activeId: doc.activeId,
      width: doc.width,
      height: doc.height,
      selection: doc.selection,
      grids: doc.grids,
      time: Date.now(),
    };
  }

  /**
   * Applies a change and records it as one undoable step. When `coalesce` matches the
   * previous step (e.g. dragging a slider), that step is replaced instead of appended.
   */
  commit(
    label: string,
    patch: Partial<Pick<Doc, 'layers' | 'activeId' | 'width' | 'height' | 'selection'>> = {},
    opts: { icon?: string; coalesce?: string } = {}
  ) {
    const doc = this.doc;
    if (!doc) return;
    if (patch.selection !== undefined && doc.selection && patch.selection !== doc.selection) {
      doc.lastSelection = doc.selection;
    }
    Object.assign(doc, patch);
    // Groups: keep each group's contents directly below it, whatever the edit did to the order,
    // and bake a dragged group's offset into its contents
    doc.layers = bakeGroupOffsets(normalize(doc.layers));
    // Buttons: shapes that hug their label stay fitted (hug.ts)
    doc.layers = applyHugs(doc.history[doc.hIndex]?.layers, doc.layers);
    // A new active layer (new, pasted, merged…) collapses a multi-selection unless it is still valid
    if (doc.selectedIds) {
      const ids = doc.selectedIds.filter((id) => doc.layers.some((l) => l.id === id));
      doc.selectedIds = ids.length > 1 && ids.includes(doc.activeId) ? ids : undefined;
    }
    const snap = this.snapshot(doc, label, opts.icon ?? 'edit');
    const last = doc.history[doc.hIndex];
    const coalesceKey = opts.coalesce ? `${opts.coalesce}` : null;
    if (
      coalesceKey &&
      last &&
      (last as Snapshot & { key?: string }).key === coalesceKey &&
      doc.hIndex === doc.history.length - 1 &&
      Date.now() - last.time < 1500
    ) {
      (snap as Snapshot & { key?: string }).key = coalesceKey;
      doc.history[doc.hIndex] = snap;
    } else {
      (snap as Snapshot & { key?: string }).key = coalesceKey ?? undefined;
      doc.history = doc.history.slice(0, doc.hIndex + 1);
      doc.history.push(snap);
      const limit = this.state.prefs.historyLimit ?? HISTORY_LIMIT;
      if (doc.history.length > limit) doc.history.splice(1, doc.history.length - limit);
      const maxBytes = (this.state.prefs.maxHistoryMb ?? 256) * 1024 * 1024;
      while (doc.history.length > 2 && historyBytes(doc.history) > maxBytes) doc.history.splice(1, 1);
      doc.hIndex = doc.history.length - 1;
    }
    doc.dirty = true;
    this.emit();
  }

  /** Updates doc state without creating a history step (live previews). */
  live(patch: Partial<Pick<Doc, 'layers' | 'activeId' | 'selection' | 'editMask'>>) {
    const doc = this.doc;
    if (!doc) return;
    Object.assign(doc, patch);
    if (patch.layers) doc.layers = applyHugs(doc.history[doc.hIndex]?.layers, doc.layers);
    this.emit();
  }

  /** Restores the current history step (discarding uncommitted live changes). */
  revert() {
    const doc = this.doc;
    if (!doc) return;
    this.restore(doc, doc.hIndex);
  }

  private restore(doc: Doc, index: number) {
    const s = doc.history[index];
    if (!s) return;
    // Undo / redo keep what you have selected when it still exists (like Photoshop)
    const ids = new Set(s.layers.map((l) => l.id));
    const keepActive = ids.has(doc.activeId);
    const keepSel = keepActive && doc.selectedIds?.every((id) => ids.has(id));
    doc.layers = s.layers;
    if (!keepActive) doc.activeId = s.activeId;
    doc.width = s.width;
    doc.height = s.height;
    doc.selection = s.selection;
    if ('grids' in s) doc.grids = s.grids;
    if (!keepSel) doc.selectedIds = undefined;
    doc.hIndex = index;
    doc.dirty = index > 0;
    this.invalidateRender();
    this.emit();
  }

  undo() {
    const doc = this.doc;
    if (!doc) return;
    if (this.state.crop || this.state.transform) return this.cancelModes();
    if (doc.hIndex > 0) this.restore(doc, doc.hIndex - 1);
  }

  redo() {
    const doc = this.doc;
    if (doc && doc.hIndex < doc.history.length - 1) this.restore(doc, doc.hIndex + 1);
  }

  jumpHistory(i: number) {
    const doc = this.doc;
    if (doc) this.restore(doc, i);
  }

  cancelModes() {
    if (this.state.transform || this.overrides.size) {
      this.overrides.clear();
      this.invalidateRender();
    }
    this.state.crop = null;
    this.state.transform = null;
    this.state.textEditId = null;
  }

  toggleQuickMask() {
    const doc = this.doc;
    if (!doc) return;
    const next = !this.state.quickMask;
    this.set({ quickMask: next });
    this.requestRender();
    this.toast(next ? 'Quick Mask Mode: ON (Q)' : 'Standard Selection Mode (Q)', 'info');
  }

  // ------------------------------------------------------------ layers

  replaceLayer(next: Layer, layers = this.doc?.layers ?? []): Layer[] {
    return layers.map((l) => (l.id === next.id ? next : l));
  }

  updateLayer(id: string, patch: Partial<Layer>, label?: string, coalesce?: string) {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    const layers = this.replaceLayer(withLayer(layer, patch), doc.layers);
    if (label) this.commit(label, { layers }, { coalesce: coalesce ?? `${label}:${id}` });
    else this.live({ layers });
  }

  /**
   * Copy-on-write: clones the active layer's pixels (or mask) so they can be edited in
   * place without corrupting history. If the current layer is not locked but cannot be edited
   * as pixels directly (e.g. text, shape, adjustment, group, or no layer selected), it
   * auto-generates a new pixel layer right above it and immediately begins editing.
   */
  beginPixelEdit(target: 'auto' | 'pixels' | 'mask' = 'auto'): { canvas: HTMLCanvasElement; layer: Layer; ox: number; oy: number; isMask: boolean } | null {
    const doc = this.doc;
    if (!doc) return null;
    const layer = this.activeLayer;
    if (layer?.locked) {
      this.toast('Layer is locked', 'error');
      return null;
    }
    const wantMask = target === 'mask' || (target === 'auto' && doc.editMask && !!layer?.mask);
    if (wantMask && layer?.mask) {
      const canvas = cloneCanvas(layer.mask.canvas);
      const next = withLayer(layer, { mask: { ...layer.mask, canvas } });
      doc.layers = this.replaceLayer(next, doc.layers);
      return { canvas, layer: next, ox: layer.mask.x, oy: layer.mask.y, isMask: true };
    }
    // Existing editable raster layer with canvas
    if (layer && layer.kind === 'raster' && layer.canvas && !layer.smart) {
      const canvas = cloneCanvas(layer.canvas);
      const next = withLayer(layer, { canvas });
      doc.layers = this.replaceLayer(next, doc.layers);
      return { canvas, layer: next, ox: layer.x, oy: layer.y, isMask: false };
    }
    // Existing raster layer without canvas: initialize canvas and edit it
    if (layer && layer.kind === 'raster' && !layer.smart) {
      const canvas = createCanvas(doc.width, doc.height);
      const next = withLayer(layer, { canvas, x: 0, y: 0, width: doc.width, height: doc.height });
      doc.layers = this.replaceLayer(next, doc.layers);
      return { canvas, layer: next, ox: 0, oy: 0, isMask: false };
    }
    // Non-pixel layer (text, shape, adjustment, group, smart object) or no active layer:
    // Auto-generate a new pixel layer right above the current layer and continue editing seamlessly
    const newLayer = this.newRasterLayer(undefined, { above: layer?.id });
    if (!newLayer || !newLayer.canvas) return null;
    this.toast(`Auto-created ${newLayer.name}`);
    const canvas = cloneCanvas(newLayer.canvas);
    const next = withLayer(newLayer, { canvas });
    doc.layers = this.replaceLayer(next, doc.layers);
    return { canvas, layer: next, ox: next.x, oy: next.y, isMask: false };
  }

  newRasterLayer(name?: string, opts: { above?: string; canvas?: HTMLCanvasElement; x?: number; y?: number } = {}): Layer | null {
    const doc = this.doc;
    if (!doc) return null;
    const canvas = opts.canvas ?? createCanvas(doc.width, doc.height);
    const layer = makeLayer({
      kind: 'raster',
      name: name ?? `Layer ${doc.layers.length + 1}`,
      canvas,
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      width: canvas.width,
      height: canvas.height,
    });
    this.insertLayer(layer, opts.above);
    return layer;
  }

  insertLayer(layer: Layer, above?: string, label?: string) {
    const doc = this.doc;
    if (!doc) return;
    const idx = doc.layers.findIndex((l) => l.id === (above ?? doc.activeId));
    const anchor = doc.layers[idx];
    // A new layer joins the group of the layer it is placed above
    if (anchor && layer.parent === undefined && anchor.parent) layer = { ...layer, parent: anchor.parent };
    const layers = [...doc.layers];
    layers.splice(idx < 0 ? layers.length : idx + 1, 0, layer);
    doc.editMask = false;
    this.commit(label ?? `New ${layer.kind === 'adjustment' ? 'Adjustment' : 'Layer'}`, { layers, activeId: layer.id }, { icon: 'layer' });
  }

  /** Layers selected in the Layers panel, bottom to top (just the active layer unless several are). */
  get selectedLayers(): Layer[] {
    const d = this.doc;
    if (!d) return [];
    const ids = new Set(d.selectedIds ?? []);
    ids.add(d.activeId);
    return d.layers.filter((l) => ids.has(l.id));
  }

  /**
   * Selects a layer. `toggle` (⌘/Ctrl-click) adds or removes it from a multi-selection,
   * `range` (Shift-click) selects every layer between the active one and this one.
   */
  selectLayer(id: string, mode: 'replace' | 'toggle' | 'range' = 'replace') {
    const doc = this.doc;
    if (!doc || !doc.layers.some((l) => l.id === id)) return;
    const current = this.selectedLayers.map((l) => l.id);
    if (mode === 'replace') {
      if (doc.activeId === id && current.length <= 1) return;
      this.cancelModes();
      doc.activeId = id;
      doc.selectedIds = undefined;
    } else if (mode === 'toggle') {
      if (current.includes(id)) {
        const rest = current.filter((x) => x !== id);
        if (!rest.length) return; // keep at least one layer selected
        doc.selectedIds = rest;
        if (doc.activeId === id) doc.activeId = rest[rest.length - 1];
      } else {
        doc.selectedIds = [...current, id];
        doc.activeId = id;
      }
    } else {
      const a = doc.layers.findIndex((l) => l.id === doc.activeId);
      const b = doc.layers.findIndex((l) => l.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      doc.selectedIds = doc.layers.slice(lo, hi + 1).map((l) => l.id);
      doc.activeId = id;
    }
    doc.editMask = false;
    this.emit();
  }

  /** Selects exactly these layers (the last one becomes active). */
  setSelectedLayers(ids: string[]) {
    const doc = this.doc;
    if (!doc) return;
    const valid = ids.filter((id) => doc.layers.some((l) => l.id === id));
    if (!valid.length) return;
    doc.activeId = valid[valid.length - 1];
    doc.selectedIds = valid.length > 1 ? valid : undefined;
    doc.editMask = false;
    this.emit();
  }

  // ------------------------------------------------------------ misc

  toast(text: string, kind: Toast['kind'] = 'info') {
    const t = { id: Date.now() + Math.random(), text, kind };
    this.state.toasts = [...this.state.toasts.slice(-3), t];
    this.emit();
    setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((x) => x.id !== t.id);
      this.emit();
    }, kind === 'error' ? 4200 : 2600);
  }

  async task<T>(label: string, fn: () => Promise<T> | T): Promise<T | undefined> {
    this.set({ busy: label });
    await new Promise((r) => setTimeout(r, 30)); // let the spinner paint
    try {
      return await fn();
    } catch (err) {
      console.error(err);
      this.toast(`${label} failed: ${(err as Error).message}`, 'error');
      return undefined;
    } finally {
      this.set({ busy: null });
    }
  }

  setTool(tool: ToolId) {
    if (this.state.tool === tool) return;
    if (this.state.crop || this.state.transform) this.cancelModes();
    this.state.textEditId = null;
    // The white-balance picker is a one-off mode: leaving the eyedropper returns it to picking colours
    if (this.state.opts.eyedropperMode === 'wb' && tool !== 'eyedropper') this.state.opts = { ...this.state.opts, eyedropperMode: 'color' };
    this.set({ tool });
  }

  pushRecentColor(hex: string) {
    const list = [hex, ...this.state.recentColors.filter((c) => c !== hex)].slice(0, 12);
    this.state.recentColors = list;
  }

  setSelection(sel: Selection | null, label: string) {
    this.commit(label, { selection: sel }, { icon: 'selection' });
  }
}

// Bump when a stored option's meaning changes so old values get reset.
const OPTIONS_VERSION = 2;

function loadOptions(): ToolOptions {
  try {
    const raw = localStorage.getItem('photoscale.opts');
    if (raw) {
      const saved = JSON.parse(raw);
      // v1 stored lazy-mouse smoothing (on by default); v2 is a stabilizer that defaults off
      if ((saved._v ?? 1) < 2) delete saved.smoothing;
      delete saved._v;
      return { ...DEFAULT_OPTIONS, ...saved };
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_OPTIONS };
}

function saveOptions(o: ToolOptions) {
  try {
    // Never remember the white-balance picker between sessions
    localStorage.setItem('photoscale.opts', JSON.stringify({ ...o, eyedropperMode: 'color', _v: OPTIONS_VERSION }));
  } catch {
    /* storage unavailable */
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem('photoscale.prefs');
    if (raw) {
      const saved = JSON.parse(raw);
      // v1 defaulted to the orange theme; v2 makes VS Code Dark Modern the default
      if ((saved._v ?? 1) < PREFS_VERSION) return { ...DEFAULT_PREFS };
      delete saved._v;
      return { ...DEFAULT_PREFS, ...saved };
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_PREFS };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem('photoscale.prefs', JSON.stringify({ ...p, _v: PREFS_VERSION }));
  } catch {
    /* storage unavailable */
  }
}

export const store = new Store();

export function useStore(): State {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store.state;
}

/** Marks a canvas edited and repaints. */
export function pixelsChanged(c: HTMLCanvasElement) {
  touch(c);
  store.requestRender();
}

export { ctx2d };
