import type { Adjust, CurvePoint } from './types';

/** Monotone cubic (Fritsch–Carlson) curve → 256-entry lookup table. */
export function curveLut(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
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
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      const h = xs[seg + 1] - xs[seg] || 1e-6;
      const t = (x - xs[seg]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      y =
        (2 * t3 - 3 * t2 + 1) * ys[seg] +
        (t3 - 2 * t2 + t) * h * m[seg] +
        (-2 * t3 + 3 * t2) * ys[seg + 1] +
        (t3 - t2) * h * m[seg + 1];
    }
    lut[x] = Math.max(0, Math.min(255, Math.round(y)));
  }
  return lut;
}

export function levelsLut(l: Adjust['levels']): Uint8Array {
  const lut = new Uint8Array(256);
  const range = Math.max(1, l.inWhite - l.inBlack);
  const invG = 1 / Math.max(0.05, l.gamma);
  for (let i = 0; i < 256; i++) {
    let v = (Math.min(l.inWhite, Math.max(l.inBlack, i)) - l.inBlack) / range;
    v = Math.pow(v, invG);
    lut[i] = Math.max(0, Math.min(255, Math.round(l.outBlack + v * (l.outWhite - l.outBlack))));
  }
  return lut;
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
