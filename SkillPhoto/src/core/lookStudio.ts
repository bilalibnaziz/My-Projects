// Look Studio: Instagram-style editing of any look (built-in, imported .cube, matched or your own). The
// sliders are a recipe applied *after* the look's own colours (they start at 0), baked live into the look
// layer's LUT, so the result stays one non-destructive layer that exports as .cube and saves to My Looks.
// Also: looks suggested for the open photo from its colours.

import { store } from './store';
import type { Layer } from './types';
import { withLayer } from './types';
import { decodeLut, encodeLut, type Lut3D } from './lut';
import { gradeFunction, sampleLut, LOOKS, type Look, type LookCategory, type LookRecipe } from './looks';
import { addMyLook, applyLook, currentLookLayer, LOOK_PREFIX, lookSource, type MyLook } from './lookOps';
import { ctx2d } from './canvas';

// ================================================================ the sliders

export interface TweakSlider {
  id: string;
  label: string;
  group: 'Light' | 'Color' | 'Tone' | 'Split' | 'Colors';
  min: number;
  max: number;
  /** Slider units → recipe value. */
  get: (r: LookRecipe) => number;
  set: (r: LookRecipe, v: number) => LookRecipe;
  /** Hue sliders draw a rainbow track. */
  hue?: boolean;
}

const num = (key: 'exposure' | 'temp' | 'tint' | 'contrast' | 'shadows' | 'highlights' | 'fade' | 'sat' | 'vib', k: number) => ({
  get: (r: LookRecipe) => Math.round(((r[key] ?? 0) / k) * 100) / 1,
  set: (r: LookRecipe, v: number) => ({ ...r, [key]: v ? (v / 100) * k : undefined }),
});

const band = (b: 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta') => ({
  get: (r: LookRecipe) => Math.round((r.hsl?.[b]?.[1] ?? 0) * 100),
  set: (r: LookRecipe, v: number) => {
    const hsl = { ...(r.hsl ?? {}) };
    const cur = hsl[b] ?? [0, 0, 0];
    const next: [number, number, number] = [cur[0], v / 100, cur[2]];
    if (!next[0] && !next[1] && !next[2]) delete hsl[b];
    else hsl[b] = next;
    return { ...r, hsl: Object.keys(hsl).length ? hsl : undefined };
  },
});

const split = (which: 'shadow' | 'highlight', part: 0 | 1) => ({
  get: (r: LookRecipe) => {
    const v = r.split?.[which];
    return part === 0 ? Math.round(v?.[0] ?? (which === 'shadow' ? 210 : 40)) : Math.round(((v?.[1] ?? 0) / 0.4) * 100);
  },
  set: (r: LookRecipe, v: number) => {
    const sp = { ...(r.split ?? {}) };
    const cur = sp[which] ?? [which === 'shadow' ? 210 : 40, 0];
    sp[which] = part === 0 ? [v, cur[1]] : [cur[0], (v / 100) * 0.4];
    if (!sp[which]![1]) {
      // Keep the chosen hue for when the strength goes up again, but no toning while it is 0
      sp[which] = [sp[which]![0], 0];
    }
    return { ...r, split: sp };
  },
});

export const TWEAK_SLIDERS: TweakSlider[] = [
  { id: 'exposure', label: 'Brightness', group: 'Light', min: -100, max: 100, ...num('exposure', 1) },
  { id: 'contrast', label: 'Contrast', group: 'Light', min: -100, max: 100, ...num('contrast', 1) },
  { id: 'highlights', label: 'Highlights', group: 'Light', min: -100, max: 100, ...num('highlights', 1) },
  { id: 'shadows', label: 'Shadows', group: 'Light', min: -100, max: 100, ...num('shadows', 1) },
  { id: 'fade', label: 'Fade', group: 'Tone', min: 0, max: 100, ...num('fade', 0.25) },
  { id: 'temp', label: 'Warmth', group: 'Color', min: -100, max: 100, ...num('temp', 1) },
  { id: 'tint', label: 'Tint', group: 'Color', min: -100, max: 100, ...num('tint', 1) },
  { id: 'sat', label: 'Saturation', group: 'Color', min: -100, max: 100, ...num('sat', 1) },
  { id: 'vib', label: 'Vibrance', group: 'Color', min: -100, max: 100, ...num('vib', 1) },
  { id: 'sh-hue', label: 'Shadow tint', group: 'Split', min: 0, max: 360, hue: true, ...split('shadow', 0) },
  { id: 'sh-amt', label: 'Shadow amount', group: 'Split', min: 0, max: 100, ...split('shadow', 1) },
  { id: 'hi-hue', label: 'Highlight tint', group: 'Split', min: 0, max: 360, hue: true, ...split('highlight', 0) },
  { id: 'hi-amt', label: 'Highlight amount', group: 'Split', min: 0, max: 100, ...split('highlight', 1) },
  { id: 'red', label: 'Reds', group: 'Colors', min: -100, max: 100, ...band('red') },
  { id: 'orange', label: 'Oranges & skin', group: 'Colors', min: -100, max: 100, ...band('orange') },
  { id: 'yellow', label: 'Yellows', group: 'Colors', min: -100, max: 100, ...band('yellow') },
  { id: 'green', label: 'Greens', group: 'Colors', min: -100, max: 100, ...band('green') },
  { id: 'blue', label: 'Blues & sky', group: 'Colors', min: -100, max: 100, ...band('blue') },
];

/** True when the recipe changes nothing. */
export function isNeutral(r: LookRecipe | undefined): boolean {
  if (!r) return true;
  return TWEAK_SLIDERS.every((s) => (s.id.endsWith('-hue') ? true : !s.get(r)));
}

// ================================================================ baking

/** `tweak(base(rgb))` as a new LUT of the base's size. A missing base is the identity. */
export function composeLut(base: Lut3D | null, tweak: LookRecipe, size = base?.size ?? 25): Lut3D {
  const f = gradeFunction(tweak);
  const data = new Float32Array(size * size * size * 3);
  const n = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [r1, g1, b1] = base ? sampleLut(base, r / n, g / n, b / n) : [r / n, g / n, b / n];
        const o = f(r1, g1, b1);
        data[i++] = o[0];
        data[i++] = o[1];
        data[i++] = o[2];
      }
    }
  }
  return { size, data };
}

const baseOf = (l: Layer): { size: number; data: string } => {
  const lut = l.adjust!.lut!;
  return lut.base ?? { size: lut.size, data: lut.data };
};

/** Name of the look as edited: "Name (edited)" once, never stacked. */
const editedName = (name: string) => (/\(edited\)$/.test(name) ? name : `${name} (edited)`);

/** The tweak recipe of the selected look layer (empty when it was never edited). */
export const currentTweak = (): LookRecipe => currentLookLayer()?.adjust?.lut?.tweak ?? {};

/**
 * Edits the selected look layer live: bakes `tweak` on top of its original colours. One undo step per
 * editing session (coalesced). Without a look layer, starts a blank "Custom" look first.
 */
export function editLook(tweak: LookRecipe): Layer | null {
  const doc = store.doc;
  if (!doc) return null;
  let cur = currentLookLayer(doc);
  if (!cur) {
    const blank = composeLut(null, {}, 25);
    cur = applyLook({ name: 'Custom', size: blank.size, data: encodeLut(blank) });
    if (!cur) return null;
  }
  const d = store.doc!;
  cur = d.layers.find((l) => l.id === cur!.id) ?? cur;
  const lut = cur.adjust!.lut!;
  const base = baseOf(cur);
  const baseLut = { size: base.size, data: decodeLut(base.data, base.size) };
  const out = isNeutral(tweak) ? baseLut : composeLut(baseLut, tweak, Math.min(33, base.size));
  const name = isNeutral(tweak) ? lut.name.replace(/ \(edited\)$/, '') : editedName(lut.name);
  const next = withLayer(cur, {
    name: LOOK_PREFIX + name,
    adjust: { ...cur.adjust!, lut: { ...lut, name, size: out.size, data: isNeutral(tweak) ? base.data : encodeLut(out), base, tweak: isNeutral(tweak) ? undefined : tweak } },
  });
  store.commit(`Edit Look`, { layers: d.layers.map((l) => (l.id === cur!.id ? next : l)) }, { coalesce: `look-edit-${cur.id}` });
  return next;
}

/** Saves the selected look (with its edits) to My Looks, so it is one tap away in every photo. */
export function saveLookAsMine(name?: string): MyLook | null {
  const cur = currentLookLayer();
  const lut = cur?.adjust?.lut;
  if (!cur || !lut) {
    store.toast('Apply or edit a look first');
    return null;
  }
  const title = (name ?? lut.name).trim() || 'My Look';
  const look = addMyLook(title, { size: lut.size, data: decodeLut(lut.data, lut.size) }, 'custom');
  if (look) store.toast(`Saved “${title}” to My Looks`, 'success');
  return look;
}

// ================================================================ suggestions

export interface PhotoProfile {
  /** Share of colourful pixels by kind (0..1). */
  warm: number;
  green: number;
  sky: number;
  skin: number;
  /** Mean luminance and saturation (0..1). */
  lum: number;
  sat: number;
}

/** Colour profile of RGBA pixels (sampled every `step` pixels). */
export function photoProfile(px: Uint8ClampedArray, step = 1): PhotoProfile {
  let n = 0, warm = 0, green = 0, sky = 0, skin = 0, lum = 0, sat = 0;
  for (let i = 0; i < px.length; i += 4 * step) {
    if (px[i + 3] < 128) continue;
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    const s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1) + 1e-6);
    let h = 0;
    if (d > 1e-6) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    n++;
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat += s;
    if (s > 0.2 && l > 0.12 && l < 0.92) {
      if (h < 55 || h >= 340) warm++;
      else if (h >= 70 && h < 165) green++;
      else if (h >= 185 && h < 250) sky++;
    }
    // Skin: warm hue with modest chroma (a fried crust or a tomato is far more saturated)
    if (h >= 8 && h < 45 && d > 0.08 && d < 0.42 && l > 0.3 && l < 0.85 && r > g && g > b) skin++;
  }
  const k = 1 / Math.max(1, n);
  return { warm: warm * k, green: green * k, sky: sky * k, skin: skin * k, lum: lum * k, sat: sat * k };
}

/** Categories that fit a photo, best first, with a reason for the panel. */
export function suggestCategories(p: PhotoProfile): { category: LookCategory; why: string }[] {
  const score: { category: LookCategory; s: number; why: string }[] = [
    { category: 'Night', s: p.lum < 0.22 ? 2 : 0, why: 'low light' },
    { category: 'Food', s: p.warm * 2.6 + (p.sat > 0.3 ? 0.2 : 0) - p.sky * 1.5 - p.skin, why: 'warm, appetising colours' },
    { category: 'Portrait', s: p.skin * 4, why: 'skin tones' },
    { category: 'Landscape', s: (p.green + p.sky) * 2.2, why: 'greens and sky' },
    { category: 'Travel', s: p.sky * 2 + p.warm * 0.6, why: 'sky and colour' },
    { category: 'Product', s: p.sat < 0.18 && p.lum > 0.55 ? 0.9 : 0.15, why: 'clean, bright background' },
    { category: 'Black & White', s: p.sat < 0.1 ? 1.2 : 0.05, why: 'already low colour' },
    { category: 'Moody', s: p.lum < 0.35 ? 0.8 : 0.1, why: 'dark tones' },
    { category: 'Film', s: 0.3, why: 'works on most photos' },
    { category: 'Cinematic', s: 0.28, why: 'works on most photos' },
  ];
  return score.sort((a, b) => b.s - a.s).map(({ category, why }) => ({ category, why }));
}

/** Up to `n` looks for the open photo: the best categories first, alternating so the picks are varied. */
export function suggestLooks(n = 8): { look: Look; why: string }[] {
  const doc = store.doc;
  if (!doc) return [];
  const c = lookSource(doc, 160);
  const prof = photoProfile(ctx2d(c).getImageData(0, 0, c.width, c.height).data, 1);
  return pickLooks(prof, n);
}

export function pickLooks(prof: PhotoProfile, n = 8): { look: Look; why: string }[] {
  const cats = suggestCategories(prof).slice(0, 3);
  const pools = cats.map((c) => ({ why: c.why, list: LOOKS.filter((l) => l.category === c.category) }));
  // Two thirds from the best category, then the others
  const out: { look: Look; why: string }[] = [];
  const take = [Math.ceil(n * 0.5), Math.ceil(n * 0.3), n];
  pools.forEach((p, i) => {
    for (const look of p.list) {
      if (out.length >= Math.min(n, take.slice(0, i + 1).reduce((a, b) => a + b, 0)) || out.length >= n) break;
      if (!out.some((o) => o.look.id === look.id)) out.push({ look, why: p.why });
    }
  });
  return out.slice(0, n);
}
