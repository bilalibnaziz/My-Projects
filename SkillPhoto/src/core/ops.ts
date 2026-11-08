import { frameVisible } from './objectTransform';
import type { Adjust, BitDepth, Doc, Layer, Rect, Selection, SmartFilter } from './types';
import { defaultAdjust, makeLayer, withLayer, uid } from './types';
import { PixelBuffer } from './pixels';
import { FLOAT_FILTERS, floatFilter, limitToSelection, withBuffer } from './hibit';
import { alphaBounds, blurImageData, cloneCanvas, convertCanvas, createCanvas, ctx2d, intersectRect, touch, spaceOf, pixelsLike, workingSpace, type ColorSpaceId } from './canvas';
import { layerSurface, renderDocument, syncTextBounds } from './render';
import * as sel from './selection';
import { store } from './store';
import { applyFilterOffThread, contentAwareScaleOffThread } from './filterThread';
import { mapIntoRect, rectifiedSize, rectify } from './perspectiveCrop';
import type { TransformState } from './store';
import { contentAwareFill } from './fill';
import { filterById } from './filters';
import { copyCanvasToClipboard } from './io';
import { blockOf, childrenOf, groupLayers, isGroup, moveTo, parentOf, shiftAmongSiblings, ungroup } from './groups';
import type { DropWhere } from './groups';
import { renderTransformed, transformMatrix } from './transform';
import { record } from './actions';
import { rerenderSmart, replaceSmartSource, smartFromPixels, smartGeometry } from './smart';
import { harmonizeLayerColor } from './colorHarmonizer';
import { proofRgb } from './color';
import { renderMockup, type MockupPresetId, MOCKUP_PRESETS } from './mockupEngine';

const need = (): Doc | null => store.doc;

function activeIndex(doc: Doc) {
  return doc.layers.findIndex((l) => l.id === doc.activeId);
}

// ================================================================ documents

export function newDocument(width: number, height: number, background: 'white' | 'black' | 'transparent' | string, title = 'Untitled', safeZone?: string) {
  const canvas = createCanvas(width, height);
  if (background !== 'transparent') {
    const ctx = ctx2d(canvas);
    ctx.fillStyle = background === 'white' ? '#ffffff' : background === 'black' ? '#000000' : background;
    ctx.fillRect(0, 0, width, height);
  }
  const layer = makeLayer({ kind: 'raster', name: background === 'transparent' ? 'Layer 1' : 'Background', canvas, width, height });
  return store.addDoc({ title, width, height, layers: [layer], safeZone });
}

// ================================================================ layers

function ancestorsPicked(layers: Layer[], l: Layer, picked: Set<string>): boolean {
  const map = new Map(layers.map((x) => [x.id, x]));
  let p = parentOf(map, l);
  for (let n = 0; p && n < 64; n++) {
    if (picked.has(p)) return true;
    p = parentOf(map, map.get(p)!);
  }
  return false;
}

export function copyOf(layer: Layer): Layer {
  return makeLayer({
    ...layer,
    name: `${layer.name} copy`,
    canvas: layer.canvas ? cloneCanvas(layer.canvas) : undefined,
    mask: layer.mask ? { ...layer.mask, canvas: cloneCanvas(layer.mask.canvas) } : undefined,
    adjust: layer.adjust ? structuredClone(layer.adjust) : undefined,
    shape: layer.shape ? structuredClone(layer.shape) : undefined,
    text: layer.text ? structuredClone(layer.text) : undefined,
    fx: layer.fx ? structuredClone(layer.fx) : undefined,
  });
}

/** Copies a layer, or a group with everything in it (fresh ids, same structure). */
function copyBlock(layers: Layer[], layer: Layer): Layer[] {
  const block = blockOf(layers, layer);
  const ids = new Map<string, string>();
  const copies = block.map((l) => {
    const c = l.id === layer.id ? copyOf(l) : makeLayer({ ...copyOf(l), name: l.name });
    ids.set(l.id, c.id);
    return c;
  });
  return copies.map((c, i) => {
    const p = block[i].parent;
    return p && ids.has(p) ? { ...c, parent: ids.get(p) } : c;
  });
}

/** Duplicates every selected layer (each copy goes right above its original; groups with their contents). */
export function duplicateLayer() {
  const doc = need();
  const all = store.selectedLayers;
  if (!doc || !all.length) return;
  // A layer inside a selected group is copied with the group
  const picked = new Set(all.map((l) => l.id));
  const selected = all.filter((l) => !ancestorsPicked(doc.layers, l, picked));
  const ids = new Set(selected.map((l) => l.id));
  const copies: string[] = [];
  const layers = doc.layers.flatMap((l) => {
    if (!ids.has(l.id)) return [l];
    const c = copyBlock(doc.layers, l);
    copies.push(c[c.length - 1].id);
    return [l, ...c];
  });
  if (selected.length === 1) {
    store.commit(isGroup(selected[0]) ? 'Duplicate Group' : 'Duplicate Layer', { layers, activeId: copies[0] }, { icon: 'layer' });
    return;
  }
  store.commit(`Duplicate ${selected.length} Layers`, { layers, activeId: copies[copies.length - 1] }, { icon: 'layer' });
  store.setSelectedLayers(copies);
}

/** Deletes the given layer, or every selected layer. */
export function deleteLayer(id?: string) {
  const doc = need();
  if (!doc) return;
  const picked = id ? doc.layers.filter((l) => l.id === id) : store.selectedLayers;
  // Deleting a group deletes everything in it
  const targets = new Set(picked.flatMap((l) => blockOf(doc.layers, l)).map((l) => l.id));
  if (doc.layers.filter((l) => !targets.has(l.id) && !isGroup(l)).length < 1) {
    store.toast('A document needs at least one layer', 'error');
    return;
  }
  const idx = doc.layers.findIndex((l) => targets.has(l.id));
  const layers = doc.layers.filter((l) => !targets.has(l.id));
  const next = layers[Math.max(0, Math.min(idx, layers.length) - 1)] ?? layers[0];
  store.cancelModes();
  doc.editMask = false;
  store.commit(picked.length === 1 && isGroup(picked[0]) ? 'Delete Group' : targets.size > 1 ? `Delete ${targets.size} Layers` : 'Delete Layer', { layers, activeId: targets.has(doc.activeId) ? next.id : doc.activeId }, { icon: 'trash' });
}

/** Applies the same change to every selected layer as one step (opacity, blend, visibility, lock…). */
export function updateSelectedLayers(patch: Partial<Layer>, label: string, coalesce?: string) {
  const doc = need();
  if (!doc) return;
  const ids = new Set(store.selectedLayers.map((l) => l.id));
  const layers = doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, patch) : l));
  store.commit(label, { layers }, { coalesce: coalesce ?? `${label}:${[...ids].join(',')}` });
}

/** Merges the selected layers into one pixel layer at the position of the topmost. */
export function mergeSelected() {
  const doc = need();
  if (!doc) return;
  const selected = store.selectedLayers;
  if (selected.length < 2) return mergeDown();
  const ids = new Set(selected.flatMap((l) => blockOf(doc.layers, l)).map((l) => l.id));
  const canvas = renderLayers(doc, doc.layers.filter((l) => ids.has(l.id)).map((l) => (selected.includes(l) ? withLayer(l, { clip: false }) : l)));
  const top = selected[selected.length - 1];
  const merged = makeLayer({ kind: 'raster', name: top.name, canvas, width: doc.width, height: doc.height, parent: parentOf(doc.layers, top) });
  const topIdx = doc.layers.findIndex((l) => l.id === top.id);
  const layers = doc.layers.flatMap((l, i) => (i === topIdx ? [merged] : ids.has(l.id) ? [] : [l]));
  store.commit(`Merge ${selected.length} Layers`, { layers, activeId: merged.id }, { icon: 'merge' });
}

export function moveLayer(fromId: string, toIndex: number) {
  const doc = need();
  if (!doc) return;
  const from = doc.layers.findIndex((l) => l.id === fromId);
  if (from < 0) return;
  const layers = [...doc.layers];
  const [l] = layers.splice(from, 1);
  const to = Math.max(0, Math.min(layers.length, toIndex));
  if (to === from) return;
  layers.splice(to, 0, l);
  store.commit('Reorder Layers', { layers }, { icon: 'layers' });
}

/** Bring Forward / Send Backward: one step among the layer's siblings (groups move whole). */
export function shiftLayer(dir: 1 | -1) {
  const doc = need();
  if (!doc) return;
  const layers = shiftAmongSiblings(doc.layers, doc.activeId, dir);
  if (layers !== doc.layers) store.commit('Reorder Layers', { layers }, { icon: 'layers' });
}

/** Drag and drop in the Layers panel: above / below a layer, or into a group. */
export function dropLayer(id: string, targetId: string, where: DropWhere) {
  const doc = need();
  if (!doc) return;
  const ids = store.selectedLayers.some((l) => l.id === id) ? store.selectedLayers.map((l) => l.id) : [id];
  let layers = doc.layers;
  // Several layers keep their order: the topmost goes first, each next one right below the last
  let anchor = targetId;
  let at: DropWhere = where;
  for (const x of [...ids].reverse()) {
    if (x === targetId) continue;
    const next = moveTo(layers, x, anchor, at);
    if (next === layers) continue;
    layers = next;
    anchor = x;
    at = 'below';
  }
  if (layers !== doc.layers) store.commit(where === 'into' ? 'Move into Group' : 'Reorder Layers', { layers }, { icon: 'layers' });
}

// ================================================================ groups

/** Groups the selected layers (⌘G). */
export function groupSelected() {
  const doc = need();
  if (!doc) return;
  const ids = store.selectedLayers.map((l) => l.id);
  const n = doc.layers.filter((l) => isGroup(l)).length + 1;
  const r = groupLayers(doc.layers, ids, `Group ${n}`);
  if (!r) return;
  store.commit('Group Layers', { layers: r.layers, activeId: r.group.id }, { icon: 'layers' });
}

/** New empty group above the active layer. */
export function newGroup() {
  const doc = need();
  if (!doc) return;
  const n = doc.layers.filter((l) => isGroup(l)).length + 1;
  store.insertLayer(makeLayer({ kind: 'group', name: `Group ${n}`, blend: 'pass-through' }), undefined, 'New Group');
}

/** Ungroup (⇧⌘G): removes the active group (or the group the active layer is in). */
export function ungroupActive() {
  const doc = need();
  const l = store.activeLayer;
  if (!doc || !l) return;
  const g = isGroup(l) ? l : doc.layers.find((x) => x.id === parentOf(doc.layers, l));
  if (!g) return store.toast('Select a group to ungroup');
  const kids = childrenOf(doc.layers, g.id);
  const layers = ungroup(doc.layers, g.id);
  store.commit('Ungroup Layers', { layers, activeId: kids.length ? kids[kids.length - 1].id : layers[layers.length - 1].id }, { icon: 'layers' });
  if (kids.length > 1) store.setSelectedLayers(kids.map((k) => k.id));
}

/** Merge Group: flattens a group into one pixel layer in its place. */
export function mergeGroup(g: Layer) {
  const doc = need();
  if (!doc) return;
  const block = blockOf(doc.layers, g);
  const ids = new Set(block.map((l) => l.id));
  const canvas = renderLayers(doc, doc.layers.filter((l) => ids.has(l.id)).map((l) => (l.id === g.id ? withLayer(l, { opacity: 1, blend: 'normal', clip: false, mask: undefined, fx: undefined }) : l)));
  const merged = makeLayer({
    kind: 'raster', name: g.name, canvas, width: doc.width, height: doc.height,
    opacity: g.opacity, blend: g.blend, clip: g.clip, mask: g.mask, fx: g.fx, parent: parentOf(doc.layers, g),
  });
  const layers = doc.layers.flatMap((l) => (l.id === g.id ? [merged] : ids.has(l.id) ? [] : [l]));
  store.commit('Merge Group', { layers, activeId: merged.id }, { icon: 'merge' });
}

export function rasterizeLayer(layer: Layer): Layer {
  if (layer.kind === 'raster' || layer.kind === 'adjustment') return layer;
  const surf = layerSurface(layer);
  const canvas = surf ? cloneCanvas(surf.canvas) : createCanvas(1, 1);
  return withLayer(layer, {
    kind: 'raster',
    canvas,
    x: surf?.x ?? 0,
    y: surf?.y ?? 0,
    width: canvas.width,
    height: canvas.height,
    text: undefined,
    shape: undefined,
  });
}

export function rasterizeActive() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (layer.smart) return store.commit('Rasterize Smart Object', { layers: store.replaceLayer(withLayer(layer, { smart: undefined })) });
  if (layer.kind !== 'text' && layer.kind !== 'shape') return store.toast('Only text, shape and smart object layers can be rasterized');
  store.commit('Rasterize Layer', { layers: store.replaceLayer(rasterizeLayer(layer)) });
}

function renderLayers(doc: Doc, layers: Layer[]): HTMLCanvasElement {
  const c = createCanvas(doc.width, doc.height);
  renderDocument({ ...doc, layers }, c);
  return c;
}

export function mergeDown() {
  const doc = need();
  if (!doc) return;
  const top = store.activeLayer;
  if (!top) return;
  if (isGroup(top)) return mergeGroup(top);
  const sibs = childrenOf(doc.layers, parentOf(doc.layers, top));
  const si = sibs.findIndex((l) => l.id === top.id);
  const below = sibs[si - 1];
  if (!below) return store.toast('No layer below to merge into');
  if (below.kind === 'adjustment') return store.toast('Cannot merge into an adjustment layer', 'error');
  if (isGroup(below)) return store.toast('Cannot merge into a group: merge the group first', 'error');
  const i = doc.layers.findIndex((l) => l.id === top.id);
  const canvas = renderLayers(doc, [
    withLayer(below, { opacity: 1, blend: 'normal', clip: false }),
    withLayer(top, { clip: false }),
  ]);
  const merged = makeLayer({
    kind: 'raster',
    name: below.name,
    canvas,
    width: doc.width,
    height: doc.height,
    opacity: below.opacity,
    blend: below.blend,
    clip: below.clip,
    parent: parentOf(doc.layers, below),
  });
  const layers = doc.layers.flatMap((l, k) => (k === i ? [merged] : l.id === below.id ? [] : [l]));
  store.commit('Merge Down', { layers, activeId: merged.id }, { icon: 'merge' });
}

export function mergeVisible() {
  const doc = need();
  if (!doc) return;
  const canvas = renderLayers(doc, doc.layers);
  const merged = makeLayer({ kind: 'raster', name: 'Merged', canvas, width: doc.width, height: doc.height });
  const layers = [...doc.layers.filter((l) => !l.visible), merged];
  store.commit('Merge Visible', { layers, activeId: merged.id }, { icon: 'merge' });
}

/**
 * Image ▸ Color Space: redraws every pixel layer, smart object source and mask in the other space (the
 * browser converts the colours). sRGB → Display P3 loses nothing; Display P3 → sRGB clips colours sRGB
 * can't show. Text, shapes and adjustments are redrawn from their settings. One undo step.
 */
export function convertColorSpace(target: ColorSpaceId) {
  const doc = need();
  if (!doc) return;
  if ((doc.colorSpace ?? 'srgb') === target) return store.toast(`Already ${target === 'srgb' ? 'sRGB' : 'Display P3'}`);
  const layers = doc.layers.map((l) => {
    const patch: Partial<Layer> = {};
    if (l.canvas) patch.canvas = convertCanvas(l.canvas, target);
    if (l.smart) patch.smart = { ...l.smart, source: convertCanvas(l.smart.source, target) };
    if (l.mask) patch.mask = { ...l.mask, canvas: convertCanvas(l.mask.canvas, target) };
    return Object.keys(patch).length ? withLayer(l, patch) : l;
  });
  doc.colorSpace = target === 'srgb' ? undefined : target;
  store.invalidateRender();
  store.commit(target === 'srgb' ? 'Convert to sRGB' : 'Convert to Display P3', { layers }, { icon: 'layer' });
  store.toast(target === 'srgb' ? 'Converted to sRGB (colours outside sRGB were clipped)' : 'Working in Display P3: wide-gamut colours are kept and exports carry the P3 profile');
}

/**
 * Image ▸ Mode: converts document color mode (RGB Color vs CMYK Color).
 * In CMYK mode, document layers are separated and gamut-mapped for offset print inks,
 * soft-proof is enabled by default, and exports write true CMYK separations.
 * One undo step.
 */
export function convertColorMode(target: 'rgb' | 'cmyk') {
  const doc = need();
  if (!doc) return;
  const current = doc.colorMode ?? 'rgb';
  if (current === target) return store.toast(`Already ${target.toUpperCase()} Color`);

  const layers = doc.layers.map((l) => {
    if (!l.canvas || target !== 'cmyk') return l;
    const w = l.canvas.width, h = l.canvas.height;
    const ctx = ctx2d(l.canvas);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const pr = proofRgb([d[i], d[i + 1], d[i + 2]]);
      d[i] = pr[0];
      d[i + 1] = pr[1];
      d[i + 2] = pr[2];
    }
    const c = createCanvas(w, h, spaceOf(l.canvas));
    ctx2d(c).putImageData(img, 0, 0);
    return withLayer(l, { canvas: c });
  });

  doc.colorMode = target === 'rgb' ? undefined : 'cmyk';
  if (target === 'cmyk') store.set({ proof: 'cmyk' });
  else if (store.state.proof === 'cmyk') store.set({ proof: 'off' });
  store.invalidateRender();
  store.commit(target === 'cmyk' ? 'Convert to CMYK Color' : 'Convert to RGB Color', { layers }, { icon: 'layer' });
  store.toast(target === 'cmyk' ? 'Converted to CMYK Color (print separation mode, soft-proof enabled)' : 'Converted to RGB Color');
}

/** True when the buffer, shown at 8 bits, is the canvas's exact pixels (no edit since it was made). */
function bufferMatchesCanvas(pb: PixelBuffer, canvas: HTMLCanvasElement): boolean {
  if (pb.width !== canvas.width || pb.height !== canvas.height) return false;
  const a = pb.toImageData(false, spaceOf(canvas)).data;
  const b = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1) return false;
  return true;
}

/**
 * Image ▸ Mode: converts document bit depth (8, 16, or 32 Bits per Channel).
 * Converts raster layers' PixelBuffers and updates display canvases with dithering when reducing depth.
 * One undo step.
 */
export function convertBitDepth(target: BitDepth, dither = true) {
  const doc = need();
  if (!doc) return;
  const current = doc.depth ?? 8;
  if (current === target) return store.toast(`Already ${target} Bits/Channel`);

  const layers = doc.layers.map((l) => {
    if (!l.canvas && !l.pixels) return l;
    // The high-bit buffer is only trusted while the layer still shows exactly what it holds: paint, filters
    // and adjustments still edit the 8-bit canvas, and an edited canvas must win (or those edits are lost)
    let pb = l.pixels && l.canvas && !bufferMatchesCanvas(l.pixels, l.canvas) ? undefined : l.pixels;
    if (!pb && l.canvas) {
      pb = PixelBuffer.fromCanvas(l.canvas, current);
    }
    if (pb) {
      const converted = pb.convert(target, dither);
      const canvas = converted.toCanvas(l.canvas ? spaceOf(l.canvas) : workingSpace(), dither);
      return withLayer(l, { pixels: converted, canvas });
    }
    return l;
  });

  doc.depth = target;
  store.invalidateRender();
  const label = `Convert to ${target} Bits/Channel`;
  store.commit(label, { layers, depth: target }, { icon: 'layer' });
  store.toast(
    target > 8
      ? `Layers stored at ${target} bits per channel. Painting, filters and adjustments still render at 8 bits for now.`
      : 'Converted to 8 bits per channel'
  );
}

export function flattenImage() {
  const doc = need();
  if (!doc) return;
  const canvas = createCanvas(doc.width, doc.height);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, doc.width, doc.height);
  ctx.drawImage(renderLayers(doc, doc.layers), 0, 0);
  const flat = makeLayer({ kind: 'raster', name: 'Background', canvas, width: doc.width, height: doc.height });
  store.commit('Flatten Image', { layers: [flat], activeId: flat.id }, { icon: 'merge' });
}

/** Stamp all visible layers into a new layer on top (Photoshop's ⇧⌥⌘E). */
export function stampVisible() {
  const doc = need();
  if (!doc) return;
  const canvas = renderLayers(doc, doc.layers);
  const layer = makeLayer({ kind: 'raster', name: 'Stamp', canvas, width: doc.width, height: doc.height });
  store.commit('Stamp Visible', { layers: [...doc.layers, layer], activeId: layer.id }, { icon: 'merge' });
}

export function toggleClip() {
  const layer = store.activeLayer;
  const doc = need();
  if (!layer || !doc) return;
  if (activeIndex(doc) === 0) return store.toast('The bottom layer cannot be clipped');
  store.updateLayer(layer.id, { clip: !layer.clip }, layer.clip ? 'Release Clipping Mask' : 'Create Clipping Mask');
}

/** Pixels of the active layer inside the selection, as a doc-positioned canvas. */
function selectedPixels(doc: Doc, layer: Layer, selection: Selection | null): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const surf = layerSurface(layer);
  if (!surf) return null;
  if (!selection) return { canvas: cloneCanvas(surf.canvas), x: surf.x, y: surf.y };
  const b = intersectRect(selection.bounds, { x: surf.x, y: surf.y, width: surf.canvas.width, height: surf.canvas.height });
  if (!b) return null;
  const c = createCanvas(b.width, b.height);
  const ctx = ctx2d(c);
  ctx.drawImage(surf.canvas, surf.x - b.x, surf.y - b.y);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(selection.canvas, -b.x, -b.y);
  void doc;
  return { canvas: c, x: b.x, y: b.y };
}

function clearSelectedPixels(layer: Layer, selection: Selection): Layer {
  const canvas = cloneCanvas(layer.canvas!);
  const ctx = ctx2d(canvas);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(selection.canvas, -layer.x, -layer.y);
  return withLayer(layer, { canvas });
}

export function layerViaCopy(cut = false) {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (layer.kind === 'adjustment') return;
  const px = selectedPixels(doc, layer, doc.selection);
  if (!px) return store.toast('Selection is empty', 'error');
  const nl = makeLayer({ kind: 'raster', name: cut ? 'Layer via Cut' : 'Layer via Copy', canvas: px.canvas, x: px.x, y: px.y, width: px.canvas.width, height: px.canvas.height });
  let layers = doc.layers;
  if (cut && doc.selection && layer.kind === 'raster') layers = store.replaceLayer(clearSelectedPixels(layer, doc.selection), layers);
  const idx = layers.findIndex((l) => l.id === layer.id);
  layers = [...layers];
  layers.splice(idx + 1, 0, nl);
  store.commit(cut ? 'Layer via Cut' : 'Layer via Copy', { layers, activeId: nl.id, selection: null }, { icon: 'layer' });
}

// ================================================================ masks

export function addMask(fromSelection = true) {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (layer.mask) {
    doc.editMask = true;
    store.emit();
    return;
  }
  const canvas = createCanvas(doc.width, doc.height);
  const ctx = ctx2d(canvas);
  if (fromSelection && doc.selection) ctx.drawImage(doc.selection.canvas, 0, 0);
  else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  const next = withLayer(layer, { mask: { canvas, x: 0, y: 0, enabled: true } });
  doc.editMask = true;
  store.commit('Add Layer Mask', { layers: store.replaceLayer(next), selection: fromSelection ? null : doc.selection }, { icon: 'mask' });
}

export function deleteMask() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer?.mask) return;
  doc.editMask = false;
  store.commit('Delete Layer Mask', { layers: store.replaceLayer(withLayer(layer, { mask: undefined })) }, { icon: 'mask' });
}

export function applyMask() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer?.mask || layer.kind !== 'raster' || !layer.canvas) return;
  const canvas = cloneCanvas(layer.canvas);
  const ctx = ctx2d(canvas);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(layer.mask.canvas, layer.mask.x - layer.x, layer.mask.y - layer.y);
  doc.editMask = false;
  store.commit('Apply Layer Mask', { layers: store.replaceLayer(withLayer(layer, { canvas, mask: undefined })) }, { icon: 'mask' });
}

export function invertMask() {
  const layer = store.activeLayer;
  if (!layer?.mask) return;
  const m = layer.mask;
  const canvas = createCanvas(m.canvas.width, m.canvas.height);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(m.canvas, 0, 0);
  store.commit('Invert Mask', { layers: store.replaceLayer(withLayer(layer, { mask: { ...m, canvas } })) }, { icon: 'mask' });
}

// ================================================================ adjustment layers

export interface AdjustPreset {
  id: string;
  name: string;
  tint: string; // swatch for UI
  adjust: Partial<Adjust>;
}

const curve = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x, y }));

export const ADJUST_PRESETS: AdjustPreset[] = [
  { id: 'pop', name: 'Pop', tint: '#ff9a3c', adjust: { contrast: 18, vibrance: 35, clarity: 20, shadows: 15, highlights: -15 } },
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    tint: '#1fa2a6',
    adjust: { contrast: 20, vibrance: 20, grade: { shadowHue: 190, shadowSat: 45, highlightHue: 32, highlightSat: 38, balance: 0 }, vignette: -18 },
  },
  { id: 'golden', name: 'Golden Hour', tint: '#f2b134', adjust: { temperature: 32, tint: 6, exposure: 0.15, highlights: -25, shadows: 18, vibrance: 25, vignette: -12 } },
  { id: 'moody-bw', name: 'Moody B&W', tint: '#555', adjust: { bw: true, contrast: 35, clarity: 30, blacks: -20, grain: 18, vignette: -30 } },
  { id: 'clean-portrait', name: 'Clean Portrait', tint: '#f3c7b3', adjust: { exposure: 0.15, contrast: -6, highlights: -14, shadows: 16, clarity: -12, vibrance: 10 } },
  {
    id: 'film',
    name: 'Faded Film',
    tint: '#b9a27a',
    adjust: { fade: 35, grain: 30, contrast: 10, temperature: 10, saturation: -12, curves: { rgb: curve([0, 22], [64, 66], [192, 196], [255, 240]), r: curve([0, 0], [255, 255]), g: curve([0, 0], [255, 255]), b: curve([0, 0], [255, 255]) } },
  },
  { id: 'crisp-landscape', name: 'Crisp Landscape', tint: '#3a8f5c', adjust: { dehaze: 25, clarity: 25, vibrance: 30, highlights: -30, shadows: 20, sharpen: 25 } },
  { id: 'noir', name: 'Noir', tint: '#222', adjust: { bw: true, contrast: 60, whites: 20, blacks: -40, vignette: -45, clarity: 20 } },
  { id: 'cool-matte', name: 'Cool Matte', tint: '#7aa0c4', adjust: { temperature: -22, fade: 25, contrast: -10, saturation: -15, grade: { shadowHue: 215, shadowSat: 30, highlightHue: 200, highlightSat: 10, balance: 0 } } },
  { id: 'high-key', name: 'High Key', tint: '#eee', adjust: { exposure: 0.6, contrast: -15, highlights: -30, shadows: 45, whites: 20, saturation: -10 } },
  { id: 'cyberpunk', name: 'Neon Night', tint: '#d63cff', adjust: { contrast: 25, vibrance: 40, grade: { shadowHue: 260, shadowSat: 60, highlightHue: 320, highlightSat: 45, balance: -10 }, hue: -8, vignette: -25 } },
  { id: 'sepia', name: 'Antique', tint: '#8b6b3e', adjust: { bw: false, saturation: -70, temperature: 45, fade: 20, grain: 25, vignette: -35 } },
];

/** `openPanel`: show the Adjust panel for the new layer (looks keep the Looks panel open). */
export function newAdjustmentLayer(adjust: Partial<Adjust> = {}, name = 'Adjustment', openPanel = true) {
  const doc = need();
  if (!doc) return;
  if (Object.keys(adjust).length) record({ kind: 'adjust', adjust: structuredClone(adjust), label: `${name} adjustment layer` });
  const base = defaultAdjust();
  const layer = makeLayer({
    kind: 'adjustment',
    name,
    adjust: { ...base, ...structuredClone(adjust) },
    width: doc.width,
    height: doc.height,
  });
  // Adjustment layers get a white mask so they can be painted on right away
  const mask = createCanvas(doc.width, doc.height);
  const mctx = ctx2d(mask);
  if (doc.selection) mctx.drawImage(doc.selection.canvas, 0, 0);
  else {
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, doc.width, doc.height);
  }
  layer.mask = { canvas: mask, x: 0, y: 0, enabled: true };
  store.insertLayer(layer, undefined, `New ${name}`);
  if (doc.selection) store.commit(`New ${name}`, { selection: null }, { coalesce: `new-adj-${layer.id}` });
  if (openPanel) store.set({ rightTab: 'adjust' });
  return layer;
}

/** Returns the adjustment layer the Adjust panel edits, creating one when needed. */
export function ensureAdjustmentTarget(): Layer | null {
  const layer = store.activeLayer;
  if (layer?.kind === 'adjustment') return layer;
  return newAdjustmentLayer({}, 'Develop') ?? null;
}

export function setAdjust(layerId: string, adjust: Adjust, label: string) {
  store.updateLayer(layerId, { adjust }, label, `adjust:${layerId}:${label}`);
  const layer = store.doc?.layers.find((l) => l.id === layerId);
  if (layer) record({ kind: 'adjust', adjust: adjustDiff(adjust), label: `${layer.name} adjustment layer` });
}

/** Only the settings that differ from the defaults (keeps recorded actions small and readable). */
function adjustDiff(a: Adjust): Partial<Adjust> {
  const d = defaultAdjust() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (JSON.stringify(v) !== JSON.stringify(d[k])) out[k] = v;
  return out as Partial<Adjust>;
}

/** Analyses the image and builds an "Auto Enhance" adjustment layer. */
export function autoEnhance() {
  const doc = need();
  if (!doc) return;
  const small = createCanvas(Math.min(512, doc.width), Math.min(512, doc.height));
  const full = createCanvas(doc.width, doc.height);
  renderDocument(doc, full);
  const sctx = ctx2d(small);
  sctx.drawImage(full, 0, 0, small.width, small.height);
  const d = sctx.getImageData(0, 0, small.width, small.height).data;
  const hist = new Uint32Array(256);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const L = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    hist[L]++;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  if (!n) return;
  const pct = (p: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= n * p) return i;
    }
    return 255;
  };
  const lo = pct(0.004);
  const hi = pct(0.996);
  const mid = pct(0.5);
  r /= n;
  g /= n;
  b /= n;
  const avg = (r + g + b) / 3;
  const adj: Partial<Adjust> = {
    levels: { inBlack: Math.min(lo, 60), inWhite: Math.max(hi, 190), gamma: 1, outBlack: 0, outWhite: 255 },
    temperature: Math.max(-40, Math.min(40, Math.round(((b - r) / Math.max(1, avg)) * 90))),
    tint: Math.max(-30, Math.min(30, Math.round(((g - (r + b) / 2) / Math.max(1, avg)) * 90))),
    vibrance: 18,
    clarity: 10,
    shadows: mid < 90 ? 25 : 8,
    highlights: hi > 245 ? -25 : -8,
  };
  const normMid = (mid - lo) / Math.max(1, hi - lo);
  if (normMid > 0.05 && normMid < 0.95) adj.levels!.gamma = Math.max(0.6, Math.min(1.8, Math.log(0.5) / Math.log(normMid)));
  newAdjustmentLayer(adj, 'Auto Enhance');
  store.toast('Auto Enhance added as an editable adjustment layer', 'success');
}

// ================================================================ selection commands

export function selectAll() {
  const doc = need();
  if (doc) store.setSelection(sel.selectAll(doc.width, doc.height), 'Select All');
}

export function deselect() {
  const doc = need();
  if (doc?.selection) store.setSelection(null, 'Deselect');
}

export function reselect() {
  const doc = need();
  if (doc?.lastSelection) store.setSelection(doc.lastSelection, 'Reselect');
}

export function invertSelection() {
  const doc = need();
  if (doc) store.setSelection(sel.invert(doc.selection, doc.width, doc.height), 'Inverse Selection');
}

export function modifySelection(kind: 'feather' | 'expand' | 'contract' | 'smooth', amount: number) {
  const doc = need();
  if (!doc?.selection) return store.toast('No active selection');
  const s = doc.selection;
  const next =
    kind === 'feather' ? sel.feather(s, amount) : kind === 'expand' ? sel.grow(s, amount) : kind === 'contract' ? sel.grow(s, -amount) : sel.smooth(s, amount);
  store.setSelection(next, `${kind[0].toUpperCase()}${kind.slice(1)} Selection`);
}

export function selectLayerAlpha(layerId?: string) {
  const doc = need();
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === (layerId ?? doc.activeId));
  const surf = layer && layerSurface(layer);
  if (!surf) return;
  const c = createCanvas(doc.width, doc.height);
  ctx2d(c).drawImage(surf.canvas, surf.x, surf.y);
  store.setSelection(sel.selectionFromCanvas(c), 'Load Selection');
}

export function selectColorRange(hex: string, tolerance: number) {
  const doc = need();
  if (!doc) return;
  const full = createCanvas(doc.width, doc.height);
  renderDocument(doc, full);
  const img = ctx2d(full).getImageData(0, 0, doc.width, doc.height);
  // Seed a temporary pixel with the target color for the flood routine
  const d = new Uint8ClampedArray(img.data);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  d[0] = r; d[1] = g; d[2] = b; d[3] = 255;
  const mask = sel.floodMask(d, doc.width, doc.height, 0, 0, tolerance, false);
  store.setSelection(sel.selectionFromCanvas(sel.maskToCanvas(mask, doc.width, doc.height)), 'Color Range');
}

// ================================================================ edit

let clipboard: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;

export interface LayerClipboardData {
  sourceApp: 'SkillVector' | 'SkillPhoto';
  sourceDocId: string;
  sourceDocTitle: string;
  layers: Layer[];
  width: number;
  height: number;
}

let inMemoryLayersClipboard: LayerClipboardData | null = null;

export function getLayersClipboard(): LayerClipboardData | null {
  if (inMemoryLayersClipboard) return inMemoryLayersClipboard;
  try {
    const raw = localStorage.getItem('skillsuite_layers_clipboard');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.layers) && parsed.layers.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse layers from localStorage', e);
  }
  return null;
}

export function setLayersClipboard(data: LayerClipboardData) {
  inMemoryLayersClipboard = data;
  try {
    const serializableLayers = data.layers.map((l) => {
      const copy = { ...l };
      if (copy.canvas) {
        try {
          (copy as unknown as { canvasData?: string }).canvasData = copy.canvas.toDataURL();
          delete (copy as { canvas?: HTMLCanvasElement }).canvas;
        } catch {
          delete (copy as { canvas?: HTMLCanvasElement }).canvas;
        }
      }
      if (copy.mask?.canvas) {
        try {
          (copy.mask as unknown as { canvasData?: string }).canvasData = copy.mask.canvas.toDataURL();
          delete (copy.mask as { canvas?: HTMLCanvasElement }).canvas;
        } catch {
          delete (copy.mask as { canvas?: HTMLCanvasElement }).canvas;
        }
      }
      return copy;
    });
    localStorage.setItem(
      'skillsuite_layers_clipboard',
      JSON.stringify({
        ...data,
        layers: serializableLayers,
      })
    );
  } catch (e) {
    console.warn('Failed to save layers to localStorage', e);
  }
}

export async function copy(merged = false, cut = false) {
  const doc = need();
  if (!doc) return;
  const layer = store.activeLayer;

  // 1. Pixel marquee selection copy
  if (doc.selection || merged) {
    let px: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
    if (merged) {
      const full = renderLayers(doc, doc.layers);
      const tmp = makeLayer({ kind: 'raster', name: 'm', canvas: full, width: doc.width, height: doc.height });
      px = selectedPixels(doc, tmp, doc.selection);
    } else if (layer?.kind === 'raster') {
      px = selectedPixels(doc, layer, doc.selection);
    }
    if (px) {
      clipboard = px;
      const ok = await copyCanvasToClipboard(px.canvas);
      if (cut && layer?.kind === 'raster' && doc.selection) {
        store.commit('Cut', { layers: store.replaceLayer(clearSelectedPixels(layer, doc.selection)) }, { icon: 'cut' });
      }
      store.toast(ok ? 'Copied to clipboard' : 'Copied (internal clipboard)');
      return;
    }
  }

  // 2. Object / Layer level copy (shapes, text, vectors, groups, or whole raster layers)
  const selected = store.selectedLayers.length ? store.selectedLayers : layer ? [layer] : [];
  if (!selected.length) return store.toast('Nothing selected to copy');

  const copiedLayers: Layer[] = [];
  const handled = new Set<string>();
  for (const l of selected) {
    if (handled.has(l.id)) continue;
    const block = copyBlock(doc.layers, l);
    for (const b of block) {
      handled.add(b.id);
      copiedLayers.push(b);
    }
  }

  setLayersClipboard({
    sourceApp: 'SkillPhoto',
    sourceDocId: doc.id,
    sourceDocTitle: doc.title,
    layers: copiedLayers,
    width: doc.width,
    height: doc.height,
  });

  // Try copying rendered image to system clipboard if single layer with canvas
  try {
    if (copiedLayers.length === 1 && copiedLayers[0].canvas) {
      await copyCanvasToClipboard(copiedLayers[0].canvas);
    }
  } catch {
    /* ignore */
  }

  if (cut) {
    deleteLayer();
    store.toast(`Cut ${copiedLayers.length} layer${copiedLayers.length > 1 ? 's' : ''}`);
  } else {
    store.toast(`Copied ${copiedLayers.length} layer${copiedLayers.length > 1 ? 's' : ''}`);
  }
}

export function pasteInternal(): boolean {
  if (!clipboard || !store.doc) return false;
  const c = cloneCanvas(clipboard.canvas);
  store.newRasterLayer('Pasted', { canvas: c, x: clipboard.x, y: clipboard.y });
  return true;
}

export async function paste(): Promise<boolean> {
  const doc = need();
  if (!doc) return false;

  // 1. Check layer clipboard (in-memory or localStorage)
  const clip = getLayersClipboard();
  if (clip && clip.layers && clip.layers.length > 0) {
    const isSameDoc = clip.sourceDocId === doc.id;
    const dx = isSameDoc ? 24 : 0;
    const dy = isSameDoc ? 24 : 0;

    const idMap = new Map<string, string>();
    for (const l of clip.layers) {
      idMap.set(l.id, uid('layer'));
    }

    const pasted: Layer[] = [];
    for (const orig of clip.layers) {
      const newId = idMap.get(orig.id) || uid('layer');
      const newParent = orig.parent ? idMap.get(orig.parent) : undefined;
      const copy = copyOf(orig);

      let canvas = copy.canvas;
      const canvasData = (orig as unknown as { canvasData?: string }).canvasData;
      if (!canvas && canvasData) {
        try {
          const img = new Image();
          img.src = canvasData;
          await new Promise((r) => { img.onload = r; img.onerror = r; });
          if (img.width && img.height) {
            canvas = createCanvas(img.width, img.height);
            ctx2d(canvas).drawImage(img, 0, 0);
          }
        } catch {
          /* ignore */
        }
      }

      pasted.push(withLayer(copy, {
        id: newId,
        parent: newParent,
        name: isSameDoc ? `${orig.name} copy` : orig.name,
        x: orig.x + dx,
        y: orig.y + dy,
        canvas,
      }));
    }

    const activeIdx = doc.layers.findIndex((l) => l.id === doc.activeId);
    const insertIdx = activeIdx >= 0 ? activeIdx + 1 : doc.layers.length;
    const nextLayers = [...doc.layers];
    nextLayers.splice(insertIdx, 0, ...pasted);

    const top = pasted[pasted.length - 1];
    const newSelectedIds = pasted.map((l) => l.id);

    doc.selectedIds = newSelectedIds.length > 1 ? newSelectedIds : undefined;
    store.commit('Paste', {
      layers: nextLayers,
      activeId: top.id,
    }, { icon: 'layer' });

    store.toast(`Pasted ${pasted.length} layer${pasted.length > 1 ? 's' : ''}`);
    return true;
  }

  // 2. Check internal pixel clipboard
  if (clipboard) {
    return pasteInternal();
  }

  // 3. Check system clipboard
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const file = new File([blob], 'pasted-image.png', { type: imageType });
        const { placeImage } = await import('./io');
        await placeImage(file, 'Pasted Image');
        return true;
      }
      if (item.types.includes('image/svg+xml') || item.types.includes('text/plain')) {
        const t = item.types.includes('image/svg+xml') ? 'image/svg+xml' : 'text/plain';
        const blob = await item.getType(t);
        const text = await blob.text();
        if (text.includes('<svg') || text.includes('xmlns=')) {
          const file = new File([new Blob([text], { type: 'image/svg+xml' })], 'pasted.svg', { type: 'image/svg+xml' });
          const { placeImage } = await import('./io');
          await placeImage(file, 'Pasted Vector');
          return true;
        }
      }
    }
  } catch {
    /* fallback */
  }

  store.toast('Clipboard is empty');
  return false;
}

export function transferLayersToDoc(targetDocId: string, layers: Layer[], at?: { x: number; y: number }) {
  store.addLayersToDoc(targetDocId, layers, at);
  store.toast(`Transferred ${layers.length} layer${layers.length > 1 ? 's' : ''}`);
}

export function clearSelection() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (!doc.selection) {
    // Nothing selected on the canvas (after clicking empty space): nothing to delete
    if (store.state.tool === 'move' && !frameVisible()) return;
    return deleteLayer();
  }
  if (doc.editMask && layer.mask) {
    const canvas = cloneCanvas(layer.mask.canvas);
    const ctx = ctx2d(canvas);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(doc.selection.canvas, -layer.mask.x, -layer.mask.y);
    return store.commit('Clear Mask', { layers: store.replaceLayer(withLayer(layer, { mask: { ...layer.mask, canvas } })) });
  }
  if (layer.kind !== 'raster') return store.toast('Rasterize the layer first', 'error');
  store.commit('Clear', { layers: store.replaceLayer(clearSelectedPixels(layer, doc.selection)) }, { icon: 'trash' });
}

export function fill(color: string) {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (doc.editMask && layer.mask) {
    const canvas = cloneCanvas(layer.mask.canvas);
    const ctx = ctx2d(canvas);
    const L = parseInt(color.slice(1, 3), 16) * 0.3 + parseInt(color.slice(3, 5), 16) * 0.59 + parseInt(color.slice(5, 7), 16) * 0.11;
    const area = doc.selection ? doc.selection.canvas : null;
    ctx.globalCompositeOperation = L < 128 ? 'destination-out' : 'source-over';
    if (area) ctx.drawImage(area, -layer.mask.x, -layer.mask.y);
    else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    return store.commit('Fill Mask', { layers: store.replaceLayer(withLayer(layer, { mask: { ...layer.mask, canvas } })) });
  }
  if (layer.kind !== 'raster' || !layer.canvas) return store.toast('Select a pixel layer to fill', 'error');
  const canvas = cloneCanvas(layer.canvas);
  const ctx = ctx2d(canvas);
  if (doc.selection) {
    const tmp = createCanvas(canvas.width, canvas.height);
    const t = ctx2d(tmp);
    t.drawImage(doc.selection.canvas, -layer.x, -layer.y);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = color;
    t.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(tmp, 0, 0);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  store.commit('Fill', { layers: store.replaceLayer(withLayer(layer, { canvas })) }, { icon: 'fill' });
}

export async function contentAwareFillSelection() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (!doc.selection) return store.toast('Select the area to remove first (lasso works great)', 'error');
  if (layer.kind !== 'raster' || !layer.canvas) return store.toast('Select a pixel layer', 'error');
  const hole = createCanvas(layer.canvas.width, layer.canvas.height);
  ctx2d(hole).drawImage(doc.selection.canvas, -layer.x, -layer.y);
  const src = layer.canvas;
  const result = await store.task('Content-Aware Fill', () => contentAwareFill(src, hole, 3));
  if (!result) return;
  const fresh = store.doc?.layers.find((l) => l.id === layer.id);
  if (!fresh) return;
  store.commit('Content-Aware Fill', { layers: store.replaceLayer(withLayer(fresh, { canvas: result })), selection: null }, { icon: 'magic' });
}

// ================================================================ image

export function crop(rect: Rect, deletePixels: boolean) {
  const doc = need();
  if (!doc) return;
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  const layers = doc.layers.map((l) => {
    const moved: Partial<Layer> = { x: l.x - r.x, y: l.y - r.y };
    if (l.mask) moved.mask = { ...l.mask, x: l.mask.x - r.x, y: l.mask.y - r.y };
    if (l.kind === 'adjustment') {
      moved.x = 0;
      moved.y = 0;
      moved.width = r.width;
      moved.height = r.height;
    }
    let next = withLayer(l, moved);
    if (deletePixels && next.kind === 'raster' && next.canvas) {
      const c = createCanvas(r.width, r.height);
      ctx2d(c).drawImage(next.canvas, next.x, next.y);
      next = withLayer(next, { canvas: c, x: 0, y: 0, width: r.width, height: r.height, smart: undefined });
    }
    return next;
  });
  store.invalidateRender();
  store.commit('Crop', { layers, width: r.width, height: r.height, selection: null }, { icon: 'crop' });
  doc.view.fitted = false;
}

/**
 * Image ▸ Perspective Crop: straightens the plane under `quad` (doc space, nw ne se sw) into a
 * rectangle. Pixel layers and masks are resampled through the homography; text and shapes keep
 * their geometry and move to where their centre lands; adjustments cover the new canvas.
 */
export function perspectiveCrop(quad: { x: number; y: number }[], size = rectifiedSize(quad)) {
  const doc = need();
  if (!doc) return;
  const { width: W, height: H } = size;
  const warpCanvas = (c: HTMLCanvasElement, ox: number, oy: number) => {
    const px = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
    const out = createCanvas(W, H, spaceOf(c));
    ctx2d(out).putImageData(pixelsLike(c, rectify(px, c.width, c.height, ox, oy, quad, W, H) as Uint8ClampedArray, W, H), 0, 0);
    return out;
  };
  const layers = doc.layers.map((l) => {
    const patch: Partial<Layer> = {};
    if (l.mask) patch.mask = { ...l.mask, canvas: warpCanvas(l.mask.canvas, l.mask.x, l.mask.y), x: 0, y: 0 };
    if (l.kind === 'adjustment') Object.assign(patch, { x: 0, y: 0, width: W, height: H });
    else if (l.kind === 'raster' && l.canvas && !l.text && !l.shape) Object.assign(patch, { canvas: warpCanvas(l.canvas, l.x, l.y), x: 0, y: 0, width: W, height: H, smart: undefined });
    else if (l.width && l.height) {
      const c = mapIntoRect(quad, W, H, { x: l.x + l.width / 2, y: l.y + l.height / 2 });
      Object.assign(patch, { x: c.x - l.width / 2, y: c.y - l.height / 2 });
    }
    return withLayer(l, patch);
  });
  store.invalidateRender();
  store.commit('Perspective Crop', { layers, width: W, height: H, selection: null }, { icon: 'crop' });
  doc.view.fitted = false;
}

export interface ContentAwareScaleOptions {
  /** 0–100: share of the change made by seams (the rest is plain scaling). */
  amount: number;
  /** Keep the selected area's shape. */
  protectSelection: boolean;
  protectSkin: boolean;
}

/**
 * Edit ▸ Content-Aware Scale: resizes the active pixel layer to tw × th by removing or adding
 * low-detail seams. A full-canvas layer (a photo) resizes the canvas with it.
 */
export async function contentAwareScale(tw: number, th: number, o: ContentAwareScaleOptions): Promise<void> {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (layer.kind !== 'raster' || !layer.canvas || layer.text || layer.shape) return store.toast('Content-Aware Scale works on a pixel layer', 'error');
  const c = layer.canvas;
  const full = layer.x === 0 && layer.y === 0 && c.width === doc.width && c.height === doc.height;
  let protect: Float32Array | undefined;
  if (o.protectSelection && doc.selection) {
    // Selection alpha under each layer pixel
    const s = ctx2d(doc.selection.canvas).getImageData(0, 0, doc.width, doc.height).data;
    protect = new Float32Array(c.width * c.height);
    for (let y = 0; y < c.height; y++) {
      const dy = Math.round(layer.y) + y;
      if (dy < 0 || dy >= doc.height) continue;
      for (let x = 0; x < c.width; x++) {
        const dx = Math.round(layer.x) + x;
        if (dx >= 0 && dx < doc.width) protect[y * c.width + x] = s[(dy * doc.width + dx) * 4 + 3] / 255;
      }
    }
  }
  const img = ctx2d(c).getImageData(0, 0, c.width, c.height);
  await store.task('Content-Aware Scale', async () => {
    const out = await contentAwareScaleOffThread(img, tw, th, { amount: o.amount / 100, protect, protectSkin: o.protectSkin });
    if (store.doc !== doc || !doc.layers.includes(layer)) return store.toast('Content-Aware Scale skipped: the layer changed while it ran', 'error');
    const canvas = createCanvas(out.width, out.height);
    ctx2d(canvas).putImageData(out, 0, 0);
    // A full-canvas photo takes the canvas with it; other layers keep their centre
    const x = full ? 0 : layer.x + (c.width - out.width) / 2;
    const y = full ? 0 : layer.y + (c.height - out.height) / 2;
    const scaled = withLayer(layer, { canvas, x, y, width: out.width, height: out.height, smart: undefined });
    let layers = store.replaceLayer(scaled);
    if (full) layers = layers.map((l) => (l.kind === 'adjustment' ? withLayer(l, { x: 0, y: 0, width: out.width, height: out.height }) : l));
    record({ kind: 'contentAwareScale', width: tw, height: th, opts: { ...o }, label: `Content-Aware Scale ${tw} × ${th}` });
    // An open crop box belongs to the old canvas size
    if (full) store.cancelModes();
    store.invalidateRender();
    store.commit('Content-Aware Scale', full ? { layers, width: out.width, height: out.height, selection: null } : { layers }, { icon: 'transform' });
    if (full) doc.view.fitted = false;
  });
}

export function cropToSelection() {
  const doc = need();
  if (!doc?.selection) return store.toast('No active selection');
  crop(doc.selection.bounds, false);
}

export function trimTransparent() {
  const doc = need();
  if (!doc) return;
  const full = renderLayers(doc, doc.layers);
  const b = alphaBounds(full, 0);
  if (!b) return store.toast('Image is empty');
  crop(b, false);
}

function scaleCanvas(c: HTMLCanvasElement, sx: number, sy: number): HTMLCanvasElement {
  const out = createCanvas(c.width * sx, c.height * sy);
  const ctx = ctx2d(out);
  ctx.imageSmoothingQuality = 'high';
  // Step down in halves for quality when shrinking a lot
  let src = c;
  while (src.width * 0.5 > out.width && src.height * 0.5 > out.height) {
    const half = createCanvas(src.width / 2, src.height / 2);
    const hctx = ctx2d(half);
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(src, 0, 0, half.width, half.height);
    src = half;
  }
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export function imageSize(width: number, height: number) {
  const doc = need();
  if (!doc) return;
  record({ kind: 'imageSize', width, height, fit: true, label: `Fit within ${width} × ${height}` });
  const sx = width / doc.width;
  const sy = height / doc.height;
  const layers = doc.layers.map((l) => {
    const patch: Partial<Layer> = { x: l.x * sx, y: l.y * sy };
    if (l.canvas) {
      patch.canvas = scaleCanvas(l.canvas, sx, sy);
      patch.width = patch.canvas.width;
      patch.height = patch.canvas.height;
    }
    if (l.mask) patch.mask = { ...l.mask, canvas: scaleCanvas(l.mask.canvas, sx, sy), x: l.mask.x * sx, y: l.mask.y * sy };
    if (l.text) {
      patch.text = { ...l.text, size: l.text.size * sy };
    }
    if (l.kind === 'shape' || l.kind === 'adjustment') {
      patch.width = l.width * sx;
      patch.height = l.height * sy;
    }
    if (l.smart) {
      // Smart objects re-render from their source at the new scale (no quality loss)
      const sm = l.smart;
      const sc = (pts?: { x: number; y: number }[]) => pts?.map((p) => ({ x: p.x * sx, y: p.y * sy }));
      const smart = { ...sm, scaleX: sm.scaleX * sx, scaleY: sm.scaleY * sy, ax: sm.ax * sx, ay: sm.ay * sy, quad: sc(sm.quad), mesh: sc(sm.mesh) };
      return rerenderSmart(withLayer(l, patch), smart);
    }
    return withLayer(l, patch);
  });
  store.invalidateRender();
  store.commit('Image Size', { layers, width, height, selection: null }, { icon: 'resize' });
  doc.view.fitted = false;
}

export function canvasSize(width: number, height: number, anchorX: number, anchorY: number, extendColor: string | null) {
  const doc = need();
  if (!doc) return;
  const dx = Math.round((width - doc.width) * anchorX);
  const dy = Math.round((height - doc.height) * anchorY);
  const layers = doc.layers.map((l, i) => {
    const patch: Partial<Layer> = { x: l.x + dx, y: l.y + dy };
    if (l.mask) patch.mask = { ...l.mask, x: l.mask.x + dx, y: l.mask.y + dy };
    if (l.kind === 'adjustment') Object.assign(patch, { x: 0, y: 0, width, height });
    if (i === 0 && extendColor && l.kind === 'raster' && l.canvas) {
      const c = createCanvas(width, height);
      const ctx = ctx2d(c);
      ctx.fillStyle = extendColor;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(l.canvas, l.x + dx, l.y + dy);
      Object.assign(patch, { canvas: c, x: 0, y: 0, width, height });
    }
    return withLayer(l, patch);
  });
  store.invalidateRender();
  store.commit('Canvas Size', { layers, width, height, selection: null }, { icon: 'resize' });
  doc.view.fitted = false;
}

function transformCanvas(c: HTMLCanvasElement, kind: 'cw' | 'ccw' | '180' | 'h' | 'v'): HTMLCanvasElement {
  const swap = kind === 'cw' || kind === 'ccw';
  const out = createCanvas(swap ? c.height : c.width, swap ? c.width : c.height);
  const ctx = ctx2d(out);
  if (kind === 'cw') ctx.setTransform(0, 1, -1, 0, c.height, 0);
  else if (kind === 'ccw') ctx.setTransform(0, -1, 1, 0, 0, c.width);
  else if (kind === '180') ctx.setTransform(-1, 0, 0, -1, c.width, c.height);
  else if (kind === 'h') ctx.setTransform(-1, 0, 0, 1, c.width, 0);
  else ctx.setTransform(1, 0, 0, -1, 0, c.height);
  ctx.drawImage(c, 0, 0);
  return out;
}

function transformRect(x: number, y: number, w: number, h: number, W: number, H: number, kind: 'cw' | 'ccw' | '180' | 'h' | 'v') {
  switch (kind) {
    case 'cw':
      return { x: H - y - h, y: x };
    case 'ccw':
      return { x: y, y: W - x - w };
    case '180':
      return { x: W - x - w, y: H - y - h };
    case 'h':
      return { x: W - x - w, y };
    case 'v':
      return { x, y: H - y - h };
  }
}

export function rotateCanvas(kind: 'cw' | 'ccw' | '180' | 'h' | 'v') {
  const doc = need();
  if (!doc) return;
  const W = doc.width;
  const H = doc.height;
  const swap = kind === 'cw' || kind === 'ccw';
  const layers = doc.layers.map((orig) => {
    const l = rasterizeLayer(orig);
    const patch: Partial<Layer> = {};
    if (l.kind === 'raster' && l.canvas) {
      patch.canvas = transformCanvas(l.canvas, kind);
      patch.smart = undefined;
      Object.assign(patch, transformRect(l.x, l.y, l.canvas.width, l.canvas.height, W, H, kind));
      patch.width = patch.canvas.width;
      patch.height = patch.canvas.height;
    }
    if (l.kind === 'adjustment') Object.assign(patch, { width: swap ? H : W, height: swap ? W : H });
    if (l.mask) {
      const mc = transformCanvas(l.mask.canvas, kind);
      const p = transformRect(l.mask.x, l.mask.y, l.mask.canvas.width, l.mask.canvas.height, W, H, kind);
      patch.mask = { ...l.mask, canvas: mc, x: p.x, y: p.y };
    }
    return withLayer(l, patch);
  });
  const labels = { cw: 'Rotate 90° CW', ccw: 'Rotate 90° CCW', '180': 'Rotate 180°', h: 'Flip Canvas Horizontal', v: 'Flip Canvas Vertical' };
  store.invalidateRender();
  store.commit(labels[kind], { layers, width: swap ? H : W, height: swap ? W : H, selection: null }, { icon: 'rotate' });
  doc.view.fitted = false;
}

export function flipLayer(dir: 'h' | 'v') {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (layer.smart) {
    const sm = layer.smart;
    const flipped = { ...sm, scaleX: dir === 'h' ? -sm.scaleX : sm.scaleX, scaleY: dir === 'v' ? -sm.scaleY : sm.scaleY, quad: undefined, mesh: undefined };
    return store.commit(dir === 'h' ? 'Flip Layer Horizontal' : 'Flip Layer Vertical', { layers: store.replaceLayer(rerenderSmart(layer, flipped)) });
  }
  const l = rasterizeLayer(layer);
  if (!l.canvas) return;
  store.commit(dir === 'h' ? 'Flip Layer Horizontal' : 'Flip Layer Vertical', {
    layers: store.replaceLayer(withLayer(l, { canvas: transformCanvas(l.canvas, dir) })),
  });
}

// ================================================================ free transform

export function beginTransform() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (layer.kind === 'adjustment') return store.toast('Adjustment layers cannot be transformed');
  if (layer.locked) return store.toast('Layer is locked', 'error');
  const many = store.selectedLayers.filter((l) => l.kind !== 'adjustment');
  if (isGroup(layer) || many.length > 1) return beginMultiTransform(doc, isGroup(layer) ? [layer] : many, layer);
  if (layer.smart) {
    // Smart objects transform their original pixels, starting from the current transform
    const g = smartGeometry(layer.smart, layer.x, layer.y);
    store.set({ transform: { layerId: layer.id, lifted: false, ...g }, tool: 'move' });
    updateTransformPreview();
    return;
  }
  const surf = layerSurface(layer);
  if (!surf) return;
  // Transform the selected pixels only, if there is a selection on a raster layer
  let source = surf.canvas;
  let sx = surf.x;
  let sy = surf.y;
  let lifted = false;
  if (layer.kind === 'raster' && doc.selection) {
    const px = selectedPixels(doc, layer, doc.selection);
    if (px) {
      lifted = true;
      doc.layers = store.replaceLayer(clearSelectedPixels(layer, doc.selection), doc.layers);
      const ab = alphaBounds(px.canvas);
      if (ab) {
        const c = createCanvas(ab.width, ab.height);
        ctx2d(c).drawImage(px.canvas, -ab.x, -ab.y);
        source = c;
        sx = px.x + ab.x;
        sy = px.y + ab.y;
      }
    }
  } else if (layer.kind === 'raster') {
    const ab = alphaBounds(surf.canvas);
    if (!ab) return store.toast('Layer is empty');
    const c = createCanvas(ab.width, ab.height);
    ctx2d(c).drawImage(surf.canvas, -ab.x, -ab.y);
    source = c;
    sx = surf.x + ab.x;
    sy = surf.y + ab.y;
  }
  const t: TransformState = { layerId: layer.id, source, sx, sy, lifted, tx: 0, ty: 0, scaleX: 1, scaleY: 1, angle: 0 };
  store.set({ transform: t, tool: 'move' });
  updateTransformPreview();
}

export { transformMatrix, transformCorners } from './transform';

/** The pixel / text / shape layers a multi-transform moves: groups contribute their contents. */
function multiTargets(doc: Doc, picked: Layer[]): Layer[] {
  const ids = new Set(picked.flatMap((l) => blockOf(doc.layers, l)).map((l) => l.id));
  return doc.layers.filter((l) => ids.has(l.id) && !isGroup(l) && l.kind !== 'adjustment' && !l.locked);
}

/** Free Transform on a group or several layers: one box around all of them. */
function beginMultiTransform(doc: Doc, picked: Layer[], active: Layer) {
  const targets = multiTargets(doc, picked);
  if (!targets.length) return store.toast('Nothing to transform');
  // Preview source: the targets composited as they look (outside their groups)
  const comp = renderLayers(doc, targets.map((l) => withLayer(l, { parent: undefined, clip: false })));
  const ab = alphaBounds(comp);
  if (!ab) return store.toast('The layers are empty');
  const source = createCanvas(ab.width, ab.height);
  ctx2d(source).drawImage(comp, -ab.x, -ab.y);
  const t: TransformState = { layerId: active.id, source, sx: ab.x, sy: ab.y, lifted: false, tx: 0, ty: 0, scaleX: 1, scaleY: 1, angle: 0, multi: targets.map((l) => l.id) };
  store.set({ transform: t, tool: 'move' });
  updateTransformPreview();
}

export function updateTransformPreview() {
  const t = store.state.transform;
  const doc = store.doc;
  if (!t || !doc) return;
  if (t.multi) {
    // Show the transformed composite in place of the first layer; hide the rest meanwhile
    const out = renderTransformed(t);
    touch(out.canvas);
    const holder = isGroup(doc.layers.find((l) => l.id === t.layerId)) ? t.layerId : t.multi[t.multi.length - 1];
    const empty = createCanvas(1, 1);
    for (const id of t.multi) store.overrides.set(id, { canvas: empty, x: 0, y: 0 });
    store.overrides.set(holder, out);
    store.requestRender();
    return;
  }
  const layer = doc.layers.find((l) => l.id === t.layerId);
  if (!layer) return;
  if (layer.kind === 'raster') {
    const out = renderTransformed(t);
    // Composite the transformed pixels over whatever stays behind on the layer
    const base = layerSurface(layer);
    if (base) {
      const minX = Math.min(base.x, out.x);
      const minY = Math.min(base.y, out.y);
      const maxX = Math.max(base.x + base.canvas.width, out.x + out.canvas.width);
      const maxY = Math.max(base.y + base.canvas.height, out.y + out.canvas.height);
      const c = createCanvas(maxX - minX, maxY - minY);
      const ctx = ctx2d(c);
      if (t.lifted) ctx.drawImage(base.canvas, base.x - minX, base.y - minY);
      ctx.drawImage(out.canvas, out.x - minX, out.y - minY);
      store.overrides.set(t.layerId, { canvas: c, x: minX, y: minY });
    }
  } else {
    store.overrides.set(t.layerId, renderTransformed(t));
  }
  touch(store.overrides.get(t.layerId)!.canvas);
  store.requestRender();
}

export function commitTransform() {
  const t = store.state.transform;
  const doc = store.doc;
  if (!t || !doc) return;
  const layer = doc.layers.find((l) => l.id === t.layerId);
  store.overrides.delete(t.layerId);
  store.state.transform = null;
  if (!layer) return store.emit();
  if (t.multi) {
    for (const id of t.multi) store.overrides.delete(id);
    // Each layer (and its mask) goes through the same transform, in the shared box
    const box = { x: t.sx, y: t.sy, w: t.source.width, h: t.source.height };
    const through = (c: HTMLCanvasElement, x: number, y: number) => {
      const placed = createCanvas(box.w, box.h);
      ctx2d(placed).drawImage(c, x - box.x, y - box.y);
      const out = renderTransformed({ ...t, source: placed });
      // Trim to the layer's own content (the shared box is mostly empty for each layer)
      const ab = alphaBounds(out.canvas);
      if (!ab) return { canvas: createCanvas(1, 1), x: out.x, y: out.y };
      const trimmed = createCanvas(ab.width, ab.height);
      ctx2d(trimmed).drawImage(out.canvas, -ab.x, -ab.y);
      return { canvas: trimmed, x: out.x + ab.x, y: out.y + ab.y };
    };
    const ids = new Set(t.multi);
    const layers = doc.layers.map((l) => {
      if (!ids.has(l.id)) return l;
      const r = l.kind === 'raster' ? withLayer(l, { smart: undefined }) : rasterizeLayer(l);
      if (!r.canvas) return l;
      const out = through(r.canvas, r.x, r.y);
      const patch: Partial<Layer> = { canvas: out.canvas, x: out.x, y: out.y, width: out.canvas.width, height: out.canvas.height };
      if (r.mask) {
        const m = through(r.mask.canvas, r.mask.x, r.mask.y);
        patch.mask = { ...r.mask, canvas: m.canvas, x: m.x, y: m.y };
      }
      return withLayer(r, patch);
    });
    store.invalidateRender();
    store.commit(isGroup(layer) ? 'Transform Group' : `Transform ${t.multi.length} Layers`, { layers, selection: null }, { icon: 'transform' });
    return;
  }
  if (layer.smart) {
    const cx = t.sx + t.source.width / 2 + t.tx;
    const cy = t.sy + t.source.height / 2 + t.ty;
    const smart = {
      ...layer.smart,
      scaleX: t.scaleX,
      scaleY: t.scaleY,
      angle: t.angle,
      ax: cx - layer.x,
      ay: cy - layer.y,
      quad: t.quad?.map((p) => ({ x: p.x - layer.x, y: p.y - layer.y })),
      mesh: t.mesh?.map((p) => ({ x: p.x - layer.x, y: p.y - layer.y })),
    };
    store.invalidateRender();
    store.commit('Transform Smart Object', { layers: store.replaceLayer(rerenderSmart(layer, smart), doc.layers) }, { icon: 'transform' });
    return;
  }
  let next: Layer;
  // Scale and rotate keep text and shapes live; skew / distort / warp turn them into pixels
  const live = ((layer.kind === 'text' && layer.text) || layer.kind === 'shape') && !t.quad && !t.mesh;
  if (live) {
    // New size, the centre carried through the transform, and the added rotation
    const c = transformMatrix(t).transformPoint(new DOMPoint(layer.x + layer.width / 2, layer.y + layer.height / 2));
    const deg = (((((layer.rotation ?? 0) + (t.angle * 180) / Math.PI + 180) % 360) + 360) % 360) - 180;
    let sized: Layer;
    if (layer.kind === 'text' && layer.text) {
      const k = Math.abs(t.scaleY);
      const tx = layer.text;
      const text = { ...tx, size: Math.max(1, tx.size * k), tracking: tx.tracking * k, stroke: tx.stroke * k, boxWidth: tx.boxWidth ? Math.max(8, Math.round(tx.boxWidth * Math.abs(t.scaleX))) : undefined };
      const tmp = withLayer(layer, { text });
      sized = withLayer(tmp, syncTextBounds(tmp));
    } else sized = withLayer(layer, { width: layer.width * Math.abs(t.scaleX), height: layer.height * Math.abs(t.scaleY) });
    next = withLayer(sized, { x: c.x - sized.width / 2, y: c.y - sized.height / 2, rotation: Math.abs(deg) < 1e-6 ? undefined : Math.round(deg * 100) / 100 });
  } else {
    const r = rasterizeLayer(layer);
    const out = renderTransformed(t);
    const base = r.canvas!;
    const minX = Math.min(r.x, out.x);
    const minY = Math.min(r.y, out.y);
    const maxX = Math.max(r.x + base.width, out.x + out.canvas.width);
    const maxY = Math.max(r.y + base.height, out.y + out.canvas.height);
    const c = createCanvas(maxX - minX, maxY - minY);
    const ctx = ctx2d(c);
    // Remaining (unselected) pixels stay; the whole-layer case starts from empty
    if (t.lifted) ctx.drawImage(base, r.x - minX, r.y - minY);
    ctx.drawImage(out.canvas, out.x - minX, out.y - minY);
    next = withLayer(r, { canvas: c, x: minX, y: minY, width: c.width, height: c.height });
  }
  store.invalidateRender();
  store.commit('Free Transform', { layers: store.replaceLayer(next, doc.layers), selection: null }, { icon: 'transform' });
}

export function cancelTransform() {
  if (!store.state.transform) return;
  store.cancelModes();
  store.revert();
}

// ================================================================ filters

export function applyFilterToLayer(layer: Layer, selection: Selection | null, filterId: string, params: Record<string, number>): HTMLCanvasElement | null {
  const f = filterById(filterId);
  if (!f || !layer.canvas) return null;
  const img = ctx2d(layer.canvas).getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  f.apply(img, params);
  return finishFilter(layer, selection, img);
}

/** Same as applyFilterToLayer, with the pixel work in a background worker. */
export async function applyFilterToLayerAsync(layer: Layer, selection: Selection | null, filterId: string, params: Record<string, number>): Promise<HTMLCanvasElement | null> {
  if (!filterById(filterId) || !layer.canvas) return null;
  const img = ctx2d(layer.canvas).getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  return finishFilter(layer, selection, await applyFilterOffThread(filterId, img, params));
}

/** Puts filtered pixels on a new canvas, limited to the selection when there is one. */
function finishFilter(layer: Layer, selection: Selection | null, img: ImageData): HTMLCanvasElement {
  const src = layer.canvas!;
  const filtered = createCanvas(src.width, src.height);
  ctx2d(filtered).putImageData(img, 0, 0);
  if (!selection) return filtered;
  const out = cloneCanvas(src);
  const tmp = createCanvas(src.width, src.height);
  const t = ctx2d(tmp);
  t.drawImage(filtered, 0, 0);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(selection.canvas, -layer.x, -layer.y);
  const octx = ctx2d(out);
  octx.globalCompositeOperation = 'destination-out';
  octx.drawImage(selection.canvas, -layer.x, -layer.y);
  octx.globalCompositeOperation = 'source-over';
  octx.drawImage(tmp, 0, 0);
  return out;
}

/** The last filter applied, so it can be repeated with the same settings. */
export let lastFilter: { id: string; params: Record<string, number> } | null = null;

/** Resolves once the filter has been applied, so Actions and Repeat can run the next step on its result. */
export async function commitFilter(filterId: string, params: Record<string, number>): Promise<void> {
  const doc = need();
  const layer = store.activeLayer;
  store.overrides.clear();
  if (!doc || !layer) return;
  const f = filterById(filterId);
  const name = f ? f.name : 'Filter';
  if (layer.smart && !doc.selection) {
    lastFilter = { id: filterId, params: { ...params } };
    record({ kind: 'filter', id: filterId, params: { ...params }, label: name });
    setSmartFilters(layer.id, [...layer.smart.filters, { id: filterId, params: { ...params }, enabled: true }], `Smart Filter: ${name}`);
    return;
  }
  // 16 / 32 bits: these filters work on the layer's buffer in float (no 8-bit rounding)
  const floatNext = (doc.depth ?? 8) > 8 && FLOAT_FILTERS.has(filterId) && layer.kind === 'raster' && layer.pixels && layer.canvas && !layer.smart ? floatFilter(layer.pixels, filterId, params) : null;
  if (floatNext && layer.pixels) {
    let next = floatNext;
    if (doc.selection) next = limitToSelection(layer.pixels, next, doc.selection.canvas, Math.round(layer.x), Math.round(layer.y));
    lastFilter = { id: filterId, params: { ...params } };
    record({ kind: 'filter', id: filterId, params: { ...params }, label: name });
    store.invalidateRender();
    store.commit(name, { layers: store.replaceLayer(withBuffer(layer, next)) }, { icon: 'filter' });
    return;
  }
  const finish = (out: HTMLCanvasElement | null) => {
    if (!out) return;
    lastFilter = { id: filterId, params: { ...params } };
    record({ kind: 'filter', id: filterId, params: { ...params }, label: name });
    store.invalidateRender();
    store.commit(name, { layers: store.replaceLayer(withLayer(layer, { canvas: out })) }, { icon: 'filter' });
  };
  // Big layers filter in a background worker behind the busy spinner, so the window stays responsive
  if (layer.canvas && layer.canvas.width * layer.canvas.height > 500_000) {
    await store.task(name, async () => {
      const out = await applyFilterToLayerAsync(layer, doc.selection, filterId, params);
      // If the layer changed while the filter ran, its result is stale: drop it rather than undo that edit
      if (store.doc !== doc || !doc.layers.includes(layer)) return store.toast(`${name} skipped: the layer changed while it ran`, 'error');
      finish(out);
    });
  } else {
    finish(applyFilterToLayer(layer, doc.selection, filterId, params));
  }
}

// ================================================================ smart objects

/** Layer ▸ Convert to Smart Object: pixel, text and shape layers, or a whole group. */
export function convertToSmartObject() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  if (layer.smart) return store.toast('This layer is already a Smart Object');
  if (layer.kind === 'adjustment') return store.toast('Adjustment layers cannot become Smart Objects', 'error');
  let pixels: { canvas: HTMLCanvasElement; x: number; y: number } | null;
  let replaceIds = new Set([layer.id]);
  if (isGroup(layer)) {
    // Flatten the group's contents (its own opacity, mask and style stay on the new layer)
    const block = blockOf(doc.layers, layer);
    replaceIds = new Set(block.map((l) => l.id));
    pixels = { canvas: renderLayers(doc, block.filter((l) => l.id !== layer.id).map((l) => (l.parent === layer.id ? withLayer(l, { parent: undefined }) : l))), x: 0, y: 0 };
  } else {
    const surf = layerSurface(layer);
    pixels = surf && { canvas: surf.canvas, x: surf.x, y: surf.y };
  }
  const patch = pixels && smartFromPixels(pixels.canvas, pixels.x, pixels.y);
  if (!patch) return store.toast('Layer is empty');
  const smartLayer = withLayer(layer, { ...patch, kind: 'raster', text: undefined, shape: undefined, collapsed: undefined });
  const layers = doc.layers.flatMap((l) => (l.id === layer.id ? [smartLayer] : replaceIds.has(l.id) ? [] : [l]));
  store.commit('Convert to Smart Object', { layers, activeId: layer.id }, { icon: 'layer' });
}

export function setSmartFilters(layerId: string, filters: SmartFilter[], label: string) {
  const doc = need();
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || !layer?.smart) return;
  store.invalidateRender();
  store.commit(label, { layers: store.replaceLayer(rerenderSmart(layer, { ...layer.smart, filters })) }, { icon: 'filter' });
}

/** Layer ▸ Smart Object ▸ Replace Contents: new pixels, same size, transform and filters. */
export async function replaceSmartContents(file: Blob) {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer?.smart) return store.toast('Select a Smart Object first');
  const { fileToCanvas } = await import('./io');
  const img = await fileToCanvas(file, workingSpace());
  store.invalidateRender();
  store.commit('Replace Contents', { layers: store.replaceLayer(replaceSmartSource(layer, img)) }, { icon: 'layer' });
}

// ================================================================ histogram

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
  max: number;
}

export function histogramOf(source: HTMLCanvasElement): Histogram {
  const s = Math.min(1, 360 / Math.max(source.width, source.height));
  const c = createCanvas(source.width * s, source.height * s);
  const ctx = ctx2d(c);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const h: Histogram = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), max: 1 };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    h.r[d[i]]++;
    h.g[d[i + 1]]++;
    h.b[d[i + 2]]++;
    h.l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
  }
  // Ignore the extreme bins when scaling so clipped images still read well
  for (let i = 1; i < 255; i++) h.max = Math.max(h.max, h.r[i], h.g[i], h.b[i]);
  return h;
}

// ================================================================ frequency separation

/**
 * Frequency Separation: splits active layer into Low Frequency (tones/color) and High Frequency (texture).
 * High frequency layer uses linear-light blend mode with (original - low) + 128 offset math.
 */
export function applyFrequencySeparation(blurRadius = 3) {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer || !layer.canvas) return store.toast('Select a pixel layer first', 'error');

  const w = layer.canvas.width;
  const h = layer.canvas.height;

  // 1. Low frequency: blurred copy
  const lowCanvas = createCanvas(w, h);
  const lowCtx = ctx2d(lowCanvas);
  lowCtx.drawImage(layer.canvas, 0, 0);
  const lowImg = lowCtx.getImageData(0, 0, w, h);
  blurImageData(lowImg, blurRadius);
  // Keep the original coverage: the blur averages colour from covered pixels only, never fading the edges
  const srcAlpha = ctx2d(layer.canvas).getImageData(0, 0, w, h).data;
  for (let i = 3; i < lowImg.data.length; i += 4) lowImg.data[i] = srcAlpha[i];
  lowCtx.putImageData(lowImg, 0, 0);

  // 2. High frequency: (original − low) / 2 + 128, so Linear Light (low + 2·high − 1) gives back the original
  const origImg = ctx2d(layer.canvas).getImageData(0, 0, w, h);
  const highCanvas = createCanvas(w, h);
  const highCtx = ctx2d(highCanvas);
  const highImg = highCtx.createImageData(w, h);
  const oData = origImg.data;
  const lData = lowImg.data;
  const hData = highImg.data;

  for (let i = 0; i < oData.length; i += 4) {
    hData[i] = Math.max(0, Math.min(255, Math.round((oData[i] - lData[i]) / 2 + 128)));
    hData[i + 1] = Math.max(0, Math.min(255, Math.round((oData[i + 1] - lData[i + 1]) / 2 + 128)));
    hData[i + 2] = Math.max(0, Math.min(255, Math.round((oData[i + 2] - lData[i + 2]) / 2 + 128)));
    hData[i + 3] = oData[i + 3];
  }
  highCtx.putImageData(highImg, 0, 0);

  // 3. Create Group and Layers
  const group = makeLayer({
    kind: 'group',
    name: 'Frequency Separation',
    x: layer.x,
    y: layer.y,
    width: w,
    height: h,
  });

  const lowLayer = makeLayer({
    kind: 'raster',
    name: 'Low Frequency (Color/Tone)',
    canvas: lowCanvas,
    x: layer.x,
    y: layer.y,
    width: w,
    height: h,
    parent: group.id,
  });

  const highLayer = makeLayer({
    kind: 'raster',
    name: 'High Frequency (Texture)',
    canvas: highCanvas,
    x: layer.x,
    y: layer.y,
    width: w,
    height: h,
    blend: 'linear-light',
    parent: group.id,
  });

  const idx = doc.layers.findIndex((l) => l.id === layer.id);
  const nextLayers = [...doc.layers];
  // Children sit directly below their group in the layer array
  nextLayers.splice(idx, 1, lowLayer, highLayer, group);

  store.commit('Frequency Separation', {
    layers: nextLayers,
    activeId: highLayer.id,
  }, { icon: 'filter' });
  store.toast('Frequency Separation applied', 'success');
}

// ================================================================ Sky Replacement

/**
 * Edit ▸ Sky Replacement: the sky (the selection when there is one, else the one Select Sky finds)
 * replaced by a pass-through "Sky Replacement" group above the top-level active layer: the new sky
 * masked to the old one, and a soft-light Foreground Lighting layer (pass-through lets the soft light
 * reach the photo below the group). Nothing below is changed; one undo step.
 */
export async function replaceSky(o: import('./skyReplace').SkyOptions) {
  const doc = need();
  if (!doc) return;
  await store.task('Replacing the sky', async () => {
    const sky = await import('./skyReplace');
    const { docImage, selectionAlpha } = await import('./smartSelect');
    const w = doc.width;
    const h = doc.height;
    let alpha: Float32Array | null = null;
    const sel = selectionAlpha();
    if (sel) alpha = Float32Array.from(sel, (v) => v / 255);
    else {
      const img = docImage(true);
      const { selectSky } = await import('./segment');
      const r = img && selectSky(img);
      if (r) alpha = sky.alphaFromRegion(r, w, h);
    }
    if (!alpha || !alpha.some((v) => v > 0.5)) {
      store.toast('No sky found: select the sky first (Select ▸ Sky, or a marquee) and try again', 'error');
      return;
    }
    const parts = sky.buildSky(alpha, w, h, o);
    const group = makeLayer({ kind: 'group', name: 'Sky Replacement', blend: 'pass-through', x: 0, y: 0, width: w, height: h });
    const skyLayer = makeLayer({
      kind: 'raster',
      name: 'Sky',
      parent: group.id,
      canvas: parts.sky,
      x: 0,
      y: 0,
      width: w,
      height: h,
      mask: { canvas: sky.maskCanvas(parts.mask, w, h), x: 0, y: 0, enabled: true },
    });
    const light = makeLayer({ kind: 'raster', name: 'Foreground Lighting', canvas: parts.light, x: 0, y: 0, width: w, height: h, blend: 'soft-light', opacity: o.lighting / 100, parent: group.id });
    // Above the active layer when it's top-level (the photo), else at the top
    const active = doc.layers.find((l) => l.id === doc.activeId);
    const at = active && !active.parent ? doc.layers.indexOf(active) + 1 : doc.layers.length;
    const layers = [...doc.layers];
    layers.splice(at, 0, skyLayer, light, group); // Children sit directly below their group
    store.commit('Sky Replacement', { layers, activeId: skyLayer.id, selection: null }, { icon: 'layer' });
    store.toast('Sky replaced · the Sky layer has a mask you can paint; Foreground Lighting is a soft-light layer', 'success');
  });
}

// ================================================================ Smart AI & Designer Superpowers

/** One-click cutout from the Move tool bar: the AI subject cutout as a new, edge-cleaned layer. */
export async function removeBackgroundActiveLayer() {
  const { cutOutSubject } = await import('./smartSelect');
  await cutOutSubject();
}

export async function selectSubjectActiveLayer() {
  const { selectSubject } = await import('./smartSelect');
  await selectSubject();
}

export async function harmonizeActiveLayerWithBackground() {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer || !layer.canvas) {
    store.toast('Select a foreground layer to harmonize tone', 'info');
    return;
  }
  const idx = doc.layers.findIndex((l) => l.id === layer.id);
  const bgLayer = doc.layers.slice(0, idx).reverse().find((l) => l.canvas && l.visible);
  if (!bgLayer?.canvas) {
    store.toast('No background layer found below to match colors with', 'info');
    return;
  }
  const harmonized = await store.task('Harmonizing Tone', () => harmonizeLayerColor(layer.canvas!, bgLayer.canvas!, 0.85));
  if (!harmonized) return;
  const updated = withLayer(layer, { canvas: harmonized });
  store.commit('Harmonize Color Tone', {
    layers: doc.layers.map((l) => (l.id === layer.id ? updated : l)),
  }, { icon: 'adjust' });
  store.toast('Subject tone harmonized with background', 'success');
}

export async function createMockupFromActiveLayer(presetId: MockupPresetId = 'iphone-16-pro') {
  const doc = need();
  const layer = store.activeLayer;
  if (!doc || !layer) return;
  const src = layer.canvas ? layer.canvas : store.docPixels();
  const mockupCanvas = await store.task('Generating Mockup', () => renderMockup(src, presetId));
  if (!mockupCanvas) return;
  const newDoc = newDocument(mockupCanvas.width, mockupCanvas.height, 'transparent', `${doc.title} - ${presetId} Mockup`);
  if (newDoc) {
    const mockupLayer = makeLayer({
      kind: 'raster',
      name: `${presetId} Mockup`,
      canvas: mockupCanvas,
      width: mockupCanvas.width,
      height: mockupCanvas.height,
    });
    store.commit('Add Mockup', { layers: [mockupLayer], activeId: mockupLayer.id });
  }
  store.toast(`Generated ${presetId} Mockup in new tab!`, 'success');
}

export { MOCKUP_PRESETS };


