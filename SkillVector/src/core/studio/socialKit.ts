// Social studio: one design → every platform size, seamless carousels exported as slides, profile
// grid splits in posting order, and a phone-legibility check.

import { store } from '../store';
import type { Artboard, Doc, Layer, Rect } from '../types';
import { DOC_PRESETS } from '../social';
import { GRID_COLORS, materialize } from '../grids';
import { getActiveArtboard } from '../vectorOps';
import { appendArtboard, cloneBlocks, layersIn, mapLayers } from './common';
import { exportArtboards } from './export';
import { layerBounds } from '../align';

export const PLATFORM_SIZES = DOC_PRESETS.filter((p) => p.category === 'Social' || p.id === 'reel' || p.id === 'yt-thumb');

/** Quick set most posts need. */
export const CORE_PLATFORMS = ['ig-portrait', 'ig-square', 'ig-story', 'fb-post', 'x-post', 'li-post', 'pin', 'yt-thumb'];

/** A layer counts as the background when it covers almost the whole board. */
const isBackground = (b: Rect, ab: Rect) => b.x <= ab.x + ab.width * 0.03 && b.y <= ab.y + ab.height * 0.03 && b.x + b.width >= ab.x + ab.width * 0.97 && b.y + b.height >= ab.y + ab.height * 0.97;

/**
 * Lays the content of `src` out on a w×h board at (x, y): backgrounds cover the new board, the rest is
 * scaled uniformly to fit inside a 6% margin and centred. Returns the mapped copies.
 */
export function adaptContent(doc: Doc, src: Artboard, dst: { x: number; y: number; width: number; height: number }, content: Layer[]): Layer[] {
  const out: Layer[] = [];
  const bgTops = content.filter((l) => {
    const b = layerBounds(l);
    return b && isBackground(b, src);
  });
  const fgTops = content.filter((l) => !bgTops.includes(l));
  // Background: cover the new board (uniform scale, centred)
  for (const top of bgTops) {
    const copies = cloneBlocks(doc, [top]);
    const s = Math.max(dst.width / src.width, dst.height / src.height);
    out.push(...mapLayers(copies, src, dst, s, (dst.width - src.width * s) / 2, (dst.height - src.height * s) / 2));
  }
  if (fgTops.length) {
    const copies = cloneBlocks(doc, fgTops);
    // Fit the foreground's own bounds into the new board's safe area, keeping its place relative to the centre
    const fb = fgTops.map(layerBounds).filter((b): b is Rect => !!b).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) }));
    const m = 0.06;
    const fitS = Math.min((dst.width * (1 - 2 * m)) / Math.max(1, fb.width), (dst.height * (1 - 2 * m)) / Math.max(1, fb.height));
    // Never enlarge content by more than the board grew
    const s = Math.min(fitS, Math.max(dst.width / src.width, dst.height / src.height));
    const dx = (dst.width - fb.width * s) / 2 - (fb.x - src.x) * s;
    const dy = (dst.height - fb.height * s) / 2 - (fb.y - src.y) * s;
    out.push(...mapLayers(copies, src, dst, s, dx, dy));
  }
  return out;
}

/** Copies the active artboard's design onto a new artboard per platform size. Returns the new boards. */
export function resizeForPlatforms(presetIds: string[]): Artboard[] {
  const doc = store.doc;
  if (!doc) return [];
  const src = getActiveArtboard(doc);
  const content = layersIn(doc, src);
  const made: Artboard[] = [];
  const added: Layer[] = [];
  for (const id of presetIds) {
    const p = PLATFORM_SIZES.find((q) => q.id === id) ?? DOC_PRESETS.find((q) => q.id === id);
    if (!p) continue;
    const ab = appendArtboard(doc, p.label, p.w, p.h);
    made.push(ab);
    added.push(...adaptContent(doc, src, ab, content));
  }
  if (!made.length) return [];
  doc.activeArtboardId = src.id;
  store.commit(`Resize for ${made.length} Platform${made.length > 1 ? 's' : ''}`, { layers: [...doc.layers, ...added] }, { icon: 'artboard' });
  store.toast(`Made ${made.length} sizes to the right of “${src.name}”. Fine-tune each, then Export Artboards.`, 'success');
  return made;
}

/** A wide panorama artboard cut into `n` slides (with slide dividers), for seamless carousels. */
export function createCarousel(n: number, presetId = 'ig-portrait'): Artboard | null {
  const doc = store.doc;
  if (!doc) return null;
  const p = DOC_PRESETS.find((q) => q.id === presetId) ?? DOC_PRESETS[0];
  const ab = appendArtboard(doc, `Carousel · ${n} × ${p.label}`, p.w * n, p.h, true);
  // Slide dividers and a safe margin per slide, as layout grids (they guide and snap, never export)
  ab.grids = materialize([
    { kind: 'panels', axis: 'x', positions: Array.from({ length: n - 1 }, (_, i) => p.w * (i + 1)), names: Array.from({ length: n }, (_, i) => `SLIDE ${i + 1}`), color: GRID_COLORS.panels },
    { kind: 'safe', inset: [p.h * 0.05, p.w * 0.05, p.h * 0.05, p.w * 0.05], label: 'SAFE', color: GRID_COLORS.safe },
  ]);
  doc.artboards = doc.artboards!.map((a) => (a.id === ab.id ? ab : a));
  store.commit('New Carousel', {}, { icon: 'artboard' });
  if (!store.state.docGrid.showLayout) store.set({ docGrid: { ...store.state.docGrid, showLayout: true } });
  store.toast(`Carousel of ${n} slides: design across the seams, then Export Slides`, 'success');
  return ab;
}

/** Slide rectangles of a carousel artboard. */
export function carouselSlides(ab: Artboard, n?: number): { name: string; rect: Rect }[] {
  const count = n ?? Math.max(1, Math.round(ab.width / ab.height / (4 / 5)) || 1);
  const m = /Carousel · (\d+) ×/.exec(ab.name);
  const k = m ? +m[1] : count;
  const w = ab.width / k;
  return Array.from({ length: k }, (_, i) => ({ name: `Slide ${String(i + 1).padStart(2, '0')}`, rect: { x: ab.x + i * w, y: ab.y, width: w, height: ab.height } }));
}

export async function exportCarousel(n?: number) {
  const doc = store.doc;
  if (!doc) return 0;
  const ab = getActiveArtboard(doc);
  return exportArtboards(doc, { format: 'png', regions: carouselSlides(ab, n), fileName: `${doc.title} carousel` });
}

/**
 * Splits the active artboard into rows × cols tiles for a profile-grid puzzle. Files are numbered
 * in posting order (bottom-right first, so the grid reads right once all are posted).
 */
export function profileGridTiles(ab: Artboard, rows: number, cols: number): { name: string; rect: Rect }[] {
  const w = ab.width / cols;
  const h = ab.height / rows;
  const tiles: { name: string; rect: Rect }[] = [];
  let k = 1;
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      tiles.push({ name: `Post ${String(k++).padStart(2, '0')} (row ${r + 1}, col ${c + 1})`, rect: { x: ab.x + c * w, y: ab.y + r * h, width: w, height: h } });
    }
  }
  return tiles;
}

export async function exportProfileGrid(rows = 3, cols = 3) {
  const doc = store.doc;
  if (!doc) return 0;
  return exportArtboards(doc, { format: 'png', regions: profileGridTiles(getActiveArtboard(doc), rows, cols), fileName: `${doc.title} grid` });
}

/** Text that will be hard to read on a phone (under ~2.2% of the board height, about 24 px on a 1080 post). */
export function legibility(doc: Doc): { layer: Layer; size: number; min: number }[] {
  const boards = doc.artboards?.length ? doc.artboards : [getActiveArtboard(doc)];
  const out: { layer: Layer; size: number; min: number }[] = [];
  for (const l of doc.layers) {
    if (l.kind !== 'text' || !l.text || !l.visible) continue;
    const b = layerBounds(l);
    const ab = b && boards.find((a) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
    if (!ab) continue;
    const min = Math.round(Math.min(ab.width, ab.height) * 0.022);
    if (l.text.size < min) out.push({ layer: l, size: l.text.size, min });
  }
  return out;
}
