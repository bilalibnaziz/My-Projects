import type { Rect } from './types';

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
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
}

export function scratch(key: string, width: number, height: number): HTMLCanvasElement {
  let c = scratchPool.get(key);
  if (!c) {
    c = createCanvas(width, height);
    scratchPool.set(key, c);
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

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r * 2 + 1);
  for (let x = 0; x < w; x++) {
    const first = src[x];
    const last = src[(h - 1) * w + x];
    let acc = first * (r + 1);
    for (let i = 0; i < r; i++) acc += src[Math.min(i, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      const addIdx = y + r;
      const subIdx = y - r - 1;
      acc += addIdx < h ? src[addIdx * w + x] : last;
      acc -= subIdx >= 0 ? src[subIdx * w + x] : first;
      dst[y * w + x] = acc * inv;
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
