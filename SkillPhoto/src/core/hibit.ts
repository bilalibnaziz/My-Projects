// High-bit-depth editing (16-bit integer, 32-bit float). At 16/32 bits each raster layer's PixelBuffer
// (layer.pixels) holds the real pixels; layer.canvas is only its dithered 8-bit preview, rebuilt from the
// buffer after every committed edit (syncHighBit).
//   - Converted operations work on the buffer directly: adjustment layers (the same GPU shader on float
//     textures, gl.ts processFloat), Gaussian Blur (float), the 16-bit composite for export.
//   - Everything else still edits the 8-bit preview; on commit the change is merged into the buffer as a
//     delta (new = buffer + (after − before)), so untouched pixels keep their full precision and edited
//     pixels are exact to one 8-bit level. HIGH_BIT_NATIVE lists what is full precision.

import type { Adjust, BlendMode, Doc, Layer } from './types';
import { hasFx, withLayer } from './types';
import { PixelBuffer, type BitDepth } from './pixels';
import { blurChannel, blurImageData, createCanvas, ctx2d, rev, spaceOf, touch, workingSpace } from './canvas';
import { denoise, smartSharpen } from './restore';
import { getAdjustEngine } from './gl';
import { layerSurface, renderDocument } from './render';

/** Operations that work at full precision at 16/32 bits (others: exact to 1 level where they change pixels). */
export const HIGH_BIT_NATIVE = [
  'Adjustment layers (all)',
  'Gaussian Blur, Motion Blur, Unsharp Mask, Smart Sharpen, High Pass, Add Noise, Reduce Noise, Pixelate, Emboss, Find Edges, Dreamy Glow, Chromatic Aberration, Halftone Dots, Lens Correction (all 14 filters)',
  'Brush / Pencil / Eraser / Paint Bucket / Gradient (colour is 8-bit, the layer keeps full depth)',
  'Image ▸ Mode conversions',
  '16-bit PNG / TIFF import and export',
];

const synced = new WeakMap<PixelBuffer, { canvas: HTMLCanvasElement; rev: number }>();
const maxOf = (d: BitDepth) => (d === 16 ? 65535 : d === 32 ? 1 : 255);

/** The buffer's preview written into `canvas` (dithered, deterministic) and remembered as in sync. */
export function writePreview(pb: PixelBuffer, canvas: HTMLCanvasElement) {
  if (canvas.width !== pb.width || canvas.height !== pb.height) {
    canvas.width = pb.width;
    canvas.height = pb.height;
  }
  ctx2d(canvas).putImageData(pb.toImageData(true, spaceOf(canvas)), 0, 0);
  touch(canvas);
  synced.set(pb, { canvas, rev: rev(canvas) });
}

/** A raster layer whose buffer and preview agree (fresh buffer + preview). */
export function withBuffer(l: Layer, pb: PixelBuffer): Layer {
  const canvas = createCanvas(pb.width, pb.height, l.canvas ? spaceOf(l.canvas) : workingSpace());
  writePreview(pb, canvas);
  return withLayer(l, { pixels: pb, canvas });
}

/**
 * Called by store.commit at 16/32 bits: every raster layer gets a buffer, and any canvas edited since its buffer
 * was made is merged into a new buffer (old steps keep theirs, so undo is exact). Returns the new layer list,
 * plus how many layers took an 8-bit-precision merge (for the one-time hint).
 */
export function syncHighBit(doc: Doc): { layers: Layer[]; merged: number } {
  const depth = (doc.depth ?? 8) as BitDepth;
  let merged = 0;
  const layers = doc.layers.map((l) => {
    if (l.kind !== 'raster' || l.smart || !l.canvas) return l;
    const pb = l.pixels;
    if (!pb || pb.depth !== depth) {
      // New layer (pasted, duplicated, new raster…): 8-bit pixels go up exactly
      const nb = PixelBuffer.fromCanvas(l.canvas, depth);
      synced.set(nb, { canvas: l.canvas, rev: rev(l.canvas) });
      return withLayer(l, { pixels: nb });
    }
    const s = synced.get(pb);
    if (s && s.canvas === l.canvas && s.rev === rev(l.canvas)) return l;
    // Same buffer, other canvas object that shows exactly the buffer (e.g. a clone made for an edit that was undone)
    const after = ctx2d(l.canvas).getImageData(0, 0, l.canvas.width, l.canvas.height).data;
    if (pb.width !== l.canvas.width || pb.height !== l.canvas.height) {
      // Resized / cropped / transformed: the canvas is the new truth (8-bit precision)
      merged++;
      const nb = PixelBuffer.fromCanvas(l.canvas, depth);
      synced.set(nb, { canvas: l.canvas, rev: rev(l.canvas) });
      return withLayer(l, { pixels: nb });
    }
    const before = pb.toImageData(true, spaceOf(l.canvas)).data;
    let changed = false;
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) { changed = true; break; }
    if (!changed) {
      synced.set(pb, { canvas: l.canvas, rev: rev(l.canvas) });
      return l;
    }
    merged++;
    const data = pb.getContiguousArray();
    const max = maxOf(depth);
    const k = max / 255;
    for (let i = 0; i < after.length; i += 4) {
      if (after[i] === before[i] && after[i + 1] === before[i + 1] && after[i + 2] === before[i + 2] && after[i + 3] === before[i + 3]) continue;
      if (after[i + 3] === 0) {
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        continue;
      }
      // An empty pixel that got paint takes the paint exactly; otherwise the 8-bit change is added to the full value
      const fresh = before[i + 3] === 0;
      for (let c = 0; c < 4; c++) {
        const v = fresh ? after[i + c] * k : data[i + c] + (after[i + c] - before[i + c]) * k;
        data[i + c] = depth === 32 ? Math.min(1, Math.max(0, v)) : Math.round(Math.min(max, Math.max(0, v)));
      }
    }
    const nb = PixelBuffer.fromArray(data, pb.width, pb.height, depth, pb.tileSize);
    writePreview(nb, l.canvas);
    return withLayer(l, { pixels: nb });
  });
  return { layers, merged };
}

// ---------------------------------------------------------------- float helpers

/** A buffer's pixels as straight-alpha floats 0..1. */
export function toFloat(pb: PixelBuffer): Float32Array {
  const src = pb.getContiguousArray();
  if (pb.depth === 32) return Float32Array.from(src);
  const inv = 1 / maxOf(pb.depth);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] * inv;
  return out;
}

/** Floats 0..1 back into a buffer of `depth`. */
export function fromFloat(f: Float32Array, w: number, h: number, depth: BitDepth): PixelBuffer {
  if (depth === 32) return PixelBuffer.fromArray(f, w, h, 32);
  const max = maxOf(depth);
  const out = depth === 16 ? new Uint16Array(f.length) : new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, f[i])) * max);
  return PixelBuffer.fromArray(out, w, h, depth);
}

function canvasFloat(c: HTMLCanvasElement): Float32Array {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i] / 255;
  return out;
}

// ---------------------------------------------------------------- Gaussian blur (float)

/** Gaussian Blur on a buffer in float: the same kernel as the 8-bit filter (blurChannel), premultiplied. */
export function gaussianBlurBuffer(pb: PixelBuffer, radius: number): PixelBuffer {
  const w = pb.width, h = pb.height, n = w * h;
  const f = toFloat(pb);
  const a = new Float32Array(n);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const al = f[i * 4 + 3];
    a[i] = al;
    ch[0][i] = f[i * 4] * al;
    ch[1][i] = f[i * 4 + 1] * al;
    ch[2][i] = f[i * 4 + 2] * al;
  }
  blurChannel(a, w, h, radius);
  for (const c of ch) blurChannel(c, w, h, radius);
  for (let i = 0; i < n; i++) {
    const al = a[i];
    f[i * 4 + 3] = al;
    if (al > 1e-7) {
      f[i * 4] = ch[0][i] / al;
      f[i * 4 + 1] = ch[1][i] / al;
      f[i * 4 + 2] = ch[2][i] / al;
    }
  }
  return fromFloat(f, w, h, pb.depth);
}

/** Filters that run on the buffer in float at 16 / 32 bits (all 14 filters). */
export const FLOAT_FILTERS = new Set([
  'gaussian-blur',
  'unsharp',
  'high-pass',
  'motion-blur',
  'add-noise',
  'smart-sharpen',
  'reduce-noise',
  'pixelate',
  'emboss',
  'find-edges',
  'glow',
  'chromatic',
  'halftone',
  'lens-correction',
]);

/**
 * A filter on the buffer at full precision. Same maths as the 8-bit filters, on float values in the 8-bit
 * filters' 0..255 scale (so their parameters mean the same), without rounding.
 */
export function floatFilter(pb: PixelBuffer, id: string, p: Record<string, number>): PixelBuffer | null {
  if (id === 'gaussian-blur') return gaussianBlurBuffer(pb, p.radius ?? 6);
  if (!FLOAT_FILTERS.has(id)) return null;
  const w = pb.width, h = pb.height;
  const f = toFloat(pb);
  for (let i = 0; i < f.length; i++) f[i] *= 255;
  const img = { width: w, height: h, data: f, colorSpace: 'srgb' } as unknown as ImageData;
  const copyBlur = (r: number) => {
    const b = { width: w, height: h, data: new Float32Array(f), colorSpace: 'srgb' } as unknown as ImageData;
    blurImageData(b, r);
    return b.data as unknown as Float32Array;
  };
  // Luminance of the float image (0..255 scale, same coefficients as filters.ts), blurred by `radius`.
  const lumFloat = (radius: number) => {
    const L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = 0.2126 * f[i * 4] + 0.7152 * f[i * 4 + 1] + 0.0722 * f[i * 4 + 2];
    blurChannel(L, w, h, radius);
    return L;
  };
  if (id === 'unsharp') {
    const b = copyBlur(p.radius ?? 1.5);
    const k = (p.amount ?? 120) / 100, th = p.threshold ?? 2;
    for (let i = 0; i < f.length; i += 4) for (let c = 0; c < 3; c++) {
      const diff = f[i + c] - b[i + c];
      if (Math.abs(diff) >= th) f[i + c] += diff * k;
    }
  } else if (id === 'high-pass') {
    const b = copyBlur(p.radius ?? 4);
    for (let i = 0; i < f.length; i += 4) for (let c = 0; c < 3; c++) f[i + c] = 128 + f[i + c] - b[i + c];
  } else if (id === 'motion-blur') {
    const src = new Float32Array(f);
    const a = ((p.angle ?? 0) * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const dist = p.distance ?? 24;
    const taps = Math.max(2, Math.min(64, Math.round(dist)));
    const step = dist / taps;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, bl = 0, al = 0;
      for (let tp = 0; tp < taps; tp++) {
        const o = (tp - taps / 2) * step;
        const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx * o)));
        const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy * o)));
        const i = (sy * w + sx) * 4;
        r += src[i]; g += src[i + 1]; bl += src[i + 2]; al += src[i + 3];
      }
      const i = (y * w + x) * 4;
      f[i] = r / taps; f[i + 1] = g / taps; f[i + 2] = bl / taps; f[i + 3] = al / taps;
    }
  } else if (id === 'add-noise') {
    const amt = ((p.amount ?? 12) / 100) * 255;
    for (let i = 0; i < f.length; i += 4) {
      if (p.mono ?? 1) { const n = (Math.random() - 0.5) * amt; f[i] += n; f[i + 1] += n; f[i + 2] += n; }
      else for (let c = 0; c < 3; c++) f[i + c] += (Math.random() - 0.5) * amt;
    }
  } else if (id === 'smart-sharpen') {
    smartSharpen(img, { amount: p.amount ?? 150, radius: p.radius ?? 1.2, noise: p.noise ?? 15, halo: p.halo ?? 70 }, blurChannel);
  } else if (id === 'reduce-noise') {
    denoise(img, { strength: p.strength ?? 50, color: p.color ?? 50, detail: p.detail ?? 40 });
  } else if (id === 'pixelate') {
    const s = Math.max(2, Math.round(p.size ?? 16));
    const src = new Float32Array(f);
    for (let by = 0; by < h; by += s)
      for (let bx = 0; bx < w; bx += s) {
        let r = 0, g = 0, b = 0, al = 0, n = 0;
        for (let y = by; y < Math.min(h, by + s); y++)
          for (let x = bx; x < Math.min(w, bx + s); x++) {
            const i = (y * w + x) * 4;
            r += src[i]; g += src[i + 1]; b += src[i + 2]; al += src[i + 3]; n++;
          }
        for (let y = by; y < Math.min(h, by + s); y++)
          for (let x = bx; x < Math.min(w, bx + s); x++) {
            const i = (y * w + x) * 4;
            f[i] = r / n; f[i + 1] = g / n; f[i + 2] = b / n; f[i + 3] = al / n;
          }
      }
  } else if (id === 'emboss') {
    const L = lumFloat(0);
    const a = ((p.angle ?? 135) * Math.PI) / 180;
    const ox = Math.round(Math.cos(a)), oy = Math.round(Math.sin(a));
    const k = (p.amount ?? 100) / 100;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const x1 = Math.min(w - 1, Math.max(0, x + ox));
        const y1 = Math.min(h - 1, Math.max(0, y + oy));
        const x2 = Math.min(w - 1, Math.max(0, x - ox));
        const y2 = Math.min(h - 1, Math.max(0, y - oy));
        const v = 128 + (L[y1 * w + x1] - L[y2 * w + x2]) * k;
        const i = (y * w + x) * 4;
        f[i] = f[i + 1] = f[i + 2] = v;
      }
  } else if (id === 'find-edges') {
    const L = lumFloat(0);
    const at = (x: number, y: number) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    const k = (p.strength ?? 100) / 100;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
        const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
        const v = 255 - Math.min(255, Math.hypot(gx, gy) * k * 0.5);
        const i = (y * w + x) * 4;
        f[i] = f[i + 1] = f[i + 2] = v;
      }
  } else if (id === 'glow') {
    const b = copyBlur(p.radius ?? 24);
    const s = (p.strength ?? 45) / 100;
    for (let i = 0; i < f.length; i += 4)
      for (let c = 0; c < 3; c++) {
        const a = f[i + c] / 255;
        const bb = b[i + c] / 255;
        const screen = 1 - (1 - a) * (1 - bb);
        f[i + c] = (a + (screen - a) * s) * 255;
      }
  } else if (id === 'chromatic') {
    const src = new Float32Array(f);
    const s = Math.round(p.shift ?? 6);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const xr = Math.min(w - 1, x + s);
        const xb = Math.max(0, x - s);
        f[i] = src[(y * w + xr) * 4];
        f[i + 2] = src[(y * w + xb) * 4 + 2];
      }
  } else if (id === 'halftone') {
    const s = Math.max(3, Math.round(p.size ?? 10));
    const L = lumFloat(s / 2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const cx = Math.floor(x / s) * s + s / 2;
        const cy = Math.floor(y / s) * s + s / 2;
        const l = L[Math.min(h - 1, Math.floor(cy)) * w + Math.min(w - 1, Math.floor(cx))] / 255;
        const r = (1 - l) * s * 0.72;
        const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r;
        const i = (y * w + x) * 4;
        f[i] = f[i + 1] = f[i + 2] = inside ? 20 : 245;
      }
  } else if (id === 'lens-correction') {
    const src = new Float32Array(f);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.hypot(cx, cy) || 1;
    const k = ((p.distortion ?? 0) / 100) * 0.35;
    const fill = k > 0 ? 1 / (1 + k) : 1;
    const ca = ((p.fringe ?? 0) / 100) * 0.006;
    const v = (p.vignette ?? 0) / 100;
    const mid = Math.min(0.95, (p.midpoint ?? 50) / 100);
    const geometric = k !== 0 || ca !== 0;
    const sample = (x: number, y: number, c: number): number => {
      x -= 0.5;
      y -= 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
      const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, x - x0));
      const fy = Math.max(0, Math.min(1, y - y0));
      const a = src[(y0 * w + x0) * 4 + c] * (1 - fx) + src[(y0 * w + x1) * 4 + c] * fx;
      const b = src[(y1 * w + x0) * 4 + c] * (1 - fx) + src[(y1 * w + x1) * 4 + c] * fx;
      return a * (1 - fy) + b * fy;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const r = Math.hypot(dx, dy) / R;
        const i = (y * w + x) * 4;
        if (geometric) {
          const factor = (1 + k * r * r) * fill;
          const scales = [factor * (1 - ca), factor, factor * (1 + ca)];
          for (let c = 0; c < 3; c++) f[i + c] = sample(cx + dx * scales[c], cy + dy * scales[c], c);
          f[i + 3] = sample(cx + dx * factor, cy + dy * factor, 3);
        }
        if (v !== 0 && r > mid) {
          const t = (r - mid) / (1 - mid);
          const g = 1 + v * t * t;
          for (let c = 0; c < 3; c++) f[i + c] = f[i + c] * g;
        }
      }
    }
  }
  for (let i = 0; i < f.length; i++) f[i] = Math.min(1, Math.max(0, f[i] / 255));
  return fromFloat(f, w, h, pb.depth);
}

/** `next` where the selection (document coords, alpha) covers the layer, `prev` elsewhere. */
export function limitToSelection(prev: PixelBuffer, next: PixelBuffer, sel: HTMLCanvasElement, ox: number, oy: number): PixelBuffer {
  const sd = ctx2d(sel).getImageData(0, 0, sel.width, sel.height).data;
  const p = toFloat(prev), q = toFloat(next);
  const w = prev.width, h = prev.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x + ox, sy = y + oy;
    const m = sx < 0 || sy < 0 || sx >= sel.width || sy >= sel.height ? 0 : sd[(sy * sel.width + sx) * 4 + 3] / 255;
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) q[i + c] = p[i + c] + (q[i + c] - p[i + c]) * m;
  }
  return fromFloat(q, w, h, prev.depth);
}

// ---------------------------------------------------------------- composite (float)

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColor(c: [number, number, number]): [number, number, number] {
  const l = lum(...c), n = Math.min(...c), x = Math.max(...c);
  if (n < 0) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n || 1);
  if (x > 1) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l || 1);
  return c;
}
const setLum = (c: [number, number, number], l: number) => { const d = l - lum(...c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
function setSat(c: [number, number, number], s: number): [number, number, number] {
  const mx = Math.max(...c), mn = Math.min(...c);
  if (mx === mn) return [0, 0, 0];
  return c.map((v) => ((v - mn) * s) / (mx - mn)) as [number, number, number];
}
const soft = (b: number, s: number) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b));
const burn = (b: number, s: number) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const dodge = (b: number, s: number) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
function sep(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply': return b * s;
    case 'screen': return b + s - b * s;
    case 'overlay': return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'darken': return Math.min(b, s);
    case 'lighten': return Math.max(b, s);
    case 'color-dodge': return dodge(b, s);
    case 'color-burn': return burn(b, s);
    case 'hard-light': return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'soft-light': return soft(b, s);
    case 'difference': return Math.abs(b - s);
    case 'exclusion': return b + s - 2 * b * s;
    case 'linear-burn': return Math.max(0, b + s - 1);
    case 'lighter': return Math.min(1, b + s);
    case 'vivid-light': return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1);
    case 'linear-light': return clamp(b + 2 * s - 1);
    case 'pin-light': return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 'hard-mix': return b + s >= 1 ? 1 : 0;
    case 'subtract': return Math.max(0, b - s);
    case 'divide': return s <= 0 ? (b > 0 ? 1 : 0) : Math.min(1, b / s);
    default: return s;
  }
}
const NONSEP = new Set(['hue', 'saturation', 'color', 'luminosity', 'darker-color', 'lighter-color']);
export const FLOAT_BLENDS = new Set<string>(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'linear-burn', 'lighter', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'subtract', 'divide', ...NONSEP]);

/** Source over backdrop (both straight alpha) with `mode`, W3C compositing: writes into dst. */
function blendPixel(dst: Float32Array, i: number, sr: number, sg: number, sb: number, sa: number, mode: BlendMode) {
  if (sa <= 0) return;
  const br = dst[i], bg = dst[i + 1], bb = dst[i + 2], ba = dst[i + 3];
  let mr = sr, mg = sg, mb = sb;
  if (mode !== 'normal' && ba > 0) {
    if (NONSEP.has(mode)) {
      const B: [number, number, number] = [br, bg, bb], S: [number, number, number] = [sr, sg, sb];
      let m: [number, number, number];
      if (mode === 'hue') m = setLum(setSat(S, sat(B)), lum(...B));
      else if (mode === 'saturation') m = setLum(setSat(B, sat(S)), lum(...B));
      else if (mode === 'color') m = setLum(S, lum(...B));
      else if (mode === 'luminosity') m = setLum(B, lum(...S));
      else if (mode === 'darker-color') m = lum(...S) < lum(...B) ? S : B;
      else m = lum(...S) > lum(...B) ? S : B;
      [mr, mg, mb] = m;
    } else {
      mr = sep(mode, br, sr); mg = sep(mode, bg, sg); mb = sep(mode, bb, sb);
    }
  }
  const oa = sa + ba * (1 - sa);
  const mix = (b: number, s: number, m: number) => ((1 - ba) * sa * s + (1 - sa) * ba * b + sa * ba * m) / oa;
  dst[i] = mix(br, sr, mr);
  dst[i + 1] = mix(bg, sg, mg);
  dst[i + 2] = mix(bb, sb, mb);
  dst[i + 3] = oa;
}

/** Clipped layers: blend `s` onto the base but keep the base's alpha (W3C source-atop with a blend mode). */
function atopPixel(dst: Float32Array, i: number, sr: number, sg: number, sb: number, sa: number, mode: BlendMode) {
  const ba = dst[i + 3];
  if (sa <= 0 || ba <= 0) return;
  const save = ba;
  // Blend as if over an opaque backdrop of the base colour, then put the base alpha back
  dst[i + 3] = 1;
  blendPixel(dst, i, sr, sg, sb, sa, mode);
  dst[i + 3] = save;
}

/** Why the float composite can't do this document yet (null: it can). */
export function highBitCompositeBlocker(doc: Doc): string | null {
  for (const l of doc.layers) {
    if (!l.visible) continue;
    if (!FLOAT_BLENDS.has(l.blend) && l.blend !== 'pass-through') return `${l.blend} blend mode`;
  }
  return null;
}

/** A layer (or group result) as a float image placed in the document. */
interface FImg { data: Float32Array; w: number; h: number; ox: number; oy: number }

function maskOf(l: Layer): ((x: number, y: number) => number) | null {
  const m = l.mask && l.mask.enabled ? l.mask : null;
  if (!m) return null;
  const d = ctx2d(m.canvas).getImageData(0, 0, m.canvas.width, m.canvas.height).data;
  const mw = m.canvas.width, mh = m.canvas.height;
  return (x, y) => {
    const mx = x - m.x, my = y - m.y;
    return mx < 0 || my < 0 || mx >= mw || my >= mh ? 0 : d[(my * mw + mx) * 4 + 3] / 255;
  };
}

/** Draws an image onto a document-sized float buffer (opacity, mask, blend; atop = clipped). */
function drawImg(out: Float32Array, W: number, H: number, img: FImg, k: number, mask: ((x: number, y: number) => number) | null, blend: BlendMode, atop = false) {
  const x0 = Math.max(0, img.ox), y0 = Math.max(0, img.oy), x1 = Math.min(W, img.ox + img.w), y1 = Math.min(H, img.oy + img.h);
  const mode = blend === 'pass-through' ? 'normal' : blend;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const si = ((y - img.oy) * img.w + (x - img.ox)) * 4;
    const a = img.data[si + 3] * k * (mask ? mask(x, y) : 1);
    if (a <= 0) continue;
    const di = (y * W + x) * 4;
    if (atop) atopPixel(out, di, img.data[si], img.data[si + 1], img.data[si + 2], a, mode);
    else blendPixel(out, di, img.data[si], img.data[si + 1], img.data[si + 2], a, mode);
  }
}

/**
 * The document composited in float (straight alpha, 0..1, document size). Raster layers come from their buffers;
 * text, shapes and smart objects from their surfaces; layers with styles from their styled render (the effects
 * are 8-bit, the blend is float). Groups (isolated or pass-through), clipping masks, layer masks, opacity, fill and
 * adjustment layers (the GPU stack on float pixels) are all composited in float. Null when blocked or when the GPU
 * can't render float.
 */
export function compositeHighBit(doc: Doc): Float32Array | null {
  if (highBitCompositeBlocker(doc)) return null;
  const W = doc.width, H = doc.height;
  const groups = new Set(doc.layers.filter((l) => l.kind === 'group').map((l) => l.id));
  const kids = new Map<string | undefined, Layer[]>();
  for (const l of doc.layers) {
    const p = l.parent && groups.has(l.parent) && l.parent !== l.id ? l.parent : undefined;
    const list = kids.get(p) ?? [];
    list.push(l);
    kids.set(p, list);
  }
  let failed = false;

  const imageOf = (l: Layer): FImg | null => {
    if (l.kind === 'group') {
      const g = new Float32Array(W * H * 4);
      compositeList(kids.get(l.id) ?? [], g);
      return { data: g, w: W, h: H, ox: 0, oy: 0 };
    }
    if (hasFx(l)) {
      // The layer alone with its styles (8-bit effects), unblended: blended below in float
      const c = createCanvas(W, H, 'srgb');
      renderDocument({ ...doc, layers: [withLayer(l, { opacity: 1, blend: 'normal', clip: false, parent: undefined, mask: undefined })] }, c);
      return { data: canvasFloat(c), w: W, h: H, ox: 0, oy: 0 };
    }
    if (l.kind === 'raster' && l.pixels && !l.smart) return { data: toFloat(l.pixels), w: l.pixels.width, h: l.pixels.height, ox: Math.round(l.x), oy: Math.round(l.y) };
    const s = layerSurface(l);
    return s ? { data: canvasFloat(s.canvas), w: s.canvas.width, h: s.canvas.height, ox: Math.round(s.x), oy: Math.round(s.y) } : null;
  };

  const adjust = (l: Layer, target: Float32Array, atopBase: boolean) => {
    if (!l.adjust) return;
    const adjusted = getAdjustEngine()?.processFloat(target, W, H, l.adjust as Adjust);
    if (!adjusted) { failed = true; return; }
    const mask = maskOf(l);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      const a = l.opacity * (mask ? mask(x, y) : 1);
      if (a <= 0 || target[i + 3] <= 0) continue;
      if (l.blend === 'normal' || l.blend === 'pass-through') for (let c = 0; c < 3; c++) target[i + c] += (adjusted[i + c] - target[i + c]) * a;
      else if (atopBase) atopPixel(target, i, adjusted[i], adjusted[i + 1], adjusted[i + 2], a, l.blend);
      else blendPixel(target, i, adjusted[i], adjusted[i + 1], adjusted[i + 2], a * target[i + 3], l.blend);
    }
  };

  function compositeList(list: Layer[], out: Float32Array) {
    for (let i = 0; i < list.length && !failed; i++) {
      const l = list[i];
      if (l.clip) continue; // drawn with its base
      // The clipping run above this layer
      const run: Layer[] = [];
      for (let j = i + 1; j < list.length && list[j].clip; j++) run.push(list[j]);
      if (!l.visible) continue;
      if (l.kind === 'adjustment') {
        adjust(l, out, false);
        continue;
      }
      // A pass-through group at full strength draws its contents straight onto what's below
      if (l.kind === 'group' && l.blend === 'pass-through' && !run.length && !maskOf(l) && l.opacity >= 1 && !hasFx(l)) {
        compositeList(kids.get(l.id) ?? [], out);
        continue;
      }
      const img = imageOf(l);
      if (!img) continue;
      if (run.some((c) => c.visible)) {
        // Clipped layers go onto the base (kept at its own alpha), then the base goes down with its settings
        const base: FImg = img.w === W && img.h === H && img.ox === 0 && img.oy === 0 ? { ...img, data: new Float32Array(img.data) } : (() => {
          const d = new Float32Array(W * H * 4);
          drawImg(d, W, H, img, 1, null, 'normal');
          return { data: d, w: W, h: H, ox: 0, oy: 0 };
        })();
        for (const c of run) {
          if (!c.visible) continue;
          if (c.kind === 'adjustment') { adjust(c, base.data, true); continue; }
          const ci = imageOf(c);
          if (ci) drawImg(base.data, W, H, ci, c.opacity * (c.fill ?? 1), maskOf(c), c.blend, true);
        }
        drawImg(out, W, H, base, l.opacity * (l.kind === 'group' || hasFx(l) ? 1 : l.fill ?? 1), maskOf(l), l.blend);
        continue;
      }
      // Fill opacity is already inside a styled render; a group has none
      const k = l.opacity * (l.kind === 'group' || hasFx(l) ? 1 : l.fill ?? 1);
      drawImg(out, W, H, img, k, maskOf(l), l.blend);
    }
  }

  const out = new Float32Array(W * H * 4);
  compositeList(kids.get(undefined) ?? [], out);
  return failed ? null : out;
}

/** The float composite as a document-sized buffer of `depth` (16-bit export). */
export function compositeBuffer(doc: Doc, depth: BitDepth = (doc.depth ?? 16) as BitDepth): PixelBuffer | null {
  const f = compositeHighBit(doc);
  return f ? fromFloat(f, doc.width, doc.height, depth) : null;
}
