// Mask math for selections: blurs, guided filter, distance fields, colour fill and edge matting.
// Everything works on flat Float32Array masks (0..1) and RGBA byte images, with no DOM, so it is unit tested
// and runs the same at preview and full resolution.

export interface RGBA {
  data: Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
}

/** Mean over a (2r+1)² window, clamped at the borders (divides by the real window area). */
export function boxMean(src: Float32Array, w: number, h: number, r: number, into?: Float32Array): Float32Array {
  const out: Float32Array = into ?? new Float32Array(w * h);
  if (r < 1) {
    out.set(src);
    return out;
  }
  const tmp = new Float32Array(w * h);
  // Horizontal running sums
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) acc += src[row + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r);
      const hi = Math.min(w - 1, x + r);
      tmp[row + x] = acc / (hi - lo + 1);
      const add = x + r + 1;
      const sub = x - r;
      if (add < w) acc += src[row + add];
      if (sub >= 0) acc -= src[row + sub];
    }
  }
  // Vertical running sums, row by row (cache friendly)
  const col = new Float32Array(w);
  for (let y = 0; y <= Math.min(r, h - 1); y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) col[x] += tmp[row + x];
  }
  for (let y = 0; y < h; y++) {
    const inv = 1 / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = col[x] * inv;
    const add = y + r + 1;
    const sub = y - r;
    if (add < h) {
      const ar = add * w;
      for (let x = 0; x < w; x++) col[x] += tmp[ar + x];
    }
    if (sub >= 0) {
      const sr = sub * w;
      for (let x = 0; x < w; x++) col[x] -= tmp[sr + x];
    }
  }
  return out;
}

/** Gaussian blur approximated by three box passes (sigma in pixels). */
export function gaussBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.3) return Float32Array.from(src);
  // Box radius whose triple convolution matches the variance
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  let a = boxMean(src, w, h, r);
  a = boxMean(a, w, h, r);
  return boxMean(a, w, h, r);
}

/** Luminance 0..1 of an RGBA image. */
export function luma(img: RGBA): Float32Array {
  const n = img.w * img.h;
  const out = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) out[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return out;
}

/** He et al. guided filter: smooths `p` while keeping the edges of the guide `I` (both 0..1). */
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mI = boxMean(I, w, h, r);
  const mP = boxMean(p, w, h, r);
  const mIp = boxMean(Ip, w, h, r);
  const mII = boxMean(II, w, h, r);
  const a = Ip; // reuse buffers
  const b = II;
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const cov = mIp[i] - mI[i] * mP[i];
    a[i] = cov / (varI + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = boxMean(a, w, h, r, mI);
  const mB = boxMean(b, w, h, r, mP);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = mA[i] * I[i] + mB[i];
  return q;
}

/** Bilinear resize of a mask. */
export function resizeMask(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = sx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bot = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

/**
 * Signed distance (pixels) to the 0.5 contour of a mask: positive inside, negative outside.
 * Two-pass chamfer (1, √2), accurate to a few percent, O(n).
 */
export function signedDistance(mask: Float32Array, w: number, h: number): Float32Array {
  const n = w * h;
  const BIG = 1e9;
  const dIn = new Float32Array(n); // inside pixels: distance to the nearest outside pixel
  const dOut = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const inside = mask[i] >= 0.5;
    dIn[i] = inside ? BIG : 0;
    dOut[i] = inside ? 0 : BIG;
  }
  chamfer(dIn, w, h);
  chamfer(dOut, w, h);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] >= 0.5 ? dIn[i] - 0.5 : -(dOut[i] - 0.5);
  return out;
}

function chamfer(d: Float32Array, w: number, h: number) {
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
}

/**
 * Push-pull fill: colours where `known` is set spread smoothly into the unknown pixels.
 * Returns RGB floats (0..255) for every pixel.
 */
export function pushPullFill(img: RGBA, known: Uint8Array): Float32Array {
  const levels: { w: number; h: number; c: Float32Array; wt: Float32Array }[] = [];
  let w = img.w;
  let h = img.h;
  const c0 = new Float32Array(w * h * 3);
  const w0 = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!known[i]) continue;
    w0[i] = 1;
    c0[i * 3] = img.data[i * 4];
    c0[i * 3 + 1] = img.data[i * 4 + 1];
    c0[i * 3 + 2] = img.data[i * 4 + 2];
  }
  levels.push({ w, h, c: c0, wt: w0 });
  // Push: average known colours down the pyramid
  while (w > 1 || h > 1) {
    const prev = levels[levels.length - 1];
    const nw = Math.max(1, Math.ceil(w / 2));
    const nh = Math.max(1, Math.ceil(h / 2));
    const c = new Float32Array(nw * nh * 3);
    const wt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let sw = 0, r = 0, g = 0, b = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const px = x * 2 + dx;
            const py = y * 2 + dy;
            if (px >= w || py >= h) continue;
            const k = py * w + px;
            const ww = prev.wt[k];
            if (!ww) continue;
            sw += ww;
            r += prev.c[k * 3] * ww;
            g += prev.c[k * 3 + 1] * ww;
            b += prev.c[k * 3 + 2] * ww;
          }
        const o = y * nw + x;
        if (sw > 0) {
          c[o * 3] = r / sw;
          c[o * 3 + 1] = g / sw;
          c[o * 3 + 2] = b / sw;
          wt[o] = Math.min(1, sw);
        }
      }
    levels.push({ w: nw, h: nh, c, wt });
    w = nw;
    h = nh;
  }
  // Pull: fill each level's gaps from the coarser one (bilinear)
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.h; y++) {
      const cy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(cy);
      const y1 = Math.min(coarse.h - 1, y0 + 1);
      const ty = cy - y0;
      for (let x = 0; x < fine.w; x++) {
        const k = y * fine.w + x;
        const wt = fine.wt[k];
        if (wt >= 1) continue;
        const cx = Math.min(coarse.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(cx);
        const x1 = Math.min(coarse.w - 1, x0 + 1);
        const tx = cx - x0;
        for (let ch = 0; ch < 3; ch++) {
          const v =
            (coarse.c[(y0 * coarse.w + x0) * 3 + ch] * (1 - tx) + coarse.c[(y0 * coarse.w + x1) * 3 + ch] * tx) * (1 - ty) +
            (coarse.c[(y1 * coarse.w + x0) * 3 + ch] * (1 - tx) + coarse.c[(y1 * coarse.w + x1) * 3 + ch] * tx) * ty;
          fine.c[k * 3 + ch] = fine.c[k * 3 + ch] * wt + v * (1 - wt);
        }
        fine.wt[k] = 1;
      }
    }
  }
  return levels[0].c;
}

/** Local detail (std-dev of luminance in a window), used by Smart Radius to widen the edge band in hair and fur. */
export function localDetail(I: Float32Array, w: number, h: number, r: number): Float32Array {
  const sq = new Float32Array(I.length);
  for (let i = 0; i < I.length; i++) sq[i] = I[i] * I[i];
  const m = boxMean(I, w, h, r);
  const m2 = boxMean(sq, w, h, r);
  const out = new Float32Array(I.length);
  for (let i = 0; i < I.length; i++) out[i] = Math.sqrt(Math.max(0, m2[i] - m[i] * m[i]));
  return out;
}

export interface MatteResult {
  alpha: Float32Array;
  /** Estimated pure foreground colour (0..255 RGB) inside `fgBox`, for decontamination; null when no edge was matted. */
  fg: Float32Array | null;
  fgBox?: { x: number; y: number; w: number; h: number };
  /** The band that was matted (1 = unknown), for the "Show Edge" view. */
  band: Uint8Array;
}

/**
 * Edge matting: inside a band around the mask edge (plus any painted refine marks), solves
 * I = αF + (1-α)B with F and B filled in from the sure regions, then cleans α with a guided filter.
 */
export function matteEdges(img: RGBA, mask: Float32Array, radius: number, smart: boolean, marks: Uint8Array | null): MatteResult {
  const { w, h } = img;
  const n = w * h;
  const band = new Uint8Array(n);
  if (radius < 0.5 && !marks) return { alpha: Float32Array.from(mask), fg: null, band };
  const sdf = signedDistance(mask, w, h);
  const I = luma(img);
  let detail: Float32Array | null = null;
  if (smart && radius >= 1) detail = localDetail(I, w, h, Math.max(2, Math.round(radius / 2)));
  let any = false;
  for (let i = 0; i < n; i++) {
    let r = radius;
    // Smart Radius: crisp edges keep a thin band, busy edges (hair, fur, foliage) get the full width
    if (detail) r = radius * Math.min(1, 0.2 + detail[i] * 9);
    if (Math.abs(sdf[i]) <= r || (marks && marks[i])) {
      band[i] = 1;
      any = true;
    }
  }
  if (!any) return { alpha: Float32Array.from(mask), fg: null, band };

  // Work only on the band's bounding box (plus a margin of known pixels to sample from)
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (band[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const m = Math.ceil(radius) + 8;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m);
  y1 = Math.min(h - 1, y1 + m);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const bn = bw * bh;
  const sub = new Uint8ClampedArray(bn * 4);
  const subI = new Float32Array(bn);
  const knownF = new Uint8Array(bn);
  const knownB = new Uint8Array(bn);
  const subA = new Float32Array(bn);
  for (let y = 0; y < bh; y++) {
    const src = (y + y0) * w + x0;
    sub.set(img.data.subarray(src * 4, (src + bw) * 4), y * bw * 4);
    for (let x = 0; x < bw; x++) {
      const i = src + x;
      const k = y * bw + x;
      subI[k] = I[i];
      subA[k] = mask[i];
      if (band[i]) continue;
      if (mask[i] >= 0.5) knownF[k] = 1;
      else knownB[k] = 1;
    }
  }
  const simg = { data: sub, w: bw, h: bh };
  const F = pushPullFill(simg, knownF);
  const B = pushPullFill(simg, knownB);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const k = y * bw + x;
      if (!band[(y + y0) * w + x + x0]) continue;
      const fr = F[k * 3], fg = F[k * 3 + 1], fb = F[k * 3 + 2];
      const br = B[k * 3], bg = B[k * 3 + 1], bb = B[k * 3 + 2];
      const dr = fr - br, dg = fg - bg, db = fb - bb;
      const len2 = dr * dr + dg * dg + db * db;
      const est = ((sub[k * 4] - br) * dr + (sub[k * 4 + 1] - bg) * dg + (sub[k * 4 + 2] - bb) * db) / Math.max(1, len2);
      // Trust the colour estimate only when foreground and background really differ
      const conf = Math.min(1, Math.sqrt(len2) / 70);
      const prior = Math.min(1, Math.max(0, subA[k]));
      subA[k] = Math.min(1, Math.max(0, est)) * conf + prior * (1 - conf);
    }
  // Edge-preserving clean-up of the solved alpha, only inside the band
  const smooth = guidedFilter(subI, subA, bw, bh, 2, 1e-4);
  const alpha = Float32Array.from(mask);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0;
      if (band[i]) alpha[i] = Math.min(1, Math.max(0, smooth[y * bw + x]));
    }
  return { alpha, fg: F, fgBox: { x: x0, y: y0, w: bw, h: bh }, band };
}

export interface RefineParams {
  /** Edge detection radius (px). */
  radius: number;
  smartRadius: boolean;
  /** 0..100: rounds jagged outlines. */
  smooth: number;
  /** Feather radius (px). */
  feather: number;
  /** 0..100 %: hardens soft edges. */
  contrast: number;
  /** Pixels to move the edge out (+) or in (−). */
  shiftEdge: number;
}

export const DEFAULT_REFINE: RefineParams = { radius: 0, smartRadius: true, smooth: 0, feather: 0, contrast: 0, shiftEdge: 0 };

/**
 * The Select and Mask pipeline. `scale` converts the pixel-based params (given at document resolution)
 * to the working resolution, so a preview proxy and the full-size output look the same.
 */
export function refineMask(img: RGBA, base: Float32Array, p: RefineParams, marks: Uint8Array | null, scale = 1): MatteResult {
  const { w, h } = img;
  const n = w * h;
  let m = base;
  // 1. Smooth the outline: blur, then re-harden around the 0.5 contour
  if (p.smooth > 0) {
    const b = gaussBlur(m, w, h, (p.smooth / 100) * 6 * scale + 0.5);
    m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = clamp01((b[i] - 0.5) * 3 + 0.5);
  }
  // 2. Shift the edge with a signed distance field (anti-aliased by one pixel)
  if (p.shiftEdge !== 0) {
    const sdf = signedDistance(m, w, h);
    const s = p.shiftEdge * scale;
    const soft = m;
    m = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const hard = clamp01(sdf[i] + s + 0.5);
      // Keep existing soft edges where the shift is small
      m[i] = Math.abs(s) < 1 ? soft[i] * (1 - Math.abs(s)) + hard * Math.abs(s) : hard;
    }
  }
  // 3. Matte the edge band
  const res = matteEdges(img, m, p.radius * scale, p.smartRadius, marks);
  let a = res.alpha;
  // 4. Contrast
  if (p.contrast > 0) {
    const k = 1 + (p.contrast / 100) * 12;
    for (let i = 0; i < n; i++) a[i] = clamp01((a[i] - 0.5) * k + 0.5);
  }
  // 5. Feather
  if (p.feather > 0) a = gaussBlur(a, w, h, p.feather * scale);
  res.alpha = a;
  return res;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Decontaminate colours: pulls edge pixels toward the estimated foreground colour so a cutout
 * placed on a new background shows no halo of the old one. Returns new RGBA with alpha applied.
 */
export function decontaminate(img: RGBA, res: MatteResult, amount: number): Uint8ClampedArray {
  const n = img.w * img.h;
  const out = new Uint8ClampedArray(n * 4);
  const d = img.data;
  const t = Math.max(0, Math.min(1, amount));
  for (let i = 0; i < n; i++) {
    const a = res.alpha[i];
    let r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const fb = res.fgBox;
    if (res.fg && fb && t > 0 && a > 0 && a < 0.999) {
      const x = (i % img.w) - fb.x;
      const y = Math.floor(i / img.w) - fb.y;
      if (x >= 0 && y >= 0 && x < fb.w && y < fb.h) {
        const k = (y * fb.w + x) * 3;
        // Strongest in the soft part of the edge
        const s = t * Math.min(1, (1 - a) * 2);
        r += (res.fg[k] - r) * s;
        g += (res.fg[k + 1] - g) * s;
        b += (res.fg[k + 2] - b) * s;
      }
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = Math.round(a * (d[i * 4 + 3] ?? 255));
  }
  return out;
}

/**
 * Upsamples a low-resolution mask to full size and snaps it to the real edges with a guided filter,
 * so a selection computed on a small proxy follows full-resolution detail.
 */
export function guidedUpsample(img: RGBA, small: Float32Array, sw: number, sh: number, sharpen = true): Float32Array {
  const { w, h } = img;
  const up = resizeMask(small, sw, sh, w, h);
  const scale = w / sw;
  if (scale <= 1.01) return up;
  // Only the pixels near the edge need work; find their bounding box
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = up[y * w + x];
      if (v > 0.01 && v < 0.99) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) return up;
  const r = Math.max(2, Math.round(scale * 1.5));
  x0 = Math.max(0, x0 - r * 2);
  y0 = Math.max(0, y0 - r * 2);
  x1 = Math.min(w - 1, x1 + r * 2);
  y1 = Math.min(h - 1, y1 + r * 2);
  const rw = x1 - x0 + 1;
  const rh = y1 - y0 + 1;
  const I = new Float32Array(rw * rh);
  const p = new Float32Array(rw * rh);
  const d = img.data;
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const si = (y + y0) * w + x + x0;
      I[y * rw + x] = (0.299 * d[si * 4] + 0.587 * d[si * 4 + 1] + 0.114 * d[si * 4 + 2]) / 255;
      p[y * rw + x] = up[si];
    }
  const q = guidedFilter(I, p, rw, rh, r, 1e-3);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const si = (y + y0) * w + x + x0;
      const v = up[si];
      if (v <= 0.001 || v >= 0.999) {
        // Interior stays put unless the filter clearly moved it (thin structures)
        if (Math.abs(q[y * rw + x] - v) < 0.5) continue;
      }
      const g = q[y * rw + x];
      up[si] = sharpen ? clamp01((g - 0.5) * 1.6 + 0.5) : clamp01(g);
    }
  return up;
}
