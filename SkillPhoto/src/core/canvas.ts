import type { Rect } from './types';

// ------------------------------------------------------------ colour spaces
// A document works in sRGB or Display P3. Its canvases are created in that space (a canvas's space is
// fixed when its context is made), so wide-gamut photos keep their colours while edited. drawImage
// between canvases of different spaces converts colours; pixel buffers are tagged with the space their
// numbers came from (pixelsLike / spaceOf), so putImageData converts them correctly too.

export type ColorSpaceId = 'srgb' | 'display-p3';

let working: ColorSpaceId = 'srgb';
const spaces = new WeakMap<HTMLCanvasElement, ColorSpaceId>();

/** The space new canvases are made in: the active document's (set by the store). */
export function setWorkingSpace(space: ColorSpaceId) {
  working = space;
}
export const workingSpace = (): ColorSpaceId => working;

/** The space a canvas's pixels are in. */
export const spaceOf = (c: HTMLCanvasElement): ColorSpaceId => spaces.get(c) ?? 'srgb';

/** Gives a canvas made elsewhere (e.g. by React) a space; only before its first ctx2d call. */
export function setCanvasSpace(c: HTMLCanvasElement, space: ColorSpaceId) {
  if (space === 'srgb') spaces.delete(c);
  else spaces.set(c, space);
}

export function createCanvas(width: number, height: number, space: ColorSpaceId = working): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  if (space !== 'srgb') spaces.set(c, space);
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const space = spaces.get(c);
  const ctx = space ? c.getContext('2d', { colorSpace: space }) : c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

/** An ImageData whose numbers are in `like`'s space (a canvas, an ImageData, or a space name). */
export function pixelsLike(like: HTMLCanvasElement | ImageData | ColorSpaceId, data: Uint8ClampedArray, width: number, height: number): ImageData {
  const colorSpace = typeof like === 'string' ? like : like instanceof HTMLCanvasElement ? spaceOf(like) : ((like.colorSpace as ColorSpaceId) ?? 'srgb');
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height, { colorSpace });
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height, spaceOf(src));
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

// Display P3 → linear sRGB (D65)
const P3_TO_SRGB = [1.2249401, -0.2249404, 0, -0.0420569, 1.0420571, 0, -0.0196376, -0.0786361, 1.0982735];
const toLinear = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/**
 * Whether a Display P3 canvas holds colours sRGB can't show (checked on a copy at most 512 px across).
 * A few stray pixels don't count: at least 0.05 % of them must be clearly outside.
 */
export function hasWideGamut(c: HTMLCanvasElement): boolean {
  const k = Math.min(1, 512 / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * k));
  const h = Math.max(1, Math.round(c.height * k));
  const probe = createCanvas(w, h, 'display-p3');
  const g = ctx2d(probe);
  g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const m = P3_TO_SRGB;
  let out = 0;
  let seen = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    seen++;
    const r = toLinear[d[i]];
    const gg = toLinear[d[i + 1]];
    const b = toLinear[d[i + 2]];
    for (let row = 0; row < 3; row++) {
      const v = m[row * 3] * r + m[row * 3 + 1] * gg + m[row * 3 + 2] * b;
      if (v < -0.02 || v > 1.02) {
        out++;
        break;
      }
    }
  }
  return seen > 0 && out >= Math.max(4, seen * 0.0005);
}

/** The canvas redrawn in another space (the browser converts the colours); itself when already there. */
export function convertCanvas(src: HTMLCanvasElement, space: ColorSpaceId): HTMLCanvasElement {
  if (spaceOf(src) === space) return src;
  const c = createCanvas(src.width, src.height, space);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

// Pixel revisions let the renderer cache work keyed on canvas content.
const pixelRev = new WeakMap<HTMLCanvasElement, number>();
let revCounter = 1;

export function touch(c: HTMLCanvasElement | undefined | null): void {
  if (c) pixelRev.set(c, revCounter++);
}

export function rev(c: HTMLCanvasElement | undefined | null): number {
  if (!c) return 0;
  let r = pixelRev.get(c);
  if (r === undefined) {
    r = revCounter++;
    pixelRev.set(c, r);
  }
  return r;
}

// Scratch canvases reused for temporary compositing to avoid GC churn.
const scratchPool = new Map<string, HTMLCanvasElement>();
/** Frees a scratch canvas that is no longer needed (big previews shouldn't stay in memory). */
export function releaseScratch(key: string) {
  scratchPool.delete(key);
  scratchPool.delete(`${key}@display-p3`);
}

export function scratch(key: string, width: number, height: number): HTMLCanvasElement {
  // One per space: a scratch made for an sRGB document can't hold P3 pixels unconverted
  const k = working === 'srgb' ? key : `${key}@${working}`;
  let c = scratchPool.get(k);
  if (!c) {
    c = createCanvas(width, height);
    scratchPool.set(k, c);
  }
  if (c.width !== width || c.height !== height) {
    c.width = Math.max(1, width);
    c.height = Math.max(1, height);
  } else {
    ctx2d(c).clearRect(0, 0, c.width, c.height);
  }
  const ctx = ctx2d(c);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || btm <= y) return null;
  return { x, y, width: r - x, height: btm - y };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function roundRectOut(r: Rect): Rect {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, width: Math.ceil(r.x + r.width) - x, height: Math.ceil(r.y + r.height) - y };
}

/**
 * Bounding box of pixels with alpha > threshold, or null if fully transparent.
 * Scans inward from each edge in strips and stops at the first hit, so layers whose content
 * reaches the edges (photos, fills) read a few rows/columns instead of the whole canvas.
 */
export function alphaBounds(c: HTMLCanvasElement, threshold = 0): Rect | null {
  const { width: W, height: H } = c;
  if (!W || !H) return null;
  const ctx = ctx2d(c);
  const STRIP = 64;
  const rowHit = (y0: number, n: number, fromEnd: boolean): number => {
    const d = ctx.getImageData(0, y0, W, n).data;
    for (let k = 0; k < n; k++) {
      const r = fromEnd ? n - 1 - k : k;
      for (let x = 0, i = r * W * 4 + 3; x < W; x++, i += 4) if (d[i] > threshold) return y0 + r;
    }
    return -1;
  };
  let top = -1;
  for (let y = 0; y < H && top < 0; y += STRIP) top = rowHit(y, Math.min(STRIP, H - y), false);
  if (top < 0) return null;
  let bottom = -1;
  for (let y = H; y > top && bottom < 0; y -= STRIP) {
    const y0 = Math.max(top, y - STRIP);
    bottom = rowHit(y0, y - y0, true);
  }
  const rows = bottom - top + 1;
  const colHit = (x0: number, n: number, fromEnd: boolean): number => {
    const d = ctx.getImageData(x0, top, n, rows).data;
    for (let k = 0; k < n; k++) {
      const col = fromEnd ? n - 1 - k : k;
      for (let y = 0, i = col * 4 + 3; y < rows; y++, i += n * 4) if (d[i] > threshold) return x0 + col;
    }
    return -1;
  };
  let left = -1;
  for (let x = 0; x < W && left < 0; x += STRIP) left = colHit(x, Math.min(STRIP, W - x), false);
  let right = -1;
  for (let x = W; x > left && right < 0; x -= STRIP) {
    const x0 = Math.max(left, x - STRIP);
    right = colHit(x0, x - x0, true);
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Separable box blur applied 3× (≈ gaussian) on a single channel buffer.
 * Operates in place on `buf` (width*height values).
 */
export function blurChannel(buf: Float32Array, width: number, height: number, radius: number): void {
  if (radius < 0.5) return;
  const r = Math.max(1, Math.round(radius / 1.7));
  const tmp = new Float32Array(buf.length);
  for (let pass = 0; pass < 3; pass++) {
    boxH(buf, tmp, width, height, r);
    boxV(tmp, buf, width, height, r);
  }
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r * 2 + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row];
    const last = src[row + w - 1];
    let acc = first * (r + 1);
    for (let i = 0; i < r; i++) acc += src[row + Math.min(i, w - 1)];
    for (let x = 0; x < w; x++) {
      const addIdx = x + r;
      const subIdx = x - r - 1;
      acc += addIdx < w ? src[row + addIdx] : last;
      acc -= subIdx >= 0 ? src[row + subIdx] : first;
      dst[row + x] = acc * inv;
    }
  }
}

// Row by row with one running sum per column: walking down columns of a wide image misses the CPU cache on
// nearly every read (a 40 MP blur took ~40 s that way)
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r * 2 + 1);
  const acc = new Float64Array(w);
  const lastRow = (h - 1) * w;
  for (let x = 0; x < w; x++) acc[x] = src[x] * (r + 1);
  for (let i = 0; i < r; i++) {
    const row = Math.min(i, h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const add = y + r < h ? (y + r) * w : lastRow;
    const sub = y - r - 1 >= 0 ? (y - r - 1) * w : 0;
    const out = y * w;
    for (let x = 0; x < w; x++) {
      acc[x] += src[add + x] - src[sub + x];
      dst[out + x] = acc[x] * inv;
    }
  }
}

/** Gaussian-ish blur of RGBA ImageData (premultiplies alpha so edges don't halo). */
export function blurImageData(img: ImageData, radius: number): void {
  const { width, height, data } = img;
  const n = width * height;
  const a = new Float32Array(n);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const al = data[i * 4 + 3] / 255;
    a[i] = al;
    ch[0][i] = data[i * 4] * al;
    ch[1][i] = data[i * 4 + 1] * al;
    ch[2][i] = data[i * 4 + 2] * al;
  }
  blurChannel(a, width, height, radius);
  for (const c of ch) blurChannel(c, width, height, radius);
  for (let i = 0; i < n; i++) {
    const al = a[i];
    data[i * 4 + 3] = al * 255;
    if (al > 1e-4) {
      data[i * 4] = ch[0][i] / al;
      data[i * 4 + 1] = ch[1][i] / al;
      data[i * 4 + 2] = ch[2][i] / al;
    }
  }
}

export async function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

export function imageToCanvas(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const w = (img as HTMLImageElement).naturalWidth || img.width;
  const h = (img as HTMLImageElement).naturalHeight || img.height;
  const c = createCanvas(w, h);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}
