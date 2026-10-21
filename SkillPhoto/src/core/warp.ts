// Projective (perspective) warping for Free Transform's Skew, Distort and Perspective modes.
// The source rectangle maps onto any convex quad through a homography; every output pixel is
// mapped back into the source and sampled bilinearly, so edges come out anti-aliased and there
// are no seams (unlike triangle-mesh approximations).

export interface Pt {
  x: number;
  y: number;
}

/** 3×3 matrix, row-major, mapping (u, v, 1) → (x·w, y·w, w). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Homography from the unit square (0,0)(1,0)(1,1)(0,1) to the quad q0..q3 (Heckbert). */
export function squareToQuad(q: Pt[]): Mat3 {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // Parallelogram: affine
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

export function apply3(m: Mat3, x: number, y: number): Pt {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** A quad is usable when it is convex and not degenerate (all turns the same way). */
export function isConvexQuad(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Point-in-polygon (even-odd); works for the 4-corner box and longer outlines. */
export function pointInQuad(q: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Warps an RGBA image of w×h onto quad `q` (document coordinates). Returns the output pixels
 * and where they go: a box covering the quad.
 */
export function warpToQuad(src: Uint8ClampedArray, w: number, h: number, q: Pt[]): { data: Uint8ClampedArray; x: number; y: number; width: number; height: number } {
  const x0 = Math.floor(Math.min(...q.map((p) => p.x)));
  const y0 = Math.floor(Math.min(...q.map((p) => p.y)));
  const x1 = Math.ceil(Math.max(...q.map((p) => p.x)));
  const y1 = Math.ceil(Math.max(...q.map((p) => p.y)));
  const W = Math.max(1, x1 - x0);
  const H = Math.max(1, y1 - y0);
  const out = new Uint8ClampedArray(W * H * 4);
  const inv = invert3(squareToQuad(q));
  for (let oy = 0; oy < H; oy++) {
    const py = y0 + oy + 0.5;
    for (let ox = 0; ox < W; ox++) {
      const px = x0 + ox + 0.5;
      const ww = inv[6] * px + inv[7] * py + inv[8];
      if (ww <= 0) continue;
      // Unit-square coordinates → source pixel centres
      const u = ((inv[0] * px + inv[1] * py + inv[2]) / ww) * w - 0.5;
      const v = ((inv[3] * px + inv[4] * py + inv[5]) / ww) * h - 0.5;
      if (u < -1 || v < -1 || u > w || v > h) continue;
      const iu = Math.floor(u);
      const iv = Math.floor(v);
      const fu = u - iu;
      const fv = v - iv;
      // Bilinear on premultiplied colour; samples outside the source are transparent
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const sx = iu + (k & 1);
        const sy = iv + (k >> 1);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const wt = (k & 1 ? fu : 1 - fu) * (k >> 1 ? fv : 1 - fv);
        const i = (sy * w + sx) * 4;
        const al = src[i + 3] * wt;
        r += src[i] * al;
        g += src[i + 1] * al;
        b += src[i + 2] * al;
        a += al;
      }
      if (a <= 0) continue;
      const o = (oy * W + ox) * 4;
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = a;
    }
  }
  return { data: out, x: x0, y: y0, width: W, height: H };
}

// ---------------------------------------------------------------- text warp

export type TextWarpStyle = 'none' | 'arc' | 'arch' | 'bulge' | 'flag' | 'wave' | 'rise';

export const TEXT_WARPS: { id: TextWarpStyle; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'arc', label: 'Arc' },
  { id: 'arch', label: 'Arch' },
  { id: 'bulge', label: 'Bulge' },
  { id: 'flag', label: 'Flag' },
  { id: 'wave', label: 'Wave' },
  { id: 'rise', label: 'Rise' },
];

/** Samples `src` (RGBA w×h) at a fractional position; returns straight RGBA or null when empty. */
function sample(src: Uint8ClampedArray, w: number, h: number, u: number, v: number, out: Uint8ClampedArray, o: number) {
  u -= 0.5;
  v -= 0.5;
  if (u < -1 || v < -1 || u > w || v > h) return;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = u - iu;
  const fv = v - iv;
  let r = 0, g = 0, b = 0, a = 0;
  for (let k = 0; k < 4; k++) {
    const sx = iu + (k & 1);
    const sy = iv + (k >> 1);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const wt = (k & 1 ? fu : 1 - fu) * (k >> 1 ? fv : 1 - fv);
    const i = (sy * w + sx) * 4;
    const al = src[i + 3] * wt;
    r += src[i] * al;
    g += src[i + 1] * al;
    b += src[i + 2] * al;
    a += al;
  }
  if (a <= 0) return;
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a;
}

/**
 * Photoshop-style Warp Text on a rendered text block (w×h RGBA). `bend` is −100..100.
 * Returns the warped pixels and the offset of the new box relative to the old one.
 */
export function warpText(src: Uint8ClampedArray, w: number, h: number, style: TextWarpStyle, bend: number): { data: Uint8ClampedArray; width: number; height: number; dx: number; dy: number } {
  const b = Math.max(-1, Math.min(1, bend / 100));
  if (style === 'none' || Math.abs(b) < 0.005) return { data: src, width: w, height: h, dx: 0, dy: 0 };

  if (style === 'arc') {
    // Lay the text's centre line along a circular arc; letters stay upright to the curve
    const s = Math.sign(b);
    const theta = Math.abs(b) * Math.PI; // total arc angle (180° at 100%)
    const R = w / theta;
    const fwd = (u: number, v: number) => {
      const phi = (u - w / 2) / R;
      const r = s > 0 ? R + (h / 2 - v) : R + (v - h / 2);
      return s > 0 ? { x: r * Math.sin(phi), y: -r * Math.cos(phi) } : { x: r * Math.sin(phi), y: r * Math.cos(phi) };
    };
    // Bounds from the edges of the block
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i <= 64; i++) {
      for (const [u, v] of [[(w * i) / 64, 0], [(w * i) / 64, h], [0, (h * i) / 64], [w, (h * i) / 64]]) {
        const p = fwd(u, v);
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
    const W = Math.ceil(x1 - x0) + 2;
    const H = Math.ceil(y1 - y0) + 2;
    const out = new Uint8ClampedArray(W * H * 4);
    const ox = Math.floor(x0) - 1;
    const oy = Math.floor(y0) - 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x + ox + 0.5;
        const dy = y + oy + 0.5;
        const r = Math.hypot(dx, dy);
        const phi = s > 0 ? Math.atan2(dx, -dy) : Math.atan2(dx, dy);
        const u = w / 2 + phi * R;
        const v = s > 0 ? h / 2 - (r - R) : h / 2 + (r - R);
        sample(src, w, h, u, v, out, (y * W + x) * 4);
      }
    }
    // Keep the block's centre where it was: the centre line's midpoint sits at (0, ∓R)
    const mid = fwd(w / 2, h / 2);
    return { data: out, width: W, height: H, dx: ox - mid.x + w / 2, dy: oy - mid.y + h / 2 };
  }

  // Vertical displacement styles: each column shifts (or scales, for bulge) by a profile of x
  const amp = h * 0.6 * b;
  const shift = (x: number, y: number): number => {
    const t = x / w;
    switch (style) {
      case 'arch':
        return -amp * Math.sin(Math.PI * t);
      case 'flag':
        return amp * 0.5 * Math.sin(2 * Math.PI * t);
      case 'wave':
        return amp * 0.5 * Math.sin(2 * Math.PI * t + (y / h) * Math.PI * 0.5);
      case 'rise':
        return -amp * (t - 0.5) * 2;
      default:
        return 0;
    }
  };
  const pad = Math.ceil(Math.abs(amp)) + 2;
  const W = w;
  const H = h + pad * 2;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const yy = y - pad + 0.5;
      const xx = x + 0.5;
      let v: number;
      if (style === 'bulge') {
        const k = 1 + b * 0.6 * Math.sin(Math.PI * (xx / w));
        v = h / 2 + (yy - h / 2) / Math.max(0.05, k);
      } else {
        // Solve v + shift(x, v) = y with a few fixed-point steps (exact when shift ignores y)
        v = yy - shift(xx, yy);
        for (let i = 0; i < 3; i++) v = yy - shift(xx, v);
      }
      sample(src, w, h, xx, v, out, (y * W + x) * 4);
    }
  }
  return { data: out, width: W, height: H, dx: 0, dy: -pad };
}
