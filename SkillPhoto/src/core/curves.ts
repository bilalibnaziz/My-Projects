import type { Adjust, CurvePoint } from './types';

/** Monotone cubic (Fritsch–Carlson) curve → 256-entry lookup table. */
export function curveLut(points: CurvePoint[]): Uint8Array {
  const f = curveFn(points);
  const lut = new Uint8Array(256);
  for (let x = 0; x < 256; x++) lut[x] = Math.max(0, Math.min(255, Math.round(f(x))));
  return lut;
}

/** The same curve as a continuous function on 0..255 (no rounding), for high-precision tables. */
export function curveFn(points: CurvePoint[]): (x: number) => number {
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts.length < 2) return (x) => x;
  const n = pts.length;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i] || 1e-6;
    d.push((ys[i + 1] - ys[i]) / dx);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let seg = 0;
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const h = xs[seg + 1] - xs[seg] || 1e-6;
    const t = (x - xs[seg]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * m[seg + 1];
  };
}

/** The curve as a continuous function on normalized 0..1 (0..1 input -> 0..1 output). */
export function curveFnNorm(points: CurvePoint[]): (normX: number) => number {
  const f = curveFn(points);
  return (normX: number) => {
    const clampedX = Math.max(0, Math.min(1, normX));
    return Math.max(0, Math.min(1, f(clampedX * 255) / 255));
  };
}

/** 16-bit curve lookup table with 65,536 entries, mapping 0..65535 to 0..65535 without 8-bit quantization. */
export function curveLut16(points: CurvePoint[]): Uint16Array {
  const f = curveFn(points);
  const lut = new Uint16Array(65536);
  for (let x = 0; x < 65536; x++) {
    const x255 = (x * 255) / 65535;
    const y255 = f(x255);
    lut[x] = Math.max(0, Math.min(65535, Math.round((y255 * 65535) / 255)));
  }
  return lut;
}

export function levelsLut(l: Adjust['levels']): Uint8Array {
  const f = levelsFn(l);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round(f(i))));
  return lut;
}

/** Levels as a continuous function on 0..255. */
export function levelsFn(l: Adjust['levels']): (x: number) => number {
  const range = Math.max(1, l.inWhite - l.inBlack);
  const invG = 1 / Math.max(0.05, l.gamma);
  return (x) => {
    const v = Math.pow((Math.min(l.inWhite, Math.max(l.inBlack, x)) - l.inBlack) / range, invG);
    return l.outBlack + v * (l.outWhite - l.outBlack);
  };
}

/** Levels as a continuous function on normalized 0..1. */
export function levelsFnNorm(l: Adjust['levels']): (normX: number) => number {
  const f = levelsFn(l);
  return (normX: number) => {
    const clampedX = Math.max(0, Math.min(1, normX));
    return Math.max(0, Math.min(1, f(clampedX * 255) / 255));
  };
}

/** 16-bit levels lookup table with 65,536 entries, mapping 0..65535 to 0..65535. */
export function levelsLut16(l: Adjust['levels']): Uint16Array {
  const f = levelsFn(l);
  const lut = new Uint16Array(65536);
  for (let x = 0; x < 65536; x++) {
    const x255 = (x * 255) / 65535;
    const y255 = f(x255);
    lut[x] = Math.max(0, Math.min(65535, Math.round((y255 * 65535) / 255)));
  }
  return lut;
}

/**
 * 16-bit chained Levels -> Master Curve -> Channel Curve tables (65536 entries each).
 * Chained at continuous precision without stepping through 8-bit integers.
 */
export function toneLut16(adj: Adjust): { r: Uint16Array; g: Uint16Array; b: Uint16Array } {
  const lv = levelsFn(adj.levels);
  const master = curveFn(adj.curves.rgb);
  const cr = curveFn(adj.curves.r);
  const cg = curveFn(adj.curves.g);
  const cb = curveFn(adj.curves.b);
  const c = (v: number) => Math.max(0, Math.min(255, v));
  const rLut = new Uint16Array(65536);
  const gLut = new Uint16Array(65536);
  const bLut = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) {
    const x255 = (i * 255) / 65535;
    const base = c(master(c(lv(x255))));
    rLut[i] = Math.max(0, Math.min(65535, Math.round((c(cr(base)) * 65535) / 255)));
    gLut[i] = Math.max(0, Math.min(65535, Math.round((c(cg(base)) * 65535) / 255)));
    bLut[i] = Math.max(0, Math.min(65535, Math.round((c(cb(base)) * 65535) / 255)));
  }
  return { r: rLut, g: gLut, b: bLut };
}

export const TONE_LUT_SIZE = 1024;

/**
 * Levels → master curve → channel curve as one high-precision table (RGBA, 0..1 floats,
 * TONE_LUT_SIZE entries): the stages are chained without rounding, so a gentle curve stays smooth
 * instead of stepping through 8-bit values three times.
 */
export function toneLutF(adj: Adjust, size = TONE_LUT_SIZE): Float32Array {
  const lv = levelsFn(adj.levels);
  const master = curveFn(adj.curves.rgb);
  const r = curveFn(adj.curves.r);
  const g = curveFn(adj.curves.g);
  const b = curveFn(adj.curves.b);
  const c = (v: number) => Math.max(0, Math.min(255, v));
  const out = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const base = c(master(c(lv((i * 255) / (size - 1)))));
    out[i * 4] = c(r(base)) / 255;
    out[i * 4 + 1] = c(g(base)) / 255;
    out[i * 4 + 2] = c(b(base)) / 255;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** Combined levels → master curve → channel curve, packed as RGBA 256×1. */
export function toneLut(adj: Adjust): Uint8Array {
  const lv = levelsLut(adj.levels);
  const master = curveLut(adj.curves.rgb);
  const r = curveLut(adj.curves.r);
  const g = curveLut(adj.curves.g);
  const b = curveLut(adj.curves.b);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const base = master[lv[i]];
    out[i * 4] = r[base];
    out[i * 4 + 1] = g[base];
    out[i * 4 + 2] = b[base];
    out[i * 4 + 3] = 255;
  }
  return out;
}
