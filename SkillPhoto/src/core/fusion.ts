/**
 * Stack fusion: Merge to HDR (exposure fusion) and Focus Stacking, from several shots of one scene.
 *
 * - Alignment: Ward's median threshold bitmaps (MTB). Each shot is cut at its own median brightness, so
 *   differently exposed shots give the same bitmap; a coarse-to-fine search finds the shift. Handheld
 *   brackets line up without any exposure matching.
 * - Blending: Mertens–Kautz–Van Reeth. Each shot gets a weight per pixel (exposure: contrast ×
 *   saturation × well-exposedness; focus: local sharpness), and the shots are mixed band by band in a
 *   Laplacian pyramid with Gaussian-smoothed weights, so there are no seams or halos.
 *
 * Works on straight RGBA bytes; pure, so it runs in a worker (fusion.worker.ts).
 */

export type FusionMode = 'exposure' | 'focus';

export interface FusionInput {
  images: Uint8ClampedArray[];
  w: number;
  h: number;
  mode: FusionMode;
  align: boolean;
  /** Focus: how strongly the sharpest shot wins (1 = soft mix … 8 = nearly winner-takes-all). */
  sharpness?: number;
}

export interface FusionResult {
  data: Uint8ClampedArray;
  /** Shift applied to each shot (the reference shot is 0, 0). */
  shifts: [number, number][];
}

// ---------------------------------------------------------------- alignment (MTB)

const gray8 = (d: Uint8ClampedArray, n: number) => {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (54 * d[j] + 183 * d[j + 1] + 19 * d[j + 2]) >> 8;
  return g;
};

function halve(g: Uint8Array, w: number, h: number): { g: Uint8Array; w: number; h: number } {
  const w2 = w >> 1;
  const h2 = h >> 1;
  const o = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    const r0 = 2 * y * w;
    const r1 = r0 + w;
    for (let x = 0; x < w2; x++) o[y * w2 + x] = (g[r0 + 2 * x] + g[r0 + 2 * x + 1] + g[r1 + 2 * x] + g[r1 + 2 * x + 1] + 2) >> 2;
  }
  return { g: o, w: w2, h: h2 };
}

function median(g: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc * 2 >= g.length) return v;
  }
  return 128;
}

/** Threshold bitmap (above the median) and exclusion bitmap (clearly away from the median). */
function bitmaps(g: Uint8Array): { tb: Uint8Array; eb: Uint8Array } {
  const m = median(g);
  const tb = new Uint8Array(g.length);
  const eb = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) {
    tb[i] = g[i] > m ? 1 : 0;
    eb[i] = Math.abs(g[i] - m) > 4 ? 1 : 0;
  }
  return { tb, eb };
}

function mismatch(a: { tb: Uint8Array; eb: Uint8Array }, b: { tb: Uint8Array; eb: Uint8Array }, w: number, h: number, dx: number, dy: number): number {
  let err = 0;
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(w, w - dx);
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(h, h - dy);
  for (let y = y0; y < y1; y++) {
    const ra = y * w;
    const rb = (y + dy) * w + dx;
    for (let x = x0; x < x1; x++) err += (a.tb[ra + x] ^ b.tb[rb + x]) & a.eb[ra + x] & b.eb[rb + x];
  }
  // Normalise by overlap so large shifts are not favoured for having fewer pixels to compare
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  return err / area;
}

/**
 * The shift (dx, dy) such that `img(x + dx, y + dy)` lines up with `ref(x, y)`.
 * Up to about ±(2^levels + 2^(levels−1)) px; the finest level is the full image.
 */
export function mtbShift(ref: Uint8Array, img: Uint8Array, w: number, h: number, maxShift = 64): [number, number] {
  const pyrA = [{ g: ref, w, h }];
  const pyrB = [{ g: img, w, h }];
  while ((1 << pyrA.length) <= maxShift && pyrA[pyrA.length - 1].w >= 64 && pyrA[pyrA.length - 1].h >= 64) {
    const a = pyrA[pyrA.length - 1];
    pyrA.push(halve(a.g, a.w, a.h));
    const b = pyrB[pyrB.length - 1];
    pyrB.push(halve(b.g, b.w, b.h));
  }
  let sx = 0;
  let sy = 0;
  for (let l = pyrA.length - 1; l >= 0; l--) {
    sx *= 2;
    sy *= 2;
    const A = bitmaps(pyrA[l].g);
    const B = bitmaps(pyrB[l].g);
    const { w: lw, h: lh } = pyrA[l];
    let best = Infinity;
    let bx = sx;
    let by = sy;
    // Wider search at the coarsest level (cheap there), ±1 on every finer one
    const R = l === pyrA.length - 1 ? 3 : 1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const e = mismatch(A, B, lw, lh, sx + dx, sy + dy);
        if (e < best - 1e-12) {
          best = e;
          bx = sx + dx;
          by = sy + dy;
        }
      }
    }
    sx = bx;
    sy = by;
  }
  return [sx, sy];
}

// ---------------------------------------------------------------- pyramids

interface Plane {
  d: Float32Array;
  w: number;
  h: number;
}

const K = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];

/** 5-tap Gaussian blur, then keep every second pixel. */
function reduce(p: Plane): Plane {
  const { d, w, h } = p;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = x + k < 0 ? -(x + k) : x + k >= w ? 2 * w - 2 - (x + k) : x + k;
        s += K[k + 2] * d[r + Math.max(0, Math.min(w - 1, xx))];
      }
      tmp[r + x] = s;
    }
  }
  const w2 = Math.max(1, (w + 1) >> 1);
  const h2 = Math.max(1, (h + 1) >> 1);
  const o = new Float32Array(w2 * h2);
  for (let y2 = 0; y2 < h2; y2++) {
    const y = y2 * 2;
    for (let x2 = 0; x2 < w2; x2++) {
      const x = x2 * 2;
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        const yy = y + k < 0 ? -(y + k) : y + k >= h ? 2 * h - 2 - (y + k) : y + k;
        s += K[k + 2] * tmp[Math.max(0, Math.min(h - 1, yy)) * w + x];
      }
      o[y2 * w2 + x2] = s;
    }
  }
  return { d: o, w: w2, h: h2 };
}

/** Bilinear upsample of a half-size plane to w × h (sample centres of the reduce grid). */
function expand(p: Plane, w: number, h: number): Float32Array {
  const o = new Float32Array(w * h);
  const { d, w: pw, h: ph } = p;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(ph - 1, y / 2);
    const y0 = Math.floor(fy);
    const y1 = Math.min(ph - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(pw - 1, x / 2);
      const x0 = Math.floor(fx);
      const x1 = Math.min(pw - 1, x0 + 1);
      const tx = fx - x0;
      const a = d[y0 * pw + x0] + (d[y0 * pw + x1] - d[y0 * pw + x0]) * tx;
      const b = d[y1 * pw + x0] + (d[y1 * pw + x1] - d[y1 * pw + x0]) * tx;
      o[y * w + x] = a + (b - a) * ty;
    }
  }
  return o;
}

function gaussianPyramid(p: Plane, levels: number): Plane[] {
  const out = [p];
  for (let l = 1; l < levels; l++) out.push(reduce(out[l - 1]));
  return out;
}

function laplacianPyramid(p: Plane, levels: number): Plane[] {
  const g = gaussianPyramid(p, levels);
  return g.map((gl, l) => {
    if (l === levels - 1) return gl;
    const up = expand(g[l + 1], gl.w, gl.h);
    const d = new Float32Array(gl.d.length);
    for (let i = 0; i < d.length; i++) d[i] = gl.d[i] - up[i];
    return { d, w: gl.w, h: gl.h };
  });
}

// ---------------------------------------------------------------- weights

function laplacianAbs(g: Float32Array, w: number, h: number): Float32Array {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : y;
    const yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      const c = g[y * w + x];
      o[y * w + x] = Math.abs(g[yu * w + x] + g[yd * w + x] + g[y * w + xl] + g[y * w + xr] - 4 * c);
    }
  }
  return o;
}

/** Box blur (radius r) of a plane, in place via two running-sum passes. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) s += src[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / (2 * r + 1);
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Per-pixel weight of one shot (before normalising across shots). `valid` = 0 where the shift left no data. */
function weightMap(rgb: Float32Array[], alpha: Float32Array, w: number, h: number, mode: FusionMode, sharpness: number): Float32Array {
  const n = w * h;
  const [R, G, B] = rgb;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
  const contrast = laplacianAbs(gray, w, h);
  const W = new Float32Array(n);
  if (mode === 'exposure') {
    for (let i = 0; i < n; i++) {
      const r = R[i], g = G[i], b = B[i];
      const mu = (r + g + b) / 3;
      const sat = Math.sqrt(((r - mu) ** 2 + (g - mu) ** 2 + (b - mu) ** 2) / 3);
      const well = Math.exp(-((r - 0.5) ** 2) / 0.08) * Math.exp(-((g - 0.5) ** 2) / 0.08) * Math.exp(-((b - 0.5) ** 2) / 0.08);
      W[i] = ((contrast[i] + 1e-3) * (sat + 1e-3) * (well + 1e-6)) * alpha[i] + 1e-12;
    }
  } else {
    // Local sharpness, spread over a small neighbourhood so the choice does not flicker pixel to pixel
    const r = Math.max(2, Math.round(Math.min(w, h) / 300));
    const sharp = boxBlur(contrast, w, h, r);
    let max = 1e-9;
    for (let i = 0; i < n; i++) max = Math.max(max, sharp[i]);
    for (let i = 0; i < n; i++) W[i] = Math.pow(sharp[i] / max + 1e-4, sharpness) * alpha[i] + 1e-20;
  }
  return W;
}

// ---------------------------------------------------------------- fusion

/** Copy of a shot moved so it lines up with the reference; uncovered pixels get alpha 0. */
function shifted(d: Uint8ClampedArray, w: number, h: number, dx: number, dy: number): { rgb: Float32Array[]; alpha: Float32Array } {
  const n = w * h;
  const rgb = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const alpha = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const sy = Math.max(0, Math.min(h - 1, y + dy));
    const inY = y + dy >= 0 && y + dy < h;
    for (let x = 0; x < w; x++) {
      const sx = Math.max(0, Math.min(w - 1, x + dx));
      const inside = inY && x + dx >= 0 && x + dx < w;
      const j = (sy * w + sx) * 4;
      const i = y * w + x;
      rgb[0][i] = d[j] / 255;
      rgb[1][i] = d[j + 1] / 255;
      rgb[2][i] = d[j + 2] / 255;
      // Edge-clamped colour still counts a little, so a border no shot covers is not black
      alpha[i] = (d[j + 3] / 255) * (inside ? 1 : 1e-6);
    }
  }
  return { rgb, alpha };
}

export function fuse(input: FusionInput, progress?: (f: number) => void): FusionResult {
  const { images, w, h, mode, align } = input;
  const sharpness = input.sharpness ?? 4;
  const n = w * h;
  if (images.length < 2) throw new Error('Fusion needs at least two images');
  const refIdx = Math.floor(images.length / 2);
  const refGray = align ? gray8(images[refIdx], n) : null;
  const levels = Math.max(1, Math.min(10, Math.floor(Math.log2(Math.max(2, Math.min(w, h)) / 4))));

  // Running sums per pyramid level: Σ G(weight)·L(image) per channel, and Σ G(weight)
  let acc: Plane[][] | null = null;
  let wsum: Plane[] | null = null;
  const shifts: [number, number][] = [];
  const alphaOut = new Uint8ClampedArray(n);

  for (let k = 0; k < images.length; k++) {
    const img = images[k];
    const shift: [number, number] = align && k !== refIdx ? mtbShift(refGray!, gray8(img, n), w, h) : [0, 0];
    shifts.push(shift);
    const { rgb, alpha } = shifted(img, w, h, shift[0], shift[1]);
    for (let i = 0; i < n; i++) alphaOut[i] = Math.max(alphaOut[i], Math.round(alpha[i] * 255));
    const gw = gaussianPyramid({ d: weightMap(rgb, alpha, w, h, mode, sharpness), w, h }, levels);
    const lp = rgb.map((c) => laplacianPyramid({ d: c, w, h }, levels));
    if (!acc || !wsum) {
      acc = lp.map((pyr) => pyr.map((p) => ({ d: new Float32Array(p.d.length), w: p.w, h: p.h })));
      wsum = gw.map((p) => ({ d: new Float32Array(p.d.length), w: p.w, h: p.h }));
    }
    for (let l = 0; l < levels; l++) {
      const W = gw[l].d;
      const S = wsum[l].d;
      for (let i = 0; i < W.length; i++) S[i] += W[i];
      for (let c = 0; c < 3; c++) {
        const L = lp[c][l].d;
        const A = acc[c][l].d;
        for (let i = 0; i < W.length; i++) A[i] += W[i] * L[i];
      }
    }
    progress?.((k + 1) / (images.length + 1));
  }

  // Normalise each band, then collapse the pyramid
  const out = new Uint8ClampedArray(n * 4);
  const A = acc as unknown as Plane[][];
  const S = wsum as unknown as Plane[];
  for (let c = 0; c < 3; c++) {
    for (let l = 0; l < levels; l++) {
      const a = A[c][l].d;
      const s = S[l].d;
      for (let i = 0; i < a.length; i++) a[i] /= s[i];
    }
    let cur = A[c][levels - 1];
    for (let l = levels - 2; l >= 0; l--) {
      const up = expand(cur, A[c][l].w, A[c][l].h);
      const band = A[c][l].d;
      for (let i = 0; i < up.length; i++) up[i] += band[i];
      cur = { d: up, w: A[c][l].w, h: A[c][l].h };
    }
    for (let i = 0; i < n; i++) out[i * 4 + c] = Math.round(cur.d[i] * 255);
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = alphaOut[i];
  progress?.(1);
  return { data: out, shifts };
}
