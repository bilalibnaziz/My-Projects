// Building blocks shared by the workspace studios: layer factories, artboard helpers, cloning and
// fitting artwork from one box into another.

import { store } from '../store';
import type { Artboard, Doc, Layer, Rect, ShapeProps, TextProps } from '../types';
import { makeLayer, uid } from '../types';
import { cloneCanvas } from '../canvas';
import { syncTextBounds } from '../render';
import { groupLayers, blockOf } from '../groups';
import { getActiveArtboard } from '../vectorOps';
import { mappedLayer, selectionFrame } from '../objectTransform';
import { layerBounds } from '../align';

export const FONT = 'Inter';

export function rectLayer(name: string, x: number, y: number, w: number, h: number, fill: string, extra: Partial<ShapeProps> = {}, layer: Partial<Layer> = {}): Layer {
  return makeLayer({
    kind: 'shape',
    name,
    x,
    y,
    width: w,
    height: h,
    ...layer,
    shape: { shape: 'rectangle', fill, fillEnabled: fill !== 'none', stroke: '#000000', strokeWidth: 0, radius: 0, ...extra },
  });
}

export function ellipseLayer(name: string, x: number, y: number, w: number, h: number, fill: string, extra: Partial<ShapeProps> = {}): Layer {
  return makeLayer({ kind: 'shape', name, x, y, width: w, height: h, shape: { shape: 'ellipse', fill, fillEnabled: fill !== 'none', stroke: '#000000', strokeWidth: 0, radius: 0, ...extra } });
}

export function lineLayer(name: string, x1: number, y1: number, x2: number, y2: number, color: string, width = 1, extra: Partial<ShapeProps> = {}): Layer {
  return makeLayer({ kind: 'shape', name, x: x1, y: y1, width: x2 - x1, height: y2 - y1, shape: { shape: 'line', fill: color, fillEnabled: false, stroke: color, strokeWidth: width, radius: 0, strokeCap: 'butt', ...extra } });
}

export function textLayer(name: string, text: string, x: number, y: number, t: Partial<TextProps> = {}): Layer {
  const l = makeLayer({
    kind: 'text',
    name,
    x,
    y,
    text: { text, font: FONT, size: 32, weight: 400, italic: false, color: '#111111', align: 'left', lineHeight: 1.25, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000000', ...t },
  });
  return { ...l, ...syncTextBounds(l) };
}

/** Text placed so its box is centred on (cx, cy) horizontally and starts at y. */
export function centeredText(name: string, text: string, cx: number, y: number, t: Partial<TextProps> = {}): Layer {
  const l = textLayer(name, text, 0, y, { ...t, align: 'center' });
  return { ...l, x: cx - l.width / 2 };
}

/** Adds layers on top as one group, selects it, one undo step. Returns the group id. */
export function addGroup(parts: Layer[], name: string, label = `Add ${name}`): string | null {
  const doc = store.doc;
  if (!doc || !parts.length) return null;
  const g = groupLayers([...doc.layers, ...parts], parts.map((l) => l.id), name);
  if (!g) return null;
  store.commit(label, { layers: g.layers, activeId: g.group.id }, { icon: 'shape' });
  return g.group.id;
}

/** Adds layers on top (no group), selecting them. */
export function addLayers(parts: Layer[], label: string) {
  const doc = store.doc;
  if (!doc || !parts.length) return;
  store.commit(label, { layers: [...doc.layers, ...parts], activeId: parts[parts.length - 1].id }, { icon: 'shape' });
  store.setSelectedLayers(parts.map((l) => l.id));
}

export const activeBoard = (doc: Doc): Artboard => getActiveArtboard(doc);

/** A new artboard to the right of every other one (or below, when `below`). Mutates the doc. */
export function appendArtboard(doc: Doc, name: string, w: number, h: number, below = false): Artboard {
  const boards = doc.artboards?.length ? doc.artboards : [getActiveArtboard(doc)];
  const right = Math.max(...boards.map((b) => b.x + b.width));
  const bottom = Math.max(...boards.map((b) => b.y + b.height));
  const ab: Artboard = { id: uid('artboard'), name, x: below ? 0 : right + 80, y: below ? bottom + 80 : boards[0].y, width: Math.round(w), height: Math.round(h) };
  doc.artboards = [...boards, ab];
  doc.activeArtboardId = ab.id;
  if (ab.x + ab.width > doc.width) doc.width = ab.x + ab.width;
  if (ab.y + ab.height > doc.height) doc.height = ab.y + ab.height;
  return ab;
}

/** Top-level layers (not inside a group) whose bounds overlap the box. */
export function layersIn(doc: Doc, box: Rect): Layer[] {
  return doc.layers.filter((l) => {
    if (l.parent || l.kind === 'adjustment' || !l.visible) return false;
    const b = layerBounds(l);
    return !!b && b.x < box.x + box.width && b.x + b.width > box.x && b.y < box.y + box.height && b.y + b.height > box.y;
  });
}

/** Deep copy of layers (and everything inside groups) with fresh ids. */
export function cloneBlocks(doc: Doc, tops: Layer[]): Layer[] {
  const ids = new Map<string, string>();
  const out: Layer[] = [];
  for (const top of tops) {
    for (const l of blockOf(doc.layers, top)) {
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

/**
 * Maps layers from one box to another with a uniform scale `s` about the boxes' origins
 * (images resampled, shapes and text stay live). Groups' children are mapped one by one.
 */
export function mapLayers(layers: Layer[], from: Rect, to: { x: number; y: number }, s: number, dx = 0, dy = 0): Layer[] {
  const leaves = layers.filter((l) => l.kind !== 'group');
  const frame = selectionFrame(leaves) ?? { cx: from.x + from.width / 2, cy: from.y + from.height / 2, w: from.width, h: from.height, angle: 0 };
  const map = {
    apply: (p: { x: number; y: number }) => ({ x: to.x + dx + (p.x - from.x) * s, y: to.y + dy + (p.y - from.y) * s }),
    da: 0,
    sx: s,
    sy: s,
    axis: 0,
    frame,
  };
  return layers.map((l) => (l.kind === 'group' ? l : mappedLayer(l, map as Parameters<typeof mappedLayer>[1], true).layer));
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Union of the bounds of some layers. */
export function boundsOf(layers: Layer[]): Rect | null {
  let r: Rect | null = null;
  for (const l of layers) {
    const b = layerBounds(l);
    if (!b) continue;
    r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), width: Math.max(r.x + r.width, b.x + b.width) - Math.min(r.x, b.x), height: Math.max(r.y + r.height, b.y + b.height) - Math.min(r.y, b.y) } : { ...b };
  }
  return r;
}

/** File-name-safe text. */
export const safeName = (s: string) => (s.trim() || 'Untitled').replace(/[\\/:*?"<>|]/g, '-');
