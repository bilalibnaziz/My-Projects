// Color science helpers: conversions between hex / RGB / HSB / HSL / Lab / CMYK, harmonies,
// WCAG contrast, and a CMYK print simulation used for soft-proofing and gamut warnings.
// All pure functions (tested).

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** HSB: h 0..360, s 0..100, b 0..100. */
export function rgbToHsb([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? (d / max) * 100 : 0, (max / 255) * 100];
}

export function hsbToRgb(h: number, s: number, v: number): RGB {
  const S = s / 100;
  const V = v / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (V - V * S * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

// ---------------------------------------------------------------- Lab (D65)

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const gam = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToLab([r, g, b]: RGB): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([L, a, b]: [number, number, number]): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047;
  const Y = inv(fy);
  const Z = inv(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return [gam(R), gam(G), gam(B)].map((v) => Math.max(0, Math.min(255, v))) as RGB;
}

/** CIE76 colour difference. */
export function deltaE(a: RGB, b: RGB): number {
  const p = rgbToLab(a);
  const q = rgbToLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---------------------------------------------------------------- CMYK

/** Naive device CMYK (0..100) with full black generation. */
export function rgbToCmyk([r, g, b]: RGB): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k), k].map((v) => v * 100) as [number, number, number, number];
}

export function cmykToRgb(c: number, m: number, y: number, k: number): RGB {
  const K = 1 - k / 100;
  return [255 * (1 - c / 100) * K, 255 * (1 - m / 100) * K, 255 * (1 - y / 100) * K];
}

/**
 * How ink on coated paper reproduces CMY overprints (sRGB values close to the GRACoL / FOGRA
 * coated references). Interpolating between these (Neugebauer model) shows how a colour
 * prints: bright RGB greens, blues and oranges come out duller, as on press.
 */
const PRIMARIES: Record<string, RGB> = {
  w: [255, 255, 255],
  c: [0, 160, 227],
  m: [229, 0, 126],
  y: [255, 237, 0],
  cm: [45, 46, 131],
  cy: [0, 150, 64],
  my: [228, 30, 37],
  cmy: [40, 38, 40],
};
const K_INK: RGB = [35, 31, 32];

/** Simulated print colour of a CMYK value (0..100). */
export function simulatePrint(c: number, m: number, y: number, k: number): RGB {
  const C = c / 100, M = m / 100, Y = y / 100, K = k / 100;
  const P = PRIMARIES;
  const out: number[] = [0, 0, 0];
  const terms: [RGB, number][] = [
    [P.w, (1 - C) * (1 - M) * (1 - Y)],
    [P.c, C * (1 - M) * (1 - Y)],
    [P.m, (1 - C) * M * (1 - Y)],
    [P.y, (1 - C) * (1 - M) * Y],
    [P.cm, C * M * (1 - Y)],
    [P.cy, C * (1 - M) * Y],
    [P.my, (1 - C) * M * Y],
    [P.cmy, C * M * Y],
  ];
  // Interpolated in gamma space, matching how the device separation above is computed, so
  // neutrals stay neutral and only colours the inks can't reach shift
  for (const [col, w] of terms) for (let i = 0; i < 3; i++) out[i] += col[i] * w;
  for (let i = 0; i < 3; i++) out[i] = out[i] * (1 - K) + ((out[i] * K_INK[i]) / 255) * K;
  return out.map((v) => Math.max(0, Math.min(255, v))) as RGB;
}

/**
 * Colour-managed separation: finds the ink mix whose printed colour is closest to `rgb`.
 * Black comes from the naive separation (GCR); C, M and Y are solved with a few damped
 * Newton steps on the ink model, clamped to 0..100 %. Colours the inks can reach come out
 * exact; others land on the nearest reachable mix (relative colorimetric, like Photoshop).
 */
export function separate(rgb: RGB): [number, number, number, number] {
  // Saturated colours need little or no black: try a few black levels, keep the closest
  const k0 = rgbToCmyk(rgb)[3] * 0.85;
  let best: [number, number, number, number] = [0, 0, 0, 0];
  let bestErr = Infinity;
  for (const k of k0 > 0 ? [k0, k0 * 0.5, 0] : [0]) {
    const cmy = solveCmy(rgb, k);
    const err = deltaE(rgb, simulatePrint(cmy[0], cmy[1], cmy[2], k));
    if (err < bestErr) {
      bestErr = err;
      best = [cmy[0], cmy[1], cmy[2], k];
    }
    if (err < 1) break;
  }
  return best;
}

/** C, M, Y (0..100) whose print with black `k` is closest to `rgb` (damped Newton, clamped). */
function solveCmy(rgb: RGB, k: number): number[] {
  const n = rgbToCmyk(rgb);
  let x = [n[0], n[1], n[2]].map((v) => v * 0.9);
  const f = (v: number[]) => simulatePrint(v[0], v[1], v[2], k);
  for (let it = 0; it < 12; it++) {
    const y = f(x);
    const err = [y[0] - rgb[0], y[1] - rgb[1], y[2] - rgb[2]];
    if (Math.hypot(err[0], err[1], err[2]) < 0.5) break;
    const J: number[][] = [[], [], []];
    for (let j = 0; j < 3; j++) {
      const h = x[j] > 99 ? -1 : 1;
      const xp = [...x];
      xp[j] += h;
      const yp = f(xp);
      for (let i = 0; i < 3; i++) J[i][j] = (yp[i] - y[i]) / h;
    }
    const step = solve3(J, err);
    if (!step) break;
    x = x.map((v, j) => Math.max(0, Math.min(100, v - step[j] * 0.9)));
  }
  return x;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const [a, bb, c] = A[0];
  const [d, e, f] = A[1];
  const [g, h, i] = A[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  const inv = [
    [(e * i - f * h) / det, (c * h - bb * i) / det, (bb * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (bb * g - a * h) / det, (a * e - bb * d) / det],
  ];
  return inv.map((r) => r[0] * b[0] + r[1] * b[1] + r[2] * b[2]);
}

/** Soft proof: how an sRGB colour would look printed (colour-managed separation, then the inks). */
export function proofRgb(rgb: RGB): RGB {
  const [c, m, y, k] = separate(rgb);
  return simulatePrint(c, m, y, k);
}

/** Colours that change visibly when printed (ΔE above a "clearly noticeable" threshold). */
export function outOfGamut(rgb: RGB, threshold = 6): boolean {
  return deltaE(rgb, proofRgb(rgb)) > threshold;
}

let proofLut: Uint8ClampedArray | null = null;
const N = 33;

/** 33³ grid of proofed colours (+ an out-of-gamut flag), built once. */
function getProofLut(): Uint8ClampedArray {
  if (proofLut) return proofLut;
  const lut = new Uint8ClampedArray(N * N * N * 4);
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++) {
        const rgb: RGB = [(r * 255) / (N - 1), (g * 255) / (N - 1), (b * 255) / (N - 1)];
        const p = proofRgb(rgb);
        const i = ((b * N + g) * N + r) * 4;
        lut[i] = p[0];
        lut[i + 1] = p[1];
        lut[i + 2] = p[2];
        lut[i + 3] = deltaE(rgb, p) > 6 ? 1 : 0;
      }
  proofLut = lut;
  return lut;
}

/** Proof (or gamut-warn) an RGBA buffer in place. */
export function proofImage(data: Uint8ClampedArray, warn: boolean, warnColor: RGB = [128, 128, 128]) {
  const lut = getProofLut();
  const s = (N - 1) / 255;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    // Nearest grid point is plenty for a preview (≤ 4 levels of error)
    const r = Math.round(data[i] * s), g = Math.round(data[i + 1] * s), b = Math.round(data[i + 2] * s);
    const j = ((b * N + g) * N + r) * 4;
    if (warn) {
      if (lut[j + 3]) {
        data[i] = warnColor[0];
        data[i + 1] = warnColor[1];
        data[i + 2] = warnColor[2];
      }
    } else {
      data[i] = lut[j];
      data[i + 1] = lut[j + 1];
      data[i + 2] = lut[j + 2];
    }
  }
}

// ---------------------------------------------------------------- harmonies & contrast

export type HarmonyKind = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic' | 'monochrome';

export const HARMONIES: { id: HarmonyKind; label: string }[] = [
  { id: 'complementary', label: 'Complementary' },
  { id: 'analogous', label: 'Analogous' },
  { id: 'triadic', label: 'Triadic' },
  { id: 'split', label: 'Split' },
  { id: 'tetradic', label: 'Tetradic' },
  { id: 'monochrome', label: 'Shades' },
];

/** A palette built around `hex` (the base colour comes first). */
export function harmony(hex: string, kind: HarmonyKind): string[] {
  const [h, s, v] = rgbToHsb(hexToRgb(hex));
  const at = (dh: number, ds = 0, dv = 0) => rgbToHex(hsbToRgb((h + dh + 360) % 360, Math.max(0, Math.min(100, s + ds)), Math.max(0, Math.min(100, v + dv))));
  switch (kind) {
    case 'complementary':
      return [at(0), at(0, -30, 15), at(180), at(180, -30, 15), at(180, 0, -30)];
    case 'analogous':
      return [at(0), at(-30), at(-15), at(15), at(30)];
    case 'triadic':
      return [at(0), at(120), at(240), at(120, -25, 10), at(240, -25, 10)];
    case 'split':
      return [at(0), at(150), at(210), at(150, -25, 10), at(210, -25, 10)];
    case 'tetradic':
      return [at(0), at(90), at(180), at(270), at(0, -35, 20)];
    case 'monochrome':
      return [at(0, 0, -45), at(0, 0, -25), at(0), at(0, -25, 15), at(0, -50, 30)];
  }
}

/** WCAG 2 relative luminance and contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const L = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = L(a);
  const y = L(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** WCAG rating for text: AAA ≥ 7, AA ≥ 4.5, AA Large ≥ 3. */
export function contrastGrade(ratio: number): 'AAA' | 'AA' | 'AA Large' | 'Fail' {
  return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA Large' : 'Fail';
}
