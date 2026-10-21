import type { Rect, Selection } from './types';
import { alphaBounds, blurChannel, createCanvas, ctx2d } from './canvas';

export type SelOp = 'replace' | 'add' | 'subtract' | 'intersect';

export function selectionFromCanvas(canvas: HTMLCanvasElement): Selection | null {
  const bounds = alphaBounds(canvas, 0);
  return bounds ? { canvas, bounds } : null;
}

/** Builds a doc-sized selection canvas by running `draw` with a white fill style. */
export function drawSelection(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff';
  draw(ctx);
  return c;
}

export function combine(prev: Selection | null, next: HTMLCanvasElement, op: SelOp): Selection | null {
  if (op === 'replace' || !prev) {
    return op === 'subtract' || (op === 'intersect' && !prev) ? null : selectionFromCanvas(next);
  }
  const c = createCanvas(next.width, next.height);
  const ctx = ctx2d(c);
  ctx.drawImage(prev.canvas, 0, 0);
  ctx.globalCompositeOperation =
    op === 'add' ? 'source-over' : op === 'subtract' ? 'destination-out' : 'destination-in';
  ctx.drawImage(next, 0, 0);
  return selectionFromCanvas(c);
}

export function selectAll(w: number, h: number): Selection {
  const c = drawSelection(w, h, (ctx) => ctx.fillRect(0, 0, w, h));
  return { canvas: c, bounds: { x: 0, y: 0, width: w, height: h } };
}

export function invert(sel: Selection | null, w: number, h: number): Selection | null {
  if (!sel) return selectAll(w, h);
  const c = drawSelection(w, h, (ctx) => {
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(sel.canvas, 0, 0);
  });
  return selectionFromCanvas(c);
}

function mapAlpha(sel: Selection, fn: (a: Float32Array, w: number, h: number) => void): Selection | null {
  const { width: w, height: h } = sel.canvas;
  const src = ctx2d(sel.canvas).getImageData(0, 0, w, h);
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = src.data[i * 4 + 3];
  fn(a, w, h);
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < a.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = a[i];
  }
  ctx.putImageData(out, 0, 0);
  return selectionFromCanvas(c);
}

export function feather(sel: Selection, radius: number): Selection | null {
  if (radius <= 0) return sel;
  return mapAlpha(sel, (a, w, h) => blurChannel(a, w, h, radius));
}

/** Expand (px > 0) or contract (px < 0) using blur + threshold (a cheap round morphology). */
export function grow(sel: Selection, px: number): Selection | null {
  if (px === 0) return sel;
  const r = Math.abs(px);
  return mapAlpha(sel, (a, w, h) => {
    for (let i = 0; i < a.length; i++) a[i] = a[i] >= 128 ? 255 : 0;
    blurChannel(a, w, h, r);
    const t = px > 0 ? 255 * 0.08 : 255 * 0.92;
    for (let i = 0; i < a.length; i++) a[i] = a[i] > t ? 255 : 0;
  });
}

/** Smooth jagged edges (blur then re-threshold). */
export function smooth(sel: Selection, radius: number): Selection | null {
  return mapAlpha(sel, (a, w, h) => {
    blurChannel(a, w, h, radius);
    for (let i = 0; i < a.length; i++) a[i] = a[i] >= 128 ? 255 : 0;
  });
}

/**
 * Magic-wand / color-range flood fill over RGBA pixels.
 * Returns a mask with 255 for selected pixels. Pure function (unit tested).
 */
export function floodMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean
): Uint8Array {
  const mask = new Uint8Array(w * h);
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const s = (sy * w + sx) * 4;
  const r0 = data[s], g0 = data[s + 1], b0 = data[s + 2], a0 = data[s + 3];
  const match = (p: number) => {
    const i = p * 4;
    return (
      Math.abs(data[i] - r0) <= tolerance &&
      Math.abs(data[i + 1] - g0) <= tolerance &&
      Math.abs(data[i + 2] - b0) <= tolerance &&
      Math.abs(data[i + 3] - a0) <= tolerance
    );
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p)) mask[p] = 255;
    return mask;
  }
  // Scanline flood fill
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let p = y * w + x;
    while (x >= 0 && !mask[p] && match(p)) {
      x--;
      p--;
    }
    x++;
    p++;
    let up = false;
    let down = false;
    while (x < w && !mask[p] && match(p)) {
      mask[p] = 255;
      if (y > 0) {
        const q = p - w;
        if (!mask[q] && match(q)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < h - 1) {
        const q = p + w;
        if (!mask[q] && match(q)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
      p++;
    }
  }
  return mask;
}

export function maskToCanvas(mask: Uint8Array, w: number, h: number, ox = 0, oy = 0, docW = w, docH = h): HTMLCanvasElement {
  const tmp = createCanvas(w, h);
  const ctx = ctx2d(tmp);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = mask[i];
  }
  ctx.putImageData(img, 0, 0);
  if (ox === 0 && oy === 0 && docW === w && docH === h) return tmp;
  const c = createCanvas(docW, docH);
  ctx2d(c).drawImage(tmp, ox, oy);
  return c;
}

/**
 * Builds the marching-ants outline as a Path2D in document coordinates.
 * Large selections are traced on a downsampled copy to keep it interactive.
 */
export function outlinePath(sel: Selection): Path2D {
  const { width: W, height: H } = sel.canvas;
  const scale = Math.min(1, 1400 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const small = createCanvas(w, h);
  const sctx = ctx2d(small);
  sctx.imageSmoothingEnabled = scale < 1;
  sctx.drawImage(sel.canvas, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 128;
  const path = new Path2D();
  const k = 1 / scale;
  // Horizontal edges: between row y-1 and y
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && inside(x, y - 1) !== inside(x, y);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) {
        path.moveTo(start * k, y * k);
        path.lineTo(x * k, y * k);
        start = -1;
      }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && inside(x - 1, y) !== inside(x, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) {
        path.moveTo(x * k, start * k);
        path.lineTo(x * k, y * k);
        start = -1;
      }
    }
  }
  return path;
}

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }, square = false, fromCenter = false): Rect {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (square) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  if (fromCenter) return { x: a.x - Math.abs(w), y: a.y - Math.abs(h), width: Math.abs(w) * 2, height: Math.abs(h) * 2 };
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), width: Math.abs(w), height: Math.abs(h) };
}
