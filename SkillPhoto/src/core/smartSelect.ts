// App glue for the smart selection engine (segment.ts + matte.ts): reads the picture, runs a pipeline,
// and turns the result into a selection, a layer mask or a cut-out layer.

import { createCanvas, ctx2d, touch } from './canvas';
import { layerSurface, renderDocument } from './render';
import * as sel from './selection';
import type { SelOp } from './selection';
import { store } from './store';
import { makeLayer, withLayer } from './types';
import type { Rect } from './types';
import * as seg from './segment';
import type { Dab, RegionMask } from './segment';
import type { RGBA } from './matte';
import type { CutoutResult, Prior } from './cutout';
import { runCutout } from './cutoutThread';
import { subjectPrior, warmUp } from './aiModels';

export { warmUp as warmUpAI };

/** What the selection tools look at: the whole visible image, or only the active layer. */
export function docImage(sampleAll = store.state.opts.sampleAll): RGBA | null {
  const doc = store.doc;
  if (!doc) return null;
  const c = createCanvas(doc.width, doc.height);
  const layer = store.activeLayer;
  const surf = !sampleAll && layer ? layerSurface(layer) : null;
  if (surf) ctx2d(c).drawImage(surf.canvas, surf.x, surf.y);
  else renderDocument(doc, c);
  const d = ctx2d(c).getImageData(0, 0, doc.width, doc.height);
  return { data: d.data, w: doc.width, h: doc.height };
}

/** Current selection strength per pixel (0..255), or null. */
export function selectionAlpha(): Uint8Array | null {
  const doc = store.doc;
  if (!doc?.selection) return null;
  const d = ctx2d(doc.selection.canvas).getImageData(0, 0, doc.width, doc.height).data;
  const out = new Uint8Array(doc.width * doc.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/** White canvas with the region's alpha, positioned at its roi. */
export function regionCanvas(r: RegionMask): HTMLCanvasElement {
  const c = createCanvas(r.roi.w, r.roi.h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(r.roi.w, r.roi.h);
  for (let i = 0; i < r.alpha.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, r.alpha[i])) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Doc-sized selection canvas from a region (nothing outside the roi). */
export function regionToDocCanvas(r: RegionMask): HTMLCanvasElement {
  const doc = store.doc!;
  const c = createCanvas(doc.width, doc.height);
  ctx2d(c).drawImage(regionCanvas(r), r.roi.x, r.roi.y);
  return c;
}

/** Doc-sized canvas from a full-size alpha array. */
export function alphaToCanvas(alpha: Float32Array, w: number, h: number): HTMLCanvasElement {
  return regionCanvas({ roi: { x: 0, y: 0, w, h }, alpha });
}

function apply(r: RegionMask | null, op: SelOp, label: string, empty: string, docId?: string) {
  const doc = store.doc;
  if (!doc) return false;
  // The picture changed tabs (or closed) while the cut ran: the result belongs to another document
  if (docId && doc.id !== docId) return false;
  if (!r || !r.alpha.some((v) => v >= 0.5)) {
    store.toast(empty, 'info');
    return false;
  }
  store.setSelection(sel.combine(doc.selection, regionToDocCanvas(r), op), label);
  return true;
}

/**
 * The subject of the picture as a clean matte: the on-device models say what the subject is, cutout.ts
 * snaps it to the real full-resolution edge (in a worker). Falls back to the classic saliency engine.
 * `pixels` also returns edge-cleaned cut-out colours.
 */
export async function findSubject(img: RGBA, pixels = false): Promise<CutoutResult | null> {
  const roi = { x: 0, y: 0, w: img.w, h: img.h };
  // A cut-out layer is selected by its own alpha
  let clear = 0;
  for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] < 16) clear++;
  if (clear > img.w * img.h * 0.05) {
    const alpha = new Float32Array(img.w * img.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3] / 255;
    return { region: { roi, alpha }, pixels: pixels ? Uint8ClampedArray.from(img.data) : undefined };
  }
  const ai = await subjectPrior(img, roi, true);
  if (ai) {
    const r = await runCutout({ kind: 'prior', img, roi, prior: ai.prior, opts: { edge: ai.portrait ? 'hair' : 'crisp', pixels } });
    if (r) return r;
  }
  return runCutout({ kind: 'classic', img, pixels });
}

export async function selectSubject(op: SelOp = 'replace') {
  const img = docImage();
  if (!img) return;
  const id = store.doc!.id;
  const r = await store.task('Finding the subject', () => findSubject(img));
  if (apply(r?.region ?? null, op, 'Select Subject', 'No clear subject found — try Object Selection around it', id)) store.toast('Subject selected · ⌥⌘R to refine the edge', 'success');
}

export async function selectSky(op: SelOp = 'replace') {
  const img = docImage();
  if (!img) return;
  const r = await store.task('Finding the sky', () => seg.selectSky(img));
  apply(r ?? null, op, 'Select Sky', 'No sky found at the top of this picture');
}

/** Object Selection inside a box (doc coordinates): the object the box was drawn around. */
export async function findObjectInBox(img: RGBA, box: seg.Box): Promise<RegionMask | null> {
  const bx = seg.clampBox(box, img);
  const padX = Math.max(8, Math.round(bx.w * 0.08));
  const padY = Math.max(8, Math.round(bx.h * 0.08));
  const roi = seg.clampBox({ x: bx.x - padX, y: bx.y - padY, w: bx.w + padX * 2, h: bx.h + padY * 2 }, img);
  const ai = await subjectPrior(img, roi, false);
  if (ai) {
    // Nothing outside the box belongs to the object
    const { p, w, h } = ai.prior;
    const masked = new Float32Array(p.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = roi.x + ((x + 0.5) / w) * roi.w, dy = roi.y + ((y + 0.5) / h) * roi.h;
        const inside = dx >= bx.x && dx <= bx.x + bx.w && dy >= bx.y && dy <= bx.y + bx.h;
        masked[y * w + x] = inside ? p[y * w + x] : 0;
      }
    const prior: Prior = { p: masked, w, h };
    const r = await runCutout({ kind: 'prior', img, roi, prior, opts: { edge: 'crisp', keepAll: true } });
    if (r) return r.region;
  }
  return (await runCutout({ kind: 'classic', img, box: bx }))?.region ?? null;
}

/** Click-to-select: the object under the point. */
export async function findObjectAt(img: RGBA, x: number, y: number): Promise<RegionMask | null> {
  const roi = { x: 0, y: 0, w: img.w, h: img.h };
  const ai = await subjectPrior(img, roi, true);
  if (ai) {
    const r = await runCutout({ kind: 'prior', img, roi, prior: ai.prior, opts: { edge: ai.portrait ? 'hair' : 'crisp', seed: { x, y }, keepAll: true } });
    if (r) return r.region;
  }
  return (await runCutout({ kind: 'classic', img, at: { x, y } }))?.region ?? null;
}

/** Object Selection tool: a box around the object, or a click on it. */
export async function selectObject(box: Rect | null, at: { x: number; y: number } | null, op: SelOp) {
  const img = docImage();
  if (!img) return;
  const id = store.doc!.id;
  const r = await store.task('Selecting object', () =>
    box && box.width >= 4 && box.height >= 4 ? findObjectInBox(img, { x: box.x, y: box.y, w: box.width, h: box.height }) : at ? findObjectAt(img, at.x, at.y) : null
  );
  apply(r ?? null, op, 'Object Selection', 'No object found there — drag a box around it', id);
}

/** Edge-snapping Quick Selection result for a finished stroke. */
export function quickStroke(img: RGBA, base: Uint8Array | null, dabs: Dab[], subtract: boolean): RegionMask | null {
  return seg.strokeCut(img, base, dabs, subtract ? 'sub' : 'add');
}

/** Merges a stroke result into a selection canvas: union when adding, replace-in-region when subtracting. */
export function mergeRegion(target: HTMLCanvasElement, r: RegionMask, subtract: boolean) {
  const ctx = ctx2d(target);
  const rc = regionCanvas(r);
  if (subtract) {
    // The region already holds "old selection minus the removed part"
    ctx.clearRect(r.roi.x, r.roi.y, r.roi.w, r.roi.h);
  }
  ctx.drawImage(rc, r.roi.x, r.roi.y);
  touch(target);
}

export type RangeKind = 'skin' | 'highlights' | 'midtones' | 'shadows';
export const RANGE_LABELS: Record<RangeKind, string> = { skin: 'Skin Tones', highlights: 'Highlights', midtones: 'Midtones', shadows: 'Shadows' };

export async function selectRange(kind: RangeKind, fuzz = 0.5, op: SelOp = 'replace') {
  const img = docImage(true);
  const doc = store.doc;
  if (!img || !doc) return;
  const a = await store.task(`Selecting ${RANGE_LABELS[kind].toLowerCase()}`, () => seg.rangeMask(img, kind, fuzz));
  if (!a) return;
  apply({ roi: { x: 0, y: 0, w: img.w, h: img.h }, alpha: a }, op, `Color Range · ${RANGE_LABELS[kind]}`, `No ${RANGE_LABELS[kind].toLowerCase()} found`);
}

/**
 * Remove Background, non-destructively: finds the subject (on-device AI + full-resolution edge snap,
 * hair-aware for people) and puts the matte in a layer mask on the active layer, so nothing is lost
 * and the mask can be painted or refined.
 */
export async function removeBackground() {
  const doc = store.doc;
  const layer = store.activeLayer;
  if (!doc || !layer || layer.kind === 'adjustment' || layer.kind === 'group') return store.toast('Pick an image layer first', 'info');
  const img = docImage(false);
  if (!img) return;
  const r = await store.task('Removing background', () => findSubject(img));
  if (!r || store.doc?.id !== doc.id) return;
  const full = new Float32Array(img.w * img.h);
  const { roi, alpha } = r.region;
  for (let y = 0; y < roi.h; y++) full.set(alpha.subarray(y * roi.w, (y + 1) * roi.w), (y + roi.y) * img.w + roi.x);
  if (!full.some((v) => v >= 0.5)) return store.toast('No clear subject found', 'info');
  const canvas = alphaToCanvas(full, img.w, img.h);
  const next = withLayer(layer, { mask: { canvas, x: 0, y: 0, enabled: true } });
  store.commit('Remove Background', { layers: store.replaceLayer(next) }, { icon: 'mask' });
  store.toast('Background hidden with a layer mask · paint the mask or ⌥⌘R to refine', 'success');
}

/** Remove Background as a new, colour-cleaned cut-out layer (no halo of the old background). */
export async function cutOutSubject() {
  const doc = store.doc;
  const layer = store.activeLayer;
  if (!doc || !layer || layer.kind === 'adjustment' || layer.kind === 'group') return store.toast('Pick an image layer first', 'info');
  const img = docImage(false);
  if (!img) return;
  const r = await store.task('Cutting out the subject', () => findSubject(img, true));
  if (store.doc?.id !== doc.id) return;
  if (!r?.pixels || !r.region.alpha.some((v) => v >= 0.5)) return store.toast('No clear subject found', 'info');
  const c = createCanvas(img.w, img.h);
  const ctx = ctx2d(c);
  const id = ctx.createImageData(img.w, img.h);
  id.data.set(r.pixels);
  ctx.putImageData(id, 0, 0);
  const nl = makeLayer({ kind: 'raster', name: `${layer.name} · Cutout`, canvas: c, x: 0, y: 0, width: doc.width, height: doc.height });
  const idx = doc.layers.findIndex((l) => l.id === layer.id);
  const layers = [...doc.layers];
  layers.splice(idx + 1, 0, nl);
  store.commit('Cut Out Subject', { layers: layers.map((l) => (l.id === layer.id ? withLayer(l, { visible: false }) : l)), activeId: nl.id }, { icon: 'layer' });
  store.toast('Subject cut out to a new layer (edge colours cleaned) · original hidden below', 'success');
}

/** Output targets shared by Select and Mask. */
export type MaskOutput = 'selection' | 'mask' | 'layer' | 'layer-mask';

/** Sends a finished alpha (doc size) and optional decontaminated pixels to the chosen output. */
export function outputMask(alpha: Float32Array, out: MaskOutput, pixels: Uint8ClampedArray | null) {
  const doc = store.doc;
  if (!doc) return;
  const canvas = alphaToCanvas(alpha, doc.width, doc.height);
  const layer = store.activeLayer;
  if (out === 'selection' || !layer) {
    store.setSelection(sel.selectionFromCanvas(canvas), 'Select and Mask');
    return;
  }
  if (out === 'mask') {
    if (layer.kind === 'group') return store.toast('Pick a layer to mask', 'info');
    store.commit('Select and Mask', { layers: store.replaceLayer(withLayer(layer, { mask: { canvas, x: 0, y: 0, enabled: true } })), selection: null }, { icon: 'mask' });
    return;
  }
  // New layer: the refined pixels (decontaminated when asked), cut out or masked
  const px = createCanvas(doc.width, doc.height);
  const pctx = ctx2d(px);
  if (pixels) {
    const id = pctx.createImageData(doc.width, doc.height);
    id.data.set(pixels);
    if (out === 'layer-mask') for (let i = 0; i < alpha.length; i++) id.data[i * 4 + 3] = 255;
    pctx.putImageData(id, 0, 0);
  } else {
    const src = docImage();
    if (src) {
      const id = pctx.createImageData(doc.width, doc.height);
      id.data.set(src.data);
      if (out === 'layer') for (let i = 0; i < alpha.length; i++) id.data[i * 4 + 3] = Math.round(id.data[i * 4 + 3] * alpha[i]);
      pctx.putImageData(id, 0, 0);
    }
  }
  const nl = makeLayer({
    kind: 'raster',
    name: out === 'layer' ? 'Cutout' : 'Masked Cutout',
    canvas: px,
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
    ...(out === 'layer-mask' ? { mask: { canvas, x: 0, y: 0, enabled: true } } : {}),
  });
  const idx = doc.layers.findIndex((l) => l.id === layer.id);
  const layers = [...doc.layers];
  layers.splice(idx + 1, 0, nl);
  store.commit('Select and Mask', { layers, activeId: nl.id, selection: null }, { icon: 'layer' });
}
