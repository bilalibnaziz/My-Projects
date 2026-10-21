// Auto Tune: measures the photo, then builds an editable adjustment (never baked pixels).
// Auto Tone / Contrast / Color / White Balance use exact per-channel curves; intent presets
// (Food, Portrait, Landscape, Product, Night, Real Estate, Social Pop) add tuned slider moves on top.
// Pure functions (unit tested); the app wraps them in adjustment layers.

import type { Adjust, CurvePoint } from './types';
import { wbMultipliers } from './gl';

export interface PhotoStats {
  /** Luminance percentiles 0..255 (0.5 %, 50 %, 99.5 %). */
  lo: number;
  mid: number;
  hi: number;
  /** Per-channel clip points (0.5 % / 99.5 %). */
  chLo: [number, number, number];
  chHi: [number, number, number];
  /** Average colour of the near-neutral midtones (what should be grey), or of everything. */
  neutral: [number, number, number];
  /** Mean saturation 0..1 and luminance spread. */
  saturation: number;
  contrast: number;
  /** Share of clipped highlights / crushed shadows. */
  clipHi: number;
  clipLo: number;
  /** Share of skin-like pixels (for portrait-safe defaults). */
  skin: number;
}

/** Analyses RGBA pixels (subsampled to ~250k for speed). */
export function analyze(data: Uint8ClampedArray | Uint8Array, mask?: Uint8Array | null): PhotoStats {
  const n = data.length / 4;
  const step = Math.max(1, Math.floor(n / 250000));
  const hL = new Uint32Array(256);
  const hC = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let cnt = 0, sat = 0, sumL = 0, sumL2 = 0, skin = 0;
  let nr = 0, ng = 0, nb = 0, nn = 0, ar = 0, ag = 0, ab = 0;
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    if (data[i + 3] < 128 || (mask && mask[p] < 128)) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const L = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    hL[L]++;
    hC[0][r]++;
    hC[1][g]++;
    hC[2][b]++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx ? (mx - mn) / mx : 0;
    sat += s;
    sumL += L;
    sumL2 += L * L;
    ar += r;
    ag += g;
    ab += b;
    cnt++;
    // Near-neutral midtones: what a grey card would look like under this light
    if (s < 0.25 && L > 50 && L < 235) {
      nr += r;
      ng += g;
      nb += b;
      nn++;
    }
    if (r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15) skin++;
  }
  if (!cnt) return { lo: 0, mid: 128, hi: 255, chLo: [0, 0, 0], chHi: [255, 255, 255], neutral: [128, 128, 128], saturation: 0, contrast: 0, clipHi: 0, clipLo: 0, skin: 0 };
  const pct = (h: Uint32Array, q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += h[v];
      if (acc >= cnt * q) return v;
    }
    return 255;
  };
  const mean = sumL / cnt;
  const useNeutral = nn > cnt * 0.04;
  return {
    lo: pct(hL, 0.005),
    mid: pct(hL, 0.5),
    hi: pct(hL, 0.995),
    chLo: [pct(hC[0], 0.005), pct(hC[1], 0.005), pct(hC[2], 0.005)],
    chHi: [pct(hC[0], 0.995), pct(hC[1], 0.995), pct(hC[2], 0.995)],
    neutral: useNeutral ? [nr / nn, ng / nn, nb / nn] : [ar / cnt, ag / cnt, ab / cnt],
    saturation: sat / cnt,
    contrast: Math.sqrt(Math.max(0, sumL2 / cnt - mean * mean)),
    clipHi: (hL[255] + hL[254]) / cnt,
    clipLo: (hL[0] + hL[1]) / cnt,
    skin: skin / cnt,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const identity = (): CurvePoint[] => [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

/** Sorted, de-duplicated, strictly increasing x curve. */
function curve(points: [number, number][]): CurvePoint[] {
  const pts = points
    .map(([x, y]) => ({ x: Math.round(clamp(x, 0, 255)), y: Math.round(clamp(y, 0, 255)) }))
    .sort((a, b) => a.x - b.x)
    .filter((p, i, a) => i === 0 || p.x > a[i - 1].x + 2);
  if (pts[0].x > 0) pts.unshift({ x: 0, y: 0 });
  if (pts[pts.length - 1].x < 255) pts.push({ x: 255, y: 255 });
  return pts;
}

/** Scales a curve toward identity (strength 0..1). */
export function scaleCurve(c: CurvePoint[], k: number): CurvePoint[] {
  return c.map((p) => ({ x: p.x, y: Math.round(p.x + (p.y - p.x) * k) }));
}

/** Auto Contrast: stretch luminance between the clip points, keeping colour balance. */
export function autoContrast(s: PhotoStats): Partial<Adjust> {
  const lo = Math.min(s.lo, 80);
  const hi = Math.max(s.hi, 170);
  const c = curve([
    [lo, 0],
    [hi, 255],
  ]);
  return { curves: { rgb: c, r: identity(), g: identity(), b: identity() } };
}

/** Auto Tone: stretch each channel on its own (also removes casts that live in the shadows/highlights). */
export function autoTone(s: PhotoStats): Partial<Adjust> {
  const ch = (k: 0 | 1 | 2) =>
    curve([
      [Math.min(s.chLo[k], 90), 0],
      [Math.max(s.chHi[k], 160), 255],
    ]);
  return { curves: { rgb: identity(), r: ch(0), g: ch(1), b: ch(2) } };
}

/**
 * Temperature / Tint that make `rgb` neutral grey (inverse of the engine's white-balance multipliers,
 * applied in linear light). Editable sliders instead of opaque curves.
 */
export function wbFor(rgb: [number, number, number]): { temperature: number; tint: number } {
  const lin = rgb.map((v) => Math.pow(Math.max(1, v) / 255, 2.2));
  const A = lin[1] / lin[0];
  const B = lin[1] / lin[2];
  const m = (A + B - 2) / (0.16 + 0.22 * (A + B));
  const t = ((A - B) * (1 - 0.22 * m)) / 0.64;
  return { temperature: Math.round(clamp(t * 100, -100, 100)), tint: Math.round(clamp(m * 100, -100, 100)) };
}

/**
 * Full white balance for a colour that should be neutral: Temperature / Tint as far as their range goes,
 * plus exact per-channel curves for whatever cast is left (curves run after white balance in the engine).
 */
export function neutralize(rgb: [number, number, number], strength = 1): Partial<Adjust> {
  const wb = wbFor(rgb);
  const temperature = Math.round(wb.temperature * strength);
  const tint = Math.round(wb.tint * strength);
  const m = wbMultipliers(temperature, tint);
  const after = rgb.map((v, k) => Math.pow(Math.pow(Math.max(1, v) / 255, 2.2) * m[k], 1 / 2.2) * 255) as [number, number, number];
  const out: Partial<Adjust> = { temperature, tint };
  if (strength >= 0.99 && Math.max(...after) - Math.min(...after) > 2) {
    const target = 0.2126 * after[0] + 0.7152 * after[1] + 0.0722 * after[2];
    const one = (v: number) => curve([[v, target]]);
    out.curves = { rgb: identity(), r: one(after[0]), g: one(after[1]), b: one(after[2]) };
  }
  return out;
}

/** Auto White Balance: neutralises the colour cast of the midtones. */
export function autoWhiteBalance(s: PhotoStats): Partial<Adjust> {
  return neutralize(s.neutral);
}

/** White balance from a clicked pixel that should be neutral grey or white. */
export function whiteBalanceFrom(rgb: [number, number, number]): Partial<Adjust> {
  return neutralize(rgb);
}

/** Auto Color: per-channel clip points plus a neutral midpoint (Photoshop's "find dark & light colours" + "snap neutral midtones"). */
export function autoColor(s: PhotoStats): Partial<Adjust> {
  const target = 0.2126 * s.neutral[0] + 0.7152 * s.neutral[1] + 0.0722 * s.neutral[2];
  const ch = (k: 0 | 1 | 2) => {
    const lo = Math.min(s.chLo[k], 90);
    const hi = Math.max(s.chHi[k], 160);
    const m = clamp(s.neutral[k], lo + 8, hi - 8);
    // The neutral's grey level, measured on the stretched scale
    const tLo = Math.min(...s.chLo.map((v) => Math.min(v, 90)));
    const tHi = Math.max(...s.chHi.map((v) => Math.max(v, 160)));
    const t = ((target - tLo) / Math.max(1, tHi - tLo)) * 255;
    return curve([
      [lo, 0],
      [m, t],
      [hi, 255],
    ]);
  };
  return { curves: { rgb: identity(), r: ch(0), g: ch(1), b: ch(2) } };
}

export type Intent = 'auto' | 'food' | 'portrait' | 'landscape' | 'product' | 'night' | 'realestate' | 'social';

interface IntentRecipe {
  label: string;
  hint: string;
  /** Where the median brightness should land (0..1). */
  mid: number;
  /** How much of the measured cast to remove (product shots want it all, food keeps some warmth). */
  neutralize: number;
  moves: Partial<Pick<Adjust, 'temperature' | 'tint' | 'vibrance' | 'saturation' | 'clarity' | 'dehaze' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'sharpen' | 'vignette'>>;
}

export const INTENTS: Record<Intent, IntentRecipe> = {
  auto: { label: 'Auto', hint: 'Balanced fix for any photo', mid: 0.47, neutralize: 0.8, moves: { vibrance: 15, clarity: 8, contrast: 8 } },
  food: { label: 'Food', hint: 'Warm, appetising colour and crisp texture', mid: 0.52, neutralize: 0.6, moves: { temperature: 10, tint: 3, vibrance: 28, saturation: 6, clarity: 16, contrast: 12, shadows: 12, sharpen: 25 } },
  portrait: { label: 'Portrait', hint: 'Natural skin, soft contrast, open shadows', mid: 0.52, neutralize: 0.8, moves: { temperature: 4, vibrance: 10, saturation: -4, clarity: -8, contrast: 4, highlights: -15, shadows: 14 } },
  landscape: { label: 'Landscape', hint: 'Clear air, rich colour, detail in sky and shadows', mid: 0.45, neutralize: 0.7, moves: { temperature: 3, vibrance: 32, clarity: 20, dehaze: 18, contrast: 14, highlights: -35, shadows: 22, sharpen: 20 } },
  product: { label: 'Product', hint: 'True colours, clean whites, crisp edges', mid: 0.56, neutralize: 1, moves: { vibrance: 8, clarity: 12, contrast: 14, whites: 15, blacks: -5, sharpen: 30 } },
  night: { label: 'Night', hint: 'Lift the dark, tame bright lights', mid: 0.36, neutralize: 0.5, moves: { temperature: -5, vibrance: 15, clarity: 10, dehaze: 8, highlights: -30, shadows: 32, blacks: 8 } },
  realestate: { label: 'Real Estate', hint: 'Bright, airy rooms with window detail', mid: 0.57, neutralize: 0.9, moves: { temperature: 3, vibrance: 12, clarity: 8, highlights: -45, shadows: 40, whites: 10 } },
  social: { label: 'Social Pop', hint: 'Bold, punchy colour that stands out in a feed', mid: 0.5, neutralize: 0.7, moves: { temperature: 4, vibrance: 30, saturation: 8, clarity: 15, contrast: 18, sharpen: 20, vignette: -10 } },
};

/**
 * Smart Auto Tune for an intent: neutralises the cast (curves), sets exposure from the measured median,
 * protects clipped highlights and crushed shadows, then adds the intent's style. `strength` 0..1.
 */
export function smartTune(s: PhotoStats, intent: Intent, strength = 1): Partial<Adjust> {
  const r = INTENTS[intent];
  const k = clamp(strength, 0, 1);
  // Remove the measured cast with Temperature / Tint (partly, for intents that want some warmth)
  const wb = wbFor(s.neutral);
  // Tonal range: stretch with levels, then exposure to put the median where the intent wants it
  const lo = Math.min(s.lo, 60);
  const hi = Math.max(s.hi, 190);
  const stretchedMid = clamp((s.mid - lo) / Math.max(1, hi - lo), 0.02, 0.98);
  const exposure = clamp(Math.log2(r.mid / stretchedMid) * 0.6, -1.5, 1.5);
  const out: Partial<Adjust> = {
    levels: { inBlack: Math.round(lo * k), inWhite: Math.round(255 - (255 - hi) * k), gamma: 1, outBlack: 0, outWhite: 255 },
    exposure: Math.round(exposure * k * 100) / 100,
  };
  const m = { ...r.moves };
  // Protect: clipped highlights and crushed shadows pull those sliders further
  if (s.clipHi > 0.01) m.highlights = (m.highlights ?? 0) - 20;
  if (s.clipLo > 0.02) m.shadows = (m.shadows ?? 0) + 15;
  // Flat pictures get more contrast, punchy ones less
  if (s.contrast < 40) m.contrast = (m.contrast ?? 0) + 10;
  if (s.contrast > 75) m.contrast = (m.contrast ?? 0) - 8;
  // Already very colourful: hold back saturation; skin-heavy shots keep vibrance (skin-safe) over saturation
  if (s.saturation > 0.45) m.vibrance = Math.round((m.vibrance ?? 0) * 0.5);
  if (s.skin > 0.15 && intent !== 'portrait') m.saturation = Math.min(m.saturation ?? 0, 0);
  m.temperature = wb.temperature * r.neutralize + (m.temperature ?? 0);
  m.tint = wb.tint * r.neutralize + (m.tint ?? 0);
  for (const [key, v] of Object.entries(m) as [keyof typeof m, number][]) (out as Record<string, number>)[key] = Math.round(clamp(v * k, -100, 100));
  // Intents that want truly neutral colour also remove what the sliders can't reach
  if (r.neutralize >= 0.99 && k > 0) {
    const nz = neutralize(s.neutral);
    if (nz.curves) out.curves = { rgb: identity(), r: scaleCurve(nz.curves.r, k), g: scaleCurve(nz.curves.g, k), b: scaleCurve(nz.curves.b, k) };
  }
  return out;
}
