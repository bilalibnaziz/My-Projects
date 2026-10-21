// Smart selection engine: colour models + graph cuts (GrabCut), a saliency map for "what is the subject",
// and the pipelines behind Select Subject, Object Selection, Select Sky and edge-snapping Quick Selection.
// Fully local, no model download. Works on a small proxy, then snaps to full-resolution edges.

import { MaxFlow } from './maxflow';
import { guidedUpsample, localDetail, resizeMask, boxMean, signedDistance } from './matte';
import type { RGBA } from './matte';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Trimap labels. */
export const BG = 0;
export const FG = 1;
export const PR_BG = 2;
export const PR_FG = 3;

// ================================================================ image helpers

/** Area-averaged downsample of a region to at most `maxSide` pixels (alpha-weighted colour). */
export function downsample(img: RGBA, roi: Box, maxSide: number): { img: RGBA; f: number } {
  const f = Math.max(1, Math.max(roi.w, roi.h) / maxSide);
  const w = Math.max(1, Math.round(roi.w / f));
  const h = Math.max(1, Math.round(roi.h / f));
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = roi.w / w;
  const fy = roi.h / h;
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const sy0 = roi.y + Math.floor(y * fy);
    const sy1 = Math.max(sy0 + 1, roi.y + Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const sx0 = roi.x + Math.floor(x * fx);
      const sx1 = Math.max(sx0 + 1, roi.x + Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let sy = sy0; sy < sy1; sy++)
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * img.w + sx) * 4;
          const al = d[i + 3];
          r += d[i] * al;
          g += d[i + 1] * al;
          b += d[i + 2] * al;
          a += al;
          cnt++;
        }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / cnt;
    }
  }
  return { img: { data: out, w, h }, f };
}

/** Copies a region out of an image. */
export function crop(img: RGBA, roi: Box): RGBA {
  const out = new Uint8ClampedArray(roi.w * roi.h * 4);
  for (let y = 0; y < roi.h; y++) {
    const s = ((roi.y + y) * img.w + roi.x) * 4;
    out.set(img.data.subarray(s, s + roi.w * 4), y * roi.w * 4);
  }
  return { data: out, w: roi.w, h: roi.h };
}

function srgbToLinear(v: number) {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** CIELAB (D65) per pixel, interleaved L, a, b. */
export function toLab(img: RGBA): Float32Array {
  const n = img.w * img.h;
  const out = new Float32Array(n * 3);
  const d = img.data;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  for (let i = 0; i < n; i++) {
    const r = srgbToLinear(d[i * 4]);
    const g = srgbToLinear(d[i * 4 + 1]);
    const b = srgbToLinear(d[i * 4 + 2]);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const fx = f(X), fy = f(Y), fz = f(Z);
    out[i * 3] = 116 * fy - 16;
    out[i * 3 + 1] = 500 * (fx - fy);
    out[i * 3 + 2] = 200 * (fy - fz);
  }
  return out;
}

function normalize(a: Float32Array) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  const s = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * s;
  return a;
}

/** Otsu threshold of values in 0..1. */
export function otsu(v: Float32Array): number {
  const bins = 64;
  const hist = new Float64Array(bins);
  for (let i = 0; i < v.length; i++) hist[Math.min(bins - 1, Math.floor(v[i] * bins))]++;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 0.5;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = v.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = (t + 1) / bins;
    }
  }
  return bestT;
}

// ================================================================ saliency

/**
 * "Which part of the picture is the subject": minimum-barrier distance from the image border
 * (Zhang et al. 2015) plus colour contrast against the border and a mild centre bias. 0..1.
 */
export function saliency(img: RGBA): Float32Array {
  const { w, h } = img;
  const n = w * h;
  const lab = toLab(img);
  const mbd = new Float32Array(n);
  const D = new Float32Array(n);
  const U = new Float32Array(n);
  const L = new Float32Array(n);
  const I = new Float32Array(n);
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < n; i++) I[i] = lab[i * 3 + ch];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        D[i] = border ? 0 : Infinity;
        U[i] = L[i] = I[i];
      }
    const relax = (i: number, j: number) => {
      const u = Math.max(U[j], I[i]);
      const l = Math.min(L[j], I[i]);
      const c = u - l;
      if (c < D[i]) {
        D[i] = c;
        U[i] = u;
        L[i] = l;
      }
    };
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 1; y < h; y++)
        for (let x = 1; x < w; x++) {
          const i = y * w + x;
          relax(i, i - 1);
          relax(i, i - w);
        }
      for (let y = h - 2; y >= 0; y--)
        for (let x = w - 2; x >= 0; x--) {
          const i = y * w + x;
          relax(i, i + 1);
          relax(i, i + w);
        }
    }
    for (let i = 0; i < n; i++) mbd[i] += Number.isFinite(D[i]) ? D[i] : 0;
  }
  normalize(mbd);

  // Contrast with each border side's colour statistics (min = "looks like some edge of the frame")
  const sides: number[][] = [[], [], [], []];
  const bw = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (y < bw) sides[0].push(i);
      if (y >= h - bw) sides[1].push(i);
      if (x < bw) sides[2].push(i);
      if (x >= w - bw) sides[3].push(i);
    }
  const stats = sides.map((idx) => {
    const m = [0, 0, 0];
    const s = [0, 0, 0];
    for (const i of idx) for (let c = 0; c < 3; c++) m[c] += lab[i * 3 + c];
    for (let c = 0; c < 3; c++) m[c] /= Math.max(1, idx.length);
    for (const i of idx) for (let c = 0; c < 3; c++) s[c] += (lab[i * 3 + c] - m[c]) ** 2;
    for (let c = 0; c < 3; c++) s[c] = Math.sqrt(s[c] / Math.max(1, idx.length)) + 6;
    return { m, s };
  });
  const contrast = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (const st of stats) {
      let d = 0;
      for (let c = 0; c < 3; c++) d += ((lab[i * 3 + c] - st.m[c]) / st.s[c]) ** 2;
      if (d < best) best = d;
    }
    contrast[i] = Math.sqrt(best);
  }
  normalize(contrast);

  const out = new Float32Array(n);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r2 = ((x - cx) / (w / 2)) ** 2 + ((y - cy) / (h / 2)) ** 2;
      out[i] = (0.6 * mbd[i] + 0.4 * contrast[i]) * (1 - 0.35 * Math.min(1, r2 / 2));
    }
  normalize(boxMean(out, w, h, Math.max(1, Math.round(Math.min(w, h) / 120)), out));
  return out;
}

// ================================================================ Gaussian mixture colour model

const K = 5;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GMM {
  coef = new Float64Array(K);
  mean = new Float64Array(K * 3);
  inv = new Float64Array(K * 9);
  /** 1/sqrt(det), folded into the density. */
  norm = new Float64Array(K);

  /** Fits from pixel indices, given a component per sample. */
  learn(rgb: Float32Array, idx: Int32Array, comp: Uint8Array, count: number) {
    const sums = new Float64Array(K * 3);
    const prods = new Float64Array(K * 9);
    const cnt = new Float64Array(K);
    for (let s = 0; s < count; s++) {
      const p = idx[s] * 3;
      const k = comp[s];
      const r = rgb[p], g = rgb[p + 1], b = rgb[p + 2];
      cnt[k]++;
      sums[k * 3] += r;
      sums[k * 3 + 1] += g;
      sums[k * 3 + 2] += b;
      const q = k * 9;
      prods[q] += r * r; prods[q + 1] += r * g; prods[q + 2] += r * b;
      prods[q + 4] += g * g; prods[q + 5] += g * b; prods[q + 8] += b * b;
    }
    for (let k = 0; k < K; k++) {
      if (cnt[k] < 2) {
        this.coef[k] = 0;
        continue;
      }
      this.coef[k] = cnt[k] / count;
      const m0 = sums[k * 3] / cnt[k], m1 = sums[k * 3 + 1] / cnt[k], m2 = sums[k * 3 + 2] / cnt[k];
      this.mean[k * 3] = m0;
      this.mean[k * 3 + 1] = m1;
      this.mean[k * 3 + 2] = m2;
      const q = k * 9;
      const reg = 3; // keeps flat colour areas from collapsing to a spike
      const c00 = prods[q] / cnt[k] - m0 * m0 + reg;
      const c01 = prods[q + 1] / cnt[k] - m0 * m1;
      const c02 = prods[q + 2] / cnt[k] - m0 * m2;
      const c11 = prods[q + 4] / cnt[k] - m1 * m1 + reg;
      const c12 = prods[q + 5] / cnt[k] - m1 * m2;
      const c22 = prods[q + 8] / cnt[k] - m2 * m2 + reg;
      const det = c00 * (c11 * c22 - c12 * c12) - c01 * (c01 * c22 - c12 * c02) + c02 * (c01 * c12 - c11 * c02);
      const dd = det > 1e-6 ? det : 1e-6;
      const iv = this.inv;
      iv[q] = (c11 * c22 - c12 * c12) / dd;
      iv[q + 1] = iv[q + 3] = -(c01 * c22 - c02 * c12) / dd;
      iv[q + 2] = iv[q + 6] = (c01 * c12 - c02 * c11) / dd;
      iv[q + 4] = (c00 * c22 - c02 * c02) / dd;
      iv[q + 5] = iv[q + 7] = -(c00 * c12 - c01 * c02) / dd;
      iv[q + 8] = (c00 * c11 - c01 * c01) / dd;
      this.norm[k] = 1 / Math.sqrt(dd);
    }
  }

  private comp(k: number, r: number, g: number, b: number) {
    const m = k * 3;
    const d0 = r - this.mean[m], d1 = g - this.mean[m + 1], d2 = b - this.mean[m + 2];
    const q = k * 9;
    const iv = this.inv;
    const md =
      d0 * (d0 * iv[q] + d1 * iv[q + 3] + d2 * iv[q + 6]) +
      d1 * (d0 * iv[q + 1] + d1 * iv[q + 4] + d2 * iv[q + 7]) +
      d2 * (d0 * iv[q + 2] + d1 * iv[q + 5] + d2 * iv[q + 8]);
    return this.norm[k] * Math.exp(-0.5 * md);
  }

  prob(r: number, g: number, b: number) {
    let p = 0;
    for (let k = 0; k < K; k++) if (this.coef[k] > 0) p += this.coef[k] * this.comp(k, r, g, b);
    return p;
  }

  which(r: number, g: number, b: number) {
    let best = 0, bp = -1;
    for (let k = 0; k < K; k++) {
      if (this.coef[k] <= 0) continue;
      const p = this.comp(k, r, g, b);
      if (p > bp) {
        bp = p;
        best = k;
      }
    }
    return best;
  }
}

/** k-means++ component assignment for the first fit (deterministic seed). */
export function kmeansAssign(rgb: Float32Array, idx: Int32Array, count: number, out: Uint8Array) {
  const rand = rng(7);
  const stride = Math.max(1, Math.floor(count / 6000));
  const sample: number[] = [];
  for (let s = 0; s < count; s += stride) sample.push(idx[s]);
  const centers: number[][] = [];
  const first = sample[Math.floor(rand() * sample.length)];
  centers.push([rgb[first * 3], rgb[first * 3 + 1], rgb[first * 3 + 2]]);
  const d2 = new Float64Array(sample.length);
  while (centers.length < K) {
    let total = 0;
    for (let s = 0; s < sample.length; s++) {
      const p = sample[s] * 3;
      let best = Infinity;
      for (const c of centers) {
        const v = (rgb[p] - c[0]) ** 2 + (rgb[p + 1] - c[1]) ** 2 + (rgb[p + 2] - c[2]) ** 2;
        if (v < best) best = v;
      }
      d2[s] = best;
      total += best;
    }
    if (total <= 0) break;
    let t = rand() * total;
    let pick = sample.length - 1;
    for (let s = 0; s < sample.length; s++) {
      t -= d2[s];
      if (t <= 0) {
        pick = s;
        break;
      }
    }
    const p = sample[pick] * 3;
    centers.push([rgb[p], rgb[p + 1], rgb[p + 2]]);
  }
  const nearest = (p: number) => {
    let best = 0, bd = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const v = (rgb[p] - centers[c][0]) ** 2 + (rgb[p + 1] - centers[c][1]) ** 2 + (rgb[p + 2] - centers[c][2]) ** 2;
      if (v < bd) {
        bd = v;
        best = c;
      }
    }
    return best;
  };
  for (let it = 0; it < 8; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const i of sample) {
      const c = nearest(i * 3);
      acc[c][0] += rgb[i * 3];
      acc[c][1] += rgb[i * 3 + 1];
      acc[c][2] += rgb[i * 3 + 2];
      acc[c][3]++;
    }
    for (let c = 0; c < centers.length; c++) if (acc[c][3]) centers[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
  }
  for (let s = 0; s < count; s++) out[s] = nearest(idx[s] * 3);
}

export function toRGBf(img: RGBA): Float32Array {
  const n = img.w * img.h;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = img.data[i * 4];
    out[i * 3 + 1] = img.data[i * 4 + 1];
    out[i * 3 + 2] = img.data[i * 4 + 2];
  }
  return out;
}

// ================================================================ GrabCut

export interface CutOptions {
  iterations?: number;
  /** Edge smoothness weight (higher = cut prefers strong colour edges). */
  gamma?: number;
  /** Optional per-pixel foreground probability (0..1) mixed into the data term. */
  prior?: Float32Array;
  priorWeight?: number;
  /** First colour fit uses only the sure labels (good when probable labels are a rough guess). */
  fitSureFirst?: boolean;
}

/**
 * Iterated graph cut on a trimap (BG / FG / PR_BG / PR_FG). Mutates `trimap` (probable labels follow the
 * cut) and returns 1 for foreground pixels.
 */
export function grabCut(img: RGBA, trimap: Uint8Array, opts: CutOptions = {}): Uint8Array {
  const { w, h } = img;
  const n = w * h;
  const rgb = toRGBf(img);
  const gamma = opts.gamma ?? 50;
  const iterations = opts.iterations ?? 4;
  const SCALE = 10;
  const result = new Uint8Array(n);

  // Contrast-adaptive edge weights
  let sum = 0, cnt = 0;
  const diff2 = (i: number, j: number) => {
    const a = i * 3, b = j * 3;
    return (rgb[a] - rgb[b]) ** 2 + (rgb[a + 1] - rgb[b + 1]) ** 2 + (rgb[a + 2] - rgb[b + 2]) ** 2;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) {
        sum += diff2(i, i + 1);
        cnt++;
      }
      if (y < h - 1) {
        sum += diff2(i, i + w);
        cnt++;
        if (x < w - 1) {
          sum += diff2(i, i + w + 1);
          cnt++;
        }
        if (x > 0) {
          sum += diff2(i, i + w - 1);
          cnt++;
        }
      }
    }
  const beta = sum > 0 ? cnt / (2 * sum) : 0;
  const diag = gamma / Math.SQRT2;
  const wR = new Int32Array(n), wD = new Int32Array(n), wDR = new Int32Array(n), wDL = new Int32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) wR[i] = Math.round(gamma * Math.exp(-beta * diff2(i, i + 1)) * SCALE);
      if (y < h - 1) {
        wD[i] = Math.round(gamma * Math.exp(-beta * diff2(i, i + w)) * SCALE);
        if (x < w - 1) wDR[i] = Math.round(diag * Math.exp(-beta * diff2(i, i + w + 1)) * SCALE);
        if (x > 0) wDL[i] = Math.round(diag * Math.exp(-beta * diff2(i, i + w - 1)) * SCALE);
      }
    }
  const hard = Math.round(9 * gamma * SCALE) + 1;

  const fgM = new GMM();
  const bgM = new GMM();
  const fgIdx = new Int32Array(n), bgIdx = new Int32Array(n);
  const fgComp = new Uint8Array(n), bgComp = new Uint8Array(n);
  const prior = opts.prior;
  const pw = opts.priorWeight ?? 0;

  for (let it = 0; it < iterations; it++) {
    let nf = 0, nb = 0;
    const sureOnly = it === 0 && opts.fitSureFirst;
    for (let i = 0; i < n; i++) {
      const t = trimap[i];
      if (t === FG || (!sureOnly && t === PR_FG)) fgIdx[nf++] = i;
      else if (t === BG || (!sureOnly && t === PR_BG)) bgIdx[nb++] = i;
    }
    if (!nf || !nb) {
      // Nothing to separate: everything not sure-background is foreground
      for (let i = 0; i < n; i++) result[i] = nf && trimap[i] !== BG ? 1 : 0;
      return result;
    }
    if (it === 0) {
      kmeansAssign(rgb, fgIdx, nf, fgComp);
      kmeansAssign(rgb, bgIdx, nb, bgComp);
    } else {
      for (let s = 0; s < nf; s++) {
        const p = fgIdx[s] * 3;
        fgComp[s] = fgM.which(rgb[p], rgb[p + 1], rgb[p + 2]);
      }
      for (let s = 0; s < nb; s++) {
        const p = bgIdx[s] * 3;
        bgComp[s] = bgM.which(rgb[p], rgb[p + 1], rgb[p + 2]);
      }
    }
    fgM.learn(rgb, fgIdx, fgComp, nf);
    bgM.learn(rgb, bgIdx, bgComp, nb);

    const g = new MaxFlow(n, n * 4);
    for (let i = 0; i < n; i++) {
      const t = trimap[i];
      if (t === FG) g.addTWeights(i, hard, 0);
      else if (t === BG) g.addTWeights(i, 0, hard);
      else {
        const p = i * 3;
        let costBg = -Math.log(Math.max(1e-30, bgM.prob(rgb[p], rgb[p + 1], rgb[p + 2])));
        let costFg = -Math.log(Math.max(1e-30, fgM.prob(rgb[p], rgb[p + 1], rgb[p + 2])));
        if (prior && pw) {
          const q = Math.min(0.98, Math.max(0.02, prior[i]));
          costFg += pw * -Math.log(q);
          costBg += pw * -Math.log(1 - q);
        }
        // Source capacity = cost of the background label
        const a = Math.round(costBg * SCALE);
        const b = Math.round(costFg * SCALE);
        const m = Math.min(a, b);
        g.addTWeights(i, a - m, b - m);
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (wR[i]) g.addEdge(i, i + 1, wR[i], wR[i]);
        if (wD[i]) g.addEdge(i, i + w, wD[i], wD[i]);
        if (wDR[i]) g.addEdge(i, i + w + 1, wDR[i], wDR[i]);
        if (wDL[i]) g.addEdge(i, i + w - 1, wDL[i], wDL[i]);
      }
    g.solve();
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const fg = g.isSource(i) ? 1 : 0;
      if (fg !== result[i]) changed++;
      result[i] = fg;
      const t = trimap[i];
      if (t === PR_BG || t === PR_FG) trimap[i] = fg ? PR_FG : PR_BG;
    }
    if (it > 0 && changed < n * 0.001) break;
  }
  return result;
}

// ================================================================ mask clean-up

/** 8-connected components of a binary mask: labels (0 = none) and pixel counts per label. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = sizes.length;
    let size = 0;
    labels[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !labels[j]) {
            labels[j] = id;
            stack.push(j);
          }
        }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Drops specks: keeps components at least `minFrac` of the largest one (or those `keep` accepts). */
export function keepMain(mask: Uint8Array, w: number, h: number, minFrac: number, keep?: (label: number, labels: Int32Array) => boolean) {
  const { labels, sizes } = components(mask, w, h);
  const largest = Math.max(0, ...sizes.slice(1));
  const ok = sizes.map((s, id) => id > 0 && (keep ? keep(id, labels) : s >= largest * minFrac));
  for (let i = 0; i < mask.length; i++) mask[i] = labels[i] && ok[labels[i]] ? 1 : 0;
  return mask;
}

/** Fills holes smaller than `maxArea` pixels (background islands not touching the border). */
export function fillHoles(mask: Uint8Array, w: number, h: number, maxArea: number) {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { labels, sizes } = components(inv, w, h);
  const touches = new Uint8Array(sizes.length);
  for (let x = 0; x < w; x++) {
    touches[labels[x]] = 1;
    touches[labels[(h - 1) * w + x]] = 1;
  }
  for (let y = 0; y < h; y++) {
    touches[labels[y * w]] = 1;
    touches[labels[y * w + w - 1]] = 1;
  }
  for (let i = 0; i < mask.length; i++) {
    const l = labels[i];
    if (l && !touches[l] && sizes[l] <= maxArea) mask[i] = 1;
  }
  return mask;
}

function toFloat(mask: Uint8Array) {
  const f = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) f[i] = mask[i];
  return f;
}

/** Result of a smart selection: alpha (0..1) covering `roi` of the full image. */
export interface RegionMask {
  roi: Box;
  alpha: Float32Array;
}

function fullBox(img: RGBA): Box {
  return { x: 0, y: 0, w: img.w, h: img.h };
}

/** Snaps a proxy mask back onto the full-resolution region. */
function finish(img: RGBA, roi: Box, small: Uint8Array, sw: number, sh: number): RegionMask {
  const region = roi.x === 0 && roi.y === 0 && roi.w === img.w && roi.h === img.h ? img : crop(img, roi);
  return { roi, alpha: guidedUpsample(region, toFloat(small), sw, sh) };
}

const WORK = 400;

// ================================================================ pipelines

/** Fraction of clearly transparent pixels; a cut-out layer is selected by its own alpha. */
function transparentShare(img: RGBA) {
  let t = 0;
  const n = img.w * img.h;
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3] < 16) t++;
  return t / n;
}

/** Select Subject: finds the main subject(s) of the picture. */
export function selectSubject(img: RGBA): RegionMask {
  const roi = fullBox(img);
  if (transparentShare(img) > 0.05) {
    const a = new Float32Array(img.w * img.h);
    for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3] / 255;
    return { roi, alpha: a };
  }
  const { img: s } = downsample(img, roi, WORK);
  const sal = saliency(s);
  const t = Math.min(0.75, Math.max(0.2, otsu(sal)));
  const n = s.w * s.h;
  const tri = new Uint8Array(n);
  const prior = new Float32Array(n);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      const v = sal[i];
      prior[i] = Math.min(0.95, Math.max(0.05, 0.5 + (v - t) * 1.6));
      const border = x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1;
      tri[i] = border && v < t ? BG : v >= t ? PR_FG : PR_BG;
    }
  const cut = grabCut(s, tri, { iterations: 5, prior, priorWeight: 2.5 });
  keepMain(cut, s.w, s.h, 0.08);
  fillHoles(cut, s.w, s.h, n * 0.004);
  return finish(img, roi, cut, s.w, s.h);
}

/** Object Selection inside a box: the object the box was drawn around. */
export function selectObjectInBox(img: RGBA, box: Box): RegionMask {
  const bx = clampBox(box, img);
  const padX = Math.max(8, Math.round(bx.w * 0.1));
  const padY = Math.max(8, Math.round(bx.h * 0.1));
  const roi = clampBox({ x: bx.x - padX, y: bx.y - padY, w: bx.w + padX * 2, h: bx.h + padY * 2 }, img);
  const { img: s, f } = downsample(img, roi, WORK);
  const n = s.w * s.h;
  const tri = new Uint8Array(n);
  const ix0 = (bx.x - roi.x) / f, iy0 = (bx.y - roi.y) / f;
  const ix1 = (bx.x + bx.w - roi.x) / f, iy1 = (bx.y + bx.h - roi.y) / f;
  const sal = saliency(s);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const inside = x + 0.5 >= ix0 && x + 0.5 <= ix1 && y + 0.5 >= iy0 && y + 0.5 <= iy1;
      tri[y * s.w + x] = inside ? PR_FG : BG;
    }
  const cut = grabCut(s, tri, { iterations: 5, prior: sal, priorWeight: 1 });
  keepMain(cut, s.w, s.h, 0.1);
  fillHoles(cut, s.w, s.h, n * 0.004);
  return finish(img, roi, cut, s.w, s.h);
}

/** Click-to-select: the object under the point. */
export function selectObjectAt(img: RGBA, px: number, py: number): RegionMask {
  const roi = fullBox(img);
  const { img: s, f } = downsample(img, roi, WORK);
  const n = s.w * s.h;
  const sx = px / f, sy = py / f;
  const sal = saliency(s);
  const sigma = Math.min(s.w, s.h) * 0.3;
  const seedR = Math.max(2, Math.min(s.w, s.h) * 0.015);
  const tri = new Uint8Array(n);
  const prior = new Float32Array(n);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      const d2 = (x - sx) ** 2 + (y - sy) ** 2;
      const local = Math.exp(-d2 / (2 * sigma * sigma));
      prior[i] = 0.25 * sal[i] + 0.75 * local;
      const border = x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1;
      tri[i] = d2 <= seedR * seedR ? FG : border ? BG : prior[i] > 0.5 ? PR_FG : PR_BG;
    }
  const cut = grabCut(s, tri, { iterations: 5, prior, priorWeight: 1.5 });
  const seed = Math.min(n - 1, Math.max(0, Math.round(sy) * s.w + Math.round(sx)));
  keepMain(cut, s.w, s.h, 0, (id, labels) => labels[seed] === id);
  fillHoles(cut, s.w, s.h, n * 0.004);
  return finish(img, roi, cut, s.w, s.h);
}

/** Per-pixel "looks like sky" score (0..1): bright, blue or neutral-bright, smooth, high in the frame. */
export function skyScore(img: RGBA): Float32Array {
  const { w, h } = img;
  const n = w * h;
  const lab = toLab(img);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lab[i * 3] / 100;
  const detail = localDetail(L, w, h, 2);
  const out = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = L[i];
      const a = lab[i * 3 + 1];
      const b = lab[i * 3 + 2];
      const blue = Math.min(1, Math.max(0, -b / 35));
      const neutral = Math.max(0, 1 - Math.hypot(a, b) / 18) * Math.min(1, Math.max(0, (l - 0.55) / 0.3));
      // Sunset skies: warm, bright, smooth
      const warm = Math.min(1, Math.max(0, (b + a) / 60)) * Math.min(1, Math.max(0, (l - 0.45) / 0.3));
      const colour = Math.max(blue, neutral, warm * 0.8);
      const smooth = Math.max(0, 1 - detail[i] * 14);
      const pos = 1 - y / h;
      out[i] = Math.min(1, 0.4 * colour + 0.25 * smooth + 0.2 * Math.min(1, l * 1.4) + 0.15 * pos) * (smooth > 0.15 ? 1 : 0.4);
    }
  return out;
}

/** Select Sky: null when the top of the picture isn't sky. */
export function selectSky(img: RGBA): RegionMask | null {
  const roi = fullBox(img);
  const { img: s } = downsample(img, roi, WORK);
  const n = s.w * s.h;
  const score = skyScore(s);
  const tri = new Uint8Array(n);
  let seeds = 0;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      const v = score[i];
      if (y <= 1 && v > 0.6) {
        tri[i] = FG;
        seeds++;
      } else if (y >= s.h - 2) tri[i] = BG;
      else tri[i] = v > 0.55 ? PR_FG : PR_BG;
    }
  if (seeds < s.w * 0.15) return null;
  const cut = grabCut(s, tri, { iterations: 4, prior: score, priorWeight: 2 });
  // Sky must connect to the top of the frame
  const topBand = Math.max(1, Math.round(s.h * 0.03));
  keepMain(cut, s.w, s.h, 0, (id, labels) => {
    for (let y = 0; y < topBand; y++) for (let x = 0; x < s.w; x++) if (labels[y * s.w + x] === id) return true;
    return false;
  });
  fillHoles(cut, s.w, s.h, n * 0.002);
  let area = 0;
  for (let i = 0; i < n; i++) area += cut[i];
  if (area < n * 0.03) return null;
  const region = img;
  return { roi, alpha: guidedUpsample(region, toFloat(cut), s.w, s.h, false) };
}

export interface Dab {
  x: number;
  y: number;
  r: number;
}

export function clampBox(b: Box, img: { w: number; h: number }): Box {
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(img.w, Math.ceil(b.x + b.w));
  const y1 = Math.min(img.h, Math.ceil(b.y + b.h));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Edge-snapping Quick Selection: the painted stroke tells the cut "this is the object" (or, subtracting,
 * "this is not"); the selection grows to the object's real edges around the stroke.
 * `current` is the current selection alpha (0..255, full size) or null.
 */
export function strokeCut(img: RGBA, current: Uint8Array | null, dabs: Dab[], mode: 'add' | 'sub'): RegionMask | null {
  if (!dabs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rMax = 1;
  for (const d of dabs) {
    x0 = Math.min(x0, d.x - d.r);
    y0 = Math.min(y0, d.y - d.r);
    x1 = Math.max(x1, d.x + d.r);
    y1 = Math.max(y1, d.y + d.r);
    rMax = Math.max(rMax, d.r);
  }
  // Start with generous context around the stroke; grow it while the object runs off the edge of the region
  let pad = Math.max(rMax * 3, 24, Math.max(x1 - x0, y1 - y0) * 0.6, Math.min(img.w, img.h) * 0.2);
  let res: { region: RegionMask; open: boolean } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const roi = clampBox({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }, img);
    res = strokeCutIn(img, roi, current, dabs, mode);
    if (!res || !res.open || (roi.w === img.w && roi.h === img.h)) break;
    pad *= 2;
  }
  return res?.region ?? null;
}

function strokeCutIn(img: RGBA, roi: Box, current: Uint8Array | null, dabs: Dab[], mode: 'add' | 'sub'): { region: RegionMask; open: boolean } | null {
  const { img: s, f } = downsample(img, roi, 300);
  const n = s.w * s.h;
  const stroke = new Uint8Array(n);
  for (const d of dabs) {
    const cx = (d.x - roi.x) / f, cy = (d.y - roi.y) / f, r = Math.max(0.8, d.r / f);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(s.h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(s.w - 1, Math.ceil(cx + r)); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) stroke[y * s.w + x] = 1;
  }
  // Current selection on the proxy grid
  const cur = new Uint8Array(n);
  if (current) {
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const fx = Math.min(img.w - 1, roi.x + Math.floor((x + 0.5) * f));
        const fy = Math.min(img.h - 1, roi.y + Math.floor((y + 0.5) * f));
        cur[y * s.w + x] = current[fy * img.w + fx] >= 128 ? 1 : 0;
      }
  }
  const tri = new Uint8Array(n);

  if (mode === 'add') {
    // How big a colour jump separates each pixel from the stroke? Shading and texture are small steps,
    // an object's edge is one big one. Pixels reachable through small steps are probably the object.
    const barrier = barrierFrom(s, stroke);
    const T = barrierSplit(barrier, strokeTolerance(s, stroke));
    const region = new Uint8Array(n);
    for (let i = 0; i < n; i++) region[i] = stroke[i] || cur[i] || barrier[i] <= T ? 1 : 0;
    keepMain(region, s.w, s.h, 0, (id, labels) => {
      for (let i = 0; i < n; i++) if (stroke[i] && labels[i] === id) return true;
      return false;
    });
    // Final edge placement: a graph cut only in a thin band around the region's outline, with colour
    // models learned from the clean inside and outside
    const sdf = signedDistance(toFloat(region), s.w, s.h);
    const bandW = Math.max(3, Math.round(Math.min(s.w, s.h) / 60));
    for (let i = 0; i < n; i++) {
      if (stroke[i] || cur[i]) tri[i] = FG;
      else if (sdf[i] > bandW) tri[i] = FG;
      else if (sdf[i] < -bandW) tri[i] = BG;
      else tri[i] = sdf[i] >= 0 ? PR_FG : PR_BG;
    }
    const cut = grabCut(s, tri, { iterations: 2 });
    keepMain(cut, s.w, s.h, 0, (id, labels) => {
      for (let i = 0; i < n; i++) if (stroke[i] && labels[i] === id) return true;
      return false;
    });
    for (let i = 0; i < n; i++) if (stroke[i]) cut[i] = 1;
    fillHoles(cut, s.w, s.h, n * 0.002);
    // Does the object run off a side of the region that isn't the image edge?
    let open = false;
    for (let x = 0; x < s.w && !open; x++) open = (roi.y > 0 && cut[x] === 1 && !cur[x]) || (roi.y + roi.h < img.h && cut[(s.h - 1) * s.w + x] === 1 && !cur[(s.h - 1) * s.w + x]);
    for (let y = 0; y < s.h && !open; y++) open = (roi.x > 0 && cut[y * s.w] === 1 && !cur[y * s.w]) || (roi.x + roi.w < img.w && cut[y * s.w + s.w - 1] === 1 && !cur[y * s.w + s.w - 1]);
    return { region: finish(img, roi, cut, s.w, s.h), open };
  }

  // Subtract: the stroke is background. Selected pixels that don't look like the stroke stay selected;
  // look-alikes are left to the cut, and only what connects to the stroke is removed.
  const similar = similarTo(s, stroke);
  for (let i = 0; i < n; i++) {
    if (stroke[i] || !cur[i]) tri[i] = BG;
    else tri[i] = similar(i) ? PR_FG : FG;
  }
  const cut = grabCut(s, tri, { iterations: 3, fitSureFirst: true });
  const removed = new Uint8Array(n);
  for (let i = 0; i < n; i++) removed[i] = cur[i] && !cut[i] ? 1 : 0;
  keepMain(removed, s.w, s.h, 0, (id, labels) => {
    for (let i = 0; i < n; i++) if (stroke[i] && labels[i] === id) return true;
    return false;
  });
  for (let i = 0; i < n; i++) cut[i] = cur[i] && !removed[i] && !stroke[i] ? 1 : 0;
  return { region: finish(img, roi, cut, s.w, s.h), open: false };
}

/** Light 3×3 smoothing so sensor noise doesn't count as an edge. */
function smoothRGB(s: RGBA): Float32Array {
  const { w, h } = s;
  const out = new Float32Array(w * h * 3);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) ch[i] = s.data[i * 4 + c];
    const m = boxMean(ch, w, h, 1);
    for (let i = 0; i < w * h; i++) out[i * 3 + c] = m[i];
  }
  return out;
}

/** Edge strength per pixel: colour gradient (central differences on the lightly smoothed image). */
export function edgeStrength(s: RGBA): Float32Array {
  const { w, h } = s;
  const rgb = smoothRGB(s);
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = y * w + Math.max(0, x - 1), r = y * w + Math.min(w - 1, x + 1);
      const u = Math.max(0, y - 1) * w + x, d = Math.min(h - 1, y + 1) * w + x;
      let sum = 0;
      for (let c = 0; c < 3; c++) {
        const gx = rgb[r * 3 + c] - rgb[l * 3 + c];
        const gy = rgb[d * 3 + c] - rgb[u * 3 + c];
        sum += gx * gx + gy * gy;
      }
      g[y * w + x] = Math.sqrt(sum) / 2;
    }
  return g;
}

/**
 * Minimum-barrier distance from the stroke: for each pixel, the smallest possible "strongest edge"
 * crossed along any path from the stroke (bottleneck Dijkstra, 4-connected). Using edge strength per
 * pixel (not the step between neighbours) means an anti-aliased edge can't be walked along in small steps.
 */
export function barrierFrom(s: RGBA, seeds: Uint8Array): Float32Array {
  const { w, h } = s;
  const n = w * h;
  const edge = edgeStrength(s);
  const dist = new Float32Array(n).fill(Infinity);
  // Binary heap of (dist, index)
  const heapI = new Int32Array(n * 4 + 8);
  const heapD = new Float32Array(n * 4 + 8);
  let size = 0;
  const push = (i: number, d: number) => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= d) break;
      heapI[k] = heapI[p];
      heapD[k] = heapD[p];
      k = p;
    }
    heapI[k] = i;
    heapD[k] = d;
  };
  const pop = () => {
    const top = heapI[0];
    const li = heapI[--size];
    const ld = heapD[size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && heapD[c + 1] < heapD[c]) c++;
      if (heapD[c] >= ld) break;
      heapI[k] = heapI[c];
      heapD[k] = heapD[c];
      k = c;
    }
    heapI[k] = li;
    heapD[k] = ld;
    return top;
  };
  for (let i = 0; i < n; i++)
    if (seeds[i]) {
      dist[i] = 0;
      push(i, 0);
    }
  const done = new Uint8Array(n);
  while (size > 0) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    const x = i % w;
    const d = dist[i];
    const relax = (j: number) => {
      if (done[j]) return;
      const nd = Math.max(d, edge[j]);
      if (nd < dist[j]) {
        dist[j] = nd;
        if (size < heapI.length) push(j, nd);
      }
    };
    if (x > 0) relax(i - 1);
    if (x < w - 1) relax(i + 1);
    if (i >= w) relax(i - w);
    if (i + w < n) relax(i + w);
  }
  return dist;
}

/**
 * Where "same object" ends. As the barrier threshold rises the reachable area grows slowly while it
 * fills the object, then jumps when it leaks past an edge. Pick the most stable threshold (smallest
 * relative growth), never tighter than the stroke's own texture.
 */
export function barrierSplit(barrier: Float32Array, floor: number): number {
  const sorted = Float32Array.from(barrier).sort();
  const n = sorted.length;
  const area = (t: number) => {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let best = floor, bestScore = Infinity;
  for (let t = floor; t <= 120; t *= 1.08) {
    const a = area(t);
    if (!a) continue;
    const grow = (area(t * 1.3) - area(t / 1.3)) / a;
    // Slight preference for lower thresholds among equally stable ones
    const score = grow + t / 2000;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** How rough the stroked area is: steps up to this size still count as "the same object". */
export function strokeTolerance(s: RGBA, stroke: Uint8Array): number {
  const edge = edgeStrength(s);
  const vals: number[] = [];
  for (let i = 0; i < stroke.length; i++) if (stroke[i]) vals.push(edge[i]);
  if (!vals.length) return 20;
  vals.sort((a, b) => a - b);
  const p90 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
  return Math.min(60, Math.max(12, p90 * 2));
}

/** "Looks like the stroke": within a colour distance of one of the stroke's colour clusters. */
function similarTo(s: RGBA, stroke: Uint8Array) {
  const centers = strokeCenters(s, stroke);
  const d = s.data;
  return (i: number) => {
    let best = Infinity;
    for (const c of centers) best = Math.min(best, (d[i * 4] - c[0]) ** 2 + (d[i * 4 + 1] - c[1]) ** 2 + (d[i * 4 + 2] - c[2]) ** 2);
    return best < 30 * 30;
  };
}

function strokeCenters(s: RGBA, stroke: Uint8Array): number[][] {
  // Small fixed palette of the stroke's colours (up to 6 bins by luminance)
  const bins: number[][] = [];
  const d = s.data;
  for (let i = 0; i < stroke.length; i++) {
    if (!stroke[i]) continue;
    const c = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    let hit = false;
    for (const b of bins) {
      if ((b[0] / b[3] - c[0]) ** 2 + (b[1] / b[3] - c[1]) ** 2 + (b[2] / b[3] - c[2]) ** 2 < 20 * 20) {
        b[0] += c[0];
        b[1] += c[1];
        b[2] += c[2];
        b[3]++;
        hit = true;
        break;
      }
    }
    if (!hit && bins.length < 12) bins.push([c[0], c[1], c[2], 1]);
  }
  return bins.map((b) => [b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
}

/** Colour-range presets that Photoshop hides behind a dropdown: skin, highlights, midtones, shadows. */
export function rangeMask(img: RGBA, kind: 'skin' | 'highlights' | 'midtones' | 'shadows', fuzz = 0.5): Float32Array {
  const n = img.w * img.h;
  const out = new Float32Array(n);
  const d = img.data;
  const soft = 0.05 + fuzz * 0.25;
  if (kind === 'skin') {
    const lab = toLab(img);
    for (let i = 0; i < n; i++) {
      const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
      // Skin sits in a narrow hue wedge (≈ 20–70°) with moderate chroma, across all skin tones
      const hue = (Math.atan2(b, a) * 180) / Math.PI;
      const chroma = Math.hypot(a, b);
      const hueFit = 1 - Math.min(1, Math.abs(hue - 45) / (25 + fuzz * 25));
      const chromaFit = chroma < 6 ? 0 : chroma > 60 ? 0 : 1;
      const lightFit = L < 15 || L > 95 ? 0 : 1;
      out[i] = Math.max(0, hueFit) * chromaFit * lightFit * (d[i * 4 + 3] / 255);
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    let v: number;
    if (kind === 'highlights') v = (l - (0.75 - soft)) / soft;
    else if (kind === 'shadows') v = (0.25 + soft - l) / soft;
    else v = 1 - Math.abs(l - 0.5) / (0.15 + soft);
    out[i] = Math.min(1, Math.max(0, v)) * (d[i * 4 + 3] / 255);
  }
  return out;
}

export { resizeMask };
