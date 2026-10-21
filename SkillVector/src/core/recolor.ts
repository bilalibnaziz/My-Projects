/**
 * Recolor Artwork (Edit ▸ Edit Colors ▸ Recolor Artwork…): finds every colour in the selection (fills,
 * strokes, gradient stops, mesh points, text) and swaps them through a colour map, in one undo step.
 */
import type { Layer } from './types';
import { withLayer } from './types';
import { store } from './store';
import { descendants, isGroup } from './groups';
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb } from './color';

/** #rrggbb (lower case) of a colour; alpha is kept apart so it survives the swap. */
export const colorKey = (c: string) => (/^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7).toLowerCase() : c.toLowerCase());
const withAlpha = (orig: string, hex: string) => (orig.length === 9 ? hex + orig.slice(7) : hex);

export type ColorMap = Record<string, string>;

/** Leaf layers of the selection (group contents instead of groups). */
export function recolorTargets(all: Layer[], picked: Layer[]): Layer[] {
  const out = new Map<string, Layer>();
  for (const l of picked) {
    if (isGroup(l)) for (const d of descendants(all, l.id)) if (!isGroup(d)) out.set(d.id, d);
    if (!isGroup(l)) out.set(l.id, l);
  }
  return [...out.values()].filter((l) => !l.locked);
}

/** Every colour the layers use, most used first. */
export function collectColors(layers: Layer[]): { hex: string; count: number }[] {
  const counts = new Map<string, number>();
  const add = (c: string | undefined) => {
    if (!c || !/^#[0-9a-f]{6}/i.test(c)) return;
    const k = colorKey(c);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (const l of layers) {
    const s = l.shape;
    if (s) {
      if (s.fillEnabled) {
        if (s.pattern) {
          add(s.pattern.fg);
          if (s.pattern.bg) add(s.pattern.bg);
        } else if (s.gradient) s.gradient.stops.forEach((st) => add(st.color));
        else add(s.fill);
        s.mesh?.forEach((m) => add(m.color));
      }
      if (s.strokeWidth > 0) {
        if (s.strokeGradient) s.strokeGradient.stops.forEach((st) => add(st.color));
        else add(s.stroke);
      }
    }
    const t = l.text;
    if (t) {
      add(t.color);
      t.runs?.forEach((r) => add(r.color));
      if (t.stroke > 0) add(t.strokeColor);
      if (t.box) add(t.boxColor);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex, count]) => ({ hex, count }));
}

/** The layer with every mapped colour swapped. */
export function recolorLayer(l: Layer, map: ColorMap): Layer {
  const sw = (c: string) => {
    const to = map[colorKey(c)];
    return to && to !== colorKey(c) ? withAlpha(c, to) : c;
  };
  const patch: Partial<Layer> = {};
  if (l.shape) {
    const s = l.shape;
    patch.shape = {
      ...s,
      fill: sw(s.fill),
      stroke: sw(s.stroke),
      gradient: s.gradient ? { ...s.gradient, stops: s.gradient.stops.map((st) => ({ ...st, color: sw(st.color) })) } : undefined,
      pattern: s.pattern ? { ...s.pattern, fg: sw(s.pattern.fg), bg: s.pattern.bg ? sw(s.pattern.bg) : undefined } : undefined,
      strokeGradient: s.strokeGradient ? { ...s.strokeGradient, stops: s.strokeGradient.stops.map((st) => ({ ...st, color: sw(st.color) })) } : undefined,
      mesh: s.mesh?.map((m) => ({ ...m, color: sw(m.color) })),
    };
  }
  if (l.text) {
    const t = l.text;
    patch.text = { ...t, color: sw(t.color), strokeColor: sw(t.strokeColor), boxColor: t.boxColor ? sw(t.boxColor) : t.boxColor, runs: t.runs?.map((r) => (r.color ? { ...r, color: sw(r.color) } : r)) };
  }
  return Object.keys(patch).length ? withLayer(l, patch) : l;
}

/** Hue / saturation / brightness shift of every colour (degrees, and -100..100 for the others). */
export function shiftedMap(colors: string[], dh: number, ds = 0, db = 0): ColorMap {
  return Object.fromEntries(
    colors.map((c) => {
      const [h, s, v] = rgbToHsb(hexToRgb(c));
      return [c, rgbToHex(hsbToRgb((((h + dh) % 360) + 360) % 360, Math.max(0, Math.min(100, s + ds)), Math.max(0, Math.min(100, v + db))))];
    })
  );
}

const lightness = (c: string) => {
  const [r, g, b] = hexToRgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Assigns palette colours by lightness: the darkest original gets the darkest palette colour, and so on. */
export function paletteMap(colors: string[], palette: string[]): ColorMap {
  if (!palette.length) return {};
  const src = [...colors].sort((a, b) => lightness(a) - lightness(b));
  const pal = [...palette].map(colorKey).sort((a, b) => lightness(a) - lightness(b));
  return Object.fromEntries(src.map((c, i) => [c, pal[src.length === 1 ? Math.floor(pal.length / 2) : Math.round((i * (pal.length - 1)) / Math.max(1, src.length - 1))]]));
}

/** The current new colours, shuffled among the originals. */
export function shuffledMap(colors: string[], map: ColorMap, rnd = Math.random): ColorMap {
  const vals = colors.map((c) => map[c] ?? c);
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return Object.fromEntries(colors.map((c, i) => [c, vals[i]]));
}

/** Live preview of a map on the selection (not an undo step); `commit` records it. */
export function previewRecolor(map: ColorMap, ids: string[]) {
  const doc = store.doc;
  if (!doc) return;
  const base = doc.history[doc.hIndex].layers;
  const targets = new Set(recolorTargets(base, base.filter((l) => ids.includes(l.id))).map((l) => l.id));
  store.live({ layers: base.map((l) => (targets.has(l.id) ? recolorLayer(l, map) : l)) });
}

export function commitRecolor(map: ColorMap, ids: string[]): boolean {
  const doc = store.doc;
  if (!doc) return false;
  const base = doc.history[doc.hIndex].layers;
  const targets = new Set(recolorTargets(base, base.filter((l) => ids.includes(l.id))).map((l) => l.id));
  const changed = Object.entries(map).some(([a, b]) => colorKey(a) !== colorKey(b));
  if (!changed) {
    store.revert();
    return false;
  }
  store.commit('Recolor Artwork', { layers: base.map((l) => (targets.has(l.id) ? recolorLayer(l, map) : l)) }, { icon: 'color' });
  return true;
}
