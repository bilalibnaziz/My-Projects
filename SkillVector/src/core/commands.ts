import { frameVisible, hideObjectSelection } from './objectTransform';
import * as traceStudio from './studio/trace';
import { store } from './store';
import type { ToolId } from './store';
import * as ops from './ops';
import * as io from './io';
import * as vectorOps from './vectorOps';
import { commitCrop, cancelCrop, cancelLasso, finishLasso, interaction } from './tools';
import { FILTERS, filterById } from './filters';
import { contentBounds } from './snap';
import * as vt from './vectorTools';
import { layerBounds } from './align';
import { alignActive, centerActive, distributeSelected, offsetPatch, ALIGN_LABELS, DISTRIBUTE_LABELS } from './align';
import type { DistributeKind } from './align';
import { hasFx, withLayer } from './types';
import { canPasteStyle, clearStyle, copyStyle, pasteStyle } from './layerStyle';
import type { AlignEdge } from './align';
import { SAFE_ZONES } from './social';
import * as pro from './proTools';
import { record } from './actions';
import { applyAutoGrid } from './gridOps';
import { editSelectedGraph, graphGroupOf } from './graphOps';
import { breakSymbolLink, newSymbolFromSelection, redefineSymbol } from './symbols';
import { transformAgain } from './transformAgain';
import { offsetSelected, roundCornersSelected } from './pathOps';
import { textToOutlines } from './textOutlines';
import { groupLayers } from './groups';
import { canMakeButton, hasButton, makeButton, releaseButton } from './button';

export type MenuId = 'File' | 'Edit' | 'Object' | 'Type' | 'Select' | 'Effect' | 'View' | 'Window' | 'Help' | 'Layer' | 'Image' | 'Filter';

export interface Command {
  id: string;
  label: string;
  menu?: MenuId;
  submenu?: string;
  keys?: string; // e.g. "Mod+Shift+Z"
  run: () => void;
  enabled?: () => boolean;
  sep?: boolean; // separator before this item in menus
  checked?: () => boolean;
}

/** Safely targets an active raster layer, or selects a raster layer in the document if available. */
export const ensureActiveRaster = () => {
  if (store.activeLayer?.kind === 'raster') return store.activeLayer;
  const r = store.doc?.layers.find((l) => l.kind === 'raster');
  if (r) {
    store.selectLayer(r.id);
    return r;
  }
  return null;
};

/** Viewport controls, registered by the canvas component. */
export const view = {
  fit: () => {},
  actual: () => {},
  zoomBy: (_f: number) => {},
  /** Zooms so a document-space rectangle fills the view. */
  fitRect: (_r: { x: number; y: number; width: number; height: number }) => {},
};

const hasDoc = () => !!store.doc;

/**
 * Type ▸ Create Outlines: text becomes real vector outlines (a group when it uses several colours);
 * a live shape becomes an editable Bézier path. Both stay vectors and are one undo step.
 */
function createOutlines() {
  const doc = store.doc;
  const l = store.activeLayer;
  if (!doc || !l) return;
  if (l.kind === 'shape') {
    const p = vectorOps.convertToEditablePath(l);
    store.commit('Create Outlines', { layers: doc.layers.map((x) => (x.id === l.id ? p : x)), activeId: p.id });
    store.toast('Converted to an editable Bézier path', 'success');
    return;
  }
  const parts = textToOutlines(doc, l);
  if (!parts) return store.toast('This text draws nothing to outline', 'error');
  const at = doc.layers.findIndex((x) => x.id === l.id);
  let layers = [...doc.layers.slice(0, at), ...parts, ...doc.layers.slice(at + 1)];
  let activeId = parts[parts.length - 1].id;
  if (parts.length > 1) {
    const g = groupLayers(layers, parts.map((p) => p.id), `${l.name} outlines`);
    if (g) {
      layers = g.layers;
      activeId = g.group.id;
    }
  }
  store.commit('Create Outlines', { layers, activeId });
  store.toast(`Text converted to vector outlines (${parts.reduce((n, p) => n + (p.shape?.compoundPoints?.length ?? 1), 0)} paths)`, 'success');
}

/** Box around the selected objects (document pixels), or null. */
function selectionBounds() {
  const boxes = store.selectedLayers.filter((l) => l.kind !== 'adjustment').map(layerBounds).filter((b): b is NonNullable<typeof b> => !!b);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}
const hasSel = () => !!store.doc?.selection;
const pixelLayer = () => store.activeLayer?.kind === 'raster';
const hasMask = () => !!store.activeLayer?.mask;
const movableLayer = () => !!store.activeLayer && store.activeLayer.kind !== 'adjustment';

function askNumber(title: string, label: string, value: number, min: number, max: number, onOk: (v: number) => void, unit = 'px') {
  store.set({ dialog: { type: 'number', title, label, value, min, max, unit, onOk } });
}

function bringToFront() {
  const doc = store.doc;
  if (!doc || !store.activeLayer) return;
  const id = doc.activeId;
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return;
  const others = doc.layers.filter((x) => x.id !== id);
  store.commit('Bring to Front', { layers: [...others, l] }, { icon: 'layers' });
}

function sendToBack() {
  const doc = store.doc;
  if (!doc || !store.activeLayer) return;
  const id = doc.activeId;
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return;
  const others = doc.layers.filter((x) => x.id !== id);
  store.commit('Send to Back', { layers: [l, ...others] }, { icon: 'layers' });
}

function lockActive() {
  const l = store.activeLayer;
  if (l) ops.updateSelectedLayers({ locked: !l.locked }, l.locked ? 'Unlock' : 'Lock', `lock:${Date.now()}`);
}

function unlockAll() {
  const doc = store.doc;
  if (!doc) return;
  const layers = doc.layers.map((l) => (l.locked ? { ...l, locked: false } : l));
  store.commit('Unlock All', { layers }, { icon: 'layers' });
}

function hideActive() {
  const l = store.activeLayer;
  if (l) ops.updateSelectedLayers({ visible: false }, 'Hide Selection', `vis:${Date.now()}`);
}

function showAll() {
  const doc = store.doc;
  if (!doc) return;
  const layers = doc.layers.map((l) => (!l.visible ? { ...l, visible: true } : l));
  store.commit('Show All', { layers }, { icon: 'layers' });
}

function toggleOutlineMode() {
  const doc = store.doc;
  if (!doc) return;
  doc.outlineMode = !doc.outlineMode;
  store.emit();
  store.toast(doc.outlineMode ? 'Outline Mode (Wireframe)' : 'GPU Preview Mode');
}

export const COMMANDS: Command[] = [
  // ---------------------------------------------------------------- File
  { id: 'new', label: 'New…', menu: 'File', keys: 'Mod+N', run: () => store.set({ dialog: { type: 'new' } }) },
  { id: 'new-template', label: 'New from Template…', menu: 'File', keys: 'Mod+Alt+N', run: () => store.set({ dialog: { type: 'new', tab: 'templates' } }) },
  { id: 'open', label: 'Open…', menu: 'File', keys: 'Mod+O', run: async () => io.openFiles(await io.pickFiles()) },
  { id: 'sample-landscape', label: 'Alpine Lake (Landscape)', menu: 'File', submenu: 'Open Sample Document', run: async () => { await store.task('Opening Alpine Lake', async () => { const blob = await (await fetch('/samples/landscape.jpg')).blob(); io.docFromCanvas(await io.fileToCanvas(blob), 'Alpine Lake', 'landscape.jpg'); }); } },
  { id: 'sample-portrait', label: 'Studio Portrait', menu: 'File', submenu: 'Open Sample Document', run: async () => { await store.task('Opening Studio Portrait', async () => { const blob = await (await fetch('/samples/portrait.jpg')).blob(); io.docFromCanvas(await io.fileToCanvas(blob), 'Studio Portrait', 'portrait.jpg'); }); } },
  { id: 'sample-architecture', label: 'Modern Architecture', menu: 'File', submenu: 'Open Sample Document', run: async () => { await store.task('Opening Architecture', async () => { const blob = await (await fetch('/samples/architecture.jpg')).blob(); io.docFromCanvas(await io.fileToCanvas(blob), 'Architecture', 'architecture.jpg'); }); } },
  {
    id: 'place',
    label: 'Place Image / Vector…',
    menu: 'File',
    keys: 'Mod+Shift+P',
    enabled: hasDoc,
    run: async () => {
      const files = await io.pickFiles('image/*', false);
      if (files[0]) await store.task('Placing file', () => io.placeImage(files[0], files[0].name.replace(/\.[^.]+$/, '')));
    },
  },
  { id: 'save', label: 'Save Project (.illustratorscale)', menu: 'File', keys: 'Mod+S', sep: true, enabled: hasDoc, run: () => store.doc && store.task('Saving', () => io.saveProject(store.doc!)) },
  { id: 'export', label: 'Export As…', menu: 'File', keys: 'Mod+Alt+Shift+W', enabled: hasDoc, run: () => store.set({ dialog: { type: 'export' } }) },
  { id: 'batch-export', label: 'Multi-Format Batch Export…', menu: 'File', keys: 'Mod+Shift+E', enabled: hasDoc, run: () => store.set({ dialog: { type: 'batchExport' } }) },
  { id: 'export-svg', label: 'Export as SVG (Vector)…', menu: 'File', enabled: hasDoc, run: () => store.doc && store.task('Exporting SVG', () => io.exportSvg(store.doc!)) },
  { id: 'copy-svg', label: 'Copy SVG to Clipboard', menu: 'File', enabled: hasDoc, run: () => store.doc && io.copySvgToClipboard(store.doc!) },
  { id: 'export-pdf', label: 'Export as PDF…', menu: 'File', enabled: hasDoc, run: () => store.doc && store.task('Writing PDF', () => io.exportPdf(store.doc!)) },
  { id: 'print-tiling', label: 'Print Tiling / Export Tiled PDF…', menu: 'File', enabled: hasDoc, run: () => store.set({ dialog: { type: 'printTiling' } }) },
  { id: 'export-psd', label: 'Export as PSD…', menu: 'File', enabled: hasDoc, run: () => store.doc && store.task('Writing PSD', () => io.exportPsd(store.doc!)) },
  { id: 'export-slices', label: 'Export Slices (ZIP)…', menu: 'File', enabled: () => !!store.doc?.slices?.length, run: () => store.doc && store.task('Exporting slices', () => io.exportSlices(store.doc!)) },
  { id: 'export-layers', label: 'Export Artboards / Layers (ZIP)…', menu: 'File', enabled: hasDoc, run: () => store.doc && store.task('Exporting artboards', () => io.exportLayers(store.doc!, { trim: true })) },
  { id: 'export-scales', label: 'Export @1x @2x @3x (ZIP)', menu: 'File', enabled: hasDoc, run: () => store.doc && store.task('Exporting sizes', () => io.exportScales(store.doc!)) },
  {
    id: 'quick-export',
    label: 'Quick Export as PNG',
    menu: 'File',
    enabled: hasDoc,
    run: () => store.doc && store.task('Exporting', () => io.exportImage(store.doc!, 'png', 1, 1, null)),
  },
  {
    id: 'export-all',
    label: 'Export All Open Documents',
    menu: 'File',
    enabled: () => store.state.docs.length > 1,
    run: () =>
      store.task(`Exporting ${store.state.docs.length} documents`, async () => {
        for (const d of store.state.docs) await io.exportImage(d, 'png', 1, 1, null);
        store.toast(`Exported ${store.state.docs.length} documents`, 'success');
      }),
  },
  { id: 'revert-doc', label: 'Revert to Saved / Original', menu: 'File', sep: true, enabled: () => !!store.doc && (store.doc.hIndex > 0 || store.doc.dirty), run: () => { const d = store.doc; if (!d) return; while (d.hIndex > 0) store.undo(); store.toast(`Reverted “${d.title}”`); } },
  { id: 'close', label: 'Close Document', menu: 'File', keys: 'Mod+W', sep: true, enabled: hasDoc, run: () => store.doc && store.closeDoc(store.doc.id) },

  // ---------------------------------------------------------------- Edit
  { id: 'undo', label: 'Undo', menu: 'Edit', keys: 'Mod+Z', enabled: () => (store.doc?.hIndex ?? 0) > 0, run: () => store.undo() },
  { id: 'redo', label: 'Redo', menu: 'Edit', keys: 'Mod+Shift+Z', enabled: () => !!store.doc && store.doc.hIndex < store.doc.history.length - 1, run: () => store.redo() },
  { id: 'cut', label: 'Cut', menu: 'Edit', keys: 'Mod+X', sep: true, enabled: hasSel, run: () => ops.copy(false, true) },
  { id: 'copy', label: 'Copy', menu: 'Edit', keys: 'Mod+C', enabled: hasDoc, run: () => ops.copy() },
  { id: 'copy-merged', label: 'Copy Merged', menu: 'Edit', keys: 'Mod+Shift+C', enabled: hasDoc, run: () => ops.copy(true) },
  { id: 'paste', label: 'Paste', menu: 'Edit', keys: 'Mod+V', enabled: hasDoc, run: () => ops.paste() },
  { id: 'clear', label: 'Clear / Delete', menu: 'Edit', keys: 'Backspace', enabled: hasDoc, run: () => ops.clearSelection() },
  { id: 'fill-fg', label: 'Fill with Foreground Color', menu: 'Edit', keys: 'Alt+Backspace', sep: true, enabled: hasDoc, run: () => ops.fill(store.state.fg) },
  { id: 'fill-bg', label: 'Fill with Background Color', menu: 'Edit', keys: 'Mod+Backspace', enabled: hasDoc, run: () => ops.fill(store.state.bg) },
  { id: 'caf', label: 'Content-Aware Fill (Remove Object)', menu: 'Edit', keys: 'Shift+Backspace', enabled: hasSel, run: () => ops.contentAwareFillSelection() },
  {
    id: 'transform',
    label: 'Free Transform',
    menu: 'Edit',
    keys: 'Mod+T',
    sep: true,
    enabled: hasDoc,
    run: () => ops.beginTransform(),
  },
  { id: 'flip-layer-h', label: 'Flip Object Horizontal', menu: 'Edit', enabled: hasDoc, run: () => ops.flipLayer('h') },
  { id: 'flip-layer-v', label: 'Flip Object Vertical', menu: 'Edit', enabled: hasDoc, run: () => ops.flipLayer('v') },
  { id: 'preferences', label: 'Preferences…', menu: 'Edit', keys: 'Mod+,', sep: true, run: () => store.set({ dialog: { type: 'preferences' } }) },

  // ---------------------------------------------------------------- Object
  { id: 'arrange-front', label: 'Bring to Front', menu: 'Object', submenu: 'Arrange', keys: 'Mod+Shift+]', enabled: hasDoc, run: bringToFront },
  { id: 'raise', label: 'Bring Forward', menu: 'Object', submenu: 'Arrange', keys: 'Mod+]', enabled: hasDoc, run: () => ops.shiftLayer(1) },
  { id: 'lower', label: 'Send Backward', menu: 'Object', submenu: 'Arrange', keys: 'Mod+[', enabled: hasDoc, run: () => ops.shiftLayer(-1) },
  { id: 'arrange-back', label: 'Send to Back', menu: 'Object', submenu: 'Arrange', keys: 'Mod+Shift+[', enabled: hasDoc, run: sendToBack },

  { id: 'transform-again', label: 'Transform Again', menu: 'Object', submenu: 'Transform', keys: 'Mod+D', enabled: () => store.selectedLayers.length > 0 && !hasSel(), run: () => transformAgain() },
  { id: 'transform-each', label: 'Transform Each…', menu: 'Object', submenu: 'Transform', keys: 'Mod+Alt+Shift+D', enabled: () => store.selectedLayers.length > 0, run: () => store.set({ dialog: { type: 'transformEach' } }) },
  { id: 'transform-free', label: 'Free Transform', menu: 'Object', submenu: 'Transform', keys: 'Mod+T', enabled: hasDoc, run: () => ops.beginTransform() },
  { id: 'flip-obj-h', label: 'Flip Horizontal', menu: 'Object', submenu: 'Transform', enabled: hasDoc, run: () => ops.flipLayer('h') },
  { id: 'flip-obj-v', label: 'Flip Vertical', menu: 'Object', submenu: 'Transform', enabled: hasDoc, run: () => ops.flipLayer('v') },

  { id: 'group', label: 'Group', menu: 'Object', keys: 'Mod+G', sep: true, enabled: hasDoc, run: () => ops.groupSelected() },
  {
    id: 'ungroup',
    label: 'Ungroup',
    menu: 'Object',
    keys: 'Mod+Shift+G',
    enabled: () => !!store.activeLayer && (store.activeLayer.kind === 'group' || !!store.activeLayer.parent),
    run: () => ops.ungroupActive(),
  },
  { id: 'lock', label: 'Lock Selection', menu: 'Object', keys: 'Mod+2', sep: true, enabled: hasDoc, run: lockActive },
  { id: 'unlock-all', label: 'Unlock All', menu: 'Object', keys: 'Mod+Alt+2', enabled: hasDoc, run: unlockAll },
  { id: 'hide', label: 'Hide Selection', menu: 'Object', keys: 'Mod+3', enabled: hasDoc, run: hideActive },
  { id: 'show-all', label: 'Show All', menu: 'Object', keys: 'Mod+Alt+3', enabled: hasDoc, run: showAll },

  {
    id: 'pathfinder-unite',
    label: 'Unite (Merge Shapes)',
    menu: 'Object',
    submenu: 'Pathfinder',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('unite');
      store.toast(r.applied ? 'Pathfinder: Unite' : r.reason);
    },
  },
  {
    id: 'pathfinder-minus',
    label: 'Minus Front',
    menu: 'Object',
    submenu: 'Pathfinder',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('minus-front');
      store.toast(r.applied ? 'Pathfinder: Minus Front' : r.reason);
    },
  },
  {
    id: 'pathfinder-intersect',
    label: 'Intersect',
    menu: 'Object',
    submenu: 'Pathfinder',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('intersect');
      store.toast(r.applied ? 'Pathfinder: Intersect' : r.reason);
    },
  },
  {
    id: 'pathfinder-exclude',
    label: 'Exclude',
    menu: 'Object',
    submenu: 'Pathfinder',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('exclude');
      store.toast(r.applied ? 'Pathfinder: Exclude' : r.reason);
    },
  },
  {
    id: 'pathfinder-divide',
    label: 'Divide',
    menu: 'Object',
    submenu: 'Pathfinder',
    enabled: () => store.selectedLayers.filter((l) => l.kind === 'shape').length >= 2,
    run: () => {
      const r = vectorOps.pathfinderDivide();
      store.toast(r.applied ? 'Pathfinder: Divide' : r.reason);
    },
  },
  ...(Object.keys(vectorOps.PATHFINDER_EXTRA_LABELS) as vectorOps.PathfinderExtraOp[]).map(
    (op): Command => ({
      id: `pathfinder-${op}`,
      label: vectorOps.PATHFINDER_EXTRA_LABELS[op],
      menu: 'Object',
      submenu: 'Pathfinder',
      enabled: () => store.selectedLayers.filter((l) => l.kind === 'shape').length >= 2,
      run: () => {
        const r = vectorOps.pathfinderExtra(op);
        store.toast(r.applied ? `Pathfinder: ${r.reason}` : r.reason);
      },
    })
  ),

  {
    id: 'offset-path',
    label: 'Offset Path…',
    menu: 'Object',
    submenu: 'Path',
    enabled: () => store.selectedLayers.some((l) => l.kind === 'shape'),
    run: () => store.set({ dialog: { type: 'number', title: 'Offset Path', label: 'Offset (negative = inset)', value: 10, min: -1000, max: 1000, unit: 'px', onOk: (v) => offsetSelected(v) } }),
  },
  {
    id: 'round-corners',
    label: 'Round Corners…',
    menu: 'Object',
    submenu: 'Path',
    enabled: () => store.selectedLayers.some((l) => l.kind === 'shape'),
    run: () => store.set({ dialog: { type: 'number', title: 'Round Corners', label: 'Radius', value: 12, min: 0, max: 2000, unit: 'px', onOk: (v) => roundCornersSelected(v) } }),
  },
  {
    id: 'recolor',
    label: 'Recolor Artwork…',
    menu: 'Edit',
    submenu: 'Edit Colors',
    enabled: () => store.selectedLayers.some((l) => l.kind === 'shape' || l.kind === 'group' || l.kind === 'text'),
    run: () => store.set({ dialog: { type: 'recolor', ids: store.selectedLayers.map((l) => l.id) } }),
  },
  {
    id: 'simplify-path',
    label: 'Simplify Path',
    menu: 'Object',
    submenu: 'Path',
    enabled: () => store.activeLayer?.kind === 'shape',
    run: () => {
      const r = vectorOps.simplifyActivePath();
      store.toast(r.applied ? `Simplified: ${r.before} → ${r.after} anchors` : r.reason);
    },
  },
  {
    id: 'outline-stroke',
    label: 'Outline Stroke',
    menu: 'Object',
    submenu: 'Path',
    enabled: () => store.activeLayer?.kind === 'shape' && (store.activeLayer.shape?.strokeWidth ?? 0) > 0,
    run: () => {
      const r = vectorOps.outlineActiveStroke();
      store.toast(r.applied ? 'Stroke outlined' : r.reason);
    },
  },
  {
    id: 'reverse-path',
    label: 'Reverse Path Direction',
    menu: 'Object',
    submenu: 'Path',
    enabled: () => !!store.activeLayer?.shape?.points,
    run: () => {
      const l = store.activeLayer;
      if (l?.shape?.points) {
        l.shape.points = vectorOps.reversePoints(l.shape.points);
        store.commit('Reverse Path', { layers: store.doc!.layers.map((x) => (x.id === l.id ? l : x)) });
        store.toast('Reversed path');
      }
    },
  },
  {
    id: 'join-path',
    label: 'Join Path Endpoints',
    menu: 'Object',
    submenu: 'Path',
    keys: 'Mod+J',
    enabled: hasDoc,
    run: () => {
      const r = vectorOps.joinPaths();
      store.toast(r.joined ? 'Path endpoints joined' : r.reason);
    },
  },
  {
    id: 'convert-path',
    label: 'Convert Shape to Bézier Path',
    menu: 'Object',
    submenu: 'Path',
    enabled: () => store.activeLayer?.kind === 'shape' && store.activeLayer.shape?.shape !== 'path',
    run: () => {
      const l = store.activeLayer;
      const doc = store.doc;
      if (l && doc) {
        const res = vectorOps.convertToEditablePath(l, true, true);
        store.commit('Convert to Path', { layers: doc.layers.map((x) => (x.id === l.id ? res : x)), activeId: res.id }, { icon: 'shape' });
        store.toast('Converted shape to Bézier path');
      }
    },
  },
  {
    id: 'make-compound',
    label: 'Make Compound Path',
    menu: 'Object',
    submenu: 'Path',
    keys: 'Mod+8',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.makeCompoundPath();
      store.toast(r.created ? 'Compound path created' : r.reason);
    },
  },
  {
    id: 'release-compound',
    label: 'Release Compound Path',
    menu: 'Object',
    submenu: 'Path',
    keys: 'Mod+Alt+Shift+8',
    enabled: () => store.activeLayer?.kind === 'shape' && !!store.activeLayer.shape?.compoundPoints?.length,
    run: () => {
      const r = vectorOps.releaseCompoundPath();
      store.toast(r.released ? 'Compound path released' : r.reason);
    },
  },

  { id: 'symbol-new', label: 'New Symbol from Selection', menu: 'Object', submenu: 'Symbol', enabled: () => store.activeLayer?.kind === 'shape', run: () => { if (newSymbolFromSelection()) store.setDockTab('symbols'); } },
  { id: 'symbol-redefine', label: 'Redefine Symbol', menu: 'Object', submenu: 'Symbol', enabled: () => !!store.activeLayer?.symbol && !!store.doc?.symbols?.some((d) => d.id === store.activeLayer?.symbol), run: () => redefineSymbol() },
  { id: 'symbol-break', label: 'Break Link to Symbol', menu: 'Object', submenu: 'Symbol', enabled: () => store.selectedLayers.some((l) => l.symbol), run: () => breakSymbolLink() },

  { id: 'slice-from-selection', label: 'Create Slice from Selection', menu: 'Object', submenu: 'Slice', enabled: hasDoc, run: () => { if (!vt.sliceFromSelection(selectionBounds())) store.toast('Select objects to slice around'); } },
  { id: 'slice-delete-all', label: 'Delete All Slices', menu: 'Object', submenu: 'Slice', enabled: () => !!store.doc?.slices?.length, run: () => vt.deleteAllSlices() },

  ...(Object.keys(ALIGN_LABELS) as AlignEdge[]).map(
    (edge): Command => ({
      id: `align-${edge}`,
      label: ALIGN_LABELS[edge],
      menu: 'Object',
      submenu: 'Align',
      enabled: movableLayer,
      run: () => alignActive(edge),
    })
  ),
  { id: 'center-layer', label: 'Center on Artboard', menu: 'Object', submenu: 'Align', enabled: movableLayer, run: () => centerActive() },
  ...(Object.keys(DISTRIBUTE_LABELS) as DistributeKind[]).map(
    (k): Command => ({
      id: `distribute-${k}`,
      label: DISTRIBUTE_LABELS[k],
      menu: 'Object',
      submenu: 'Distribute',
      enabled: () => store.selectedLayers.filter((l) => l.kind !== 'adjustment').length >= 3,
      run: () => distributeSelected(k),
    })
  ),

  { id: 'make-button', label: 'Make Button', menu: 'Object', sep: true, enabled: () => hasDoc() && canMakeButton(), run: () => makeButton() },
  { id: 'release-button', label: 'Release Button', menu: 'Object', enabled: () => hasDoc() && hasButton(), run: () => { const n = releaseButton(); if (n) store.toast(`Released ${n} button${n === 1 ? '' : 's'}`); } },
  { id: 'clip', label: 'Make / Release Clipping Mask', menu: 'Object', keys: 'Mod+7', enabled: hasDoc, run: () => ops.toggleClip() },
  { id: 'layer-style', label: 'Appearance & Styles…', menu: 'Object', keys: 'Mod+Alt+Y', enabled: movableLayer, run: () => store.set({ dialog: { type: 'layerStyle' } }) },
  { id: 'copy-style', label: 'Copy Appearance', menu: 'Object', enabled: () => !!store.activeLayer && hasFx(store.activeLayer), run: () => copyStyle() },
  { id: 'paste-style', label: 'Paste Appearance', menu: 'Object', enabled: canPasteStyle, run: () => pasteStyle() },
  { id: 'rasterize', label: 'Rasterize Object', menu: 'Object', enabled: () => ['text', 'shape'].includes(store.activeLayer?.kind ?? '') || !!store.activeLayer?.smart, run: () => ops.rasterizeActive() },
  { id: 'graph-data', label: 'Graph ▸ Data…', menu: 'Object', enabled: () => !!graphGroupOf(store.activeLayer), run: () => editSelectedGraph() },
  {
    id: 'image-trace',
    label: 'Image Trace ▸ Make',
    menu: 'Object',
    enabled: hasDoc,
    run: () => {
      const l = store.activeLayer;
      if (l?.kind === 'raster' && l.canvas) void traceStudio.runTrace(l, traceStudio.currentTraceOptions(l), { after: store.state.opts.traceAfter, output: store.state.opts.traceOutput });
      else {
        store.setTool('image-trace');
        store.toast('Image Trace tool: click a picture to trace it', 'info');
      }
    },
  },
  { id: 'image-trace-studio', label: 'Image Trace ▸ Trace Studio…', menu: 'Object', enabled: hasDoc, run: () => void import('../ui/StudioPanel').then((m) => m.openStudioKit('trace')) },
  { id: 'expand-trace', label: 'Image Trace ▸ Expand to Shapes', menu: 'Object', enabled: () => store.selectedLayers.some((l) => l.kind === 'group' || (l.shape?.compoundPoints?.length ?? 0) > 1), run: () => traceStudio.expandTrace({ split: true }) },
  { id: 'ungroup-trace', label: 'Image Trace ▸ Ungroup', menu: 'Object', enabled: () => store.selectedLayers.some((l) => l.kind === 'group'), run: () => traceStudio.expandTrace({ split: false }) },
  { id: 'dup-layer', label: 'Duplicate Object', menu: 'Object', sep: true, enabled: hasDoc, run: () => ops.duplicateLayer() },
  { id: 'del-layer', label: 'Delete Object', menu: 'Object', enabled: hasDoc, run: () => ops.deleteLayer() },

  // ---------------------------------------------------------------- Type
  { id: 'type-tool', label: 'Type Tool', menu: 'Type', keys: 'T', run: () => store.setTool('text') },
  {
    id: 'glyphs-panel',
    label: 'Glyphs & Special Characters…',
    menu: 'Type',
    keys: 'Mod+Alt+G',
    run: () => store.set({ dialog: { type: 'glyphs' } }),
  },
  {
    id: 'create-outlines',
    label: 'Create Outlines (Vector Path)',
    menu: 'Type',
    keys: 'Mod+Shift+O',
    sep: true,
    enabled: () => !!store.activeLayer && (store.activeLayer.kind === 'text' || store.activeLayer.kind === 'shape'),
    run: () => createOutlines(),
  },

  // ---------------------------------------------------------------- Select
  { id: 'select-all', label: 'All', menu: 'Select', keys: 'Mod+A', enabled: hasDoc, run: () => ops.selectAll() },
  { id: 'deselect', label: 'Deselect', menu: 'Select', keys: 'Mod+D', enabled: hasSel, run: () => ops.deselect() },
  { id: 'reselect', label: 'Reselect', menu: 'Select', keys: 'Mod+Shift+D', enabled: () => !!store.doc?.lastSelection, run: () => ops.reselect() },
  { id: 'inverse', label: 'Inverse', menu: 'Select', keys: 'Mod+Shift+I', enabled: hasDoc, run: () => ops.invertSelection() },
  {
    id: 'select-all-layers',
    label: 'Select All Objects / Layers',
    menu: 'Select',
    sep: true,
    enabled: hasDoc,
    run: () => store.setSelectedLayers(store.doc!.layers.filter((l) => l.kind !== 'adjustment').map((l) => l.id)),
  },
  { id: 'layer-alpha', label: 'Load Transparency Mask', menu: 'Select', enabled: hasDoc, run: () => ops.selectLayerAlpha() },
  {
    id: 'color-range',
    label: 'Color Range…',
    menu: 'Select',
    enabled: hasDoc,
    run: () => askNumber('Color Range', 'Fuzziness', 40, 0, 200, (v) => ops.selectColorRange(store.state.fg, v), ''),
  },

  // ---------------------------------------------------------------- Effect
  {
    id: 'filter-repeat',
    label: 'Repeat Last Effect',
    menu: 'Effect',
    keys: 'Mod+Alt+F',
    enabled: () => !!ops.lastFilter && (pixelLayer() || (store.doc?.layers.some((l) => l.kind === 'raster') ?? false)),
    run: () => {
      ensureActiveRaster();
      const f = ops.lastFilter!;
      ops.commitFilter(f.id, f.params);
      store.toast(`${filterById(f.id)?.name ?? 'Effect'} applied again`);
    },
  },
  ...FILTERS.map(
    (f): Command => ({
      id: `filter-${f.id}`,
      label: `${f.name}…`,
      menu: 'Effect',
      submenu: f.group,
      enabled: () => pixelLayer() || (store.doc?.layers.some((l) => l.kind === 'raster') ?? false) || store.selectedLayers.length > 0,
      run: () => {
        ensureActiveRaster();
        store.set({ dialog: { type: 'filter', filterId: f.id } });
      },
    })
  ),

  // ---------------------------------------------------------------- View
  { id: 'outline-mode', label: 'Outline / Preview Mode', menu: 'View', keys: 'Mod+Y', enabled: hasDoc, checked: () => !!store.doc?.outlineMode, run: toggleOutlineMode },
  { id: 'proof', label: 'Proof Colors (CMYK Print)', menu: 'View', keys: 'Mod+Alt+Shift+Y', enabled: hasDoc, checked: () => store.state.proof === 'cmyk', run: () => store.set({ proof: store.state.proof === 'cmyk' ? 'off' : 'cmyk' }) },
  { id: 'gamut', label: 'Gamut Warning', menu: 'View', keys: 'Mod+Shift+Y', enabled: hasDoc, checked: () => store.state.proof === 'gamut', run: () => store.set({ proof: store.state.proof === 'gamut' ? 'off' : 'gamut' }) },
  { id: 'zoom-in', label: 'Zoom In', menu: 'View', keys: 'Mod+=', sep: true, enabled: hasDoc, run: () => view.zoomBy(1.25) },
  { id: 'zoom-out', label: 'Zoom Out', menu: 'View', keys: 'Mod+-', enabled: hasDoc, run: () => view.zoomBy(0.8) },
  { id: 'fit', label: 'Fit Artboard in Window', menu: 'View', keys: 'Mod+0', enabled: hasDoc, run: () => view.fit() },
  {
    id: 'fit-all',
    label: 'Fit All in Window',
    menu: 'View',
    keys: 'Mod+Alt+0',
    enabled: hasDoc,
    run: () => {
      const doc = store.doc;
      if (!doc) return;
      let minX = 0, minY = 0, maxX = doc.width, maxY = doc.height;
      if (doc.artboards && doc.artboards.length > 0) {
        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        for (const a of doc.artboards) {
          minX = Math.min(minX, a.x);
          minY = Math.min(minY, a.y);
          maxX = Math.max(maxX, a.x + a.width);
          maxY = Math.max(maxY, a.y + a.height);
        }
      }
      for (const l of doc.layers) {
        if (!l.visible || l.kind === 'adjustment') continue;
        const w = l.width || (l.canvas ? l.canvas.width : 0);
        const h = l.height || (l.canvas ? l.canvas.height : 0);
        minX = Math.min(minX, l.x);
        minY = Math.min(minY, l.y);
        maxX = Math.max(maxX, l.x + w);
        maxY = Math.max(maxY, l.y + h);
      }
      if (isFinite(minX) && maxX > minX && maxY > minY) {
        view.fitRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      } else {
        view.fit();
      }
    },
  },
  { id: 'actual', label: 'Actual Size (100%)', menu: 'View', keys: 'Mod+1', enabled: hasDoc, run: () => view.actual() },
  { id: 'rulers', label: 'Rulers', menu: 'View', keys: 'Mod+R', sep: true, checked: () => store.state.showRulers, run: () => store.set({ showRulers: !store.state.showRulers }) },
  { id: 'grid', label: 'Grid', menu: 'View', keys: "Mod+'", checked: () => store.state.showGrid, run: () => store.set({ showGrid: !store.state.showGrid }) },
  { id: 'pixel-grid', label: 'Pixel Grid', menu: 'View', checked: () => store.state.showPixelGrid, run: () => store.set({ showPixelGrid: !store.state.showPixelGrid }) },
  {
    id: 'snap-grid',
    label: 'Snap to Grid',
    menu: 'View',
    keys: "Mod+Alt+'",
    checked: () => store.state.docGrid.snap,
    run: () => {
      const snap = !store.state.docGrid.snap;
      // Snapping to a grid you cannot see is confusing: turning it on shows the grid
      store.set({ docGrid: { ...store.state.docGrid, snap }, ...(snap ? { showGrid: true } : {}) });
    },
  },
  { id: 'layout-grids', label: 'Layout Grids', menu: 'View', keys: 'Mod+;', checked: () => store.state.docGrid.showLayout, run: () => store.set({ docGrid: { ...store.state.docGrid, showLayout: !store.state.docGrid.showLayout } }) },
  {
    id: 'auto-grid',
    label: 'Auto Grid',
    menu: 'View',
    keys: 'Mod+Alt+;',
    enabled: hasDoc,
    run: () => {
      const why = applyAutoGrid();
      if (why) store.toast(why, 'success');
    },
  },
  { id: 'grids-panel', label: 'Grids & Layout…', menu: 'View', enabled: hasDoc, run: () => store.setDockTab('grids') },
  {
    id: 'safe-zones',
    label: 'Smart Guides & Margins',
    menu: 'View',
    keys: "Mod+Shift+'",
    enabled: () => !!store.doc,
    checked: () => store.state.showSafeZones && !!store.doc?.safeZone,
    run: () => {
      const doc = store.doc!;
      if (!doc.safeZone) {
        doc.safeZone = 'margin';
        store.set({ showSafeZones: true });
        store.toast(`${SAFE_ZONES.margin.label}: ${SAFE_ZONES.margin.note}`);
        return;
      }
      store.set({ showSafeZones: !store.state.showSafeZones });
    },
  },
  {
    id: 'compare',
    label: 'Before / After Preview',
    menu: 'View',
    keys: '\\',
    sep: true,
    checked: () => store.state.compare,
    run: () => {
      store.set({ compare: !store.state.compare });
      store.invalidateRender();
    },
  },
  { id: 'focus', label: 'Focus Mode (hide panels)', menu: 'View', keys: 'Tab', checked: () => store.state.focusMode, run: () => store.set({ focusMode: !store.state.focusMode }) },

  // ---------------------------------------------------------------- Window
  { id: 'view-corner-widgets', label: 'Corner Widgets', menu: 'View', checked: () => store.state.opts.liveCorners !== false, run: () => store.setOpts({ liveCorners: store.state.opts.liveCorners === false }) },
  { id: 'win-properties', label: 'Properties Panel', menu: 'Window', run: () => store.setDockTab('properties') },
  { id: 'win-stroke', label: 'Stroke Panel', menu: 'Window', run: () => store.setDockTab('stroke') },
  { id: 'win-artboards', label: 'Artboards Panel', menu: 'Window', run: () => store.setDockTab('artboards') },
  { id: 'win-symbols', label: 'Symbols Panel', menu: 'Window', run: () => store.setDockTab('symbols') },
  { id: 'win-color', label: 'Color / Swatches Panel', menu: 'Window', run: () => store.setDockTab('color') },
  { id: 'win-actions', label: 'Actions Panel', menu: 'Window', run: () => store.setDockTab('actions') },
  { id: 'win-info', label: 'Info Panel', menu: 'Window', run: () => store.setDockTab('info') },
  { id: 'win-history', label: 'History Panel', menu: 'Window', run: () => store.setDockTab('history') },
  { id: 'win-adjust', label: 'Adjustments Panel', menu: 'Window', run: () => store.setDockTab('adjust') },
  { id: 'win-active-toolbox', label: 'Floating Active Toolbox', menu: 'Window', checked: () => store.state.opts.activeToolbox, run: () => store.setOpts({ activeToolbox: !store.state.opts.activeToolbox }) },
  { id: 'win-focus', label: 'Focus Mode (Hide Panels)', menu: 'Window', keys: 'Tab', checked: () => store.state.focusMode, run: () => store.set({ focusMode: !store.state.focusMode }) },
  { id: 'palette', label: 'Command Palette…', menu: 'Window', keys: 'Mod+K', sep: true, run: () => store.set({ paletteOpen: true }) },

  // ---------------------------------------------------------------- Help
  { id: 'shortcuts', label: 'Keyboard Shortcuts', menu: 'Help', keys: 'Mod+/', run: () => store.set({ dialog: { type: 'shortcuts' } }) },
  { id: 'about', label: 'About Skill Vector', menu: 'Help', run: () => store.set({ dialog: { type: 'about' } }) },
];

// Actions: menu commands that change the document are recorded while an action is recording.
// Commands that open a dialog record nothing themselves (the dialog's result is recorded).
const NOT_RECORDED = new Set([
  'undo',
  'redo',
  'save',
  'export',
  'batch-export',
  'image-trace',
  'image-trace-studio',
  'export-svg',
  'copy-svg',
  'export-pdf',
  'open',
  'sample-landscape',
  'sample-portrait',
  'sample-architecture',
  'revert-doc',
  'new',
  'new-template',
  'place',
  'close',
  'palette',
  'shortcuts',
  'about',
  'preferences',
  'export-all',
  'quick-export',
  'export-psd',
  'export-layers',
  'export-scales',
  'copy',
  'focus',
  'compare',
  'outline-mode',
  'fit',
  'fit-all',
  'actual',
  'zoom-in',
  'zoom-out',
  'rulers',
  'grid',
  'pixel-grid',
  'safe-zones',
  'win-properties',
  'win-stroke',
  'win-artboards',
  'win-symbols',
  'win-color',
  'win-actions',
  'win-info',
  'win-history',
  'win-adjust',
  'win-active-toolbox',
  'win-focus',
]);

for (const c of COMMANDS) {
  const run = c.run;
  c.run = () => {
    const before = { dialog: store.state.dialog, transform: store.state.transform, crop: store.state.crop };
    const r = run();
    const opensUi = store.state.dialog !== before.dialog || store.state.transform !== before.transform || store.state.crop !== before.crop;
    if ((c.menu === 'Object' || c.menu === 'Select' || c.menu === 'Edit' || c.menu === 'Effect') && !NOT_RECORDED.has(c.id) && !opensUi) {
      record({ kind: 'command', id: c.id, label: c.label.replace(/…$/, '') });
    }
    return r;
  };
}

// Authentic Adobe Illustrator tool shortcuts
export const TOOL_KEYS: Record<string, ToolId[]> = {
  v: ['move'],
  a: ['direct-select', 'group-select'],
  y: ['wand'],
  q: ['lasso', 'poly-lasso'],
  p: ['pen', 'curvature', 'add-anchor', 'delete-anchor', 'anchor-point'],
  '\\': ['line', 'arc', 'spiral', 'rect-grid', 'polar-grid'],
  m: ['shape-rect', 'shape-round-rect'],
  l: ['shape-ellipse'],
  t: ['text', 'area-type', 'path-type', 'vertical-type', 'vertical-area-type', 'vertical-path-type', 'touch-type'],
  b: ['brush', 'blob-brush'],
  n: ['pencil', 'smooth', 'path-eraser', 'join', 'shaper'],
  r: ['rotate', 'reflect'],
  s: ['scale', 'shear', 'reshape'],
  e: ['free-transform', 'puppet-warp'],
  w: ['width', 'warp', 'twirl', 'pucker', 'bloat', 'scallop', 'crystallize', 'wrinkle'],
  k: ['bucket', 'live-paint-select'],
  c: ['scissors', 'knife', 'crop'],
  u: ['mesh'],
  g: ['gradient'],
  i: ['eyedropper', 'ruler', 'color-sampler', 'image-trace'],
  j: ['graph-column', 'graph-stacked-column', 'graph-bar', 'graph-stacked-bar', 'graph-line', 'graph-area', 'graph-scatter', 'graph-pie', 'graph-radar'],
  h: ['hand', 'print-tiling'],
  z: ['zoom'],
  o: ['artboard'],
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function formatKeys(keys?: string, mac = isMac): string {
  if (!keys) return '';
  const isMac = mac;
  return keys
    .split('+')
    .map((k) => {
      if (k === 'Mod') return isMac ? '⌘' : 'Ctrl+';
      if (k === 'Shift') return isMac ? '⇧' : 'Shift+';
      if (k === 'Alt') return isMac ? '⌥' : 'Alt+';
      if (k === 'Backspace') return isMac ? '⌫' : 'Del';
      if (k === '=') return '+'; // ⌘= is pressed as ⌘+
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join('');
}

export const MENU_ORDER: MenuId[] = ['File', 'Edit', 'Object', 'Type', 'Select', 'Effect', 'View', 'Window', 'Help'];

/** Tools whose own opacity the number keys set (everything else sets the selected objects' opacity). */
const PAINT_OPACITY_TOOLS = new Set<string>(['brush', 'eraser', 'clone', 'bucket', 'gradient', 'color-replace', 'history-brush', 'magic-eraser', 'heal-brush']);

let lastDigit: { k: string; t: number } | null = null;
let digitRun = 0;

/** 1 → 10% … 9 → 90%, 0 → 100%; a second digit within 0.6 s makes a two-digit value (5, 5 → 55%; 0, 5 → 5%). */
export function digitOpacity(k: string, now: number): number {
  const prev = lastDigit && now - lastDigit.t < 600 ? lastDigit.k : null;
  if (prev !== null) {
    lastDigit = null;
    return Number(prev + k) / 100;
  }
  lastDigit = { k, t: now };
  digitRun++;
  return k === '0' ? 1 : Number(k) / 10;
}

/** Keys handled outside COMMANDS (tools, brush, pointer). Shown in the cheatsheet and the PDF guide. */
export function extraShortcuts(mac = isMac): [string, string][] {
  const isMac = mac;
  const mod = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';
  return [
    ['V / A', 'Selection (V) / Direct Selection (A)'],
    ['P / ⇧P', 'Pen Tool / Curvature Tool'],
    ['⇧C', 'Anchor Point Tool (convert corner ↔ smooth)'],
    ['⇧O', 'Artboard Tool (add, resize, switch artboards)'],
    ['⇧M', 'Shape Builder Tool (merge overlapping paths)'],
    ['M / T / B / N', 'Rectangle / Type / Paintbrush / Pencil'],
    ['X / ⇧X / D', 'Toggle active swatch / Swap Fill & Stroke / Default swatches'],
    [`${mod}+Y`, 'Toggle Outline Mode (wireframe Bézier preview)'],
    [`${mod}+8 / ⌥⇧${mod}+8`, 'Make / Release Compound Path (evenodd cutouts)'],
    [`${mod}+J`, 'Join endpoints of open vector paths'],
    [`${mod}+0 / ⌥${mod}+0`, 'Fit active artboard / Fit all artboards in window'],
    [`${mod}+7 / ⌥${mod}+7`, 'Make / Release Clipping Mask'],
    ['[  ]', 'Stroke width / Brush size'],
    ['Shift [  ]', 'Brush hardness'],
    ['1 … 0', 'Opacity 10% … 100% (selected objects, or the painting tool); two quick digits = exact (5 5 → 55%)'],
    ['Space + drag', 'Pan view (any tool)'],
    [isMac ? 'Pinch / ⌘ + scroll' : 'Ctrl + wheel', 'Zoom at cursor'],
    ['Shift (drag)', 'Constrain: square, 45°, straight line'],
    ['Enter / Esc', 'Commit / cancel path, transform, artboard'],
    ['⌫ (pen / direct-select)', 'Remove anchor point or last segment'],
    [`${mod}-click / Shift-click`, 'Select multiple shapes / artboards'],
    ['Arrows', 'Nudge selected object (Shift = 10px)'],
    ['Double-click (hand)', 'Fit on screen'],
  ];
}

function matches(keys: string, e: KeyboardEvent): boolean {
  const parts = keys.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const mod = parts.includes('Mod');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');
  const k = e.key.toLowerCase();
  // Zoom keys: '+' needs Shift on most layouts, so ⌘= and ⌘+ (and the numpad) all count
  if (key === '=' || key === '-') {
    if (mod !== (e.metaKey || e.ctrlKey) || alt !== e.altKey) return false;
    if (key === '=') return k === '=' || k === '+' || e.code === 'Equal' || e.code === 'NumpadAdd';
    return k === '-' || k === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract';
  }
  if (mod !== (e.metaKey || e.ctrlKey) || shift !== e.shiftKey || alt !== e.altKey) return false;
  if (key === 'backspace') return k === 'backspace' || k === 'delete';
  // With Alt/Shift on macOS e.key may be a symbol; fall back to the physical code
  const code = e.code.toLowerCase();
  return k === key || code === `key${key}` || code === `digit${key}` || (key === '/' && code === 'slash') || (key === "'" && code === 'quote') || (key === ';' && code === 'semicolon') || (key === '[' && code === 'bracketleft') || (key === ']' && code === 'bracketright');
}

const REPEATABLE = new Set(['undo', 'redo', 'zoom-in', 'zoom-out', 'raise', 'lower']);

/** Global keyboard handling. Returns true when the event was consumed. */
export function handleKey(e: KeyboardEvent): boolean {
  const s = store.state;
  const doc = store.doc;

  if (e.key === 'Enter') {
    if (s.crop) return commitCrop(), true;
    if (s.transform) return ops.commitTransform(), true;
    if (interaction.lasso?.poly) return finishLasso(), true;
    if (pro.pen.path) return pro.commitPen(), true;
  }
  // Backspace while drawing a path removes its last point instead of clearing pixels
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey && pro.penDeleteLast()) return true;
  // With a slice tool, Delete removes the selected slice
  if ((e.key === 'Backspace' || e.key === 'Delete') && (s.tool === 'slice' || s.tool === 'slice-select') && vt.deleteActiveSlice()) return true;
  if (e.key === 'Escape') {
    if (s.paletteOpen) return store.set({ paletteOpen: false }), true;
    if (s.crop) return cancelCrop(), true;
    if (s.transform) return ops.cancelTransform(), true;
    if (interaction.lasso) return cancelLasso(), true;
    if (pro.pen.path) return pro.cancelPen(), true;
    if (pro.ruler.line) return pro.clearRuler(), true;
    if (s.focusMode) return store.set({ focusMode: false }), true;
    if (s.tool === 'move' && doc && frameVisible()) return hideObjectSelection(), true;
    return false;
  }

  // Commands can share a key (⌘D: Deselect pixels, else Transform Again): the first enabled one runs
  let matched = false;
  for (const c of COMMANDS) {
    if (c.keys && matches(c.keys, e)) {
      matched = true;
      // Holding a key repeats only step-like commands; one-shot commands fire once
      if (e.repeat && !REPEATABLE.has(c.id)) return true;
      if (c.enabled && !c.enabled()) continue;
      c.run();
      return true;
    }
  }
  if (matched) return true;

  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key;
  const o = s.opts;

  // Brush size / hardness
  if (k === '[' || k === ']') {
    if (e.shiftKey) store.setOpts({ hardness: Math.max(0, Math.min(1, o.hardness + (k === ']' ? 0.1 : -0.1))) });
    else {
      const step = o.size < 10 ? 1 : o.size < 50 ? 5 : o.size < 200 ? 10 : 25;
      store.setOpts({ size: Math.max(1, Math.min(2000, o.size + (k === ']' ? step : -step))) });
    }
    return true;
  }
  if (k === '{' || k === '}') {
    store.setOpts({ hardness: Math.max(0, Math.min(1, o.hardness + (k === '}' ? 0.1 : -0.1))) });
    return true;
  }
  // Opacity via number keys (1 = 10% … 0 = 100%): the painting tool's opacity, or, with objects
  // selected, the objects' opacity. Two digits typed quickly give an exact value (5, 5 = 55%).
  if (/^[0-9]$/.test(k) && !e.shiftKey) {
    const now = performance.now();
    const v = digitOpacity(k, now);
    if (doc && !PAINT_OPACITY_TOOLS.has(s.tool) && frameVisible()) {
      const ids = new Set(store.selectedLayers.filter((l) => !l.locked).map((l) => l.id));
      if (ids.size) {
        store.commit('Opacity', { layers: doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { opacity: v }) : l)) }, { coalesce: `digit-opacity:${digitRun}` });
        store.toast(`Opacity ${Math.round(v * 100)}%`);
        return true;
      }
    }
    store.setOpts({ opacity: v });
    return true;
  }
  if (k === 'x' || k === 'X') {
    store.set({ fg: s.bg, bg: s.fg });
    return true;
  }
  if (k === 'd' || k === 'D') {
    store.set({ fg: '#000000', bg: '#ffffff' });
    return true;
  }
  if (k === 'q' || k === 'Q') {
    // Quick toggle between pixels and mask editing
    if (doc && store.activeLayer?.mask) {
      doc.editMask = !doc.editMask;
      store.emit();
    }
    return true;
  }

  // Arrow nudge with move tool (every selected layer)
  if (doc && s.tool === 'move' && k.startsWith('Arrow')) {
    const movable = store.selectedLayers.filter((l) => !l.locked && l.kind !== 'adjustment');
    if (!movable.length) return true;
    const d = e.shiftKey ? 10 : 1;
    const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
    const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
    const ids = new Set(movable.map((l) => l.id));
    const layers = doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, offsetPatch(l, dx, dy)) : l));
    store.commit('Nudge', { layers }, { coalesce: `nudge:${[...ids].join(',')}` });
    return true;
  }

  if (k.toLowerCase() === 'x' && !e.metaKey && !e.ctrlKey) {
    if (e.shiftKey) {
      const oldFill = store.state.fg;
      const oldStroke = store.state.opts.shapeStrokeColor;
      store.set({ fg: oldStroke });
      store.setOpts({ shapeStrokeColor: oldFill });
      store.toast('Swapped Fill and Stroke (⇧X)');
    }
    return true;
  }
  if (k.toLowerCase() === 'd' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    store.set({ fg: '#ffffff', bg: '#000000' });
    store.setOpts({ shapeFill: true, shapeStrokeWidth: 1, shapeStrokeColor: '#000000' });
    store.toast('Default Fill & Stroke (D)');
    return true;
  }
  if (k === '/' && !e.metaKey && !e.ctrlKey) {
    store.setOpts({ shapeFill: false });
    store.toast('Fill: None (/)');
    return true;
  }
  if (k.toLowerCase() === 'f' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    store.toggleScreenMode();
    return true;
  }

  const tools = TOOL_KEYS[k.toLowerCase()];
  if (tools) {
    if (e.shiftKey && tools.length > 1) {
      const i = tools.indexOf(s.tool);
      store.setTool(tools[(i + 1) % tools.length]);
    } else if (!tools.includes(s.tool)) {
      store.setTool(s.lastTools[k.toLowerCase()] ?? tools[0]);
    }
    s.lastTools[k.toLowerCase()] = store.state.tool;
    return true;
  }
  return false;
}
