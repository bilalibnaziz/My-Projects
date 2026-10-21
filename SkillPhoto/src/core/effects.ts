// Layer styles: drop shadow, outer glow, inner shadow, inner glow, bevel, color and gradient
// overlays, and stroke. Everything is computed from the layer's alpha: an exact Euclidean
// distance transform gives crisp strokes, spreads and bevels at any size, and the separable
// blur gives soft shadows and glows. Results are cached per layer pixels + settings, so moving
// a styled layer never recomputes its effects.

import type { Layer, LayerFx } from './types';
import { fullFx } from './types';
import { blurChannel, createCanvas, ctx2d, rev } from './canvas';

export interface FxResult {
  pad: number;
  width: number;
  height: number;
  /** Effects drawn under the layer (drop shadow, outer glow), RGBA. */
  behind: Uint8ClampedArray;
  /** The layer's own pixels (at fill opacity) with overlays, inner effects, bevel and stroke, RGBA. */
  front: Uint8ClampedArray;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hexRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- distance transform

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let p = v[k];
    let s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    while (s <= z[k]) {
      k--;
      p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Exact Euclidean distance from every pixel to the nearest pixel where `target` is set. */
export function edt(target: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = target[i] ? 0 : INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = Math.sqrt(d[x]);
  }
  return out;
}

// ---------------------------------------------------------------- effect maps

/**
 * Coverage of a band `r` pixels wide measured from the shape edge. Distances are between pixel
 * centres and the edge lies half a pixel beyond the last shape pixel, so a pixel at distance d
 * spans d-1..d from the edge.
 */
const band = (r: number, d: number) => clamp01(r + 1 - d);

/** Grows `base` outward by `r` pixels using the distance to the shape (`dist`). */
function grow(base: Float32Array, dist: Float32Array, r: number): Float32Array {
  const out = new Float32Array(base);
  if (r <= 0) return out;
  for (let i = 0; i < out.length; i++) {
    const g = band(r, dist[i]);
    if (g > out[i]) out[i] = g;
  }
  return out;
}

/** Soft map: spread first (hard growth), then blur the rest of the size (Photoshop's model). */
function softMap(base: Float32Array, dist: Float32Array, size: number, spread: number, w: number, h: number): Float32Array {
  const hard = (size * Math.max(0, Math.min(100, spread))) / 100;
  const m = grow(base, dist, hard);
  blurChannel(m, w, h, size - hard);
  return m;
}

function shiftOf(angle: number, distance: number): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [Math.round(-Math.cos(a) * distance), Math.round(Math.sin(a) * distance)];
}

/** Padding needed around the layer for the outward effects. */
export function fxPad(fx: LayerFx): number {
  let p = 2;
  const ds = fx.dropShadow;
  if (ds.enabled) p = Math.max(p, ds.distance + ds.size * 1.3 + 2);
  if (fx.outerGlow.enabled) p = Math.max(p, fx.outerGlow.size * 1.3 + 2);
  const st = fx.stroke;
  if (st.enabled && st.position !== 'inside') p = Math.max(p, (st.position === 'center' ? st.size / 2 : st.size) + 2);
  return Math.ceil(p);
}

/**
 * Computes all enabled effects for an RGBA image of `w`×`h`. The result is padded by `pad`
 * pixels on every side so outward effects (shadow, glow, outside stroke) have room.
 */
export function computeFx(src: Uint8ClampedArray, w: number, h: number, fxIn: LayerFx, fill = 1): FxResult {
  const fx = fullFx(fxIn);
  const pad = fxPad(fx);
  const W = w + pad * 2;
  const H = h + pad * 2;
  const N = W * H;
  const A = new Float32Array(N);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = src[(y * w + x) * 4 + 3] / 255;
      A[(y + pad) * W + x + pad] = a;
      if (a > 0.01) {
        if (x + pad < minX) minX = x + pad;
        if (x + pad > maxX) maxX = x + pad;
        if (y + pad < minY) minY = y + pad;
        if (y + pad > maxY) maxY = y + pad;
      }
    }
  }

  let dOutCache: Float32Array | null = null;
  let dInCache: Float32Array | null = null;
  // Distance from outside pixels to the shape, and from inside pixels to the outside
  const dOut = () => {
    if (!dOutCache) {
      const t = new Uint8Array(N);
      for (let i = 0; i < N; i++) t[i] = A[i] >= 0.5 ? 1 : 0;
      dOutCache = edt(t, W, H);
    }
    return dOutCache;
  };
  const dIn = () => {
    if (!dInCache) {
      const t = new Uint8Array(N);
      for (let i = 0; i < N; i++) t[i] = A[i] < 0.5 ? 1 : 0;
      dInCache = edt(t, W, H);
    }
    return dInCache;
  };
  let invCache: Float32Array | null = null;
  const inv = () => {
    if (!invCache) {
      invCache = new Float32Array(N);
      for (let i = 0; i < N; i++) invCache[i] = 1 - A[i];
    }
    return invCache;
  };

  // ---- maps (alpha 0..1 per pixel), null when the effect is off
  const ds = fx.dropShadow;
  let shadow: Float32Array | null = null;
  let shadowDx = 0, shadowDy = 0;
  if (ds.enabled && ds.opacity > 0) {
    shadow = softMap(A, dOut(), ds.size, ds.spread, W, H);
    [shadowDx, shadowDy] = shiftOf(ds.angle, ds.distance);
  }
  const og = fx.outerGlow;
  const glow = og.enabled && og.opacity > 0 ? softMap(A, dOut(), og.size, og.spread, W, H) : null;

  const is = fx.innerShadow;
  let innerShadow: Float32Array | null = null;
  let isDx = 0, isDy = 0;
  if (is.enabled && is.opacity > 0) {
    innerShadow = softMap(inv(), dIn(), is.size, is.spread, W, H);
    [isDx, isDy] = shiftOf(is.angle, is.distance);
  }
  const ig = fx.innerGlow;
  const innerGlow = ig.enabled && ig.opacity > 0 ? softMap(inv(), dIn(), ig.size, ig.spread, W, H) : null;

  const st = fx.stroke;
  let stroke: Float32Array | null = null;
  if (st.enabled && st.size > 0 && st.opacity > 0) {
    stroke = new Float32Array(N);
    const outR = st.position === 'outside' ? st.size : st.position === 'center' ? st.size / 2 : 0;
    const inR = st.position === 'inside' ? st.size : st.position === 'center' ? st.size / 2 : 0;
    const dO = outR > 0 ? dOut() : null;
    const dI = inR > 0 ? dIn() : null;
    for (let i = 0; i < N; i++) {
      let s = 0;
      if (dO) s += clamp01(Math.max(A[i], band(outR, dO[i])) - A[i]);
      if (dI) s += A[i] * band(inR, dI[i]);
      stroke[i] = clamp01(s);
    }
  }

  const bv = fx.bevel;
  let bevelHi: Float32Array | null = null;
  let bevelLo: Float32Array | null = null;
  if (bv.enabled && bv.size > 0 && bv.opacity > 0) {
    const dI = dIn();
    const hgt = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = clamp01(dI[i] / bv.size);
      hgt[i] = 1 - (1 - t) * (1 - t);
    }
    blurChannel(hgt, W, H, Math.max(1, bv.size * 0.15));
    const scale = (bv.size * bv.depth) / 100;
    const az = (bv.angle * Math.PI) / 180;
    const alt = (Math.max(0, Math.min(90, bv.altitude)) * Math.PI) / 180;
    const lx = Math.cos(az) * Math.cos(alt);
    const ly = -Math.sin(az) * Math.cos(alt);
    const lz = Math.sin(alt);
    bevelHi = new Float32Array(N);
    bevelLo = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (A[i] <= 0) continue;
        const gx = ((hgt[i + 1] - hgt[i - 1]) / 2) * scale;
        const gy = ((hgt[i + W] - hgt[i - W]) / 2) * scale;
        const len = Math.sqrt(gx * gx + gy * gy + 1);
        const shade = (-gx * lx - gy * ly + lz) / len - lz;
        if (shade > 0) bevelHi[i] = clamp01(shade * 2.5);
        else bevelLo[i] = clamp01(-shade * 2.5);
      }
    }
  }

  // ---- gradient overlay setup
  const go = fx.gradientOverlay;
  const goOn = go.enabled && go.opacity > 0 && maxX >= 0;
  const gFrom = hexRgb(go.from);
  const gTo = hexRgb(go.to);
  const ga = (go.angle * Math.PI) / 180;
  const gux = Math.cos(ga);
  const guy = -Math.sin(ga);
  const gcx = (minX + maxX) / 2;
  const gcy = (minY + maxY) / 2;
  const gExtent = Math.max(1, Math.abs((maxX - minX + 1) * gux) + Math.abs((maxY - minY + 1) * guy));

  const co = fx.colorOverlay;
  const coOn = co.enabled && co.opacity > 0;

  const cShadow = hexRgb(ds.color);
  const cGlow = hexRgb(og.color);
  const cIs = hexRgb(is.color);
  const cIg = hexRgb(ig.color);
  const cCo = hexRgb(co.color);
  const cSt = hexRgb(st.color);
  const cHi = hexRgb(bv.highlight);
  const cLo = hexRgb(bv.shadow);

  const behind = new Uint8ClampedArray(N * 4);
  const front = new Uint8ClampedArray(N * 4);
  const fillA = clamp01(fill);

  let R = 0, G = 0, B = 0, AA = 0;
  const put = (r: number, g: number, b: number, al: number) => {
    if (al <= 0) return;
    const oa = al + AA * (1 - al);
    const k = AA * (1 - al);
    R = (r * al + R * k) / oa;
    G = (g * al + G * k) / oa;
    B = (b * al + B * k) / oa;
    AA = oa;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = A[i];

      // ---- behind: drop shadow, then outer glow over it
      R = G = B = AA = 0;
      if (shadow) {
        const sx = x - shadowDx;
        const sy = y - shadowDy;
        const v = sx >= 0 && sy >= 0 && sx < W && sy < H ? shadow[sy * W + sx] : 0;
        // The layer knocks out its own shadow (visible when the fill is lowered)
        put(cShadow[0], cShadow[1], cShadow[2], v * (ds.opacity / 100) * (1 - a));
      }
      if (glow) put(cGlow[0], cGlow[1], cGlow[2], glow[i] * (og.opacity / 100));
      const o = i * 4;
      behind[o] = R;
      behind[o + 1] = G;
      behind[o + 2] = B;
      behind[o + 3] = AA * 255;

      // ---- front: content, overlays, inner effects, bevel, stroke
      R = G = B = AA = 0;
      if (a > 0) {
        const sx = x - pad;
        const sy = y - pad;
        if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
          const so = (sy * w + sx) * 4;
          put(src[so], src[so + 1], src[so + 2], a * fillA);
        }
        if (goOn) {
          const t = clamp01(0.5 + ((x - gcx) * gux + (y - gcy) * guy) / gExtent);
          put(gFrom[0] + (gTo[0] - gFrom[0]) * t, gFrom[1] + (gTo[1] - gFrom[1]) * t, gFrom[2] + (gTo[2] - gFrom[2]) * t, a * (go.opacity / 100));
        }
        if (coOn) put(cCo[0], cCo[1], cCo[2], a * (co.opacity / 100));
        if (innerGlow) put(cIg[0], cIg[1], cIg[2], innerGlow[i] * a * (ig.opacity / 100));
        if (innerShadow) {
          const sx2 = x - isDx;
          const sy2 = y - isDy;
          const v = sx2 >= 0 && sy2 >= 0 && sx2 < W && sy2 < H ? innerShadow[sy2 * W + sx2] : 1;
          put(cIs[0], cIs[1], cIs[2], v * a * (is.opacity / 100));
        }
        if (bevelHi && bevelLo) {
          put(cHi[0], cHi[1], cHi[2], bevelHi[i] * a * (bv.opacity / 100));
          put(cLo[0], cLo[1], cLo[2], bevelLo[i] * a * (bv.opacity / 100));
        }
      }
      if (stroke) put(cSt[0], cSt[1], cSt[2], stroke[i] * (st.opacity / 100));
      front[o] = R;
      front[o + 1] = G;
      front[o + 2] = B;
      front[o + 3] = AA * 255;
    }
  }
  return { pad, width: W, height: H, behind, front };
}

// ---------------------------------------------------------------- canvas wrapper

export interface FxSurfaces {
  behind: { canvas: HTMLCanvasElement; x: number; y: number };
  front: { canvas: HTMLCanvasElement; x: number; y: number };
  full: { canvas: HTMLCanvasElement; x: number; y: number };
}

interface Cached {
  key: string;
  pad: number;
  behind: HTMLCanvasElement;
  front: HTMLCanvasElement;
  full: HTMLCanvasElement;
}

const fxCache = new WeakMap<HTMLCanvasElement, Cached>();

function toCanvas(data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  ctx2d(c).putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c;
}

/**
 * Styled pixels for a layer surface (document coordinates). The layer mask is applied first,
 * so effects follow the masked shape. Cached on the surface canvas: moving the layer is free.
 */
export function styledSurface(layer: Layer, surf: { canvas: HTMLCanvasElement; x: number; y: number }): FxSurfaces {
  const m = layer.mask && layer.mask.enabled ? layer.mask : null;
  const fill = layer.fill ?? 1;
  const key = `${rev(surf.canvas)}|${m ? `${rev(m.canvas)}@${m.x - surf.x},${m.y - surf.y}` : ''}|${fill}|${JSON.stringify(layer.fx)}`;
  let hit = fxCache.get(surf.canvas);
  if (!hit || hit.key !== key) {
    const { width: w, height: h } = surf.canvas;
    let pixels: Uint8ClampedArray;
    if (m) {
      const tmp = createCanvas(w, h);
      const t = ctx2d(tmp);
      t.drawImage(surf.canvas, 0, 0);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(m.canvas, m.x - surf.x, m.y - surf.y);
      pixels = t.getImageData(0, 0, w, h).data;
    } else {
      pixels = ctx2d(surf.canvas).getImageData(0, 0, w, h).data;
    }
    const r = computeFx(pixels, w, h, fullFx(layer.fx), fill);
    const behind = toCanvas(r.behind, r.width, r.height);
    const front = toCanvas(r.front, r.width, r.height);
    const full = createCanvas(r.width, r.height);
    const fctx = ctx2d(full);
    fctx.drawImage(behind, 0, 0);
    fctx.drawImage(front, 0, 0);
    hit = { key, pad: r.pad, behind, front, full };
    fxCache.set(surf.canvas, hit);
  }
  const x = surf.x - hit.pad;
  const y = surf.y - hit.pad;
  return { behind: { canvas: hit.behind, x, y }, front: { canvas: hit.front, x, y }, full: { canvas: hit.full, x, y } };
}
