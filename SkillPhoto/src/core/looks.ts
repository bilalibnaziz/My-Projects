// Looks: one-click colour grades for photos (food, portrait, wedding, travel, film, cinematic…).
// Each look is a recipe of photographic controls — white balance, exposure, a tone curve, per-hue
// HSL, saturation / vibrance, split toning, black & white mixing — evaluated in plain math, so it
// bakes into an exact 3D LUT (.cube) that the GPU applies live on a Color Lookup layer.
// Identical copy in SkillPhoto and SkillDesign: change both.

/** A 3D LUT: RGB triplets 0..1, red fastest, then green, then blue (the .cube order). */
export interface Lut3D {
  size: number;
  data: Float32Array;
}

export type LookCategory =
  | 'Food'
  | 'Portrait'
  | 'Wedding'
  | 'Landscape'
  | 'Travel'
  | 'Street'
  | 'Film'
  | 'Cinematic'
  | 'Black & White'
  | 'Vintage'
  | 'Moody'
  | 'Product'
  | 'Night'
  | 'Natural'
  | 'Creative';

export const LOOK_CATEGORIES: LookCategory[] = ['Natural', 'Food', 'Creative', 'Portrait', 'Wedding', 'Landscape', 'Travel', 'Street', 'Film', 'Cinematic', 'Black & White', 'Vintage', 'Moody', 'Product', 'Night'];

export type HueBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
type CurvePt = [number, number];

export interface LookRecipe {
  /** Exposure in stops (applied in linear light). */
  exposure?: number;
  /** White balance: + warmer / − cooler, and + magenta / − green (about −1..1). */
  temp?: number;
  tint?: number;
  /** Tone: S-curve strength, shadow / highlight lifts (−1..1). */
  contrast?: number;
  shadows?: number;
  highlights?: number;
  /** Matte black (lifted output black), black crush (input), highlight roll-off (lowered white), 0..0.3. */
  fade?: number;
  crush?: number;
  roll?: number;
  /** Per-channel curves (input → output, 0..1) for cross-processed and film looks. */
  rgb?: { r?: CurvePt[]; g?: CurvePt[]; b?: CurvePt[] };
  /** Per-hue shifts: [hue degrees, saturation −1..1, lightness −1..1]. */
  hsl?: Partial<Record<HueBand, [number, number, number]>>;
  /** Global saturation and vibrance (−1..1). */
  sat?: number;
  vib?: number;
  /** Split toning: [hue, strength 0..0.4] for shadows and highlights. */
  split?: { shadow?: [number, number]; highlight?: [number, number] };
  /** Black & white: channel weights, optional midtone toning [hue, strength]. */
  mono?: { r: number; g: number; b: number; tone?: [number, number] };
}

export interface Look {
  id: string;
  name: string;
  category: LookCategory;
  description: string;
  /** Swatch colour for compact lists. */
  tint: string;
  recipe: LookRecipe;
}

// ================================================================ colour math

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const toLin = (v: number) => Math.pow(Math.max(0, v), 2.2);
const toGam = (v: number) => Math.pow(Math.max(0, v), 1 / 2.2);

/** Monotone cubic (Fritsch–Carlson) through sorted points; never overshoots, so curves stay smooth. */
export function monotoneCurve(pts: CurvePt[]): (x: number) => number {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return (x) => x;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-9, p[i + 1][0] - p[i][0]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0];
    const t = (x - p[i][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const BAND_HUE: Record<HueBand, number> = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 225, purple: 275, magenta: 320 };
const BANDS = Object.keys(BAND_HUE) as HueBand[];

/** How much a hue belongs to a band: 1 at its centre, fading to 0 at the neighbouring bands. */
function bandWeight(h: number, band: HueBand): number {
  const i = BANDS.indexOf(band);
  const c = BAND_HUE[band];
  const prev = BAND_HUE[BANDS[(i + BANDS.length - 1) % BANDS.length]];
  const next = BAND_HUE[BANDS[(i + 1) % BANDS.length]];
  const span = (a: number, b: number) => (((b - a) % 360) + 360) % 360;
  const dh = ((((h - c) % 360) + 540) % 360) - 180;
  const width = dh >= 0 ? span(c, next) : span(prev, c);
  const t = Math.abs(dh) / width;
  return t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t);
}

/** Additive tint that leaves luminance unchanged. */
function tintOffset(hue: number): [number, number, number] {
  const [r, g, b] = hslToRgb(hue, 1, 0.5);
  const y = luma(r, g, b);
  return [r - y, g - y, b - y];
}

/** Turns a recipe into a colour function (0..1 RGB in, 0..1 RGB out). */
export function gradeFunction(rc: LookRecipe): (r: number, g: number, b: number) => [number, number, number] {
  const c = rc.contrast ?? 0;
  const tone = monotoneCurve([
    [0, 0],
    [0.25, 0.25 - 0.07 * c + 0.09 * (rc.shadows ?? 0)],
    [0.5, 0.5],
    [0.75, 0.75 + 0.07 * c + 0.09 * (rc.highlights ?? 0)],
    [1, 1],
  ]);
  const fade = rc.fade ?? 0, crush = rc.crush ?? 0, roll = rc.roll ?? 0;
  const cr = rc.rgb?.r ? monotoneCurve(rc.rgb.r) : null;
  const cg = rc.rgb?.g ? monotoneCurve(rc.rgb.g) : null;
  const cb = rc.rgb?.b ? monotoneCurve(rc.rgb.b) : null;
  const ev = Math.pow(2, rc.exposure ?? 0);
  const temp = rc.temp ?? 0, tint = rc.tint ?? 0;
  const wb: [number, number, number] = [1 + 0.14 * temp + 0.03 * tint, 1 - 0.09 * tint, 1 - 0.14 * temp + 0.03 * tint];
  const hsl = rc.hsl ? (Object.entries(rc.hsl) as [HueBand, [number, number, number]][]) : [];
  const shadowTint = rc.split?.shadow ? tintOffset(rc.split.shadow[0]).map((v) => v * rc.split!.shadow![1]) : null;
  const highTint = rc.split?.highlight ? tintOffset(rc.split.highlight[0]).map((v) => v * rc.split!.highlight![1]) : null;
  const monoTone = rc.mono?.tone ? tintOffset(rc.mono.tone[0]).map((v) => v * rc.mono!.tone![1]) : null;
  const sat = rc.sat ?? 0, vib = rc.vib ?? 0;
  const mapTone = (v: number) => {
    const x = crush ? clamp01((v - crush) / (1 - crush)) : v;
    return fade + clamp01(tone(x)) * (1 - roll - fade);
  };

  return (r0, g0, b0) => {
    // White balance and exposure in linear light, keeping neutral brightness
    let lr = toLin(r0), lg = toLin(g0), lb = toLin(b0);
    const y0 = luma(lr, lg, lb);
    lr *= wb[0]; lg *= wb[1]; lb *= wb[2];
    const y1 = luma(lr, lg, lb);
    const keep = y1 > 1e-6 ? (y0 / y1) * ev : ev;
    let r = toGam(lr * keep), g = toGam(lg * keep), b = toGam(lb * keep);
    // Pushed past white: scale the colour back as a whole so it keeps its hue instead of clipping to yellow / cyan
    const over = Math.max(r, g, b);
    if (over > 1) {
      r /= over;
      g /= over;
      b /= over;
    }
    r = mapTone(r); g = mapTone(g); b = mapTone(b);
    if (cr) r = clamp01(cr(r));
    if (cg) g = clamp01(cg(g));
    if (cb) b = clamp01(cb(b));
    // Per-hue HSL
    if (hsl.length) {
      let [h, s, l] = rgbToHsl(r, g, b);
      if (s > 0.001) {
        let dh = 0, ds = 0, dl = 0;
        for (const [band, [bh, bs, bl]] of hsl) {
          const w = bandWeight(h, band);
          if (!w) continue;
          dh += bh * w; ds += bs * w; dl += bl * w;
        }
        h += dh;
        s = clamp01(s * (1 + ds));
        // Lightness moves only as much as the colour is saturated, so greys stay put
        l = clamp01(l + dl * 0.5 * Math.min(1, s * 1.5) * (dl > 0 ? 1 - l : l));
        [r, g, b] = hslToRgb(h, s, l);
      }
    }
    // Saturation and vibrance about luminance
    if (sat || vib) {
      const y = luma(r, g, b);
      const cur = Math.max(r, g, b) - Math.min(r, g, b);
      const f = (1 + sat) * (1 + vib * (1 - cur) * (vib > 0 ? 1 : 0.6));
      r = y + (r - y) * f; g = y + (g - y) * f; b = y + (b - y) * f;
    }
    // Split toning: shadows and highlights tinted without changing brightness
    if (shadowTint || highTint) {
      const y = clamp01(luma(r, g, b));
      const ws = (1 - y) * (1 - y), wh = y * y;
      if (shadowTint) { r += shadowTint[0] * ws; g += shadowTint[1] * ws; b += shadowTint[2] * ws; }
      if (highTint) { r += highTint[0] * wh; g += highTint[1] * wh; b += highTint[2] * wh; }
    }
    // Black & white with an optional midtone tone (sepia, selenium…)
    if (rc.mono) {
      const m = rc.mono;
      const sum = m.r + m.g + m.b || 1;
      const y = clamp01((r * m.r + g * m.g + b * m.b) / sum);
      r = g = b = y;
      if (monoTone) {
        const w = 4 * y * (1 - y);
        r += monoTone[0] * w; g += monoTone[1] * w; b += monoTone[2] * w;
      }
    }
    return [clamp01(r), clamp01(g), clamp01(b)];
  };
}

/** Bakes a look into a 3D LUT (default 33³, the usual size for grading LUTs). */
export function bakeLook(recipe: LookRecipe, size = 33): Lut3D {
  const f = gradeFunction(recipe);
  const data = new Float32Array(size * size * size * 3);
  let k = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [nr, ng, nb] = f(r / (size - 1), g / (size - 1), b / (size - 1));
        data[k++] = nr;
        data[k++] = ng;
        data[k++] = nb;
      }
    }
  }
  return { size, data };
}

/** Trilinear lookup of one colour (0..1) in a LUT. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size - 1;
  const fr = clamp01(r) * n, fg = clamp01(g) * n, fb = clamp01(b) * n;
  const r0 = Math.min(n - 1, Math.floor(fr)), g0 = Math.min(n - 1, Math.floor(fg)), b0 = Math.min(n - 1, Math.floor(fb));
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const s = lut.size;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => lut.data[((bi * s + gi) * s + ri) * 3 + c];
    const c00 = at(r0, g0, b0) * (1 - tr) + at(r0 + 1, g0, b0) * tr;
    const c10 = at(r0, g0 + 1, b0) * (1 - tr) + at(r0 + 1, g0 + 1, b0) * tr;
    const c01 = at(r0, g0, b0 + 1) * (1 - tr) + at(r0 + 1, g0, b0 + 1) * tr;
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1) * tr;
    out[c] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
  }
  return out;
}

/** Applies a LUT to RGBA pixels in place, blended by `amount` (0..1). Used for thumbnails and exports. */
export function applyLutToPixels(px: Uint8ClampedArray, lut: Lut3D, amount = 1) {
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = sampleLut(lut, px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    px[i] = px[i] + (r * 255 - px[i]) * amount;
    px[i + 1] = px[i + 1] + (g * 255 - px[i + 1]) * amount;
    px[i + 2] = px[i + 2] + (b * 255 - px[i + 2]) * amount;
  }
}

// ================================================================ Match Look

/** sRGB (0..1) → CIE Lab. */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function labToRgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const inv = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  return [clamp01(gam(R)), clamp01(gam(G)), clamp01(gam(B))];
}

export interface ColorStats {
  mean: [number, number, number];
  std: [number, number, number];
}

/** Mean and spread of an image's colours in Lab (every `step`-th pixel, opaque pixels only). */
export function colorStats(px: Uint8ClampedArray, step = 1): ColorStats {
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < px.length; i += 4 * step) {
    if (px[i + 3] < 128) continue;
    const lab = rgbToLab(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    for (let c = 0; c < 3; c++) {
      sum[c] += lab[c];
      sq[c] += lab[c] * lab[c];
    }
    n++;
  }
  n = Math.max(1, n);
  const mean = sum.map((s) => s / n) as [number, number, number];
  const std = sq.map((s, c) => Math.sqrt(Math.max(1e-6, s / n - mean[c] * mean[c]))) as [number, number, number];
  return { mean, std };
}

/**
 * Match Look: a LUT that moves `source` colours to `reference` colour statistics (Reinhard transfer
 * in Lab). Strength 0..1; contrast change is limited so a flat reference can't wipe out the image.
 */
export function matchLookLut(source: ColorStats, reference: ColorStats, strength = 1, size = 33): Lut3D {
  const k = clamp01(strength);
  const ratio = source.std.map((s, c) => {
    const r = reference.std[c] / Math.max(1e-3, s);
    return 1 + (Math.min(2.2, Math.max(0.45, r)) - 1) * k;
  });
  const f = (r: number, g: number, b: number): [number, number, number] => {
    const lab = rgbToLab(r, g, b);
    const out = lab.map((v, c) => {
      const target = (v - source.mean[c]) * ratio[c] + reference.mean[c];
      return v + (target - v) * k;
    }) as [number, number, number];
    return labToRgb(Math.max(0, Math.min(100, out[0])), out[1], out[2]);
  };
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const [nr, ng, nb] = f(ri / (size - 1), gi / (size - 1), bi / (size - 1));
    data[i++] = nr;
    data[i++] = ng;
    data[i++] = nb;
  }
  return { size, data };
}

// ================================================================ the library

const L = (id: string, name: string, category: LookCategory, tint: string, description: string, recipe: LookRecipe): Look => ({ id, name, category, tint, description, recipe });
const MONO = { r: 0.3, g: 0.59, b: 0.11 };

export const LOOKS: Look[] = [
  // ---------------- Food
  L('food-golden-bakery', 'Golden Bakery', 'Food', '#e0a043', 'Warm golden crusts and buttery highlights for bread, pastry and desserts', { temp: 0.25, exposure: 0.1, contrast: 0.15, vib: 0.15, hsl: { orange: [0, 0.15, 0.08], yellow: [-4, 0.1, 0.05] }, split: { shadow: [30, 0.06], highlight: [45, 0.06] } }),
  L('food-fresh-market', 'Fresh Market', 'Food', '#5cb85c', 'Crisp greens and clean whites for salads, herbs and produce', { temp: 0.05, contrast: 0.2, vib: 0.3, roll: 0.02, hsl: { green: [8, 0.25, 0.05], yellow: [-6, 0.1, 0.05], red: [0, 0.1, 0] } }),
  L('food-bright-brunch', 'Bright Brunch', 'Food', '#f3e2c4', 'Light and airy café look with open shadows', { exposure: 0.25, contrast: -0.05, fade: 0.03, highlights: -0.2, shadows: 0.25, sat: -0.05, temp: 0.08, hsl: { orange: [0, 0.05, 0.1] } }),
  L('food-dark-roast', 'Dark Roast', 'Food', '#5a3a26', 'Moody, rich food photography with deep shadows', { exposure: -0.15, contrast: 0.3, crush: 0.02, roll: 0.06, sat: -0.1, hsl: { orange: [-3, 0.1, -0.05], blue: [0, -0.4, -0.1] }, split: { shadow: [25, 0.08] } }),
  L('food-juicy-red', 'Juicy Red', 'Food', '#c73a3a', 'Rich reds for berries, tomatoes and grilled meat', { temp: 0.05, contrast: 0.2, vib: 0.2, hsl: { red: [2, 0.25, 0], magenta: [0, 0.1, 0] } }),
  L('food-street-night', 'Street Food Night', 'Food', '#e2793a', 'Glowing stall lights against cool night shadows', { temp: 0.15, contrast: 0.25, sat: 0.1, hsl: { orange: [0, 0.15, 0.05] }, split: { shadow: [200, 0.07], highlight: [35, 0.1] } }),
  L('food-clean-menu', 'Clean Menu', 'Food', '#f5f5f0', 'Bright, true-to-life colour for menus and delivery apps', { exposure: 0.15, contrast: 0.1, vib: 0.1, highlights: -0.1, shadows: 0.1 }),
  L('food-rustic-table', 'Rustic Table', 'Food', '#9b7a52', 'Earthy farmhouse tones with soft muted greens', { temp: 0.18, fade: 0.05, contrast: 0.1, sat: -0.15, hsl: { orange: [-5, 0.05, 0], green: [15, -0.3, -0.05] }, split: { shadow: [30, 0.1] } }),
  L('food-cocktail-bar', 'Cocktail Bar', 'Food', '#3f6f8f', 'Cool bar shadows with warm glass highlights for drinks', { temp: -0.05, contrast: 0.3, sat: 0.1, roll: 0.04, split: { shadow: [220, 0.13], highlight: [40, 0.13] } }),

  L('food-crisp-salad', 'Crisp Salad', 'Food', '#7cc26b', 'Snappy greens and bright tomatoes, natural not neon', { contrast: 0.12, vib: 0.22, exposure: 0.08, hsl: { green: [4, 0.18, 0.08], red: [0, 0.12, 0.02], yellow: [-8, -0.05, 0.04] } }),
  L('food-chocolate', 'Cocoa Rich', 'Food', '#6b4128', 'Deep browns and glossy highlights for chocolate, coffee and cakes', { contrast: 0.28, shadows: -0.1, temp: 0.12, sat: 0.05, hsl: { orange: [-4, 0.2, -0.08], red: [0, 0.08, -0.05] }, roll: 0.03 }),
  L('food-seafood-fresh', 'Seafood Fresh', 'Food', '#7fb8c9', 'Cool, clean whites with lively oranges for fish and sushi', { temp: -0.1, exposure: 0.12, contrast: 0.1, hsl: { orange: [0, 0.22, 0.04], aqua: [0, 0.15, 0.05], blue: [0, -0.15, 0.05] } }),

  // ---------------- Portrait
  L('portrait-soft-skin', 'Soft Skin', 'Portrait', '#f1c8b0', 'Gentle, flattering skin with softened contrast', { exposure: 0.1, contrast: -0.1, fade: 0.02, temp: 0.05, highlights: -0.15, hsl: { orange: [3, -0.1, 0.12], red: [5, -0.1, 0.05] } }),
  L('portrait-warm-glow', 'Warm Glow', 'Portrait', '#f0b07a', 'Sun-kissed warmth for outdoor portraits', { temp: 0.2, tint: 0.03, contrast: 0.05, hsl: { orange: [0, 0.05, 0.1] }, split: { highlight: [40, 0.1] } }),
  L('portrait-studio-clean', 'Studio Clean', 'Portrait', '#e8e1da', 'Neutral, polished studio portrait colour', { contrast: 0.15, vib: 0.05, roll: 0.02, shadows: 0.05, hsl: { orange: [0, -0.05, 0.05] } }),
  L('portrait-editorial-matte', 'Editorial Matte', 'Portrait', '#b8aea6', 'Magazine matte blacks and restrained colour', { fade: 0.07, contrast: 0.1, sat: -0.2, hsl: { orange: [0, 0, 0.06] }, split: { shadow: [210, 0.05] } }),
  L('portrait-golden-hour', 'Golden Hour', 'Portrait', '#f2a649', 'Late-afternoon light with glowing skin', { temp: 0.3, exposure: 0.05, roll: 0.03, hsl: { orange: [-3, 0.1, 0.1], yellow: [-8, 0.1, 0] }, split: { shadow: [20, 0.04], highlight: [35, 0.12] } }),
  L('portrait-cool-fashion', 'Cool Fashion', 'Portrait', '#7d93ad', 'Cool, crisp fashion grade with clean skin', { temp: -0.15, contrast: 0.25, sat: -0.1, hsl: { orange: [5, -0.1, 0.08], blue: [0, 0.1, -0.1] }, split: { shadow: [215, 0.1] } }),
  L('portrait-natural', 'Natural Tone', 'Portrait', '#d9b9a0', 'A light touch: true skin, a little extra life', { contrast: 0.08, vib: 0.1, hsl: { orange: [0, 0, 0.05] } }),
  L('portrait-bronze', 'Bronze', 'Portrait', '#a8693b', 'Deep bronzed skin and warm shadows', { temp: 0.22, contrast: 0.2, sat: -0.05, hsl: { orange: [-4, 0.2, -0.04] }, split: { shadow: [25, 0.1] } }),

  // ---------------- Wedding
  L('wedding-ivory', 'Ivory Romance', 'Wedding', '#f4ead8', 'Bright ivory whites and soft greenery', { exposure: 0.2, contrast: -0.08, fade: 0.04, temp: 0.1, sat: -0.1, hsl: { green: [20, -0.3, 0.1] }, split: { highlight: [40, 0.07] } }),
  L('wedding-blush', 'Blush', 'Wedding', '#f0c4c8', 'Delicate pink highlights for romantic scenes', { tint: 0.06, exposure: 0.15, contrast: -0.05, hsl: { red: [0, -0.05, 0.05] }, split: { shadow: [330, 0.04], highlight: [345, 0.09] } }),
  L('wedding-fine-art', 'Fine Art Pastel', 'Wedding', '#dfe3d6', 'Pastel film-like softness', { exposure: 0.2, fade: 0.08, contrast: -0.12, sat: -0.2, hsl: { green: [15, -0.4, 0.15], blue: [-10, -0.2, 0.15] } }),
  L('wedding-evergreen', 'Evergreen Vows', 'Wedding', '#4f7a5a', 'Deep forest greens for outdoor ceremonies', { contrast: 0.12, temp: 0.08, hsl: { green: [25, -0.15, -0.1] }, split: { shadow: [160, 0.05], highlight: [40, 0.07] } }),
  L('wedding-champagne', 'Champagne', 'Wedding', '#e9d3a6', 'Warm sparkling highlights for receptions', { temp: 0.12, exposure: 0.1, sat: -0.08, contrast: 0.05, split: { highlight: [45, 0.13] } }),

  // ---------------- Landscape
  L('land-vivid-peaks', 'Vivid Peaks', 'Landscape', '#3d7fc4', 'Bold skies, rich greens, recovered highlights', { contrast: 0.2, vib: 0.35, highlights: -0.2, shadows: 0.15, hsl: { blue: [0, 0.15, -0.12], green: [0, 0.15, 0] } }),
  L('land-autumn-gold', 'Autumn Gold', 'Landscape', '#c87f2a', 'Turns foliage to amber and gold', { temp: 0.15, contrast: 0.15, hsl: { orange: [-5, 0.25, 0], yellow: [-15, 0.2, 0], green: [-30, 0, -0.05] } }),
  L('land-alpine-clear', 'Alpine Clear', 'Landscape', '#8fc0e0', 'Cold clean air, deep blue sky', { temp: -0.08, contrast: 0.15, vib: 0.2, highlights: -0.15, hsl: { blue: [5, 0.2, -0.08], aqua: [-10, 0.15, 0] } }),
  L('land-desert-heat', 'Desert Heat', 'Landscape', '#d98a4a', 'Baked sand and dusty sky', { temp: 0.3, contrast: 0.2, hsl: { orange: [-4, 0.15, 0.05], blue: [10, -0.15, 0] }, split: { shadow: [20, 0.07] } }),
  L('land-misty-forest', 'Misty Forest', 'Landscape', '#7f9a8a', 'Soft fog and muted evergreen tones', { fade: 0.08, contrast: -0.05, temp: -0.05, sat: -0.15, hsl: { green: [20, -0.25, -0.05] }, split: { shadow: [170, 0.07] } }),
  L('land-ocean-blue', 'Ocean Blue', 'Landscape', '#2f8fb5', 'Clear turquoise water and deep blue', { temp: -0.1, contrast: 0.12, vib: 0.15, hsl: { aqua: [10, 0.2, 0], blue: [-5, 0.25, -0.05] } }),

  // ---------------- Travel
  L('travel-wanderlust', 'Wanderlust', 'Travel', '#d7a26a', 'Warm, inviting travel colour with clean blues', { temp: 0.1, contrast: 0.15, vib: 0.2, hsl: { blue: [-8, 0.1, -0.05], orange: [0, 0.1, 0.05] }, split: { shadow: [200, 0.05] } }),
  L('travel-mediterranean', 'Mediterranean', 'Travel', '#2a7fc0', 'Deep sea blues and sunny whitewashed walls', { exposure: 0.05, contrast: 0.15, hsl: { blue: [-10, 0.3, -0.05], aqua: [0, 0.2, 0], yellow: [-5, 0.1, 0.08] } }),
  L('travel-tropical', 'Tropical', 'Travel', '#2bb59a', 'Lush palms and lagoon turquoise', { temp: 0.1, contrast: 0.1, vib: 0.3, hsl: { green: [-10, 0.25, 0], aqua: [-8, 0.3, 0.05] } }),
  L('travel-old-town', 'Old Town', 'Travel', '#b08a5e', 'Warm stone streets with a hint of age', { temp: 0.12, fade: 0.04, sat: -0.1, contrast: 0.1, hsl: { orange: [-5, 0.1, 0] }, split: { shadow: [30, 0.08] } }),
  L('travel-nordic', 'Nordic', 'Travel', '#9fb2c0', 'Cool Scandinavian minimalism', { temp: -0.12, sat: -0.25, contrast: 0.1, fade: 0.03, split: { shadow: [210, 0.07], highlight: [200, 0.03] } }),

  // ---------------- Street
  L('street-concrete', 'Concrete', 'Street', '#8a8f94', 'Muted, cool urban documentary', { sat: -0.35, contrast: 0.25, temp: -0.05, roll: 0.03, split: { shadow: [210, 0.07] } }),
  L('street-urban-teal', 'Urban Teal', 'Street', '#3f8a8f', 'Teal shadows and warm skin for city portraits', { contrast: 0.2, sat: -0.05, hsl: { orange: [0, 0.1, 0.05] }, split: { shadow: [195, 0.15], highlight: [30, 0.08] } }),
  L('street-gritty', 'Gritty', 'Street', '#5c5650', 'Hard contrast and worn-out colour', { contrast: 0.4, crush: 0.03, sat: -0.2, highlights: -0.1 }),
  L('street-rain', 'Rain Street', 'Street', '#4d6d8c', 'Wet, blue city evenings', { temp: -0.15, contrast: 0.2, sat: -0.15, hsl: { blue: [0, 0.1, -0.1] }, split: { shadow: [220, 0.1], highlight: [190, 0.04] } }),
  L('street-sunlit', 'Sunlit Street', 'Street', '#e3b062', 'Bright summer streets with golden light', { temp: 0.15, contrast: 0.15, vib: 0.1, hsl: { yellow: [-5, 0.1, 0.05] }, split: { highlight: [40, 0.08] } }),

  // ---------------- Film
  L('film-warm-negative', 'Warm Negative 400', 'Film', '#d8b48f', 'Gentle colour-negative film: soft contrast, pastel greens, kind skin', { contrast: -0.05, fade: 0.03, temp: 0.08, roll: 0.03, hsl: { orange: [0, -0.05, 0.08], green: [10, -0.2, 0], blue: [-10, -0.1, 0.05] }, split: { shadow: [190, 0.04], highlight: [35, 0.05] } }),
  L('film-vivid-slide', 'Vivid Slide 100', 'Film', '#2e7a3c', 'Saturated slide film with punchy contrast', { contrast: 0.3, sat: 0.25, hsl: { green: [-5, 0.2, -0.05], blue: [-5, 0.2, -0.1], red: [0, 0.15, -0.05] } }),
  L('film-consumer-200', 'Consumer 200', 'Film', '#e1b850', 'Everyday drugstore film: warm yellows and nostalgia', { temp: 0.18, contrast: 0.12, fade: 0.02, hsl: { yellow: [-5, 0.2, 0.05], orange: [0, 0.1, 0], green: [10, -0.1, 0] } }),
  L('film-cine-tungsten', 'Cine 500T', 'Film', '#4d7fa1', 'Tungsten motion-picture stock: cool cast, red halation-like warmth', { temp: -0.2, tint: 0.03, contrast: 0.15, roll: 0.05, fade: 0.02, hsl: { red: [0, 0.1, 0] }, split: { shadow: [190, 0.1], highlight: [25, 0.08] } }),
  L('film-cross-process', 'Cross Process', 'Film', '#9fd16a', 'Slide film in negative chemistry: yellow highs, cyan shadows', { contrast: 0.1, sat: 0.15, rgb: { r: [[0, 0], [0.25, 0.2], [0.75, 0.85], [1, 1]], g: [[0, 0], [0.25, 0.22], [0.75, 0.82], [1, 1]], b: [[0, 0.12], [0.5, 0.48], [1, 0.85]] } }),
  L('film-faded-print', 'Faded Print', 'Film', '#c9c2b8', 'An old print left in the sun', { fade: 0.1, roll: 0.06, sat: -0.2, temp: 0.06, split: { shadow: [200, 0.05] } }),
  L('film-expired', 'Expired Film', 'Film', '#a7b58a', 'Unpredictable expired stock with green-yellow shift', { fade: 0.08, tint: -0.06, temp: 0.1, sat: -0.1, contrast: 0.05, split: { shadow: [150, 0.08], highlight: [50, 0.08] } }),
  L('film-instant', 'Instant Color', 'Film', '#d9cfa8', 'Instant-camera print colour', { fade: 0.06, temp: 0.05, contrast: -0.05, sat: -0.08, roll: 0.05, split: { shadow: [190, 0.1], highlight: [45, 0.1] } }),

  // ---------------- Cinematic
  L('cine-teal-orange', 'Teal & Orange', 'Cinematic', '#d58a3b', 'The blockbuster complementary grade', { contrast: 0.2, hsl: { orange: [0, 0.15, 0.05], aqua: [5, 0.15, -0.05], blue: [-15, 0.1, -0.1], green: [40, -0.3, 0] }, split: { shadow: [190, 0.2], highlight: [30, 0.12] } }),
  L('cine-blockbuster', 'Blockbuster', 'Cinematic', '#36566e', 'Deep contrast, cool shadows, warm highlights', { contrast: 0.35, crush: 0.02, sat: -0.05, roll: 0.04, split: { shadow: [200, 0.17], highlight: [35, 0.1] } }),
  L('cine-noir-thriller', 'Noir Thriller', 'Cinematic', '#4a5560', 'Cold, desaturated suspense', { sat: -0.5, temp: -0.15, contrast: 0.3, split: { shadow: [210, 0.08] } }),
  L('cine-desert-epic', 'Desert Epic', 'Cinematic', '#c9874d', 'Hot epic-scale desert grade', { temp: 0.35, contrast: 0.25, sat: -0.1, hsl: { blue: [20, -0.3, 0] }, split: { shadow: [25, 0.1], highlight: [40, 0.06] } }),
  L('cine-scifi', 'Sci-Fi Cyan', 'Cinematic', '#3fb6c2', 'Clinical cyan future', { temp: -0.15, contrast: 0.2, sat: -0.1, hsl: { orange: [0, -0.2, 0] }, split: { shadow: [180, 0.17], highlight: [190, 0.06] } }),
  L('cine-vintage-hollywood', 'Vintage Hollywood', 'Cinematic', '#c6a26a', 'Golden-age warmth and soft colour', { temp: 0.15, fade: 0.05, contrast: 0.15, sat: -0.2, split: { highlight: [45, 0.1] } }),
  L('cine-emerald', 'Emerald City', 'Cinematic', '#2f8f5f', 'Stylised green-tinted drama', { contrast: 0.2, sat: -0.05, hsl: { green: [10, 0.2, -0.05] }, split: { shadow: [150, 0.13], highlight: [90, 0.05] } }),
  L('cine-bleach-bypass', 'Bleach Bypass', 'Cinematic', '#8f9497', 'Silver-retained: low saturation, hard contrast', { sat: -0.55, contrast: 0.45, crush: 0.02, roll: 0.02, highlights: -0.05 }),

  // ---------------- Black & White
  L('bw-classic', 'Classic Mono', 'Black & White', '#808080', 'Balanced black and white', { contrast: 0.15, mono: MONO }),
  L('bw-high-contrast', 'High Contrast Mono', 'Black & White', '#202020', 'Punchy blacks and bright whites', { contrast: 0.45, crush: 0.03, mono: { r: 0.35, g: 0.55, b: 0.1 } }),
  L('bw-soft', 'Soft Mono', 'Black & White', '#b0b0b0', 'Gentle matte black and white', { fade: 0.06, contrast: -0.1, mono: MONO }),
  L('bw-sepia', 'Sepia', 'Black & White', '#a07850', 'Warm brown-toned print', { fade: 0.03, mono: { ...MONO, tone: [35, 0.3] } }),
  L('bw-selenium', 'Selenium', 'Black & White', '#6a7480', 'Cool selenium-toned print', { contrast: 0.2, mono: { ...MONO, tone: [220, 0.14] } }),
  L('bw-infrared', 'Infrared Mono', 'Black & White', '#e8e8e8', 'Glowing foliage and dark skies', { contrast: 0.2, mono: { r: 0.25, g: 1, b: -0.25 } }),

  // ---------------- Vintage
  L('vintage-70s', '70s Sunshine', 'Vintage', '#d9a441', 'Warm, faded seventies print', { temp: 0.25, fade: 0.07, contrast: 0.05, hsl: { yellow: [-10, 0.15, 0], blue: [15, -0.3, 0.05] }, split: { shadow: [30, 0.07] } }),
  L('vintage-retro-pop', 'Retro Pop', 'Vintage', '#d64f8a', 'Bright eighties colour pop', { sat: 0.3, contrast: 0.25, hsl: { red: [5, 0.15, 0] }, split: { shadow: [280, 0.08], highlight: [50, 0.08] } }),
  L('vintage-polaroid', 'Polaroid Fade', 'Vintage', '#cfd8c8', 'Faded instant print with cyan shadows', { fade: 0.1, roll: 0.08, sat: -0.15, split: { shadow: [195, 0.1], highlight: [45, 0.08] } }),
  L('vintage-dusty-rose', 'Dusty Rose', 'Vintage', '#c9a0a4', 'Muted pink nostalgia', { tint: 0.07, fade: 0.06, sat: -0.2, temp: 0.05, split: { highlight: [340, 0.1] } }),
  L('vintage-sun-bleached', 'Sun-Bleached', 'Vintage', '#e8dcc6', 'Washed-out summer memory', { exposure: 0.2, fade: 0.08, sat: -0.35, temp: 0.1, roll: 0.05 }),

  // ---------------- Moody
  L('moody-forest', 'Moody Forest', 'Moody', '#36503f', 'Dark, quiet woodland', { exposure: -0.15, contrast: 0.2, sat: -0.15, hsl: { green: [20, -0.3, -0.15] }, split: { shadow: [170, 0.1] } }),
  L('moody-brooding', 'Dark & Brooding', 'Moody', '#2c3440', 'Low-key, cold and heavy', { exposure: -0.25, contrast: 0.3, sat: -0.3, temp: -0.08, crush: 0.03, split: { shadow: [215, 0.08] } }),
  L('moody-overcast', 'Overcast', 'Moody', '#9aa3a8', 'Soft grey-day calm', { temp: -0.06, contrast: -0.05, sat: -0.2, fade: 0.05 }),
  L('moody-burnt-amber', 'Burnt Amber', 'Moody', '#8a4f22', 'Smoky amber warmth', { temp: 0.25, exposure: -0.1, contrast: 0.25, sat: -0.1, hsl: { orange: [-5, 0.15, -0.05] }, split: { shadow: [20, 0.12] } }),

  // ---------------- Product
  L('product-pure-white', 'Pure White', 'Product', '#fafafa', 'Clean bright backgrounds for e-commerce', { exposure: 0.2, highlights: 0.1, contrast: 0.1, sat: -0.05, temp: -0.03 }),
  L('product-pop', 'Pop Color', 'Product', '#e8433f', 'Eye-catching saturated product colour', { vib: 0.4, contrast: 0.2, sat: 0.1 }),
  L('product-luxury', 'Luxury Dark', 'Product', '#3b2f22', 'Premium dark backdrop with golden accents', { exposure: -0.1, contrast: 0.3, sat: -0.15, crush: 0.02, split: { shadow: [40, 0.08], highlight: [45, 0.06] } }),
  L('product-tech', 'Tech Cool', 'Product', '#5c7fa3', 'Cool, sleek gadget colour', { temp: -0.08, contrast: 0.32, sat: -0.22, highlights: 0.12, hsl: { blue: [-6, 0.3, -0.05], aqua: [0, 0.2, 0] }, split: { shadow: [215, 0.05] } }),

  // ---------------- Night
  L('night-neon', 'Neon Nights', 'Night', '#c53fd6', 'Purple and magenta neon city glow', { sat: 0.2, contrast: 0.25, hsl: { magenta: [0, 0.2, 0], aqua: [10, 0.2, 0] }, split: { shadow: [270, 0.17], highlight: [320, 0.12] } }),
  L('night-city-lights', 'City Lights', 'Night', '#e09a3e', 'Warm streetlights against blue night', { temp: 0.1, contrast: 0.25, hsl: { orange: [0, 0.2, 0.05] }, split: { shadow: [220, 0.15], highlight: [40, 0.12] } }),
  L('night-midnight-blue', 'Midnight Blue', 'Night', '#23395b', 'Deep blue nocturne', { temp: -0.25, exposure: -0.1, contrast: 0.2, sat: -0.1, split: { shadow: [225, 0.17] } }),

  // ---------------- Natural (realistic colour fixes)
  L('nat-true-color', 'True Color', 'Natural', '#d9d4cc', 'Honest colour with a touch of clarity: what your eye saw', { contrast: 0.22, highlights: -0.4, shadows: 0.25, sat: -0.1, vib: 0.06 }),
  L('nat-daylight-fix', 'Daylight Fix', 'Natural', '#f1e9d8', 'Cleans a blue or shady cast back to neutral daylight', { temp: 0.22, tint: 0.04, exposure: 0.06, vib: 0.06 }),
  L('nat-tungsten-fix', 'Indoor Light Fix', 'Natural', '#cfd8e6', 'Cools down orange indoor bulbs to natural white', { temp: -0.42, tint: -0.06, contrast: 0.06, vib: 0.06 }),
  L('nat-natural-pop', 'Natural Pop', 'Natural', '#8ec07c', 'More life in the colours without looking edited', { vib: 0.4, sat: 0.06, contrast: 0.16, highlights: -0.1, shadows: 0.08 }),
  L('nat-soft-skin', 'Natural Skin', 'Natural', '#e8b89a', 'Even, healthy skin tones with gentle contrast', { contrast: 0.05, highlights: -0.1, hsl: { orange: [-3, -0.08, 0.08], red: [4, -0.1, 0.04] }, vib: 0.06 }),
  L('nat-hdr-balance', 'Balanced Light', 'Natural', '#a8a8a8', 'Opens shadows and saves highlights, like a careful HDR', { highlights: -0.45, shadows: 0.45, contrast: 0.12, vib: 0.08 }),
  L('nat-clear-sky', 'Clear Sky', 'Natural', '#6aa6e0', 'Deeper blue sky and clean clouds, land left natural', { highlights: -0.15, hsl: { blue: [-4, 0.22, -0.1], aqua: [0, 0.1, -0.05] } }),
  L('nat-matte-real', 'Real Matte', 'Natural', '#bdb6ad', 'Natural colour with soft blacks for a calm feed', { fade: 0.06, contrast: -0.05, vib: 0.05 }),

  // ---------------- Creative
  L('cr-red-splash', 'Red Splash', 'Creative', '#d62828', 'Black & white world, only the reds stay in colour', { contrast: 0.18, hsl: { orange: [0, -0.92, 0], yellow: [0, -1, 0], green: [0, -1, 0], aqua: [0, -1, 0], blue: [0, -1, 0], purple: [0, -1, 0], magenta: [0, -0.6, 0], red: [0, 0.25, 0] } }),
  L('cr-pastel-dream', 'Pastel Dream', 'Creative', '#f6c6dc', 'Soft lifted pastels, pink highlights, dreamy and light', { exposure: 0.2, fade: 0.12, contrast: -0.18, sat: -0.2, split: { highlight: [330, 0.12], shadow: [260, 0.08] } }),
  L('cr-neon-pop', 'Neon Pop', 'Creative', '#ff2e88', 'Punchy magentas and cyans for bold, playful posts', { contrast: 0.3, sat: 0.3, hsl: { red: [-10, 0.2, 0], blue: [-15, 0.3, 0], purple: [0, 0.3, 0.05], magenta: [0, 0.35, 0.05] }, split: { shadow: [280, 0.12] } }),
  L('cr-golden-hour', 'Endless Golden Hour', 'Creative', '#f0a64b', 'Sun-soaked warmth everywhere, glowing highlights', { temp: 0.45, exposure: 0.08, highlights: 0.1, split: { highlight: [40, 0.18], shadow: [20, 0.08] }, vib: 0.1 }),
  L('cr-cyber-blue', 'Cyber Blue', 'Creative', '#2a4bd7', 'Cold electric blues with crushed blacks', { temp: -0.4, contrast: 0.32, crush: 0.04, split: { shadow: [225, 0.2], highlight: [190, 0.1] }, sat: -0.05 }),
  L('cr-faded-polaroid', 'Instant Print', 'Creative', '#e3d5b8', 'Instant-camera fade: creamy highlights, green-tinted shadows', { fade: 0.1, roll: 0.06, contrast: -0.05, temp: 0.12, split: { shadow: [150, 0.1], highlight: [55, 0.1] }, sat: -0.12 }),
  L('cr-duotone-sunset', 'Sunset Duotone', 'Creative', '#e8506b', 'Purple to coral duotone for posters and covers', { mono: { r: 0.4, g: 0.45, b: 0.15 }, split: { shadow: [270, 0.35], highlight: [15, 0.32] }, contrast: 0.15 }),
  L('cr-vaporwave', 'Vaporwave', 'Creative', '#b388eb', 'Pink and cyan haze with lifted blacks, retro-digital', { fade: 0.08, contrast: 0.1, split: { shadow: [190, 0.25], highlight: [310, 0.22] }, hsl: { blue: [20, 0.2, 0], red: [-15, 0.1, 0] }, sat: 0.08 }),

];

export function lookById(id: string): Look | undefined {
  return LOOKS.find((l) => l.id === id);
}
