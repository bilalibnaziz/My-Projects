// Social studio (ported from Skill Vector's studio/socialKit.ts, reworked for one canvas per document):
// one design → every platform size as new documents, seamless carousels exported as slides, profile-grid
// splits in posting order, and a phone-legibility check.

import { store } from './store';
import type { Doc, Layer, Rect } from './types';
import { makeLayer } from './types';
import { DOC_PRESETS, safeZoneFor } from './social';
import { GRID_COLORS, materialize } from './grids';
import { layerBounds } from './align';
import { blockOf } from './groups';
import { cloneCanvas, createCanvas, ctx2d, canvasToBlob } from './canvas';
import { mappedLayer, selectionFrame } from './objectTransform';
import { renderDocument } from './render';
import { planLayout, targetFrame } from './magicResize';
import type { Item, Mode } from './magicResize';

export const PLATFORM_SIZES = DOC_PRESETS.filter((p) => p.category === 'Social' || p.id === 'reel' || p.id === 'yt-thumb' || p.id === 'yt-banner');

/** Quick set most posts need. */
export const CORE_PLATFORMS = ['ig-portrait', 'ig-square', 'ig-story', 'fb-post', 'x-post', 'li-post', 'pin', 'yt-thumb'];

/** Deep copy of layers (and everything inside groups) with fresh ids. */
export function cloneBlocks(all: Layer[], tops: Layer[]): Layer[] {
  const ids = new Map<string, string>();
  const out: Layer[] = [];
  for (const top of tops) {
    for (const l of blockOf(all, top)) {
      const c = makeLayer({
        ...l,
        canvas: l.canvas ? cloneCanvas(l.canvas) : undefined,
        mask: l.mask ? { ...l.mask, canvas: cloneCanvas(l.mask.canvas) } : undefined,
        adjust: l.adjust ? structuredClone(l.adjust) : undefined,
      });
      ids.set(l.id, c.id);
      out.push(c);
    }
  }
  return out.map((c) => (c.parent && ids.has(c.parent) ? { ...c, parent: ids.get(c.parent) } : c));
}

/** Maps layers with a uniform scale `s` about `from`'s origin, then shifts by (dx, dy). Pixels are resampled; shapes and text stay live. */
export function mapLayers(layers: Layer[], from: Rect, s: number, dx = 0, dy = 0): Layer[] {
  return mapLayersXY(layers, s, s, dx - from.x * s, dy - from.y * s);
}

/** Maps layers by p → (dx + p.x·sx, dy + p.y·sy). Shapes stretch; text and pixels scale uniformly by the axis that changed most. */
export function mapLayersXY(layers: Layer[], sx: number, sy: number, dx: number, dy: number): Layer[] {
  const leaves = layers.filter((l) => l.kind !== 'group');
  const b = union(leaves.map((l) => layerBounds(l)).filter((r): r is Rect => !!r)) ?? { x: 0, y: 0, width: 1, height: 1 };
  const frame = selectionFrame(leaves) ?? { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, angle: 0 };
  const map = { apply: (p: { x: number; y: number }) => ({ x: dx + p.x * sx, y: dy + p.y * sy }), da: 0, sx, sy, axis: 0, frame };
  return layers.map((l) => (l.kind === 'group' || l.kind === 'adjustment' ? l : mappedLayer(l, map as Parameters<typeof mappedLayer>[1], true).layer));
}

const union = (rs: Rect[]): Rect | null =>
  rs.length
    ? rs.reduce((a, b) => {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
      })
    : null;

/** The top-level layers of a design as layout items (see magicResize.ts). */
export function layoutItems(doc: Pick<Doc, 'layers'>): Item[] {
  const tops = doc.layers.filter((l) => !l.parent);
  const items: Item[] = [];
  for (const l of tops) {
    const bounds = layerBounds(l);
    if (!bounds && l.kind !== 'adjustment') continue;
    const block = blockOf(doc.layers, l);
    items.push({
      id: l.id,
      bounds: bounds ?? { x: 0, y: 0, width: 1, height: 1 },
      adjustment: l.kind === 'adjustment',
      text: block.some((k) => k.kind === 'text'),
      shape: l.kind === 'shape',
    });
  }
  return items;
}

/**
 * Lays a document's layers out on a w×h canvas so it reads as made for that size (magicResize.ts):
 * backgrounds cover, edge bands stretch, logos stay in their corner of the platform's safe zone, and
 * text and visuals re-flow side by side (wide) or stacked (tall). Text and shapes stay editable.
 */
export function adaptLayers(doc: Pick<Doc, 'width' | 'height' | 'layers'>, w: number, h: number, zone = safeZoneFor(w, h)): Layer[] {
  const tops = doc.layers.filter((l) => !l.parent);
  const plan = planLayout(layoutItems(doc), doc.width, doc.height, targetFrame(w, h, zone));
  const byId = new Map(plan.places.map((p) => [p.id, p]));
  const out: Layer[] = [];
  // Keep the original stacking order; layers with no bounds (empty) are dropped
  for (const top of tops) {
    const p = byId.get(top.id);
    if (!p) continue;
    out.push(...mapLayersXY(cloneBlocks(doc.layers, [top]), p.sx, p.sy, p.dx, p.dy));
  }
  return out;
}

/** How the design will be re-laid out for a size, for the UI ("Side by side", "Stacked", "Fitted"). */
export function layoutModeFor(doc: Pick<Doc, 'width' | 'height' | 'layers'>, w: number, h: number, zone = safeZoneFor(w, h)): Mode {
  return planLayout(layoutItems(doc), doc.width, doc.height, targetFrame(w, h, zone)).mode;
}

/** Opens a new document per platform size with the active design adapted to it. Returns how many were made. */
export function resizeForPlatforms(presetIds: string[]): number {
  const doc = store.doc;
  if (!doc) return 0;
  const srcId = doc.id;
  let made = 0;
  for (const id of presetIds) {
    const p = DOC_PRESETS.find((q) => q.id === id);
    if (!p) continue;
    const zone = p.safeZone ?? safeZoneFor(p.w, p.h);
    const layers = adaptLayers(doc, p.w, p.h, zone);
    if (!layers.length) continue;
    store.addDoc({ title: `${doc.title} · ${p.label}`, width: p.w, height: p.h, layers, safeZone: zone });
    made++;
  }
  if (made) {
    store.switchDoc(srcId);
    store.toast(`Made ${made} size${made === 1 ? '' : 's'} as new tabs. Fine-tune each, then export.`, 'success');
  }
  return made;
}

/** A throwaway document holding a design adapted to a size (for previews and exports; never added to the tabs). */
function adaptedDoc(doc: Doc, w: number, h: number, zone: string): Doc {
  const layers = adaptLayers(doc, w, h, zone);
  return { ...doc, id: `${doc.id}-adapt-${w}x${h}`, width: w, height: h, layers, activeId: layers[layers.length - 1]?.id ?? '', selection: null, lastSelection: null, history: [], hIndex: -1, safeZone: zone };
}

/** A small rendered preview of the design adapted to a platform (long side `max` px). */
export function platformPreview(doc: Doc, presetId: string, max = 220): HTMLCanvasElement | null {
  const p = DOC_PRESETS.find((q) => q.id === presetId);
  if (!p) return null;
  // Laying out at preview size gives the same layout (the plan is in proportions) for a fraction of the work
  const k = Math.min(1, max / Math.max(p.w, p.h));
  const w = Math.max(1, Math.round(p.w * k)), h = Math.max(1, Math.round(p.h * k));
  const small = adaptedDoc(doc, w, h, p.safeZone ?? safeZoneFor(p.w, p.h));
  const c = createCanvas(w, h);
  renderDocument(small, c);
  return c;
}

export type PlatformFormat = 'png' | 'jpeg' | 'webp';

/**
 * Exports the design re-laid out for every picked platform in one zip (one file per size, named by
 * platform and pixel size). The open document is not changed.
 */
export async function exportForPlatforms(presetIds: string[], format: PlatformFormat = 'png', quality = 0.92, includeCurrent = true): Promise<number> {
  const doc = store.doc;
  if (!doc) return 0;
  const { zip } = await import('./formats/zip');
  const { saveBlob } = await import('./io');
  const files: { name: string; data: Uint8Array }[] = [];
  const ext = format === 'jpeg' ? 'jpg' : format;
  const encode = async (d: Doc, name: string) => {
    const c = createCanvas(d.width, d.height);
    if (format === 'jpeg') {
      const x = ctx2d(c);
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
    }
    renderDocument(d, c);
    const blob = await canvasToBlob(c, `image/${format}`, quality);
    files.push({ name: `${name.replace(/[\\/:*?"<>|]/g, '-')}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) });
  };
  if (includeCurrent) await encode(doc, `${doc.title} · Original ${doc.width}x${doc.height}`);
  for (const id of presetIds) {
    const p = DOC_PRESETS.find((q) => q.id === id);
    if (!p) continue;
    await encode(adaptedDoc(doc, p.w, p.h, p.safeZone ?? safeZoneFor(p.w, p.h)), `${doc.title} · ${p.label} ${p.w}x${p.h}`);
  }
  if (!files.length) return 0;
  await saveBlob(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${doc.title} · ${files.length} sizes.zip`);
  store.toast(`Exported ${files.length} size${files.length === 1 ? '' : 's'}, each laid out for its platform`, 'success');
  return files.length;
}

/** A new wide document cut into `n` slides (slide dividers + safe margins as layout grids). */
export function createCarousel(n: number, presetId = 'ig-portrait'): Doc | null {
  const p = DOC_PRESETS.find((q) => q.id === presetId) ?? DOC_PRESETS[0];
  const w = p.w * n;
  const bg = createCanvas(w, p.h);
  const c = ctx2d(bg);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, p.h);
  const doc = store.addDoc({ title: `Carousel · ${n} × ${p.label}`, width: w, height: p.h, layers: [makeLayer({ kind: 'raster', name: 'Background', canvas: bg, width: w, height: p.h })] });
  doc.grids = materialize([
    { kind: 'panels', axis: 'x', positions: Array.from({ length: n - 1 }, (_, i) => p.w * (i + 1)), names: Array.from({ length: n }, (_, i) => `SLIDE ${i + 1}`), color: GRID_COLORS.panels },
    { kind: 'safe', inset: [p.h * 0.05, p.w * 0.05, p.h * 0.05, p.w * 0.05], label: 'SAFE', color: GRID_COLORS.safe },
  ]);
  store.commit('New Carousel', {}, { icon: 'image' });
  if (!store.state.docGrid.showLayout) store.set({ docGrid: { ...store.state.docGrid, showLayout: true } });
  store.toast(`Carousel of ${n} slides: design across the seams, then Export Slides`, 'success');
  return doc;
}

/** Slide count of a carousel document: from its title, else the closest whole number of 4:5 slides. */
export function slideCount(doc: Pick<Doc, 'width' | 'height' | 'title'>): number {
  const m = /Carousel · (\d+) ×/.exec(doc.title);
  if (m) return +m[1];
  return Math.max(1, Math.round(doc.width / doc.height / (4 / 5)) || 1);
}

/** Slide rectangles, left to right. */
export function carouselSlides(doc: Pick<Doc, 'width' | 'height' | 'title'>, n = slideCount(doc)): { name: string; rect: Rect }[] {
  const w = doc.width / n;
  return Array.from({ length: n }, (_, i) => ({ name: `Slide ${String(i + 1).padStart(2, '0')}`, rect: { x: Math.round(i * w), y: 0, width: Math.round((i + 1) * w) - Math.round(i * w), height: doc.height } }));
}

/**
 * rows × cols tiles for a profile-grid puzzle. Files are numbered in posting order (bottom-right first,
 * so the grid reads right once all are posted).
 */
export function profileGridTiles(doc: Pick<Doc, 'width' | 'height'>, rows: number, cols: number): { name: string; rect: Rect }[] {
  const w = doc.width / cols;
  const h = doc.height / rows;
  const tiles: { name: string; rect: Rect }[] = [];
  let k = 1;
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const x0 = Math.round(c * w), y0 = Math.round(r * h);
      tiles.push({ name: `Post ${String(k++).padStart(2, '0')} (row ${r + 1}, col ${c + 1})`, rect: { x: x0, y: y0, width: Math.round((c + 1) * w) - x0, height: Math.round((r + 1) * h) - y0 } });
    }
  }
  return tiles;
}

/** Renders the document once and saves each region as a PNG, zipped. Returns the file count. */
export async function exportRegions(doc: Doc, regions: { name: string; rect: Rect }[], fileName: string): Promise<number> {
  const { zip } = await import('./formats/zip');
  const { saveBlob } = await import('./io');
  const full = createCanvas(doc.width, doc.height);
  renderDocument(doc, full);
  const files: { name: string; data: Uint8Array }[] = [];
  for (const r of regions) {
    const c = createCanvas(Math.max(1, r.rect.width), Math.max(1, r.rect.height));
    ctx2d(c).drawImage(full, -r.rect.x, -r.rect.y);
    const blob = await canvasToBlob(c, 'image/png');
    files.push({ name: `${r.name.replace(/[\\/:*?"<>|]/g, '-')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  await saveBlob(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${fileName}.zip`);
  store.toast(`Exported ${files.length} file${files.length === 1 ? '' : 's'}`, 'success');
  return files.length;
}

export const exportCarousel = (n?: number) => (store.doc ? exportRegions(store.doc, carouselSlides(store.doc, n), `${store.doc.title} carousel`) : Promise.resolve(0));
export const exportProfileGrid = (rows = 3, cols = 3) => (store.doc ? exportRegions(store.doc, profileGridTiles(store.doc, rows, cols), `${store.doc.title} grid`) : Promise.resolve(0));

/** Text that will be hard to read on a phone (under ~2.2% of the short side, about 24 px on a 1080 post). */
export function legibility(doc: Pick<Doc, 'width' | 'height' | 'layers'>, slideWidth?: number): { layer: Layer; size: number; min: number }[] {
  const min = Math.round(Math.min(slideWidth ?? doc.width, doc.height) * 0.022);
  return doc.layers.filter((l) => l.kind === 'text' && l.text && l.visible && l.text.size < min).map((l) => ({ layer: l, size: l.text!.size, min }));
}
