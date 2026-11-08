import { frameVisible, hideObjectSelection } from './objectTransform';
import { store } from './store';
import type { ToolId } from './store';
import * as ops from './ops';
import * as smart from './smartSelect';
import * as tune from './tuneOps';
import * as io from './io';
import { commitCrop, cancelCrop, cancelLasso, finishLasso, interaction } from './tools';
import { FILTERS, filterById } from './filters';
import { contentBounds } from './snap';
import { alignActive, centerActive, distributeSelected, offsetPatch, ALIGN_LABELS, DISTRIBUTE_LABELS } from './align';
import type { DistributeKind } from './align';
import { hasFx, withLayer, defaultAdjust } from './types';
import { canPasteStyle, clearStyle, copyStyle, pasteStyle } from './layerStyle';
import type { AlignEdge } from './align';
import { SAFE_ZONES } from './social';
import * as pro from './proTools';
import { record } from './actions';
import { applyAutoGrid } from './gridOps';
import * as vectorOps from './vectorOps';
import { transformAgain } from './transformAgain';
import { offsetSelected, roundCornersSelected } from './pathOps';
import { canMakeButton, hasButton, makeButton, releaseButton } from './button';

import { toggleAssistant } from '../ai/open';
import { runFusion } from './fusionOps';

export type MenuId = 'File' | 'Edit' | 'Image' | 'Layer' | 'Select' | 'Filter' | 'View' | 'Window' | 'Help';

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

/** Viewport controls, registered by the canvas component. */
export const view = {
  fit: () => {},
  actual: () => {},
  zoomBy: (_f: number) => {},
  /** Zooms so a document-space rectangle fills the view. */
  fitRect: (_r: { x: number; y: number; width: number; height: number }) => {},
};

const hasDoc = () => !!store.doc;

/** Opens a dock panel; the UI registers how (core code never imports the UI). */
export const panelHooks = { open: (_tab: string) => {} };
const openLooks = () => panelHooks.open('looks');
const hasSel = () => !!store.doc?.selection;
export const ensureActiveRaster = () => {
  if (store.activeLayer?.kind === 'raster') return store.activeLayer;
  const r = store.doc?.layers.find((l) => l.kind === 'raster');
  if (r) {
    store.selectLayer(r.id);
    return r;
  }
  return null;
};
const pixelLayer = () => store.activeLayer?.kind === 'raster' || (store.doc?.layers.some((l) => l.kind === 'raster') ?? false);
const hasMask = () => !!store.activeLayer?.mask;
const movableLayer = () => !!store.activeLayer && store.activeLayer.kind !== 'adjustment';

function askNumber(title: string, label: string, value: number, min: number, max: number, onOk: (v: number) => void, unit = 'px') {
  store.set({ dialog: { type: 'number', title, label, value, min, max, unit, onOk } });
}

export const COMMANDS: Command[] = [
  // ---------------------------------------------------------------- File
  { id: 'new', label: 'New…', menu: 'File', keys: 'Mod+N', run: () => store.set({ dialog: { type: 'new' } }) },
  { id: 'new-template', label: 'New from Template…', menu: 'File', keys: 'Mod+Alt+N', run: () => store.set({ dialog: { type: 'new', tab: 'templates' } }) },
  { id: 'social-studio', label: 'Social Studio…', menu: 'File', keys: 'Mod+Alt+Shift+M', run: () => store.set({ dialog: { type: 'socialStudio' } }) },
  { id: 'open', label: 'Open…', menu: 'File', keys: 'Mod+O', run: async () => io.openFiles(await io.pickFiles()) },
  { id: 'sample-landscape', label: 'Alpine Lake (Landscape)', menu: 'File', submenu: 'Open Sample Photo', run: async () => { await store.task('Opening Alpine Lake', async () => { const blob = await (await fetch('/samples/landscape.jpg')).blob(); io.docFromCanvas(await io.fileToCanvas(blob), 'Alpine Lake', 'landscape.jpg'); }); } },
  { id: 'sample-portrait', label: 'Studio Portrait', menu: 'File', submenu: 'Open Sample Photo', run: async () => { await store.task('Opening Studio Portrait', async () => { const blob = await (await fetch('/samples/portrait.jpg')).blob(); io.docFromCanvas(await io.fileToCanvas(blob), 'Studio Portrait', 'portrait.jpg'); }); } },
  { id: 'sample-architecture', label: 'Modern Architecture', menu: 'File', submenu: 'Open Sample Photo', run: async () => { await store.task('Opening Architecture', async () => { const blob = await (await fetch('/samples/architecture.jpg')).blob(); io.docFromCanvas(await io.fileToCanvas(blob), 'Architecture', 'architecture.jpg'); }); } },
  {
    id: 'place',
    label: 'Place Image as Layer…',
    menu: 'File',
    keys: 'Mod+Shift+P',
    enabled: hasDoc,
    run: async () => {
      const files = await io.pickFiles('image/*', false);
      if (files[0]) await store.task('Placing image', () => io.placeImage(files[0], files[0].name.replace(/\.[^.]+$/, '')));
    },
  },
  { id: 'save', label: 'Save Project (.photoscale)', menu: 'File', keys: 'Mod+S', sep: true, enabled: hasDoc, run: () => store.doc && store.task('Saving', () => io.saveProject(store.doc!)) },
  { id: 'export', label: 'Export As…', menu: 'File', keys: 'Mod+Alt+Shift+W', enabled: hasDoc, run: () => store.set({ dialog: { type: 'export' } }) },
  { id: 'batch-export', label: 'Multi-Format Batch Export…', menu: 'File', enabled: hasDoc, run: () => store.set({ dialog: { type: 'batchExport' } }) },
  { id: 'export-psd', label: 'Export as Photoshop PSD…', menu: 'File', enabled: hasDoc, run: () => store.doc && store.task('Writing PSD', () => io.exportPsd(store.doc!)) },
  { id: 'export-layers', label: 'Export Layers to Files (ZIP)…', menu: 'File', enabled: hasDoc, run: () => store.doc && store.task('Exporting layers', () => io.exportLayers(store.doc!, { trim: true })) },
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
    label: 'Export All Open Documents as PNG',
    menu: 'File',
    enabled: () => store.state.docs.length > 1,
    run: () =>
      store.task(`Exporting ${store.state.docs.length} documents`, async () => {
        for (const d of store.state.docs) await io.exportImage(d, 'png', 1, 1, null);
        store.toast(`Exported ${store.state.docs.length} documents`, 'success');
      }),
  },
  {
    id: 'merge-hdr',
    label: 'Merge to HDR (Exposure Fusion)…',
    menu: 'File',
    submenu: 'Automate',
    run: () => void runFusion('exposure'),
  },
  {
    id: 'focus-stack',
    label: 'Focus Stack…',
    menu: 'File',
    submenu: 'Automate',
    run: () => void runFusion('focus'),
  },
  { id: 'revert-image', label: 'Revert to Saved / Original', menu: 'File', sep: true, enabled: () => !!store.doc && (store.doc.hIndex > 0 || store.doc.dirty), run: () => { const d = store.doc; if (!d) return; while (d.hIndex > 0) store.undo(); store.toast(`Reverted “${d.title}”`); } },
  { id: 'close', label: 'Close Document', menu: 'File', keys: 'Mod+W', sep: true, enabled: hasDoc, run: () => store.doc && store.closeDoc(store.doc.id) },

  // ---------------------------------------------------------------- Edit
  { id: 'undo', label: 'Undo', menu: 'Edit', keys: 'Mod+Z', enabled: () => (store.doc?.hIndex ?? 0) > 0, run: () => store.undo() },
  { id: 'redo', label: 'Redo', menu: 'Edit', keys: 'Mod+Shift+Z', enabled: () => !!store.doc && store.doc.hIndex < store.doc.history.length - 1, run: () => store.redo() },
  { id: 'cut', label: 'Cut', menu: 'Edit', keys: 'Mod+X', sep: true, enabled: hasSel, run: () => ops.copy(false, true) },
  { id: 'copy', label: 'Copy', menu: 'Edit', keys: 'Mod+C', enabled: hasDoc, run: () => ops.copy() },
  { id: 'copy-merged', label: 'Copy Merged', menu: 'Edit', keys: 'Mod+Shift+C', enabled: hasDoc, run: () => ops.copy(true) },
  { id: 'paste', label: 'Paste', menu: 'Edit', keys: 'Mod+V', enabled: hasDoc, run: () => ops.paste() },
  { id: 'clear', label: 'Clear / Delete', menu: 'Edit', keys: 'Backspace', enabled: hasDoc, run: () => ops.clearSelection() },
  { id: 'fill-fg', label: 'Fill with Foreground', menu: 'Edit', keys: 'Alt+Backspace', sep: true, enabled: hasDoc, run: () => ops.fill(store.state.fg) },
  { id: 'fill-bg', label: 'Fill with Background', menu: 'Edit', keys: 'Mod+Backspace', enabled: hasDoc, run: () => ops.fill(store.state.bg) },
  { id: 'caf', label: 'Content-Aware Fill (Remove Object)', menu: 'Edit', keys: 'Shift+Backspace', enabled: hasSel, run: () => { ensureActiveRaster(); ops.contentAwareFillSelection(); } },
  {
    id: 'transform',
    label: 'Free Transform',
    menu: 'Edit',
    keys: 'Mod+T',
    sep: true,
    enabled: hasDoc,
    run: () => ops.beginTransform(),
  },
  { id: 'flip-layer-h', label: 'Flip Layer Horizontal', menu: 'Edit', enabled: hasDoc, run: () => ops.flipLayer('h') },
  { id: 'flip-layer-v', label: 'Flip Layer Vertical', menu: 'Edit', enabled: hasDoc, run: () => ops.flipLayer('v') },
  { id: 'preferences', label: 'Preferences…', menu: 'Edit', keys: 'Mod+,', sep: true, run: () => store.set({ dialog: { type: 'preferences' } }) },

  // ---------------------------------------------------------------- Image
  { id: 'mode-rgb', label: 'RGB Color', menu: 'Image', submenu: 'Mode', enabled: hasDoc, checked: () => (store.doc?.colorMode ?? 'rgb') === 'rgb', run: () => ops.convertColorMode('rgb') },
  { id: 'mode-cmyk', label: 'CMYK Color', menu: 'Image', submenu: 'Mode', sep: true, enabled: hasDoc, checked: () => store.doc?.colorMode === 'cmyk', run: () => ops.convertColorMode('cmyk') },
  { id: 'mode-8bit', label: '8 Bits per Channel', menu: 'Image', submenu: 'Mode', enabled: hasDoc, checked: () => (store.doc?.depth ?? 8) === 8, run: () => ops.convertBitDepth(8) },
  { id: 'mode-16bit', label: '16 Bits per Channel', menu: 'Image', submenu: 'Mode', enabled: hasDoc, checked: () => store.doc?.depth === 16, run: () => ops.convertBitDepth(16) },
  { id: 'mode-32bit', label: '32 Bits per Channel (Float)', menu: 'Image', submenu: 'Mode', enabled: hasDoc, checked: () => store.doc?.depth === 32, run: () => ops.convertBitDepth(32) },

  { id: 'brightness-contrast', label: 'Brightness / Contrast…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'levels', label: 'Levels…', menu: 'Image', submenu: 'Adjustments', keys: 'Mod+L', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'curves', label: 'Curves…', menu: 'Image', submenu: 'Adjustments', keys: 'Mod+M', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'exposure', label: 'Exposure…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'vibrance', label: 'Vibrance…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'hue-saturation', label: 'Hue / Saturation…', menu: 'Image', submenu: 'Adjustments', keys: 'Mod+U', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'color-balance', label: 'Color Balance…', menu: 'Image', submenu: 'Adjustments', keys: 'Mod+B', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'black-and-white', label: 'Black & White…', menu: 'Image', submenu: 'Adjustments', keys: 'Mod+Alt+Shift+B', enabled: hasDoc, run: () => { const t = ops.ensureAdjustmentTarget(); if (t) { const cur = t.adjust ?? defaultAdjust(); ops.setAdjust(t.id, { ...cur, bw: !cur.bw }, 'Black & White'); panelHooks.open('adjust'); } } },
  { id: 'photo-filter', label: 'Photo Filter…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'channel-mixer', label: 'Channel Mixer…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'color-lookup', label: 'Color Lookup (3D LUT)…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => openLooks() },
  { id: 'invert', label: 'Invert', menu: 'Image', submenu: 'Adjustments', keys: 'Mod+I', sep: true, enabled: hasDoc, run: () => { const t = ops.ensureAdjustmentTarget(); if (t) { const cur = t.adjust ?? defaultAdjust(); ops.setAdjust(t.id, { ...cur, invert: !cur.invert }, 'Invert'); } } },
  { id: 'posterize', label: 'Posterize…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => askNumber('Posterize', 'Levels', 4, 2, 32, (v) => { const t = ops.ensureAdjustmentTarget(); if (t) { const cur = t.adjust ?? defaultAdjust(); ops.setAdjust(t.id, { ...cur, posterize: v }, 'Posterize'); } }, 'levels') },
  { id: 'threshold', label: 'Threshold…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => askNumber('Threshold', 'Threshold level', 128, 1, 255, (v) => { const t = ops.ensureAdjustmentTarget(); if (t) { const cur = t.adjust ?? defaultAdjust(); ops.setAdjust(t.id, { ...cur, threshold: v }, 'Threshold'); } }, 'lv') },
  { id: 'gradient-map', label: 'Gradient Map…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'selective-color', label: 'Selective Color…', menu: 'Image', submenu: 'Adjustments', enabled: hasDoc, run: () => { panelHooks.open('adjust'); ops.ensureAdjustmentTarget(); } },
  { id: 'desaturate', label: 'Desaturate', menu: 'Image', submenu: 'Adjustments', keys: 'Mod+Shift+U', enabled: hasDoc, run: () => { const t = ops.ensureAdjustmentTarget(); if (t) { const cur = t.adjust ?? defaultAdjust(); ops.setAdjust(t.id, { ...cur, saturation: -100 }, 'Desaturate'); } } },

  { id: 'auto-enhance', label: 'Auto Enhance (Smart Tune)', menu: 'Image', keys: 'Mod+Shift+L', sep: true, enabled: hasDoc, run: () => tune.applyIntent('auto') },
  { id: 'auto-tone', label: 'Auto Tone', menu: 'Image', enabled: hasDoc, run: () => tune.applyAuto('tone') },
  { id: 'auto-contrast', label: 'Auto Contrast', menu: 'Image', keys: 'Mod+Alt+Shift+L', enabled: hasDoc, run: () => tune.applyAuto('contrast') },
  { id: 'auto-color', label: 'Auto Color', menu: 'Image', keys: 'Mod+Shift+B', enabled: hasDoc, run: () => tune.applyAuto('color') },
  { id: 'auto-wb', label: 'Auto White Balance', menu: 'Image', enabled: hasDoc, run: () => tune.applyAuto('wb') },
  {
    id: 'wb-picker',
    label: 'White Balance Picker',
    menu: 'Image',
    enabled: hasDoc,
    run: () => {
      store.setTool('eyedropper');
      store.setOpts({ eyedropperMode: 'wb' });
      store.toast('Click something that should be white or grey');
    },
  },
  { id: 'looks', label: 'Looks & LUTs…', menu: 'Image', keys: 'Mod+Shift+K', sep: true, enabled: hasDoc, run: () => openLooks() },
  { id: 'image-size', label: 'Image Size…', menu: 'Image', keys: 'Mod+Alt+I', sep: true, enabled: hasDoc, run: () => store.set({ dialog: { type: 'imageSize' } }) },
  { id: 'sky-replacement', label: 'Sky Replacement…', menu: 'Edit', enabled: hasDoc, run: () => store.set({ dialog: { type: 'skyReplace' } }) },
  { id: 'content-aware-scale', label: 'Content-Aware Scale…', menu: 'Image', keys: 'Mod+Alt+Shift+C', enabled: hasDoc, run: () => store.set({ dialog: { type: 'contentAwareScale' } }) },
  { id: 'canvas-size', label: 'Canvas Size…', menu: 'Image', keys: 'Mod+Alt+C', enabled: hasDoc, run: () => store.set({ dialog: { type: 'canvasSize' } }) },
  { id: 'crop-tool', label: 'Crop…', menu: 'Image', enabled: hasDoc, run: () => store.setTool('crop') },
  { id: 'perspective-crop', label: 'Perspective Crop…', menu: 'Image', enabled: hasDoc, run: () => store.setTool('perspective-crop') },
  { id: 'crop-sel', label: 'Crop to Selection', menu: 'Image', enabled: hasSel, run: () => ops.cropToSelection() },
  { id: 'trim', label: 'Trim Transparent Pixels', menu: 'Image', enabled: hasDoc, run: () => ops.trimTransparent() },
  { id: 'space-srgb', label: 'sRGB', menu: 'Image', submenu: 'Color Space', sep: true, enabled: hasDoc, checked: () => !!store.doc && (store.doc.colorSpace ?? 'srgb') === 'srgb', run: () => ops.convertColorSpace('srgb') },
  { id: 'space-p3', label: 'Display P3 (wide gamut)', menu: 'Image', submenu: 'Color Space', enabled: hasDoc, checked: () => store.doc?.colorSpace === 'display-p3', run: () => ops.convertColorSpace('display-p3') },
  { id: 'rot-cw', label: 'Rotate 90° Clockwise', menu: 'Image', submenu: 'Rotate Canvas', sep: true, enabled: hasDoc, run: () => ops.rotateCanvas('cw') },
  { id: 'rot-ccw', label: 'Rotate 90° Counter-Clockwise', menu: 'Image', submenu: 'Rotate Canvas', enabled: hasDoc, run: () => ops.rotateCanvas('ccw') },
  { id: 'rot-180', label: 'Rotate 180°', menu: 'Image', submenu: 'Rotate Canvas', enabled: hasDoc, run: () => ops.rotateCanvas('180') },
  { id: 'flip-canvas-h', label: 'Flip Canvas Horizontal', menu: 'Image', submenu: 'Rotate Canvas', enabled: hasDoc, run: () => ops.rotateCanvas('h') },
  { id: 'flip-canvas-v', label: 'Flip Canvas Vertical', menu: 'Image', submenu: 'Rotate Canvas', enabled: hasDoc, run: () => ops.rotateCanvas('v') },
  {
    id: 'duplicate-image',
    label: 'Duplicate Image…',
    menu: 'Image',
    sep: true,
    enabled: hasDoc,
    run: () => {
      const d = store.doc;
      if (!d) return;
      const json = io.serializeProject(d);
      io.loadProject(json, `${d.title} copy`);
      store.toast(`Duplicated “${d.title}”`);
    },
  },

  // ---------------------------------------------------------------- Layer
  { id: 'new-layer', label: 'New Layer', menu: 'Layer', keys: 'Mod+Shift+N', enabled: hasDoc, run: () => store.newRasterLayer() },
  { id: 'new-adjustment', label: 'New Adjustment Layer', menu: 'Layer', keys: 'Mod+Alt+A', enabled: hasDoc, run: () => ops.newAdjustmentLayer({}, 'Adjustment') },
  { id: 'new-group', label: 'New Group', menu: 'Layer', enabled: hasDoc, run: () => ops.newGroup() },
  { id: 'group', label: 'Group Layers', menu: 'Layer', keys: 'Mod+G', enabled: hasDoc, run: () => ops.groupSelected() },
  {
    id: 'ungroup',
    label: 'Ungroup Layers',
    menu: 'Layer',
    keys: 'Mod+Shift+G',
    enabled: () => !!store.activeLayer && (store.activeLayer.kind === 'group' || !!store.activeLayer.parent),
    run: () => ops.ungroupActive(),
  },
  { id: 'dup-layer', label: 'Duplicate Layer', menu: 'Layer', enabled: hasDoc, run: () => ops.duplicateLayer() },
  { id: 'make-button', label: 'Make Button', menu: 'Layer', sep: true, enabled: () => hasDoc() && canMakeButton(), run: () => makeButton() },
  { id: 'release-button', label: 'Release Button', menu: 'Layer', enabled: () => hasDoc() && hasButton(), run: () => { const n = releaseButton(); if (n) store.toast(`Released ${n} button${n === 1 ? '' : 's'}`); } },
  {
    id: 'pathfinder-unite',
    label: 'Shape ▸ Pathfinder: Unite (Merge Shapes)',
    menu: 'Layer',
    sep: true,
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('unite');
      store.toast(r.applied ? 'Pathfinder: Unite' : r.reason);
    },
  },
  {
    id: 'pathfinder-minus',
    label: 'Shape ▸ Pathfinder: Minus Front',
    menu: 'Layer',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('minus-front');
      store.toast(r.applied ? 'Pathfinder: Minus Front' : r.reason);
    },
  },
  {
    id: 'pathfinder-intersect',
    label: 'Shape ▸ Pathfinder: Intersect',
    menu: 'Layer',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('intersect');
      store.toast(r.applied ? 'Pathfinder: Intersect' : r.reason);
    },
  },
  {
    id: 'pathfinder-exclude',
    label: 'Shape ▸ Pathfinder: Exclude',
    menu: 'Layer',
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.applyPathfinder('exclude');
      store.toast(r.applied ? 'Pathfinder: Exclude' : r.reason);
    },
  },
  {
    id: 'pathfinder-divide',
    label: 'Shape ▸ Pathfinder: Divide',
    menu: 'Layer',
    enabled: () => store.selectedLayers.filter((l) => l.kind === 'shape').length >= 2,
    run: () => {
      const r = vectorOps.pathfinderDivide();
      store.toast(r.applied ? 'Pathfinder: Divide' : r.reason);
    },
  },
  ...(Object.keys(vectorOps.PATHFINDER_EXTRA_LABELS) as vectorOps.PathfinderExtraOp[]).map(
    (op): Command => ({
      id: `pathfinder-${op}`,
      label: `Shape ▸ Pathfinder: ${vectorOps.PATHFINDER_EXTRA_LABELS[op]}`,
      menu: 'Layer',
      enabled: () => store.selectedLayers.filter((l) => l.kind === 'shape').length >= 2,
      run: () => {
        const r = vectorOps.pathfinderExtra(op);
        store.toast(r.applied ? `Pathfinder: ${r.reason}` : r.reason);
      },
    })
  ),
  {
    id: 'make-compound',
    label: 'Shape ▸ Make Compound Path',
    menu: 'Layer',
    keys: 'Mod+8',
    sep: true,
    enabled: () => store.selectedLayers.length >= 2,
    run: () => {
      const r = vectorOps.makeCompoundPath();
      store.toast(r.created ? 'Compound path created' : r.reason);
    },
  },
  {
    id: 'release-compound',
    label: 'Shape ▸ Release Compound Path',
    menu: 'Layer',
    keys: 'Mod+Alt+Shift+8',
    enabled: () => store.activeLayer?.kind === 'shape' && !!store.activeLayer.shape?.compoundPoints?.length,
    run: () => {
      const r = vectorOps.releaseCompoundPath();
      store.toast(r.released ? 'Compound path released' : r.reason);
    },
  },
  {
    id: 'simplify-path',
    label: 'Shape ▸ Simplify Path',
    menu: 'Layer',
    enabled: () => store.activeLayer?.kind === 'shape',
    run: () => {
      const r = vectorOps.simplifyActivePath();
      store.toast(r.applied ? `Simplified: ${r.before} → ${r.after} anchors` : r.reason);
    },
  },
  {
    id: 'outline-stroke',
    label: 'Shape ▸ Outline Stroke',
    menu: 'Layer',
    enabled: () => store.activeLayer?.kind === 'shape' && (store.activeLayer.shape?.strokeWidth ?? 0) > 0,
    run: () => {
      const r = vectorOps.outlineActiveStroke();
      store.toast(r.applied ? 'Stroke outlined' : r.reason);
    },
  },
  {
    id: 'join-path',
    label: 'Shape ▸ Join Path Endpoints',
    menu: 'Layer',
    keys: 'Mod+Alt+J',
    sep: true,
    enabled: hasDoc,
    run: () => {
      const r = vectorOps.joinPaths();
      store.toast(r.joined ? 'Path endpoints joined' : r.reason);
    },
  },
  {
    id: 'reverse-path',
    label: 'Shape ▸ Reverse Path Direction',
    menu: 'Layer',
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
    id: 'convert-path',
    label: 'Shape ▸ Convert to Editable Path',
    menu: 'Layer',
    enabled: () => store.activeLayer?.kind === 'shape' && store.activeLayer.shape?.shape !== 'path',
    run: () => {
      const l = store.activeLayer;
      const doc = store.doc;
      if (l && doc) {
        // Round corners stay live on the new path's anchors
        const res = vectorOps.convertToEditablePath(l, true, true);
        store.commit('Convert to Path', { layers: doc.layers.map((x) => (x.id === l.id ? res : x)), activeId: res.id }, { icon: 'shape' });
        store.toast('Converted shape to Bézier path');
      }
    },
  },
  { id: 'transform-again', label: 'Transform ▸ Transform Again', menu: 'Layer', keys: 'Mod+D', sep: true, enabled: () => store.selectedLayers.length > 0 && !hasSel() && frameVisible(), run: () => transformAgain() },
  { id: 'transform-each', label: 'Transform ▸ Transform Each…', menu: 'Layer', keys: 'Mod+Alt+Shift+D', enabled: () => store.selectedLayers.length > 0, run: () => store.set({ dialog: { type: 'transformEach' } }) },
  {
    id: 'offset-path',
    label: 'Shape ▸ Offset Path…',
    menu: 'Layer',
    enabled: () => store.selectedLayers.some((l) => l.kind === 'shape'),
    run: () => store.set({ dialog: { type: 'number', title: 'Offset Path', label: 'Offset (negative = inset)', value: 10, min: -1000, max: 1000, unit: 'px', onOk: (v) => offsetSelected(v) } }),
  },
  {
    id: 'round-corners',
    label: 'Shape ▸ Round Corners…',
    menu: 'Layer',
    enabled: () => store.selectedLayers.some((l) => l.kind === 'shape'),
    run: () => store.set({ dialog: { type: 'number', title: 'Round Corners', label: 'Radius', value: 12, min: 0, max: 2000, unit: 'px', onOk: (v) => roundCornersSelected(v) } }),
  },
  { id: 'recolor', label: 'Recolor Artwork…', menu: 'Edit', enabled: () => store.selectedLayers.some((l) => l.kind === 'shape' || l.kind === 'text' || l.kind === 'group'), run: () => store.set({ dialog: { type: 'recolor', ids: store.selectedLayers.map((l) => l.id) } }) },
  { id: 'via-copy', label: 'Layer via Copy', menu: 'Layer', keys: 'Mod+J', enabled: hasDoc, run: () => ops.layerViaCopy(false) },
  { id: 'via-cut', label: 'Layer via Cut', menu: 'Layer', keys: 'Mod+Shift+J', enabled: hasSel, run: () => ops.layerViaCopy(true) },
  { id: 'del-layer', label: 'Delete Layer', menu: 'Layer', enabled: hasDoc, run: () => ops.deleteLayer() },
  { id: 'add-mask', label: 'Add Layer Mask', menu: 'Layer', sep: true, enabled: hasDoc, run: () => ops.addMask(true) },
  { id: 'invert-mask', label: 'Invert Mask', menu: 'Layer', enabled: hasMask, run: () => ops.invertMask() },
  { id: 'apply-mask', label: 'Apply Layer Mask', menu: 'Layer', enabled: () => hasMask() && pixelLayer(), run: () => ops.applyMask() },
  { id: 'delete-mask', label: 'Delete Layer Mask', menu: 'Layer', enabled: hasMask, run: () => ops.deleteMask() },
  { id: 'clip', label: 'Create / Release Clipping Mask', menu: 'Layer', keys: 'Mod+Alt+G', enabled: hasDoc, run: () => ops.toggleClip() },
  { id: 'layer-style', label: 'Layer Style…', menu: 'Layer', keys: 'Mod+Alt+Y', sep: true, enabled: movableLayer, run: () => store.set({ dialog: { type: 'layerStyle' } }) },
  { id: 'copy-style', label: 'Copy Layer Style', menu: 'Layer', enabled: () => !!store.activeLayer && hasFx(store.activeLayer), run: () => copyStyle() },
  { id: 'paste-style', label: 'Paste Layer Style', menu: 'Layer', enabled: canPasteStyle, run: () => pasteStyle() },
  { id: 'remove-bg', label: 'Remove Background (Mask)', menu: 'Layer', sep: true, enabled: hasDoc, run: () => smart.removeBackground() },
  { id: 'cutout-subject', label: 'Cut Out Subject to New Layer', menu: 'Layer', enabled: hasDoc, run: () => smart.cutOutSubject() },
  { id: 'harmonize-tone', label: '⚡ Harmonize Ambient Tone', menu: 'Layer', enabled: hasDoc, run: () => ops.harmonizeActiveLayerWithBackground() },
  { id: 'mockup-iphone', label: '⚡ Create iPhone 16 Pro Mockup', menu: 'Layer', enabled: hasDoc, run: () => ops.createMockupFromActiveLayer('iphone-16-pro') },
  { id: 'smart-object', label: 'Convert to Smart Object', menu: 'Layer', sep: true, enabled: () => !!store.activeLayer && !store.activeLayer.smart && store.activeLayer.kind !== 'adjustment', run: () => ops.convertToSmartObject() },
  {
    id: 'replace-contents',
    label: 'Replace Smart Object Contents…',
    menu: 'Layer',
    enabled: () => !!store.activeLayer?.smart,
    run: async () => {
      const [f] = await io.pickFiles('image/*', false);
      if (f) await store.task('Replacing contents', () => ops.replaceSmartContents(f));
    },
  },
  {
    id: 'lock-alpha',
    label: 'Lock Transparency',
    menu: 'Layer',
    keys: '/',
    enabled: () => store.activeLayer?.kind === 'raster',
    checked: () => !!store.activeLayer?.lockAlpha,
    run: () => {
      const l = store.activeLayer;
      if (l) ops.updateSelectedLayers({ lockAlpha: !l.lockAlpha }, l.lockAlpha ? 'Unlock Transparency' : 'Lock Transparency', `lockAlpha:${Date.now()}`);
    },
  },
  { id: 'rasterize', label: 'Rasterize Layer', menu: 'Layer', enabled: () => ['text', 'shape'].includes(store.activeLayer?.kind ?? '') || !!store.activeLayer?.smart, run: () => ops.rasterizeActive() },
  { id: 'raise', label: 'Bring Forward', menu: 'Layer', keys: 'Mod+]', sep: true, enabled: hasDoc, run: () => ops.shiftLayer(1) },
  { id: 'lower', label: 'Send Backward', menu: 'Layer', keys: 'Mod+[', enabled: hasDoc, run: () => ops.shiftLayer(-1) },
  ...(Object.keys(ALIGN_LABELS) as AlignEdge[]).map(
    (edge, i): Command => ({
      id: `align-${edge}`,
      label: ALIGN_LABELS[edge],
      menu: 'Layer',
      sep: i === 0,
      enabled: movableLayer,
      run: () => alignActive(edge),
    })
  ),
  ...(Object.keys(DISTRIBUTE_LABELS) as DistributeKind[]).map(
    (k, i): Command => ({
      id: `distribute-${k}`,
      label: DISTRIBUTE_LABELS[k],
      menu: 'Layer',
      sep: i === 0,
      enabled: () => store.selectedLayers.filter((l) => l.kind !== 'adjustment').length >= 3,
      run: () => distributeSelected(k),
    })
  ),
  { id: 'center-layer', label: 'Center on Canvas (or Selection)', menu: 'Layer', enabled: movableLayer, run: () => centerActive() },
  { id: 'merge-down', label: 'Merge Down / Merge Selected', menu: 'Layer', keys: 'Mod+E', sep: true, enabled: hasDoc, run: () => ops.mergeSelected() },
  {
    id: 'select-all-layers',
    label: 'Select All Layers',
    menu: 'Select',
    enabled: hasDoc,
    run: () => store.setSelectedLayers(store.doc!.layers.filter((l) => l.kind !== 'adjustment').map((l) => l.id)),
  },
  { id: 'merge-visible', label: 'Merge Visible', menu: 'Layer', keys: 'Mod+Shift+E', enabled: hasDoc, run: () => ops.mergeVisible() },
  { id: 'stamp', label: 'Stamp Visible to New Layer', menu: 'Layer', keys: 'Mod+Alt+Shift+E', enabled: hasDoc, run: () => ops.stampVisible() },
  { id: 'flatten', label: 'Flatten Image', menu: 'Layer', enabled: hasDoc, run: () => ops.flattenImage() },

  // ---------------------------------------------------------------- Select
  { id: 'select-subject', label: 'Subject', menu: 'Select', keys: 'Mod+Alt+Shift+S', enabled: hasDoc, run: () => smart.selectSubject() },
  { id: 'select-sky', label: 'Sky', menu: 'Select', enabled: hasDoc, run: () => smart.selectSky() },
  { id: 'select-mask', label: 'Select and Mask…', menu: 'Select', keys: 'Mod+Alt+R', enabled: hasDoc, run: () => store.set({ dialog: { type: 'selectMask' } }) },
  { id: 'select-all', label: 'All', menu: 'Select', keys: 'Mod+A', enabled: hasDoc, run: () => ops.selectAll() },
  { id: 'deselect', label: 'Deselect', menu: 'Select', keys: 'Mod+D', enabled: hasSel, run: () => ops.deselect() },
  { id: 'reselect', label: 'Reselect', menu: 'Select', keys: 'Mod+Shift+D', enabled: () => !!store.doc?.lastSelection, run: () => ops.reselect() },
  { id: 'inverse', label: 'Inverse', menu: 'Select', keys: 'Mod+Shift+I', enabled: hasDoc, run: () => ops.invertSelection() },
  { id: 'layer-alpha', label: 'Load Layer Transparency', menu: 'Select', enabled: hasDoc, run: () => ops.selectLayerAlpha() },
  {
    id: 'color-range',
    label: 'Color Range (Foreground Color)…',
    menu: 'Select',
    enabled: hasDoc,
    run: () => askNumber('Color Range', 'Fuzziness', 40, 0, 200, (v) => ops.selectColorRange(store.state.fg, v), ''),
  },
  ...(Object.keys(smart.RANGE_LABELS) as smart.RangeKind[]).map(
    (k): Command => ({ id: `range-${k}`, label: `Color Range · ${smart.RANGE_LABELS[k]}`, menu: 'Select', enabled: hasDoc, run: () => smart.selectRange(k) })
  ),
  { id: 'feather', label: 'Feather…', menu: 'Select', keys: 'Shift+F6', sep: true, enabled: hasSel, run: () => askNumber('Feather Selection', 'Radius', 8, 0.5, 250, (v) => ops.modifySelection('feather', v)) },
  { id: 'expand', label: 'Expand…', menu: 'Select', enabled: hasSel, run: () => askNumber('Expand Selection', 'Expand by', 4, 1, 200, (v) => ops.modifySelection('expand', v)) },
  { id: 'contract', label: 'Contract…', menu: 'Select', enabled: hasSel, run: () => askNumber('Contract Selection', 'Contract by', 4, 1, 200, (v) => ops.modifySelection('contract', v)) },
  { id: 'smooth', label: 'Smooth…', menu: 'Select', enabled: hasSel, run: () => askNumber('Smooth Selection', 'Radius', 4, 1, 100, (v) => ops.modifySelection('smooth', v)) },
  {
    id: 'quick-mask',
    label: 'Edit in Quick Mask Mode',
    menu: 'Select',
    keys: 'Q',
    sep: true,
    enabled: hasDoc,
    checked: () => store.state.quickMask,
    run: () => store.toggleQuickMask(),
  },

  // ---------------------------------------------------------------- Filter
  {
    id: 'filter-repeat',
    label: 'Repeat Last Filter',
    menu: 'Filter',
    keys: 'Mod+Alt+F',
    enabled: () => !!ops.lastFilter && pixelLayer(),
    run: async () => {
      const f = ops.lastFilter!;
      await ops.commitFilter(f.id, f.params);
      store.toast(`${filterById(f.id)?.name ?? 'Filter'} applied again`);
    },
  },
  {
    id: 'filter-liquify',
    label: 'Liquify…',
    menu: 'Filter',
    keys: 'Mod+Shift+X',
    enabled: pixelLayer,
    run: () => {
      ensureActiveRaster();
      store.set({ dialog: { type: 'liquify' } });
    },
  },
  {
    id: 'frequency-separation',
    label: 'Frequency Separation',
    menu: 'Filter',
    enabled: pixelLayer,
    run: () => {
      ensureActiveRaster();
      ops.applyFrequencySeparation(4);
    },
  },
  ...FILTERS.map(
    (f, i): Command => ({
      id: `filter-${f.id}`,
      label: `${f.name}…`,
      menu: 'Filter',
      submenu: f.group,
      sep: i === 0 || FILTERS[i - 1].group !== f.group,
      enabled: pixelLayer,
      run: () => {
        ensureActiveRaster();
        store.set({ dialog: { type: 'filter', filterId: f.id } });
      },
    })
  ),

  // ---------------------------------------------------------------- View
  { id: 'zoom-in', label: 'Zoom In', menu: 'View', keys: 'Mod+=', enabled: hasDoc, run: () => view.zoomBy(1.25) },
  { id: 'zoom-out', label: 'Zoom Out', menu: 'View', keys: 'Mod+-', enabled: hasDoc, run: () => view.zoomBy(0.8) },
  { id: 'fit', label: 'Fit on Screen', menu: 'View', keys: 'Mod+0', enabled: hasDoc, run: () => view.fit() },
  { id: 'actual', label: '100%', menu: 'View', keys: 'Mod+1', enabled: hasDoc, run: () => view.actual() },
  {
    id: 'zoom-selection',
    label: 'Zoom to Selection / Layer',
    menu: 'View',
    keys: 'Mod+Alt+0',
    enabled: hasDoc,
    run: () => {
      const doc = store.doc!;
      const layer = store.activeLayer;
      const r = doc.selection?.bounds ?? (layer ? contentBounds(layer) : null);
      if (r) view.fitRect(r);
      else view.fit();
    },
  },
  {
    id: 'compare',
    label: 'Before / After (hide adjustments)',
    menu: 'View',
    keys: '\\',
    sep: true,
    checked: () => store.state.compare,
    run: () => {
      store.set({ compare: !store.state.compare });
      store.invalidateRender();
    },
  },
  { id: 'rulers', label: 'Rulers', menu: 'View', keys: 'Mod+R', checked: () => store.state.showRulers, run: () => store.set({ showRulers: !store.state.showRulers }) },
  { id: 'proof', label: 'Proof Colors (CMYK Print)', menu: 'View', keys: 'Mod+Y', sep: true, enabled: hasDoc, checked: () => store.state.proof === 'cmyk', run: () => store.set({ proof: store.state.proof === 'cmyk' ? 'off' : 'cmyk' }) },
  { id: 'gamut', label: 'Gamut Warning', menu: 'View', keys: 'Mod+Shift+Y', enabled: hasDoc, checked: () => store.state.proof === 'gamut', run: () => store.set({ proof: store.state.proof === 'gamut' ? 'off' : 'gamut' }) },
  { id: 'grid', label: 'Grid', menu: 'View', keys: "Mod+'", checked: () => store.state.showGrid, run: () => store.set({ showGrid: !store.state.showGrid }) },
  {
    id: 'safe-zones',
    label: 'Safe Zones',
    menu: 'View',
    keys: "Mod+Shift+'",
    enabled: () => !!store.doc,
    checked: () => store.state.showSafeZones && !!store.doc?.safeZone,
    run: () => {
      const doc = store.doc!;
      if (!doc.safeZone) {
        // Documents opened from files have no platform: start with the generic margin
        doc.safeZone = 'margin';
        store.set({ showSafeZones: true });
        store.toast(`${SAFE_ZONES.margin.label}: ${SAFE_ZONES.margin.note}`);
        return;
      }
      store.set({ showSafeZones: !store.state.showSafeZones });
    },
  },
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
    enabled: () => !!store.doc,
    run: () => {
      const why = applyAutoGrid();
      if (why) store.toast(why, 'success');
    },
  },
  { id: 'grids-panel', label: 'Grids & Layout…', menu: 'View', enabled: () => !!store.doc, run: () => panelHooks.open('grids') },
  { id: 'active-toolbox', label: 'Active Toolbox', menu: 'View', checked: () => store.state.opts.activeToolbox, run: () => store.setOpts({ activeToolbox: !store.state.opts.activeToolbox }) },
  { id: 'focus', label: 'Focus Mode (hide panels)', menu: 'View', keys: 'Tab', checked: () => store.state.focusMode, run: () => store.set({ focusMode: !store.state.focusMode }) },
  { id: 'palette', label: 'Command Palette…', menu: 'View', keys: 'Mod+K', sep: true, run: () => store.set({ paletteOpen: true }) },

  // ---------------------------------------------------------------- Window
  { id: 'win-photo', label: 'Photo Editing Panel', menu: 'Window', run: () => panelHooks.open('photo') },
  { id: 'win-adjust', label: 'Develop / Adjustments Panel', menu: 'Window', run: () => panelHooks.open('adjust') },
  { id: 'win-looks', label: 'Looks & LUTs Panel', menu: 'Window', run: () => panelHooks.open('looks') },
  { id: 'win-properties', label: 'Properties Panel', menu: 'Window', run: () => panelHooks.open('properties') },
  { id: 'win-social', label: 'Social Studio Panel', menu: 'Window', run: () => panelHooks.open('social') },
  { id: 'win-color', label: 'Color / Swatches Panel', menu: 'Window', run: () => panelHooks.open('color') },
  { id: 'win-grids', label: 'Grids & Layout Panel', menu: 'Window', run: () => panelHooks.open('grids') },
  { id: 'win-info', label: 'Info Panel', menu: 'Window', run: () => panelHooks.open('info') },
  { id: 'win-history', label: 'History Panel', menu: 'Window', run: () => panelHooks.open('history') },
  { id: 'win-actions', label: 'Actions Panel', menu: 'Window', run: () => panelHooks.open('actions') },
  { id: 'win-navigator', label: 'Navigator Panel', menu: 'Window', run: () => panelHooks.open('navigator') },
  { id: 'win-active-toolbox', label: 'Floating Active Toolbox', menu: 'Window', sep: true, checked: () => store.state.opts.activeToolbox, run: () => store.setOpts({ activeToolbox: !store.state.opts.activeToolbox }) },
  { id: 'win-focus', label: 'Focus Mode (Hide Panels)', menu: 'Window', keys: 'Tab', checked: () => store.state.focusMode, run: () => store.set({ focusMode: !store.state.focusMode }) },
  { id: 'win-palette', label: 'Command Palette…', menu: 'Window', keys: 'Mod+K', sep: true, run: () => store.set({ paletteOpen: true }) },
  { id: 'ai-assistant', label: 'AI Assistant (Claude · ChatGPT · Gemini)…', menu: 'Window', keys: 'Mod+Alt+K', run: () => toggleAssistant() },

  // ---------------------------------------------------------------- Help
  { id: 'shortcuts', label: 'Keyboard Shortcuts', menu: 'Help', keys: 'Mod+/', run: () => store.set({ dialog: { type: 'shortcuts' } }) },
  { id: 'about', label: 'About Skill Photo', menu: 'Help', run: () => store.set({ dialog: { type: 'about' } }) },
];

// Actions: menu commands that change the document are recorded while an action is recording.
// Commands that open a dialog record nothing themselves (the dialog's result is recorded).
const NOT_RECORDED = new Set([
  'undo', 'redo', 'save', 'export', 'batch-export', 'open', 'new', 'new-template', 'place', 'close',
  'palette', 'shortcuts', 'about', 'preferences', 'export-all', 'quick-export', 'export-psd', 'export-layers',
  'export-scales', 'copy', 'focus', 'compare', 'revert-image', 'sample-landscape', 'sample-portrait',
  'sample-architecture', 'duplicate-image', 'brightness-contrast', 'levels', 'curves', 'exposure',
  'vibrance', 'hue-saturation', 'color-balance', 'photo-filter', 'channel-mixer', 'color-lookup',
  'gradient-map', 'selective-color', 'win-photo', 'win-adjust', 'win-looks', 'win-properties',
  'win-social', 'win-color', 'win-grids', 'win-info', 'win-history', 'win-actions', 'win-navigator',
  'win-active-toolbox', 'win-focus', 'win-palette'
]);
for (const c of COMMANDS) {
  const run = c.run;
  c.run = () => {
    const before = { dialog: store.state.dialog, transform: store.state.transform, crop: store.state.crop };
    const r = run();
    const opensUi = store.state.dialog !== before.dialog || store.state.transform !== before.transform || store.state.crop !== before.crop;
    if ((c.menu === 'Image' || c.menu === 'Layer' || c.menu === 'Select' || c.menu === 'Edit' || c.menu === 'Filter') && !NOT_RECORDED.has(c.id) && !opensUi) {
      record({ kind: 'command', id: c.id, label: c.label.replace(/…$/, '') });
    }
    return r;
  };
}

// Same letters as Photoshop; Shift+letter cycles through the group
export const TOOL_KEYS: Record<string, ToolId[]> = {
  v: ['move'],
  m: ['marquee-rect', 'marquee-ellipse'],
  l: ['lasso', 'poly-lasso'],
  w: ['quick-select', 'wand'],
  c: ['crop', 'perspective-crop'],
  i: ['eyedropper', 'color-sampler', 'ruler'],
  b: ['brush', 'pencil', 'color-replace'],
  e: ['eraser', 'bg-eraser', 'magic-eraser'],
  s: ['clone'],
  j: ['heal', 'heal-brush', 'red-eye'],
  y: ['history-brush'],
  o: ['dodge', 'burn', 'sponge'],
  r: ['blur', 'sharpen', 'smudge'],
  g: ['gradient', 'bucket'],
  p: ['pen'],
  t: ['text'],
  u: ['shape'],
  h: ['hand'],
  z: ['zoom'],
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

export const MENU_ORDER: MenuId[] = ['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'View', 'Help'];

/** Keys handled outside COMMANDS (tools, brush, pointer). Shown in the cheatsheet and the PDF guide. */
export function extraShortcuts(mac = isMac): [string, string][] {
  const isMac = mac;
  const mod = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';
  return [
    ['V M L W C I B E S J Y O R G P T U H Z', 'Tools (Shift+key cycles grouped tools)'],
    ['[  ]', 'Brush size'],
    ['Shift [  ]', 'Brush hardness'],
    ['1 … 0', 'Tool opacity 10% … 100%'],
    ['X / D', 'Swap / default colors'],
    ['Q', 'Toggle mask editing'],
    ['Space + drag', 'Pan (any tool)'],
    [isMac ? 'Pinch / ⌘ + scroll' : 'Ctrl + wheel', 'Zoom at cursor'],
    ['Scroll / Shift + scroll', 'Pan vertically / horizontally'],
    [`${mod}-click (move)`, 'Pick the layer under the cursor'],
    [`${mod} while moving`, 'Move without snapping to guides'],
    [isMac ? '⌃⌥ + drag (brush)' : 'Alt + right-drag (brush)', 'Resize brush: → size, ↑ hardness'],
    [`${alt}-click (brush)`, 'Sample color'],
    [`${alt}-click (clone)`, 'Set clone source'],
    [`Shift / ${alt} (selections)`, 'Add / subtract'],
    ['Shift (drag)', 'Constrain: square, 45°, straight line'],
    ['Enter / Esc', 'Commit / cancel crop, transform, polygon, pen path'],
    ['⌫ (pen)', 'Remove the last path point'],
    [`${mod}-click / Shift-click (layers)`, 'Select several layers / a range'],
    [`${alt}-click (healing brush)`, 'Set healing source'],
    [`${alt}-click (color sampler)`, 'Remove a sampler'],
    ['Arrows', 'Nudge layer (Shift = 10px)'],
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

  for (const c of COMMANDS) {
    if (c.keys && matches(c.keys, e)) {
      // Holding a key repeats only step-like commands; one-shot commands fire once
      if (e.repeat && !REPEATABLE.has(c.id)) return true;
      // Commands can share a key (⌘D: Deselect with a pixel selection, else Transform Again): run the first enabled one
      if (c.enabled && !c.enabled()) {
        const alt = COMMANDS.find((o) => o !== c && o.keys && matches(o.keys, e) && (!o.enabled || o.enabled()));
        if (alt) alt.run();
        return true;
      }
      c.run();
      return true;
    }
  }

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
  // Opacity via number keys (1 = 10% … 0 = 100%)
  if (/^[0-9]$/.test(k) && !e.shiftKey) {
    store.setOpts({ opacity: k === '0' ? 1 : Number(k) / 10 });
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
