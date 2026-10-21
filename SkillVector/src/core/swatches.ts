// Document swatches (brand colours). A global swatch stays linked to every fill, stroke and type colour
// set from it: editing the swatch recolours all of them in one undo step. A link only counts while the
// layer still shows the swatch's colour, so a colour changed some other way (Recolor, a picker) simply
// stops following, without stale links overwriting it later.

import type { Doc, Layer, Swatch } from './types';
import { uid, withLayer } from './types';
import { store } from './store';
import { splitAlpha } from './gradientStops';

const same = (a: string, b: string) => splitAlpha(a).hex === splitAlpha(b).hex;

export type SwatchTarget = 'fill' | 'stroke';

/** Where a layer is linked to swatch `id` (and still shows its colour `color`). */
export function swatchLinks(l: Layer, id: string, color: string): { fill: boolean; stroke: boolean; text: boolean } {
  const s = l.shape, t = l.text;
  return {
    fill: !!s && s.fillSwatch === id && same(s.fill, color),
    stroke: !!s && s.strokeSwatch === id && same(s.stroke, color),
    text: !!t && t.colorSwatch === id && same(t.color, color),
  };
}

/** The layers with swatch `sw` recoloured to `color` wherever they are still linked to it. */
export function recolorSwatchUses(layers: Layer[], sw: Swatch, color: string): { layers: Layer[]; count: number } {
  let count = 0;
  const out = layers.map((l) => {
    const k = swatchLinks(l, sw.id, sw.color);
    if (!k.fill && !k.stroke && !k.text) return l;
    count++;
    const patch: Partial<Layer> = {};
    if (l.shape && (k.fill || k.stroke)) patch.shape = { ...l.shape, ...(k.fill ? { fill: color } : {}), ...(k.stroke ? { stroke: color } : {}) };
    if (l.text && k.text) patch.text = { ...l.text, color };
    return withLayer(l, patch);
  });
  return { layers: out, count };
}

/** How many layers use the swatch (linked and still showing it). */
export function swatchUseCount(doc: Doc, sw: Swatch): number {
  return doc.layers.filter((l) => {
    const k = swatchLinks(l, sw.id, sw.color);
    return k.fill || k.stroke || k.text;
  }).length;
}

/** The swatch a layer's fill / stroke is linked to, if the link still holds. */
export function linkedSwatch(doc: Doc | null, l: Layer, target: SwatchTarget): Swatch | null {
  if (!doc?.swatches) return null;
  const id = target === 'fill' ? l.shape?.fillSwatch ?? l.text?.colorSwatch : l.shape?.strokeSwatch;
  const sw = id ? doc.swatches.find((s) => s.id === id) : undefined;
  if (!sw) return null;
  const k = swatchLinks(l, sw.id, sw.color);
  return (target === 'fill' ? k.fill || k.text : k.stroke) ? sw : null;
}

// ---------------------------------------------------------------- store operations

function commitSwatches(label: string, swatches: Swatch[], layers?: Layer[], coalesce?: string) {
  const doc = store.doc;
  if (!doc) return;
  doc.swatches = swatches;
  store.commit(label, layers ? { layers } : {}, coalesce ? { coalesce } : {});
}

/** Adds a colour to the document swatches (global by default). Returns its id. */
export function addSwatch(color: string, opts: { name?: string; global?: boolean } = {}): string | null {
  const doc = store.doc;
  if (!doc) return null;
  const hex = splitAlpha(color).hex;
  const list = doc.swatches ?? [];
  const existing = list.find((s) => s.color === hex && s.global === (opts.global ?? true));
  if (existing) return existing.id;
  const sw: Swatch = { id: uid('swatch'), name: opts.name ?? `Colour ${list.length + 1}`, color: hex, global: opts.global ?? true };
  commitSwatches('New Swatch', [...list, sw]);
  return sw.id;
}

/** Applies a swatch to the selection's fill or stroke (text: its colour); global swatches link. */
export function applySwatch(id: string, target: SwatchTarget, layers: Layer[]): number {
  const doc = store.doc;
  const sw = doc?.swatches?.find((s) => s.id === id);
  if (!doc || !sw) return 0;
  const ids = new Set(layers.filter((l) => !l.locked).map((l) => l.id));
  const link = sw.global ? sw.id : undefined;
  let n = 0;
  const next = doc.layers.map((l) => {
    if (!ids.has(l.id)) return l;
    if (l.shape) {
      n++;
      return withLayer(l, {
        shape: target === 'fill'
          ? { ...l.shape, fill: sw.color, fillEnabled: true, gradient: undefined, fillSwatch: link }
          : { ...l.shape, stroke: sw.color, strokeWidth: l.shape.strokeWidth || 2, strokeGradient: undefined, strokeSwatch: link },
      });
    }
    if (l.text && target === 'fill') {
      n++;
      return withLayer(l, { text: { ...l.text, color: sw.color, colorSwatch: link, runs: l.text.runs?.map(({ color: _c, ...r }) => r) } });
    }
    return l;
  });
  if (n) store.commit(`Apply ${sw.name}`, { layers: next });
  return n;
}

/** Edits a swatch's colour; every linked use follows. Drags of the same swatch coalesce into one step. */
export function setSwatchColor(id: string, color: string): number {
  const doc = store.doc;
  const sw = doc?.swatches?.find((s) => s.id === id);
  if (!doc || !sw) return 0;
  const hex = splitAlpha(color).hex;
  const { layers, count } = sw.global ? recolorSwatchUses(doc.layers, sw, hex) : { layers: doc.layers, count: 0 };
  commitSwatches(`Edit ${sw.name}`, doc.swatches!.map((s) => (s.id === id ? { ...s, color: hex } : s)), layers, `swatch:${id}`);
  return count;
}

export function renameSwatch(id: string, name: string) {
  const doc = store.doc;
  if (!doc?.swatches) return;
  commitSwatches('Rename Swatch', doc.swatches.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)));
}

export function toggleSwatchGlobal(id: string) {
  const doc = store.doc;
  if (!doc?.swatches) return;
  commitSwatches('Swatch Global', doc.swatches.map((s) => (s.id === id ? { ...s, global: !s.global } : s)));
}

/** Removes the swatch; layers keep their colour, unlinked. */
export function removeSwatch(id: string) {
  const doc = store.doc;
  if (!doc?.swatches) return;
  const layers = doc.layers.map((l) => {
    const s = l.shape, t = l.text;
    if (s && (s.fillSwatch === id || s.strokeSwatch === id)) {
      return withLayer(l, { shape: { ...s, fillSwatch: s.fillSwatch === id ? undefined : s.fillSwatch, strokeSwatch: s.strokeSwatch === id ? undefined : s.strokeSwatch } });
    }
    if (t?.colorSwatch === id) return withLayer(l, { text: { ...t, colorSwatch: undefined } });
    return l;
  });
  commitSwatches('Delete Swatch', doc.swatches.filter((s) => s.id !== id), layers);
}

/** Adds every distinct fill / stroke / type colour of the given layers as global swatches, linking them. */
export function swatchesFromLayers(layers: Layer[]): number {
  const doc = store.doc;
  if (!doc) return 0;
  const list = [...(doc.swatches ?? [])];
  const byHex = new Map(list.filter((s) => s.global).map((s) => [s.color, s]));
  const want = (c: string) => {
    const hex = splitAlpha(c).hex;
    let sw = byHex.get(hex);
    if (!sw) {
      sw = { id: uid('swatch'), name: `Colour ${list.length + 1}`, color: hex, global: true };
      list.push(sw);
      byHex.set(hex, sw);
    }
    return sw.id;
  };
  const ids = new Set(layers.map((l) => l.id));
  const before = list.length;
  const next = doc.layers.map((l) => {
    if (!ids.has(l.id) || l.locked) return l;
    if (l.shape) {
      const s = l.shape;
      return withLayer(l, {
        shape: {
          ...s,
          fillSwatch: s.fillEnabled && !s.gradient ? want(s.fill) : s.fillSwatch,
          strokeSwatch: s.strokeWidth > 0 && !s.strokeGradient ? want(s.stroke) : s.strokeSwatch,
        },
      });
    }
    if (l.text) return withLayer(l, { text: { ...l.text, colorSwatch: want(l.text.color) } });
    return l;
  });
  doc.swatches = list;
  store.commit('Swatches from Selection', { layers: next });
  return list.length - before;
}
