// Image Trace: bitmap → editable vector paths.
//
// 1. Every opaque pixel gets a palette colour (k-means, grey levels, a fixed brand palette, or
//    exact colours for pixel art), so no pixel is dropped and regions never overlap.
// 2. Specks smaller than `minArea` merge into the neighbouring colour.
// 3. Region outlines follow the pixel edges (not pixel centres), so outer rings and holes are exact.
// 4. Outside pixel-exact mode, staircases are smoothed, real corners are found and kept sharp, and
//    the runs between them are fitted with cubic Béziers (Schneider) within `simplification` px.
// 5. Each colour becomes one compound path (holes cut even-odd), stacked largest area first.
//
// Colours are clustered in CIE Lab over a histogram of every pixel (so perceptually distinct, small
// details keep their own colour), and each path takes the true average of the pixels it covers.
// Centerline mode thins ink to its skeleton and returns single open strokes instead of outlines.

import type { Layer, PathAnchor } from './types';
import { makeLayer } from './types';
import { createCanvas, ctx2d } from './canvas';
import { bezierSegmentsToAnchors, fitCurves } from './pencilEngine';
import type { CubicBezierSegment } from './pencilEngine';

export type TraceMode = 'pixel-exact' | 'color' | 'bw' | 'line-art' | 'grayscale' | 'centerline';

export interface TraceOptions {
  mode: TraceMode;
  /** Palette size (2..64) for color / grayscale / pixel-exact modes. Default 8. */
  colors?: number;
  /** Luminance threshold (0..255) for B&W and line art. Default 128. */
  threshold?: number;
  /** Regions smaller than this many pixels merge into their neighbour (despeckle). Default 4. */
  minArea?: number;
  /** Turning angle (degrees) above which a point stays a sharp corner. Default 60. */
  cornerThreshold?: number;
  /** Curve fitting tolerance in pixels (lower = closer to the pixels, more anchors). Default 1. */
  simplification?: number;
  /** Leave white (and near-white) areas out. Default true. */
  ignoreWhite?: boolean;
  /** Trace with exactly these colours (e.g. a brand palette) instead of found ones. */
  palette?: string[];
  /** Pre-blur radius in pixels (0..4) to calm photo noise before colours are found. Default 0. */
  blur?: number;
  /** Adds a hairline stroke in each fill colour so neighbouring regions show no seams. */
  fillGaps?: boolean;
  /** B&W / line art: trace the light parts instead of the dark ones. */
  invert?: boolean;
  /** Colour / greyscale: find how many colours the picture needs (`colors` is then the most). */
  autoColors?: boolean;
  /** Drop the background: the colour that fills most of the image border, where it touches the border. */
  removeBackground?: boolean;
  /** Passes of an edge clean-up (majority) filter on the colour regions, 0..3. Default 0. */
  smoothEdges?: number;
  /** abutting: regions meet edge to edge. overlap: each colour runs under the ones above it (no seams). */
  method?: 'abutting' | 'overlap';
  /** One path per separate shape (island with its holes) instead of one compound path per colour. */
  split?: boolean;
  /** Colours are the exact average of the pixels each path covers (default true; brand palettes stay exact). */
  trueColors?: boolean;
  /** Centerline: stroke width in px (0 or unset = measured from the ink). */
  strokeWidth?: number;
  /** Place edges between pixels from the anti-aliasing (default true). */
  subpixel?: boolean;
}

export interface TraceContour {
  points: { x: number; y: number }[];
  color: string;
  isHole: boolean;
}

export interface TraceResult {
  contours: TraceContour[];
  /** One compound-path layer per colour (image pixel coordinates unless placed). */
  layers: Layer[];
  width: number;
  height: number;
  /** Colours used, in stacking order (bottom first). */
  colors: string[];
  anchorCount: number;
}

export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Ready-made settings, from logos to photos. */
export const TRACE_PRESETS: { id: string; label: string; hint: string; opts: TraceOptions }[] = [
  { id: 'logo', label: 'B&W Logo', hint: 'Crisp single-colour logo or icon', opts: { mode: 'bw', threshold: 128, simplification: 0.8, cornerThreshold: 55, minArea: 6 } },
  { id: 'color-logo', label: 'Colour Logo', hint: 'Flat brand art: exact colours found for you, background dropped', opts: { mode: 'color', colors: 12, autoColors: true, removeBackground: true, simplification: 0.8, cornerThreshold: 55, minArea: 10, smoothEdges: 1, method: 'overlap' } },
  { id: 'silhouette', label: 'Silhouette', hint: 'Solid shapes from a cut-out or shadow', opts: { mode: 'bw', threshold: 180, simplification: 1.5, cornerThreshold: 70, minArea: 40, blur: 1 } },
  { id: 'line-art', label: 'Line Art', hint: 'Ink drawings and scanned sketches', opts: { mode: 'line-art', threshold: 150, simplification: 0.7, cornerThreshold: 50, minArea: 8, blur: 0.5 } },
  { id: 'centerline', label: 'Centerline', hint: 'Single strokes down the middle of each line (sketches, handwriting, plotters)', opts: { mode: 'centerline', threshold: 150, simplification: 1, cornerThreshold: 60, minArea: 12, blur: 0.5 } },
  { id: 'technical', label: 'Technical', hint: 'Straight lines and sharp corners', opts: { mode: 'bw', threshold: 140, simplification: 0.5, cornerThreshold: 30, minArea: 4 } },
  { id: '3-colors', label: '3 Colours', hint: 'Flat poster look', opts: { mode: 'color', colors: 3, simplification: 1.2, minArea: 30, blur: 1, fillGaps: true, smoothEdges: 1 } },
  { id: '6-colors', label: '6 Colours', hint: 'Illustrations and flat art', opts: { mode: 'color', colors: 6, simplification: 1, minArea: 16, blur: 0.5, fillGaps: true, smoothEdges: 1 } },
  { id: '16-colors', label: '16 Colours', hint: 'Detailed artwork', opts: { mode: 'color', colors: 16, simplification: 1, minArea: 10, blur: 0.5, fillGaps: true, smoothEdges: 1 } },
  { id: 'photo-low', label: 'Low-Fi Photo', hint: 'Stylised photo, few shapes', opts: { mode: 'color', colors: 12, simplification: 2, minArea: 60, blur: 2, ignoreWhite: false, smoothEdges: 2, method: 'overlap' } },
  { id: 'photo-high', label: 'High-Fi Photo', hint: 'Close to the photo, many shapes', opts: { mode: 'color', colors: 32, autoColors: true, simplification: 1, minArea: 12, blur: 1, ignoreWhite: false, smoothEdges: 1, method: 'overlap' } },
  { id: 'grays', label: 'Greys', hint: 'Posterised shades of grey', opts: { mode: 'grayscale', colors: 6, simplification: 1.2, minArea: 20, blur: 1, fillGaps: true, smoothEdges: 1 } },
  { id: 'pixel-art', label: 'Pixel Art', hint: 'Exact pixel squares, nip to nip', opts: { mode: 'pixel-exact', colors: 64, minArea: 1 } },
];

const IGN = 0xffff;
type P2 = { x: number; y: number };
type RGB = [number, number, number];

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const parseHex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})/i.exec(h);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;
const nearWhite = (c: RGB) => c[0] > 238 && c[1] > 238 && c[2] > 238;

/** Separable box blur on RGB (alpha kept); a fractional radius blends with the original. */
function blurRGB(src: Uint8ClampedArray | Uint8Array, w: number, h: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const r = Math.ceil(radius);
  if (r <= 0) return out;
  const mix = Math.min(1, radius / r);
  const tmp = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let k = -r; k <= r; k++) {
        const i = (y * w + Math.min(w - 1, Math.max(0, x + k))) * 4;
        s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2];
      }
      const o = (y * w + x) * 3;
      tmp[o] = s0 / (2 * r + 1); tmp[o + 1] = s1 / (2 * r + 1); tmp[o + 2] = s2 / (2 * r + 1);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let k = -r; k <= r; k++) {
        const o = (Math.min(h - 1, Math.max(0, y + k)) * w + x) * 3;
        s0 += tmp[o]; s1 += tmp[o + 1]; s2 += tmp[o + 2];
      }
      const i = (y * w + x) * 4;
      const n = 2 * r + 1;
      out[i] = src[i] * (1 - mix) + (s0 / n) * mix;
      out[i + 1] = src[i + 1] * (1 - mix) + (s1 / n) * mix;
      out[i + 2] = src[i + 2] * (1 - mix) + (s2 / n) * mix;
    }
  }
  return out;
}

// ---------------------------------------------------------------- colour science (sRGB → CIE Lab)

const LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const lin = (v: number) => (Number.isInteger(v) && v >= 0 && v < 256 ? LIN[v] : (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB (0..255) → CIE L*a*b* (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const fx = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const fy = labF(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const fz = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual distance (CIE76 ΔE) between two sRGB colours. */
export function deltaE(a: RGB, b: RGB): number {
  const p = rgbToLab(...a), q = rgbToLab(...b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * Palette by weighted k-means in Lab over a 15-bit histogram of every opaque pixel. Seeds: the most
 * common colour, then the colour farthest from every seed weighted by log(pixel count), so a small but
 * distinct detail (a red dot in a logo) wins over thousands of slightly-off anti-aliasing pixels.
 * With `auto`, seeding stops once every colour that covers ≥0.1% of the picture is within ~ΔE 12.
 */
export function kmeansPalette(data: Uint8ClampedArray | Uint8Array, count: number, k: number, iterations = 12, auto = false): RGB[] {
  const sum = new Float64Array(32768 * 4);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
    sum[key * 4] += data[o]; sum[key * 4 + 1] += data[o + 1]; sum[key * 4 + 2] += data[o + 2]; sum[key * 4 + 3]++;
  }
  const rgb: number[] = [], lab: number[] = [], wt: number[] = [];
  let total = 0;
  for (let key = 0; key < 32768; key++) {
    const c = sum[key * 4 + 3];
    if (!c) continue;
    const r = sum[key * 4] / c, g = sum[key * 4 + 1] / c, b = sum[key * 4 + 2] / c;
    rgb.push(r, g, b);
    lab.push(...rgbToLab(r, g, b));
    wt.push(c);
    total += c;
  }
  const n = wt.length;
  if (!n) return [[0, 0, 0]];
  const d2 = (i: number, c: number[]) => (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2;
  let first = 0;
  for (let i = 1; i < n; i++) if (wt[i] > wt[first]) first = i;
  const cent: number[][] = [[lab[first * 3], lab[first * 3 + 1], lab[first * 3 + 2]]];
  const dmin = new Float64Array(n).fill(Infinity);
  const sig = total * 0.001;
  for (;;) {
    const c = cent[cent.length - 1];
    let far = -1, farS = 0, maxSig = 0, mean = 0;
    for (let i = 0; i < n; i++) {
      const d = d2(i, c);
      if (d < dmin[i]) dmin[i] = d;
      const s = dmin[i] * Math.log1p(wt[i]);
      if (s > farS) { farS = s; far = i; }
      if (wt[i] >= sig && dmin[i] > maxSig) maxSig = dmin[i];
      mean += Math.sqrt(dmin[i]) * wt[i];
    }
    if (cent.length >= Math.min(k, n) || far < 0) break;
    if (auto && Math.sqrt(maxSig) < 12 && mean / total < 6) break;
    cent.push([lab[far * 3], lab[far * 3 + 1], lab[far * 3 + 2]]);
  }
  // Weighted Lloyd iterations; centroids keep both Lab (for distance) and RGB (for the result)
  const K = cent.length;
  const outRGB: number[][] = cent.map(() => [0, 0, 0]);
  const used = new Uint8Array(K);
  for (let it = 0; it <= iterations; it++) {
    const acc = new Float64Array(K * 7);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < K; j++) {
        const d = d2(i, cent[j]);
        if (d < bd) { bd = d; bi = j; }
      }
      const w = wt[i];
      acc[bi * 7] += lab[i * 3] * w; acc[bi * 7 + 1] += lab[i * 3 + 1] * w; acc[bi * 7 + 2] += lab[i * 3 + 2] * w;
      acc[bi * 7 + 3] += rgb[i * 3] * w; acc[bi * 7 + 4] += rgb[i * 3 + 1] * w; acc[bi * 7 + 5] += rgb[i * 3 + 2] * w;
      acc[bi * 7 + 6] += w;
    }
    let moved = 0;
    for (let j = 0; j < K; j++) {
      const w = acc[j * 7 + 6];
      used[j] = w ? 1 : 0;
      if (!w) continue;
      const nc = [acc[j * 7] / w, acc[j * 7 + 1] / w, acc[j * 7 + 2] / w];
      moved = Math.max(moved, Math.hypot(nc[0] - cent[j][0], nc[1] - cent[j][1], nc[2] - cent[j][2]));
      cent[j] = nc;
      outRGB[j] = [acc[j * 7 + 3] / w, acc[j * 7 + 4] / w, acc[j * 7 + 5] / w];
    }
    if (it > 0 && moved < 0.25) break;
  }
  const res = outRGB.filter((_, j) => used[j]).map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] as RGB);
  // Two centroids that ended up the same colour are one
  return res.filter((c, i) => res.findIndex((d) => d[0] === c[0] && d[1] === c[1] && d[2] === c[2]) === i);
}

/** Labels every pixel with a palette index (IGN = not traced). `fixed`: the palette must stay exact. */
function labelPixels(buf: PixelBuffer, opts: TraceOptions): { labels: Uint16Array; palette: RGB[]; fixed: boolean } {
  const { width: w, height: h } = buf;
  const N = w * h;
  const data = opts.blur ? blurRGB(buf.data, w, h, Math.min(4, opts.blur)) : buf.data;
  const labels = new Uint16Array(N).fill(IGN);
  const ignoreWhite = opts.ignoreWhite ?? true;
  const mode = opts.mode;

  if (mode === 'bw' || mode === 'line-art' || mode === 'centerline') {
    const t = opts.threshold ?? 128;
    for (let i = 0; i < N; i++) {
      if (buf.data[i * 4 + 3] < 128) continue;
      const dark = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < t;
      if (dark !== !!opts.invert) labels[i] = 0;
      else if (!ignoreWhite && mode !== 'centerline') labels[i] = 1;
    }
    const ink: RGB = opts.palette?.[0] ? parseHex(opts.palette[0]) : opts.invert ? [255, 255, 255] : [0, 0, 0];
    return { labels, palette: [ink, opts.invert ? [0, 0, 0] : [255, 255, 255]], fixed: true };
  }

  let palette: RGB[];
  let fixed = false;
  if (opts.palette?.length) {
    palette = opts.palette.map(parseHex);
    fixed = true;
  } else if (mode === 'grayscale') {
    const k = Math.max(2, Math.min(32, opts.colors ?? 6));
    palette = Array.from({ length: k }, (_, i) => {
      const v = Math.round((i / (k - 1)) * 255);
      return [v, v, v] as RGB;
    });
  } else if (mode === 'pixel-exact') {
    // Exact colours when there are few (pixel art), otherwise the closest k
    const seen = new Set<number>();
    for (let i = 0; i < N && seen.size <= 256; i++) {
      if (buf.data[i * 4 + 3] >= 128) seen.add((buf.data[i * 4] << 16) | (buf.data[i * 4 + 1] << 8) | buf.data[i * 4 + 2]);
    }
    const k = Math.max(2, Math.min(256, opts.colors ?? 64));
    fixed = seen.size <= k;
    palette = fixed ? [...seen].map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as RGB) : kmeansPalette(buf.data, N, k);
  } else {
    palette = kmeansPalette(data, N, Math.max(2, Math.min(64, opts.colors ?? 8)), 12, !!opts.autoColors);
  }

  const P = palette.length;
  const pLab = palette.map((c) => rgbToLab(...c));
  const cache = new Map<number, number>();
  const src = mode === 'pixel-exact' ? buf.data : data;
  for (let i = 0; i < N; i++) {
    if (buf.data[i * 4 + 3] < 128) continue;
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
    if (mode === 'grayscale' && !opts.palette?.length) {
      labels[i] = Math.round((lum(r, g, b) / 255) * (P - 1));
      continue;
    }
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      const L = rgbToLab(r, g, b);
      let bd = Infinity;
      idx = 0;
      for (let j = 0; j < P; j++) {
        const c = pLab[j];
        const d = (L[0] - c[0]) ** 2 + (L[1] - c[1]) ** 2 + (L[2] - c[2]) ** 2;
        if (d < bd) { bd = d; idx = j; }
      }
      if (cache.size < 200000) cache.set(key, idx);
    }
    labels[i] = idx;
  }
  if (ignoreWhite) {
    const white = new Set(palette.map((c, j) => (nearWhite(c) ? j : -1)).filter((j) => j >= 0));
    if (white.size) for (let i = 0; i < N; i++) if (white.has(labels[i])) labels[i] = IGN;
  }
  return { labels, palette, fixed };
}

/**
 * Edge clean-up: a pixel takes the label most of its 8 neighbours share (5 or more), which irons out
 * ragged, noisy borders without moving clean edges or thinning 2 px lines.
 */
export function smoothLabels(labels: Uint16Array, w: number, h: number, passes: number) {
  const ids = new Uint16Array(8);
  const cnt = new Uint8Array(8);
  for (let pass = 0; pass < passes; pass++) {
    const src = labels.slice();
    let changed = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const own = src[i];
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const L = src[i + dy * w + dx];
          if (L === own) continue;
          let k = 0;
          while (k < m && ids[k] !== L) k++;
          if (k === m) { ids[m] = L; cnt[m++] = 0; }
          cnt[k]++;
        }
        for (let k = 0; k < m; k++) if (cnt[k] >= 5) { labels[i] = ids[k]; changed++; break; }
      }
    }
    if (!changed) break;
  }
}

/**
 * Drops the background: the label covering ≥55% of the image border is cleared wherever it is
 * connected to the border (the same colour inside the artwork stays). Returns the label dropped.
 */
export function dropBackground(labels: Uint16Array, w: number, h: number): number {
  const votes = new Map<number, number>();
  let border = 0;
  const vote = (i: number) => { border++; votes.set(labels[i], (votes.get(labels[i]) ?? 0) + 1); };
  for (let x = 0; x < w; x++) { vote(x); if (h > 1) vote((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { vote(y * w); if (w > 1) vote(y * w + w - 1); }
  let bg = -1, most = 0;
  for (const [L, c] of votes) if (L !== IGN && c > most) { most = c; bg = L; }
  if (bg < 0 || most < border * 0.55) return -1;
  const stack: number[] = [];
  const push = (i: number) => { if (labels[i] === bg) { labels[i] = IGN; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  return bg;
}

/**
 * True colours: each label becomes the average of the original (unblurred) pixels it covers, using
 * only pixels whose 4 neighbours share the label so anti-aliased edges don't muddy it.
 */
export function measureColors(labels: Uint16Array, buf: PixelBuffer, P: number): (RGB | null)[] {
  const { width: w, height: h, data } = buf;
  const inner = new Float64Array(P * 4);
  const all = new Float64Array(P * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const L = labels[i];
      if (L === IGN || L >= P) continue;
      const o = i * 4;
      all[L * 4] += data[o]; all[L * 4 + 1] += data[o + 1]; all[L * 4 + 2] += data[o + 2]; all[L * 4 + 3]++;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1 && labels[i - 1] === L && labels[i + 1] === L && labels[i - w] === L && labels[i + w] === L) {
        inner[L * 4] += data[o]; inner[L * 4 + 1] += data[o + 1]; inner[L * 4 + 2] += data[o + 2]; inner[L * 4 + 3]++;
      }
    }
  }
  return Array.from({ length: P }, (_, L) => {
    const s = inner[L * 4 + 3] >= 4 ? inner : all;
    const n = s[L * 4 + 3];
    return n ? [s[L * 4] / n, s[L * 4 + 1] / n, s[L * 4 + 2] / n] as RGB : null;
  });
}

/**
 * Anti-aliasing colours: a label that is thin (almost no pixel has all 4 neighbours the same) and
 * whose colour sits on the (sRGB) line between two other palette colours is the blend along their shared
 * edge, not a colour of the artwork. Its pixels go to whichever of the two they are closer to.
 */
export function pruneBlendColors(labels: Uint16Array, buf: PixelBuffer, palette: RGB[]): number {
  const { width: w, height: h, data } = buf;
  const P = palette.length;
  if (P < 3) return 0;
  const total = new Float64Array(P), inner = new Float64Array(P);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, L = labels[i];
    if (L >= P) continue;
    total[L]++;
    if (x > 0 && x < w - 1 && y > 0 && y < h - 1 && labels[i - 1] === L && labels[i + 1] === L && labels[i - w] === L && labels[i + w] === L) inner[L]++;
  }
  const lab = palette.map((c) => rgbToLab(...c));
  const remap = new Map<number, [number, number]>();
  for (let j = 0; j < P; j++) {
    if (!total[j] || inner[j] / total[j] > 0.2) continue;
    let best: [number, number] | null = null, bd = 14;
    for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
      if (a === j || b === j || remap.has(a) || remap.has(b) || inner[a] / (total[a] || 1) <= 0.2 || inner[b] / (total[b] || 1) <= 0.2) continue;
      // Distance from colour j to the segment a–b in sRGB (where edges are blended), j between them
      const A = palette[a], B = palette[b], C = palette[j];
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const t = ((C[0] - A[0]) * ab[0] + (C[1] - A[1]) * ab[1] + (C[2] - A[2]) * ab[2]) / len2;
      if (t < 0.05 || t > 0.95) continue;
      const d = Math.hypot(A[0] + ab[0] * t - C[0], A[1] + ab[1] * t - C[1], A[2] + ab[2] * t - C[2]);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    if (best) remap.set(j, best);
  }
  if (!remap.size) return 0;
  for (let i = 0; i < w * h; i++) {
    const pair = remap.get(labels[i]);
    if (!pair) continue;
    const C = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const da = (C[0] - lab[pair[0]][0]) ** 2 + (C[1] - lab[pair[0]][1]) ** 2 + (C[2] - lab[pair[0]][2]) ** 2;
    const db = (C[0] - lab[pair[1]][0]) ** 2 + (C[1] - lab[pair[1]][1]) ** 2 + (C[2] - lab[pair[1]][2]) ** 2;
    labels[i] = da <= db ? pair[0] : pair[1];
  }
  return remap.size;
}

/**
 * A pixel whose colour none of its 4 neighbours share (an anti-aliased edge pixel that landed on a
 * third colour) joins the neighbouring colour closest to its own, so edges don't get notches.
 */
export function fixLonePixels(labels: Uint16Array, buf: PixelBuffer, palette: RGB[]): number {
  const { width: w, height: h, data } = buf;
  const pLab = palette.map((c) => rgbToLab(...c));
  const src = labels.slice();
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const L = src[i];
      const nb = [x > 0 ? src[i - 1] : -1, x < w - 1 ? src[i + 1] : -1, y > 0 ? src[i - w] : -1, y < h - 1 ? src[i + w] : -1].filter((v) => v >= 0);
      if (!nb.length || nb.includes(L)) continue;
      const C = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      let best = nb[0], bd = Infinity;
      for (const q of nb) {
        if (q === IGN || q >= pLab.length) {
          if (bd === Infinity) best = q;
          continue;
        }
        const d = (C[0] - pLab[q][0]) ** 2 + (C[1] - pLab[q][1]) ** 2 + (C[2] - pLab[q][2]) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
      labels[i] = best;
      n++;
    }
  }
  return n;
}

/** Merges 4-connected regions smaller than `minArea` into the neighbour they touch most. */
export function despeckle(labels: Uint16Array, w: number, h: number, minArea: number) {
  if (minArea <= 1) return;
  const comp = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  const small: number[][] = [];
  let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (comp[s] >= 0) continue;
    const L = labels[s];
    const cells: number[] = [];
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      if (cells.length < minArea) cells.push(p);
      else cells.length = minArea; // big region: stop collecting (keeps memory flat)
      const x = p % w, y = (p - x) / w;
      if (x > 0 && comp[p - 1] < 0 && labels[p - 1] === L) { comp[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && comp[p + 1] < 0 && labels[p + 1] === L) { comp[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && comp[p - w] < 0 && labels[p - w] === L) { comp[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && comp[p + w] < 0 && labels[p + w] === L) { comp[p + w] = id; stack.push(p + w); }
    }
    if (cells.length < minArea) small.push(cells);
    id++;
  }
  small.sort((a, b) => a.length - b.length);
  for (const cells of small) {
    const L = labels[cells[0]];
    const votes = new Map<number, number>();
    for (const p of cells) {
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && labels[q] !== L) votes.set(labels[q], (votes.get(labels[q]) ?? 0) + 1);
      }
    }
    let to = -1, most = 0;
    for (const [k, v] of votes) if (v > most) { most = v; to = k; }
    if (to >= 0) for (const p of cells) labels[p] = to;
  }
}

/**
 * Outlines of every region labelled `L`, following pixel edges: closed lists of lattice corners
 * (collinear points removed). Outer rings and holes wind in opposite directions.
 */
export function regionRings(labels: Uint16Array, w: number, h: number, L: number): P2[][] {
  const W1 = w + 1;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === L;
  // Outgoing boundary edges per lattice vertex, bit d = direction (0 →, 1 ↓, 2 ←, 3 ↑); the region is on the right
  const out = new Uint8Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== L) continue;
      if (!at(x, y - 1)) out[y * W1 + x] |= 1;
      if (!at(x + 1, y)) out[y * W1 + x + 1] |= 2;
      if (!at(x, y + 1)) out[(y + 1) * W1 + x + 1] |= 4;
      if (!at(x - 1, y)) out[(y + 1) * W1 + x] |= 8;
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const rings: P2[][] = [];
  for (let v0 = 0; v0 < out.length; v0++) {
    while (out[v0]) {
      const firstD = out[v0] & 1 ? 0 : out[v0] & 2 ? 1 : out[v0] & 4 ? 2 : 3;
      let d = firstD;
      let x = v0 % W1, y = (v0 - x) / W1;
      let v = v0;
      let prevD = -1;
      const ring: P2[] = [];
      for (;;) {
        out[v] &= ~(1 << d);
        if (d !== prevD) ring.push({ x, y });
        prevD = d;
        x += DX[d];
        y += DY[d];
        v = y * W1 + x;
        if (v === v0) break;
        const m = out[v];
        // Prefer turning right, then straight, then left: diagonal pixels stay separate regions
        const nd = [(prevD + 1) % 4, prevD, (prevD + 3) % 4].find((k) => m & (1 << k));
        if (nd === undefined) break;
        d = nd;
      }
      // The start point sits mid-edge when the loop arrives heading the way it left
      if (prevD === firstD && ring.length > 1) ring.shift();
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

const ringArea = (pts: P2[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
};

const corner = (p: P2): PathAnchor => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y, type: 'corner' });

/** How far (px, outward along normal (nx, ny)) the real edge sits from the pixel edge at (x, y). */
type SubPixel = (x: number, y: number, nx: number, ny: number) => number;

/**
 * Sub-pixel edges from anti-aliasing: across a pixel edge, the pixels just inside and just outside
 * are compared with the solid colours one pixel further in and out. How much of the inside colour
 * each holds says where the true edge lies between pixel centres (a circle comes out round, not
 * with flats at its extremes).
 */
function subPixelEdges(buf: PixelBuffer): SubPixel {
  const { width: w, height: h, data } = buf;
  const at = (x: number, y: number) => {
    const cx = Math.min(w - 1, Math.max(0, Math.floor(x))), cy = Math.min(h - 1, Math.max(0, Math.floor(y)));
    return (cy * w + cx) * 4;
  };
  const cover = (o: number, inn: number, out: number) => {
    const ux = data[inn] - data[out], uy = data[inn + 1] - data[out + 1], uz = data[inn + 2] - data[out + 2];
    const ua = data[inn + 3] - data[out + 3];
    const len2 = ux * ux + uy * uy + uz * uz + ua * ua;
    if (len2 < 1600) return -1; // the two sides are too alike to measure
    const t = ((data[o] - data[out]) * ux + (data[o + 1] - data[out + 1]) * uy + (data[o + 2] - data[out + 2]) * uz + (data[o + 3] - data[out + 3]) * ua) / len2;
    return Math.min(1, Math.max(0, t));
  };
  return (x, y, nx, ny) => {
    const P = at(x - nx * 0.5, y - ny * 0.5), Q = at(x + nx * 0.5, y + ny * 0.5);
    const P2 = at(x - nx * 1.5, y - ny * 1.5), Q2 = at(x + nx * 1.5, y + ny * 1.5);
    const a = cover(Q, P2, Q2), b = cover(P, P2, Q2);
    if (a < 0 || b < 0) return 0;
    return Math.max(-0.75, Math.min(0.75, a + b - 1));
  };
}

/** Lattice ring → smooth Bézier anchors (pixel units), real corners kept sharp. */
export function fitRing(corners: P2[], tolerance: number, cornerDeg: number, subpixel?: SubPixel): PathAnchor[] {
  const n = corners.length;
  // Dense samples: the midpoint of every unit pixel edge (removes the staircase), each pushed along
  // the edge normal to where the anti-aliasing says the real edge is
  const dense: P2[] = [];
  const owner: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    for (let k = 0; k < len; k++) {
      const mx = a.x + dx * (k + 0.5), my = a.y + dy * (k + 0.5);
      const off = subpixel ? subpixel(mx, my, dy, -dx) : 0;
      dense.push({ x: mx + dy * off, y: my - dx * off });
      owner.push(i);
    }
  }
  const m = dense.length;
  if (m < 8) return corners.map(corner);
  const smoothLoop = (pts: P2[]) => pts.map((p, i) => {
    const a = pts[(i - 1 + m) % m];
    const c = pts[(i + 1) % m];
    return { x: (a.x + 2 * p.x + c.x) / 4, y: (a.y + 2 * p.y + c.y) / 4 };
  });
  // The staircase is ironed out over a few samples (more for looser fits) before curves are fitted;
  // small shapes get fewer passes so they don't shrink
  const passes = m < 40 ? 1 : tolerance < 0.5 ? 1 : tolerance < 1.2 ? 2 : 3;
  const sm = smoothLoop(dense);
  let loop = sm;
  for (let k = 1; k < passes; k++) loop = smoothLoop(loop);
  // Corner strength: angle between the chords K samples back and K ahead; keep local peaks
  const K = Math.max(2, Math.min(4, Math.floor(m / 8)));
  const ang = sm.map((p, i) => {
    const a = sm[(i - K + m) % m];
    const c = sm[(i + K) % m];
    const v1x = p.x - a.x, v1y = p.y - a.y, v2x = c.x - p.x, v2y = c.y - p.y;
    return Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)) * (180 / Math.PI);
  });
  const cornerIdx: number[] = [];
  for (let i = 0; i < m; i++) {
    if (ang[i] < cornerDeg) continue;
    let peak = true;
    for (let k = 1; k <= K && peak; k++) if (ang[(i + k) % m] > ang[i] || ang[(i - k + m) % m] >= ang[i]) peak = false;
    if (peak) cornerIdx.push(i);
  }
  // The staircase is already smoothed away, so the fit can hold the line closer than the tolerance
  const fit = (pts: P2[]) => fitCurves(pts, Math.max(0.2, tolerance * (passes > 1 ? 0.75 : 1)));

  if (!cornerIdx.length) {
    // Smooth closed curve: fit all the way round, then line up the seam handles
    const segs = fit([...loop, loop[0]]);
    if (!segs.length) return corners.map(corner);
    const anchors = segs.map((s, i): PathAnchor => {
      const next = segs[(i + 1) % segs.length];
      return { x: s.p3.x, y: s.p3.y, ix: s.p2.x, iy: s.p2.y, ox: next.p1.x, oy: next.p1.y, type: 'smooth' };
    });
    const a = anchors[anchors.length - 1];
    const tx = a.ox - a.ix, ty = a.oy - a.iy;
    const tl = Math.hypot(tx, ty) || 1;
    const li = Math.hypot(a.x - a.ix, a.y - a.iy);
    const lo = Math.hypot(a.ox - a.x, a.oy - a.y);
    Object.assign(a, { ix: a.x - (tx / tl) * li, iy: a.y - (ty / tl) * li, ox: a.x + (tx / tl) * lo, oy: a.y + (ty / tl) * lo });
    return anchors;
  }

  // Each corner snaps to the true pixel corner next to it
  const cornerPt = (i: number): P2 => {
    const c = corners[(owner[i] + 1) % n];
    return Math.hypot(c.x - dense[i].x, c.y - dense[i].y) <= 1.6 ? c : sm[i];
  };
  const runs: { start: P2; segs: CubicBezierSegment[] }[] = cornerIdx.map((i0, c) => {
    const i1 = cornerIdx[(c + 1) % cornerIdx.length];
    const start = cornerPt(i0);
    // Smooth only inside the run, so straight edges stay straight right up to their corners
    const raw: P2[] = [start];
    for (let i = (i0 + 1) % m; i !== i1; i = (i + 1) % m) raw.push(dense[i]);
    raw.push(cornerPt(i1));
    let run = raw;
    for (let k = 0; k < passes; k++) run = run.map((p, j) => (j === 0 || j === run.length - 1 ? p : { x: (run[j - 1].x + 2 * p.x + run[j + 1].x) / 4, y: (run[j - 1].y + 2 * p.y + run[j + 1].y) / 4 }));
    return { start, segs: run.length > 2 ? fit(run) : [] };
  });
  const anchors: PathAnchor[] = [];
  runs.forEach((r, c) => {
    const prev = runs[(c - 1 + runs.length) % runs.length].segs;
    const inH = prev.length ? prev[prev.length - 1].p2 : r.start;
    const outH = r.segs.length ? r.segs[0].p1 : r.start;
    anchors.push({ x: r.start.x, y: r.start.y, ix: inH.x, iy: inH.y, ox: outH.x, oy: outH.y, type: 'corner' });
    for (let s = 0; s < r.segs.length - 1; s++) {
      const a = r.segs[s];
      const b = r.segs[s + 1];
      anchors.push({ x: a.p3.x, y: a.p3.y, ix: a.p2.x, iy: a.p2.y, ox: b.p1.x, oy: b.p1.y, type: 'smooth' });
    }
  });
  return anchors;
}

/** Point-in-polygon (even-odd) for lattice rings. */
function inside(p: P2, ring: P2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Groups a colour's rings into islands: each outer ring with the holes directly inside it. */
export function islands(rings: P2[][]): P2[][][] {
  const outer = rings.filter((r) => ringArea(r) > 0).map((r) => ({ ring: r, area: ringArea(r), holes: [] as P2[][] }));
  outer.sort((a, b) => a.area - b.area);
  for (const hole of rings.filter((r) => ringArea(r) <= 0)) {
    // A point half a pixel along the hole's first edge lies on no other ring
    const a = hole[0], b = hole[1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const p = { x: a.x + ((b.x - a.x) / len) * 0.5, y: a.y + ((b.y - a.y) / len) * 0.5 };
    const host = outer.find((o) => inside(p, o.ring));
    if (host) host.holes.push(hole);
  }
  return outer.sort((a, b) => b.area - a.area).map((o) => [o.ring, ...o.holes]);
}

/** Traces a raw pixel buffer. Coordinates in the result are image pixels. */
export function tracePixels(buf: PixelBuffer, opts: TraceOptions): TraceResult {
  const { width: w, height: h } = buf;
  const lab = labelPixels(buf, opts);
  const { labels } = lab;
  let palette = lab.palette;
  const exact = opts.mode === 'pixel-exact';
  if (opts.autoColors && !lab.fixed) pruneBlendColors(labels, buf, palette);
  if (!exact && opts.mode !== 'centerline') fixLonePixels(labels, buf, palette);
  if (!exact && opts.smoothEdges) smoothLabels(labels, w, h, Math.min(3, Math.round(opts.smoothEdges)));
  despeckle(labels, w, h, Math.max(1, Math.round(opts.minArea ?? 4)));
  if (opts.removeBackground && opts.mode !== 'bw' && opts.mode !== 'line-art' && opts.mode !== 'centerline') dropBackground(labels, w, h);
  if (opts.mode === 'centerline') return traceCenterline(buf, labels, palette[0], opts);
  if (!lab.fixed && opts.trueColors !== false) {
    const measured = measureColors(labels, buf, palette.length);
    palette = palette.map((c, j) => measured[j] ?? c);
  }
  const tol = opts.simplification ?? 1;
  const cornerDeg = opts.cornerThreshold ?? 60;
  const areas = new Float64Array(palette.length);
  for (let i = 0; i < labels.length; i++) if (labels[i] !== IGN) areas[labels[i]]++;
  const order = palette.map((_, j) => j).filter((j) => areas[j] > 0).sort((a, b) => areas[b] - areas[a]);
  const overlap = opts.method === 'overlap' && order.length > 1;
  // Overlap: each colour covers itself plus every colour stacked above it
  const rank = new Int32Array(palette.length).fill(-1);
  order.forEach((j, k) => (rank[j] = k));
  const mask = overlap ? new Uint16Array(labels.length) : null;
  const contours: TraceContour[] = [];
  const layers: Layer[] = [];
  const colors: string[] = [];
  let anchorCount = 0;
  const sub = exact || opts.subpixel === false ? undefined : subPixelEdges(buf);
  const fitAll = (rings: P2[][]) => rings.map((r) => (exact ? r.map(corner) : fitRing(r, tol, cornerDeg, sub))).filter((a) => a.length >= 2);
  order.forEach((j, k) => {
    const color = hex(...palette[j]);
    let rings: P2[][];
    if (mask) {
      for (let i = 0; i < labels.length; i++) mask[i] = labels[i] !== IGN && rank[labels[i]] >= k ? 0 : IGN;
      rings = regionRings(mask, w, h, 0);
    } else rings = regionRings(labels, w, h, j);
    for (const ring of rings) contours.push({ points: ring, color, isHole: ringArea(ring) < 0 });
    const gaps = !!opts.fillGaps && !overlap;
    if (opts.split) {
      let n = 0;
      for (const isl of islands(rings)) {
        const fitted = fitAll(isl);
        if (!fitted.length) continue;
        anchorCount += fitted.reduce((s, r) => s + r.length, 0);
        layers.push(ringsLayer(fitted, color, gaps, `Trace · ${color} · ${++n}`));
      }
      if (n) colors.push(color);
      return;
    }
    const fitted = fitAll(rings);
    if (!fitted.length) return;
    anchorCount += fitted.reduce((s, r) => s + r.length, 0);
    colors.push(color);
    layers.push(ringsLayer(fitted, color, gaps, `Trace · ${color}`));
  });
  return { contours, layers, width: w, height: h, colors, anchorCount };
}

// ---------------------------------------------------------------- centerline

/** Zhang–Suen thinning: 1-pixel-wide 8-connected skeleton of `m` (1 = ink), in place. */
export function thin(m: Uint8Array, w: number, h: number) {
  const del: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!m[i]) continue;
          const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1], p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = +(!p2 && p3) + +(!p3 && p4) + +(!p4 && p5) + +(!p5 && p6) + +(!p6 && p7) + +(!p7 && p8) + +(!p8 && p9) + +(!p9 && p2);
          if (A !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          del.push(i);
        }
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
}

/** Chamfer (3-4) distance to the nearest background pixel, in pixels. */
function distanceField(m: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  const BIG = 1e9;
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? BIG : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

const N8 = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] as const;

/** Skeleton → polylines (pixel indices): node to node, then the closed loops left over. */
export function skeletonPaths(sk: Uint8Array, w: number, h: number): { pts: number[]; closed: boolean }[] {
  const nb = (i: number): number[] => {
    const x = i % w, y = (i - x) / w;
    const out: number[] = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!sk[j]) continue;
      // A diagonal step is redundant when an orthogonal pixel already links the two
      if (dx && dy && (sk[y * w + nx] || sk[ny * w + x])) continue;
      out.push(j);
    }
    return out;
  };
  const deg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (sk[i]) deg[i] = nb(i).length;
  const isNode = (i: number) => deg[i] !== 2;
  const used = new Set<number>();
  const ek = (a: number, b: number) => (a < b ? a * w * h + b : b * w * h + a);
  const paths: { pts: number[]; closed: boolean }[] = [];
  const walk = (start: number, next: number) => {
    const pts = [start];
    let prev = start, cur = next;
    used.add(ek(prev, cur));
    for (;;) {
      pts.push(cur);
      if (isNode(cur)) break;
      const n = nb(cur).find((j) => j !== prev && !used.has(ek(cur, j)));
      if (n === undefined) break;
      used.add(ek(cur, n));
      prev = cur;
      cur = n;
      if (cur === start) { pts.push(cur); break; }
    }
    return pts;
  };
  for (let i = 0; i < w * h; i++) {
    if (!sk[i] || !isNode(i)) continue;
    if (deg[i] === 0) { paths.push({ pts: [i, i], closed: false }); continue; } // a dot (the i of a word)
    for (const j of nb(i)) if (!used.has(ek(i, j))) paths.push({ pts: walk(i, j), closed: false });
  }
  // Pure loops (an O) have no nodes
  for (let i = 0; i < w * h; i++) {
    if (!sk[i] || isNode(i)) continue;
    const n = nb(i).find((j) => !used.has(ek(i, j)));
    if (n === undefined) continue;
    const pts = walk(i, n);
    const closed = pts[pts.length - 1] === i;
    if (closed) pts.pop();
    paths.push({ pts, closed });
  }
  return paths;
}

function traceCenterline(buf: PixelBuffer, labels: Uint16Array, ink: RGB, opts: TraceOptions): TraceResult {
  const { width: w, height: h } = buf;
  const m = new Uint8Array(w * h);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < w * h; i++) {
    if (labels[i] !== 0) continue;
    m[i] = 1;
    sr += buf.data[i * 4]; sg += buf.data[i * 4 + 1]; sb += buf.data[i * 4 + 2]; sn++;
  }
  const dist = distanceField(m, w, h);
  thin(m, w, h);
  const color = opts.palette?.[0] ? hex(...ink) : opts.trueColors !== false && sn ? hex(sr / sn, sg / sn, sb / sn) : hex(...ink);
  const tol = Math.max(0.3, opts.simplification ?? 1);
  const cornerDeg = opts.cornerThreshold ?? 60;
  const raw = skeletonPaths(m, w, h);
  // Spurs: short branches off a junction (thinning whiskers at line corners)
  const ends = new Map<number, number>();
  for (const p of raw) for (const e of [p.pts[0], p.pts[p.pts.length - 1]]) ends.set(e, (ends.get(e) ?? 0) + 1);
  const deg = (i: number) => ends.get(i) ?? 0;
  const halfW = (pts: number[]) => {
    const v = pts.map((i) => dist[i]).sort((a, b) => a - b);
    return v[v.length >> 1] || 0.5;
  };
  const kept = raw.filter((p) => {
    if (p.closed || p.pts.length > 3 + 2 * halfW(p.pts)) return true;
    const a = deg(p.pts[0]), b = deg(p.pts[p.pts.length - 1]);
    return !((a === 1) !== (b === 1)); // drop only end-to-junction stubs
  });
  // With the spurs gone, two strokes meeting at a former junction become one
  for (let joined = true; joined; ) {
    joined = false;
    const at = new Map<number, number[]>();
    kept.forEach((p, k) => {
      if (p.closed) return;
      for (const e of new Set([p.pts[0], p.pts[p.pts.length - 1]])) at.set(e, [...(at.get(e) ?? []), k]);
    });
    for (const [node, ks] of at) {
      if (ks.length !== 2 || ks[0] === ks[1]) continue;
      const A = kept[ks[0]], B = kept[ks[1]];
      const a = A.pts[A.pts.length - 1] === node ? A.pts : [...A.pts].reverse();
      const b = B.pts[0] === node ? B.pts : [...B.pts].reverse();
      const merged = [...a, ...b.slice(1)];
      const closed = merged[0] === merged[merged.length - 1] && merged.length > 3;
      if (closed) merged.pop();
      kept[ks[0]] = { pts: merged, closed };
      kept.splice(ks[1], 1);
      joined = true;
      break;
    }
  }
  const layers: Layer[] = [];
  const contours: TraceContour[] = [];
  let anchorCount = 0;
  for (const p of kept) {
    const pts = p.pts.map((i) => ({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 }));
    if (pts.length < 2) continue;
    const width = opts.strokeWidth || Math.max(1, Math.round(halfW(p.pts) * 2 * 2) / 2);
    const segs = fitCurves(pts, tol, { closed: p.closed, cornerAngle: cornerDeg, smooth: true });
    const anchors = segs.length ? bezierSegmentsToAnchors(segs, p.closed) : pts.map(corner);
    if (anchors.length < 2) continue;
    anchorCount += anchors.length;
    contours.push({ points: pts, color, isHole: false });
    layers.push(strokeLayer(anchors, color, width, p.closed));
  }
  return { contours, layers, width: w, height: h, colors: layers.length ? [color] : [], anchorCount };
}

/** An open (or closed) stroke-only path layer from pixel-space anchors. */
function strokeLayer(anchors: PathAnchor[], color: string, width: number, closed: boolean): Layer {
  const l = ringsLayer([anchors], color, false, 'Trace · stroke', closed);
  l.shape = { ...l.shape!, fillEnabled: false, strokeWidth: width, strokeCap: 'round', strokeJoin: 'round', closed };
  return l;
}

/** Extremes of one cubic coordinate (p0..p3) over t in [0, 1]. */
function cubicRange(p0: number, p1: number, p2: number, p3: number): [number, number] {
  let lo = Math.min(p0, p3), hi = Math.max(p0, p3);
  // Roots of the derivative: a t² + b t + c = 0
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
  else {
    const d = b * b - 4 * a * c;
    if (d >= 0) ts.push((-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a));
  }
  for (const t of ts) {
    if (t <= 0 || t >= 1) continue;
    const u = 1 - t;
    const v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** Tight bounds of the curves themselves (not their handles), so a selection frame hugs the shape. */
export function curveBounds(rings: PathAnchor[][], closed = true): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    const segs = closed ? r.length : r.length - 1;
    if (r.length === 1) { x0 = Math.min(x0, r[0].x); x1 = Math.max(x1, r[0].x); y0 = Math.min(y0, r[0].y); y1 = Math.max(y1, r[0].y); }
    for (let i = 0; i < segs; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const [ax, bx] = cubicRange(a.x, a.ox, b.ix, b.x), [ay, by] = cubicRange(a.y, a.oy, b.iy, b.y);
      x0 = Math.min(x0, ax); x1 = Math.max(x1, bx); y0 = Math.min(y0, ay); y1 = Math.max(y1, by);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** One compound-path shape layer from pixel-space rings (filled even-odd). */
function ringsLayer(rings: PathAnchor[][], color: string, gaps: boolean, name: string, closed = true): Layer {
  const bb = curveBounds(rings, closed);
  const x0 = bb.x, y0 = bb.y, x1 = bb.x + bb.width, y1 = bb.y + bb.height;
  const W = x1 - x0 || 1, H = y1 - y0 || 1;
  const norm = rings.map((r) => r.map((a) => ({ ...a, x: (a.x - x0) / W, y: (a.y - y0) / H, ix: (a.ix - x0) / W, iy: (a.iy - y0) / H, ox: (a.ox - x0) / W, oy: (a.oy - y0) / H })));
  return makeLayer({
    kind: 'shape',
    name,
    x: x0,
    y: y0,
    width: W,
    height: H,
    shape: {
      shape: 'path',
      fill: color,
      fillEnabled: true,
      stroke: color,
      // A hairline in the fill colour closes the anti-aliasing seams between neighbouring colours
      strokeWidth: gaps ? 0.6 : 0,
      strokeJoin: 'round',
      radius: 0,
      points: norm[0],
      compoundPoints: norm.length > 1 ? norm : undefined,
      closed: true,
    },
  });
}

/** Moves and scales a trace result (e.g. onto the image layer it came from). */
export function placeTrace(res: TraceResult, x: number, y: number, scale = 1): TraceResult {
  const layers = res.layers.map(
    (l) => ({ ...l, x: x + l.x * scale, y: y + l.y * scale, width: l.width * scale, height: l.height * scale, shape: l.shape && { ...l.shape, strokeWidth: l.shape.strokeWidth * scale } }) as Layer,
  );
  const contours = res.contours.map((c) => ({ ...c, points: c.points.map((p) => ({ x: x + p.x * scale, y: y + p.y * scale })) }));
  return { ...res, layers, contours, width: res.width * scale, height: res.height * scale };
}

/** Pixels of `canvas` (or of `crop` in canvas pixels), at most `maxSide` on the long side. */
function readPixels(canvas: HTMLCanvasElement, maxSide: number, crop?: { x: number; y: number; width: number; height: number }) {
  const r = crop
    ? { x: Math.max(0, Math.floor(crop.x)), y: Math.max(0, Math.floor(crop.y)), width: 0, height: 0 }
    : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  if (crop) {
    r.width = Math.max(1, Math.min(canvas.width, Math.ceil(crop.x + crop.width)) - r.x);
    r.height = Math.max(1, Math.min(canvas.height, Math.ceil(crop.y + crop.height)) - r.y);
  }
  const s = Math.min(1, maxSide / Math.max(r.width, r.height));
  if (s >= 1 && !crop) return { buf: ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height) as PixelBuffer, r, scale: 1 };
  const W = Math.max(1, Math.round(r.width * s)), H = Math.max(1, Math.round(r.height * s));
  const c = createCanvas(W, H);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, W, H);
  return { buf: g.getImageData(0, 0, W, H) as PixelBuffer, r, scale: r.width / W };
}

let worker: Worker | null = null;
let jobId = 0;
const jobs = new Map<number, { resolve: (r: TraceResult) => void; reject: (e: Error) => void }>();

function traceWorker(): Worker | null {
  if (worker || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./tracer.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; res?: TraceResult; error?: string }>) => {
      const job = jobs.get(e.data.id);
      jobs.delete(e.data.id);
      if (!job) return;
      if (e.data.res) job.resolve(e.data.res);
      else job.reject(new Error(e.data.error ?? 'Trace failed'));
    };
    worker.onerror = (e) => {
      for (const j of jobs.values()) j.reject(new Error(e.message || 'Trace worker failed'));
      jobs.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** tracePixels off the main thread (falls back to running here when workers are unavailable). */
export function tracePixelsAsync(buf: PixelBuffer, opts: TraceOptions): Promise<TraceResult> {
  const w = traceWorker();
  if (!w) return Promise.resolve(tracePixels(buf, opts));
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    jobs.set(id, {
      // Layers made in the worker get fresh ids here (both threads count ids from the same start)
      resolve: (res) => resolve({ ...res, layers: res.layers.map((l) => makeLayer({ ...l })) }),
      reject,
    });
    const data = new Uint8ClampedArray(buf.data);
    w.postMessage({ id, buf: { width: buf.width, height: buf.height, data }, opts }, [data.buffer]);
  });
}

/** Traces a canvas (or a `crop` of it, in canvas pixels) off the main thread; image-pixel coordinates. */
export async function traceCanvasAsync(canvas: HTMLCanvasElement, opts: TraceOptions, maxSide = 1600, crop?: { x: number; y: number; width: number; height: number }): Promise<TraceResult> {
  const { buf, r, scale } = readPixels(canvas, maxSide, crop);
  const res = await tracePixelsAsync(buf, opts);
  return r.x || r.y || scale !== 1 ? placeTrace(res, r.x, r.y, scale) : res;
}

/** traceLayer off the main thread; `crop` is in the layer's canvas pixels. */
export async function traceLayerAsync(layer: Layer, opts: TraceOptions, crop?: { x: number; y: number; width: number; height: number }, maxSide = 1600): Promise<TraceResult | null> {
  if (!layer.canvas) return null;
  const res = await traceCanvasAsync(layer.canvas, opts, maxSide, crop);
  const scale = layer.width && layer.canvas.width ? layer.width / layer.canvas.width : 1;
  return placeTrace(res, layer.x, layer.y, scale);
}

/**
 * Traces a canvas. Big images are traced at most `maxSide` px on the long side and scaled back, so a
 * 6000 px photo doesn't stall the app.
 */
export function traceCanvas(canvas: HTMLCanvasElement, opts: TraceOptions, maxSide = 1600): TraceResult {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let src = canvas;
  if (s < 1) {
    src = createCanvas(Math.max(1, Math.round(canvas.width * s)), Math.max(1, Math.round(canvas.height * s)));
    const c = ctx2d(src);
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, 0, 0, src.width, src.height);
  }
  const res = tracePixels(ctx2d(src).getImageData(0, 0, src.width, src.height), opts);
  return s < 1 ? placeTrace(res, 0, 0, canvas.width / src.width) : res;
}

/** Traces a pixel layer and places the paths exactly over it. */
export function traceLayer(layer: Layer, opts: TraceOptions, maxSide = 1600): TraceResult | null {
  if (!layer.canvas) return null;
  const res = traceCanvas(layer.canvas, opts, maxSide);
  const scale = layer.width && layer.canvas.width ? layer.width / layer.canvas.width : 1;
  return placeTrace(res, layer.x, layer.y, scale);
}
