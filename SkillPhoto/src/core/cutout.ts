// Model-guided cutout: turns a coarse "this is the object" probability (from the on-device models in
// aiModels.ts, or the classic saliency map) into a clean, pixel-accurate matte:
//  1. a proxy graph cut that mixes the prior with colour models (fixes soft or patchy model output),
//  2. a full-resolution graph cut in a thin band around the edge (snaps the outline to the real edge),
//  3. soft matting of that edge (anti-aliasing, hair and fur) with the foreground colour for decontamination.
// Pure functions on RGBA buffers, no DOM.

import { MaxFlow } from './maxflow';
import { decontaminate, matteEdges, resizeMask, signedDistance } from './matte';
import type { RGBA } from './matte';
import { BG, FG, PR_BG, PR_FG, GMM, components, crop, downsample, fillHoles, grabCut, keepMain, kmeansAssign } from './segment';
import type { Box, RegionMask } from './segment';

/** Foreground probability (0..1) on a w×h grid that covers the whole roi. */
export interface Prior {
  p: Float32Array;
  w: number;
  h: number;
}

export interface CutoutOptions {
  /** 'crisp' for products and graphics (thin anti-aliased edge), 'hair' for people and pets (wide smart band). */
  edge?: 'crisp' | 'hair';
  /** Keep every confident part (a row of products) instead of only the main one. */
  keepAll?: boolean;
  /** Keep only the part under this point (roi coordinates). */
  seed?: { x: number; y: number };
  /** Longest side of the working proxy. */
  proxy?: number;
  /** Also return edge-cleaned cut-out pixels. */
  pixels?: boolean;
}

export interface CutoutResult {
  region: RegionMask;
  /** Edge-cleaned RGBA over the roi with the alpha applied (when `pixels` was asked for). */
  pixels?: Uint8ClampedArray;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Stretches a model output to the full 0..1 range (models are often shy of 1 on large flat areas). */
export function normalizePrior(p: Float32Array): Float32Array {
  let lo = Infinity, hi = -Infinity;
  for (const v of p) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out = new Float32Array(p.length);
  if (!(hi - lo > 0.05)) return out;
  // Keep a confident model untouched; only lift a weak maximum
  const top = Math.max(hi, 0.6);
  for (let i = 0; i < p.length; i++) out[i] = clamp01((p[i] - lo) / (top - lo));
  return out;
}

/**
 * Models are unsure inside big flat areas: a white box on a white table comes out as a bright rim with a
 * grey (0.2–0.5) face, while the real background stays near 0. Hysteresis fixes that: everything above a
 * low floor that is connected to a confident core is lifted to probable foreground. Confident holes
 * (the gap under an arm, a mug handle) are near 0 and stay; tiny holes are filled.
 */
export function liftUncertainHoles(p: Float32Array, w: number, h: number, floor = 0.15): Float32Array {
  const n = w * h;
  const out = Float32Array.from(p);
  const support = new Uint8Array(n);
  let core = 0;
  for (let i = 0; i < n; i++) {
    if (p[i] >= floor) support[i] = 1;
    if (p[i] >= 0.5) core++;
  }
  if (!core) return out;
  const { labels, sizes } = components(support, w, h);
  const hasCore = new Uint8Array(sizes.length);
  for (let i = 0; i < n; i++) if (p[i] >= 0.5) hasCore[labels[i]] = 1;
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (labels[i] && hasCore[labels[i]]) keep[i] = 1;
  fillHoles(keep, w, h, core * 0.002);
  for (let i = 0; i < n; i++) if (keep[i]) out[i] = Math.max(out[i], 0.58);
  return out;
}

/**
 * Proxy-resolution graph cut guided by the prior. The model decides *what* the object is: away from its
 * outline its answer is kept as sure foreground / background, so a white box on a white table stays whole
 * even though colour alone can't tell them apart. Only a band around the outline is cut by colour and edges.
 * Returns 1 for foreground.
 */
export function priorCut(s: RGBA, p: Float32Array): Uint8Array {
  const { w, h } = s;
  const n = w * h;
  const sdf = signedDistance(p, w, h);
  const band = Math.max(5, Math.round(Math.min(w, h) * 0.025));
  const tri = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = sdf[i];
    tri[i] = d > band ? FG : d < -band ? BG : p[i] >= 0.5 ? PR_FG : PR_BG;
  }
  return grabCut(s, tri, { iterations: 3, prior: p, priorWeight: 1.6, gamma: 50, fitSureFirst: true });
}

/**
 * Full-resolution edge snap: a graph cut restricted to a band of ±`r` px around the outline of a coarse
 * mask (`small`, sw×sh, upscaled to the image), with colour models learned from rings just inside and
 * just outside the band (local colours, so a red product on a red-ish wall still separates where it can).
 * Only pixels near the outline are visited, so the cost follows the perimeter, not the image area.
 * Returns a hard 0/1 mask at full resolution.
 */
export function bandRefine(img: RGBA, small: Float32Array, sw: number, sh: number, r: number): Float32Array {
  const { w, h } = img;
  const n = w * h;
  const sx = w / sw, sy = h / sh;
  const scale = Math.max(sx, sy);
  const ring = Math.max(4, r * 2);
  const sdfS = signedDistance(small, sw, sh);
  const out = new Float32Array(n);
  // Full-res signed distance and coarse value, only where they matter
  const sdf = new Float32Array(n);
  const coarse = new Float32Array(n);
  const near = new Uint8Array(n);
  const reachS = (r + ring) / scale + 1.5;
  const bil = (a: Float32Array, fx: number, fy: number) => {
    const x = Math.min(sw - 1, Math.max(0, fx)), y = Math.min(sh - 1, Math.max(0, fy));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    return (a[y0 * sw + x0] * (1 - tx) + a[y0 * sw + x1] * tx) * (1 - ty) + (a[y1 * sw + x0] * (1 - tx) + a[y1 * sw + x1] * tx) * ty;
  };
  for (let py = 0; py < sh; py++) {
    const y0 = Math.floor(py * sy), y1 = Math.min(h, Math.floor((py + 1) * sy));
    for (let px = 0; px < sw; px++) {
      const x0 = Math.floor(px * sx), x1 = Math.min(w, Math.floor((px + 1) * sx));
      const d = sdfS[py * sw + px];
      if (Math.abs(d) > reachS) {
        if (d > 0) for (let y = y0; y < y1; y++) out.fill(1, y * w + x0, y * w + x1);
        continue;
      }
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const fx = (x + 0.5) / sx - 0.5, fy = (y + 0.5) / sy - 0.5;
          const c = bil(small, fx, fy);
          coarse[i] = c;
          // Distance in full-res pixels, measured to the upscaled outline
          sdf[i] = bil(sdfS, fx, fy) * scale;
          near[i] = 1;
          out[i] = c >= 0.5 ? 1 : 0;
        }
    }
  }
  const node = new Int32Array(n).fill(-1);
  const bandIdx: number[] = [];
  const fgRing: number[] = [];
  const bgRing: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!near[i]) continue;
    const d = sdf[i];
    if (Math.abs(d) <= r) {
      node[i] = bandIdx.length;
      bandIdx.push(i);
    } else if (d > r && d <= r + ring) fgRing.push(i);
    else if (d < -r && d >= -r - ring) bgRing.push(i);
  }
  if (!bandIdx.length || fgRing.length < 20 || bgRing.length < 20) return out;

  const px = img.data;
  const fit = (ids: number[]) => {
    const stride = Math.max(1, Math.floor(ids.length / 24000));
    const count = Math.ceil(ids.length / stride);
    const rgb = new Float32Array(count * 3);
    const idx = new Int32Array(count);
    for (let s = 0, k = 0; s < ids.length; s += stride, k++) {
      const q = ids[s] * 4;
      rgb[k * 3] = px[q];
      rgb[k * 3 + 1] = px[q + 1];
      rgb[k * 3 + 2] = px[q + 2];
      idx[k] = k;
    }
    const comp = new Uint8Array(count);
    kmeansAssign(rgb, idx, count, comp);
    const g = new GMM();
    g.learn(rgb, idx, comp, count);
    for (let k = 0; k < count; k++) comp[k] = g.which(rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]);
    g.learn(rgb, idx, comp, count);
    return g;
  };
  const fgM = fit(fgRing);
  const bgM = fit(bgRing);

  const diff2 = (i: number, j: number) => {
    const a = i * 4, b = j * 4;
    return (px[a] - px[b]) ** 2 + (px[a + 1] - px[b + 1]) ** 2 + (px[a + 2] - px[b + 2]) ** 2;
  };
  let sum = 0, cnt = 0;
  for (const i of bandIdx) {
    const x = i % w;
    if (x < w - 1) {
      sum += diff2(i, i + 1);
      cnt++;
    }
    if (i + w < n) {
      sum += diff2(i, i + w);
      cnt++;
    }
  }
  const beta = sum > 0 ? cnt / (2 * sum) : 0;
  const SCALE = 10;
  const gamma = 50;
  const m = bandIdx.length;
  const g = new MaxFlow(m, m * 4);
  const src = new Float64Array(m);
  const snk = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const i = bandIdx[k];
    const q = i * 4;
    const pf = fgM.prob(px[q], px[q + 1], px[q + 2]);
    const pb = bgM.prob(px[q], px[q + 1], px[q + 2]);
    const prior = Math.min(0.95, Math.max(0.05, coarse[i]));
    // Source capacity = cost of labelling it background
    src[k] += -Math.log(Math.max(1e-30, pb)) - 0.7 * Math.log(1 - prior);
    snk[k] += -Math.log(Math.max(1e-30, pf)) - 0.7 * Math.log(prior);
  }
  const link = (k: number, i: number, j: number, wgt: number) => {
    const c = gamma * wgt * Math.exp(-beta * diff2(i, j));
    const nj = node[j];
    if (nj >= 0) {
      const cap = Math.round(c * SCALE);
      if (cap) g.addEdge(k, nj, cap, cap);
    } else if (out[j] >= 0.5) src[k] += c;
    else snk[k] += c;
  };
  const diag = 1 / Math.SQRT2;
  const NB = [[1, 0, 1], [0, 1, 1], [1, 1, diag], [-1, 1, diag], [-1, 0, 1], [0, -1, 1], [-1, -1, diag], [1, -1, diag]] as const;
  for (let k = 0; k < m; k++) {
    const i = bandIdx[k];
    const x = i % w, y = (i - x) / w;
    // Each pair once: forward neighbours for band–band links, every neighbour for band–fixed links
    for (const [dx, dy, wt] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const forward = dy > 0 || (dy === 0 && dx > 0);
      if (node[j] >= 0 && !forward) continue;
      link(k, i, j, wt);
    }
  }
  for (let k = 0; k < m; k++) {
    const a = src[k], b = snk[k];
    const lo = Math.min(a, b);
    g.addTWeights(k, Math.round((a - lo) * SCALE), Math.round((b - lo) * SCALE));
  }
  g.solve();
  for (let k = 0; k < m; k++) out[bandIdx[k]] = g.isSource(k) ? 1 : 0;
  return out;
}

/** Soft edge radius for a picture of this size. */
export function edgeRadius(w: number, h: number, edge: 'crisp' | 'hair') {
  const side = Math.min(w, h);
  return edge === 'hair' ? Math.max(3, Math.round(side / 160)) : Math.max(1.5, side / 900);
}

/**
 * Hard mask → soft matte, tile by tile: only the tiles the outline passes through are matted, so a big
 * photo costs about its perimeter, not its area. With `decon`, also writes edge-cleaned colours
 * (no halo of the old background) into that RGBA buffer, alpha applied.
 */
export function softEdges(img: RGBA, hard: Float32Array, edge: 'crisp' | 'hair', decon?: Uint8ClampedArray, deconAmount = 0.85): Float32Array {
  const { w, h } = img;
  const radius = edgeRadius(w, h, edge);
  const alpha = Float32Array.from(hard);
  if (decon) {
    decon.set(img.data);
    for (let i = 0; i < w * h; i++) decon[i * 4 + 3] = Math.round(img.data[i * 4 + 3] * hard[i]);
  }
  const T = 256;
  const tw = Math.ceil(w / T), th = Math.ceil(h / T);
  const reach = Math.ceil(radius) + 2;
  const flagged = new Uint8Array(tw * th);
  const mark = (x: number, y: number) => {
    const tx0 = Math.max(0, Math.floor((x - reach) / T)), tx1 = Math.min(tw - 1, Math.floor((x + reach) / T));
    const ty0 = Math.max(0, Math.floor((y - reach) / T)), ty1 = Math.min(th - 1, Math.floor((y + reach) / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) flagged[ty * tw + tx] = 1;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = hard[i] >= 0.5;
      if ((x < w - 1 && v !== hard[i + 1] >= 0.5) || (y < h - 1 && v !== hard[i + w] >= 0.5)) mark(x, y);
    }
  const margin = reach + 24;
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      if (!flagged[ty * tw + tx]) continue;
      const cx = tx * T, cy = ty * T;
      const cw = Math.min(T, w - cx), ch = Math.min(T, h - cy);
      const box = { x: Math.max(0, cx - margin), y: Math.max(0, cy - margin), w: 0, h: 0 };
      box.w = Math.min(w, cx + cw + margin) - box.x;
      box.h = Math.min(h, cy + ch + margin) - box.y;
      const tile = crop(img, box);
      const tm = new Float32Array(box.w * box.h);
      for (let y = 0; y < box.h; y++) tm.set(hard.subarray((box.y + y) * w + box.x, (box.y + y) * w + box.x + box.w), y * box.w);
      const res = matteEdges(tile, tm, radius, true, null);
      const px = decon ? decontaminate(tile, res, deconAmount) : null;
      for (let y = cy; y < cy + ch; y++)
        for (let x = cx; x < cx + cw; x++) {
          const k = (y - box.y) * box.w + (x - box.x);
          const i = y * w + x;
          alpha[i] = res.alpha[k];
          if (px && decon) {
            decon[i * 4] = px[k * 4];
            decon[i * 4 + 1] = px[k * 4 + 1];
            decon[i * 4 + 2] = px[k * 4 + 2];
            decon[i * 4 + 3] = px[k * 4 + 3];
          }
        }
    }
  return alpha;
}

/** Hard mask over `region` → the result: soft alpha, plus cleaned pixels when asked. */
function finishCut(region: RGBA, roi: Box, hard: Float32Array, edge: 'crisp' | 'hair', withPixels: boolean): CutoutResult {
  const pixels = withPixels ? new Uint8ClampedArray(region.w * region.h * 4) : undefined;
  const alpha = softEdges(region, hard, edge, pixels);
  return { region: { roi, alpha }, pixels };
}

/** Snaps an already-found region (classic pipelines, a painted mask) to full-resolution edges. */
export function snapRegion(img: RGBA, r: RegionMask, edge: 'crisp' | 'hair' = 'crisp', scale = 4, withPixels = false): CutoutResult {
  const region = r.roi.x === 0 && r.roi.y === 0 && r.roi.w === img.w && r.roi.h === img.h ? img : crop(img, r.roi);
  const k = Math.max(1, Math.max(region.w, region.h) / 640);
  const sw = Math.max(1, Math.round(region.w / k)), sh = Math.max(1, Math.round(region.h / k));
  const small = k > 1 ? resizeMask(r.alpha, region.w, region.h, sw, sh) : r.alpha;
  const hard = bandRefine(region, small, sw, sh, Math.max(2, Math.ceil(Math.max(scale, k)) + 2));
  return finishCut(region, r.roi, hard, edge, withPixels);
}

/** The whole pipeline: prior over `roi` → clean matte over `roi`. */
export function cutout(img: RGBA, roi: Box, prior: Prior, opts: CutoutOptions = {}): CutoutResult | null {
  const region = roi.x === 0 && roi.y === 0 && roi.w === img.w && roi.h === img.h ? img : crop(img, roi);
  const { img: s, f } = downsample(region, { x: 0, y: 0, w: region.w, h: region.h }, opts.proxy ?? 560);
  const n = s.w * s.h;
  let p = normalizePrior(resizeMask(prior.p, prior.w, prior.h, s.w, s.h));
  p = liftUncertainHoles(p, s.w, s.h);
  if (!p.some((v) => v >= 0.5)) return null;
  const cut = priorCut(s, p);
  if (opts.seed) {
    const sx = Math.min(s.w - 1, Math.max(0, Math.round(opts.seed.x / f)));
    const sy = Math.min(s.h - 1, Math.max(0, Math.round(opts.seed.y / f)));
    const seed = sy * s.w + sx;
    if (!cut[seed]) return null;
    keepMain(cut, s.w, s.h, 0, (id, labels) => labels[seed] === id);
  } else keepMain(cut, s.w, s.h, opts.keepAll ? 0.01 : 0.06);
  fillHoles(cut, s.w, s.h, n * 0.002);
  if (!cut.some((v) => v)) return null;
  const small = new Float32Array(n);
  for (let i = 0; i < n; i++) small[i] = cut[i];
  const scale = region.w / s.w;
  const hard = bandRefine(region, small, s.w, s.h, Math.ceil(scale) + 2);
  return finishCut(region, roi, hard, opts.edge ?? 'crisp', !!opts.pixels);
}
