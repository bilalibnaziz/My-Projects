// Mood board studio: drop many pictures and they arrange themselves (masonry or grid), pull a colour
// palette out of the board, add sticky notes and labels, and tidy any selection.

import { store } from '../store';
import type { Layer, Rect } from '../types';
import { makeLayer } from '../types';
import { createCanvas, ctx2d } from '../canvas';
import { fileToCanvas } from '../io';
import { kmeansPalette } from '../tracer';
import { deltaE, hexToRgb } from '../color';
import { frameVisible, hideObjectSelection } from '../objectTransform';
import { layerBounds } from '../align';
import { activeBoard, addGroup, layersIn, mapLayers, rectLayer, textLayer } from './common';
import { renderRect } from './export';

export type ArrangeMode = 'masonry' | 'grid';

/**
 * Pure layout: places items (width/height) into `cols` columns inside `box`. Masonry keeps aspect
 * ratios and drops each item into the shortest column; grid uses equal square cells (items contained).
 * Returns the target rect of each item, in input order.
 */
export function arrangeRects(items: { w: number; h: number }[], box: Rect, cols: number, gap: number, mode: ArrangeMode): Rect[] {
  const c = Math.max(1, Math.min(cols, items.length || 1));
  const colW = (box.width - gap * (c - 1)) / c;
  if (mode === 'grid') {
    return items.map((it, i) => {
      const col = i % c;
      const row = Math.floor(i / c);
      const s = Math.min(colW / it.w, colW / it.h);
      const w = it.w * s, h = it.h * s;
      return { x: box.x + col * (colW + gap) + (colW - w) / 2, y: box.y + row * (colW + gap) + (colW - h) / 2, width: w, height: h };
    });
  }
  const heights = new Array(c).fill(0);
  return items.map((it) => {
    const col = heights.indexOf(Math.min(...heights));
    const h = (it.h / it.w) * colW;
    const r = { x: box.x + col * (colW + gap), y: box.y + heights[col], width: colW, height: h };
    heights[col] += h + gap;
    return r;
  });
}

/** Columns that suit the count and the board's shape. */
export const autoCols = (n: number, box: Rect) => Math.max(1, Math.min(n, Math.round(Math.sqrt((n * box.width) / Math.max(1, box.height)))));

/** Rescales layers so the whole arrangement fits the box height (masonry can run long). */
function fitHeight(rects: Rect[], box: Rect): Rect[] {
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const s = Math.min(1, box.height / Math.max(1, bottom - box.y));
  if (s >= 1) return rects;
  const offX = (box.width - box.width * s) / 2;
  return rects.map((r) => ({ x: box.x + offX + (r.x - box.x) * s, y: box.y + (r.y - box.y) * s, width: r.width * s, height: r.height * s }));
}

/** Arranges the selected objects (or everything on the active artboard) in one undo step. */
export function arrange(mode: ArrangeMode, gapPct = 2, cols?: number) {
  const doc = store.doc;
  if (!doc) return 0;
  const ab = activeBoard(doc);
  let targets = frameVisible() ? store.selectedLayers.filter((l) => !l.parent) : [];
  const wholeBoard = targets.length < 2;
  if (wholeBoard) targets = layersIn(doc, ab).filter((l) => !(l.kind === 'raster' && l.width >= ab.width * 0.97 && l.height >= ab.height * 0.97));
  const items = targets.map((l) => ({ l, b: layerBounds(l) })).filter((x): x is { l: Layer; b: Rect } => !!x.b && x.b.width > 0 && x.b.height > 0);
  if (items.length < 2) {
    store.toast('Add or select two or more pictures to arrange');
    return 0;
  }
  const gap = Math.round(Math.min(ab.width, ab.height) * (gapPct / 100));
  const box = { x: ab.x + gap * 2, y: ab.y + gap * 2, width: ab.width - gap * 4, height: ab.height - gap * 4 };
  let rects = arrangeRects(items.map(({ b }) => ({ w: b.width, h: b.height })), box, cols ?? autoCols(items.length, box), gap, mode);
  if (mode === 'masonry') rects = fitHeight(rects, box);
  const moved = new Map<string, Layer>();
  items.forEach(({ l, b }, i) => {
    const r = rects[i];
    const s = Math.min(r.width / b.width, r.height / b.height);
    const block = l.kind === 'group' ? doc.layers.filter((x) => x.id === l.id || isInside(doc.layers, x, l.id)) : [l];
    for (const m of mapLayers(block, b, { x: r.x, y: r.y }, s, (r.width - b.width * s) / 2, (r.height - b.height * s) / 2)) moved.set(m.id, m);
  });
  store.commit(mode === 'masonry' ? 'Arrange · Masonry' : 'Arrange · Grid', { layers: doc.layers.map((l) => moved.get(l.id) ?? l) }, { icon: 'layers' });
  // Arranging the whole board leaves nothing selected, so the next step (palette, export) sees the board
  if (wholeBoard) hideObjectSelection();
  return items.length;
}

function isInside(layers: Layer[], l: Layer, groupId: string): boolean {
  let p = l.parent;
  for (let n = 0; p && n < 32; n++) {
    if (p === groupId) return true;
    p = layers.find((x) => x.id === p)?.parent;
  }
  return false;
}

/** Adds pictures to the active artboard and arranges the whole board as masonry. */
export async function addPictures(files: File[]) {
  const doc = store.doc;
  if (!doc || !files.length) return 0;
  const ab = activeBoard(doc);
  const cols = autoCols(files.length + layersIn(doc, ab).length, ab);
  const target = Math.max(120, Math.round(ab.width / cols));
  const parts: Layer[] = [];
  for (const f of files) {
    try {
      const src = await fileToCanvas(f);
      // Downscale big photos to about one column wide (keeps the board light)
      const s = Math.min(1, (target * 1.5) / src.width);
      const c = createCanvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
      const cx = ctx2d(c);
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, 0, 0, c.width, c.height);
      parts.push(makeLayer({ kind: 'raster', name: f.name.replace(/\.[^.]+$/, '') || 'Picture', canvas: c, x: ab.x, y: ab.y, width: c.width, height: c.height }));
    } catch {
      store.toast(`Couldn't open ${f.name}`, 'error');
    }
  }
  if (!parts.length) return 0;
  store.commit(`Add ${parts.length} Picture${parts.length > 1 ? 's' : ''}`, { layers: [...doc.layers, ...parts], activeId: parts[parts.length - 1].id }, { icon: 'layer' });
  store.setSelectedLayers([]);
  arrange('masonry');
  return parts.length;
}

/** The main colours of the selection (or the whole active artboard), most common first. */
export function boardPalette(k = 6): string[] {
  const doc = store.doc;
  if (!doc) return [];
  // A deliberate selection (frame showing) narrows the palette; otherwise the whole board
  const sel = frameVisible() ? store.selectedLayers.filter((l) => !l.parent) : [];
  const r: Rect | null = sel.length ? sel.map(layerBounds).filter((b): b is Rect => !!b).reduce<Rect | null>((a, b) => (a ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) } : b), null) : activeBoard(doc);
  if (!r) return [];
  const c = renderRect(doc, r, Math.min(1, 300 / Math.max(r.width, r.height)));
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  const pal = kmeansPalette(d, c.width * c.height, k + 2);
  // Count how much of the picture each colour covers, drop near-duplicates, keep the k biggest
  const counts = new Array(pal.length).fill(0);
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 128) continue;
    let bi = 0, bd = Infinity;
    pal.forEach((p, j) => {
      const dd = (d[i] - p[0]) ** 2 + (d[i + 1] - p[1]) ** 2 + (d[i + 2] - p[2]) ** 2;
      if (dd < bd) { bd = dd; bi = j; }
    });
    counts[bi]++;
  }
  const hex = (p: number[]) => '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('');
  const out: string[] = [];
  for (const j of pal.map((_, j) => j).sort((a, b) => counts[b] - counts[a])) {
    const h = hex(pal[j]);
    // Skip shades that look the same as one already picked (ΔE under 12)
    if (counts[j] && !out.some((o) => deltaE(hexToRgb(o), hexToRgb(h)) < 12)) out.push(h);
    if (out.length >= k) break;
  }
  return out;
}

/** Puts the palette on the board as labelled swatches (and into recent colours). */
export function addPaletteStrip(colors: string[]) {
  const doc = store.doc;
  if (!doc || !colors.length) return;
  const ab = activeBoard(doc);
  const s = Math.round(Math.min(ab.width, ab.height) * 0.08);
  const gap = Math.round(s * 0.18);
  const x0 = ab.x + gap * 2;
  const y0 = ab.y + ab.height - s - s * 0.5 - gap * 2;
  const parts: Layer[] = [];
  colors.forEach((c, i) => {
    const x = x0 + i * (s + gap);
    parts.push(rectLayer(`Swatch ${c}`, x, y0, s, s, c, { radius: Math.round(s * 0.12), stroke: '#00000022', strokeWidth: 1 }));
    parts.push(textLayer(`Hex ${c}`, c.toUpperCase(), x, y0 + s + gap * 0.5, { size: Math.max(10, Math.round(s * 0.16)), weight: 600, color: '#111111', font: 'Inter' }));
    store.pushRecentColor(c);
  });
  addGroup(parts, 'Palette', 'Add Palette');
}

export const NOTE_COLORS = ['#fff3a3', '#ffd6e0', '#cde9ff', '#d6f5d6', '#eadcff'];

export function addNote(text = 'Idea', color = NOTE_COLORS[0]) {
  const doc = store.doc;
  if (!doc) return;
  const ab = activeBoard(doc);
  const s = Math.round(Math.min(ab.width, ab.height) * 0.2);
  const x = ab.x + ab.width / 2 - s / 2 + (Math.random() - 0.5) * s * 0.6;
  const y = ab.y + ab.height / 2 - s / 2 + (Math.random() - 0.5) * s * 0.6;
  const pad = Math.round(s * 0.1);
  const note = rectLayer('Note', x, y, s, s, color, { radius: Math.round(s * 0.03) });
  const t = textLayer('Note text', text, x + pad, y + pad, { size: Math.round(s * 0.11), weight: 500, color: '#1f2937', boxWidth: s - pad * 2, lineHeight: 1.3 });
  addGroup([{ ...note, fx: undefined }, t], 'Sticky note', 'Add Note');
}

export function addLabel(text = 'Section') {
  const doc = store.doc;
  if (!doc) return;
  const ab = activeBoard(doc);
  const size = Math.round(Math.min(ab.width, ab.height) * 0.045);
  const t = textLayer('Label', text.toUpperCase(), ab.x + size, ab.y + size * 0.8, { size, weight: 800, color: '#111111', tracking: size * 0.08 });
  addGroup([t], 'Label', 'Add Label');
}
