import type { Rect } from './types';
import { cloneCanvas, createCanvas, ctx2d, intersectRect, pixelsLike, roundRectOut, scratch, unionRect } from './canvas';

export type BrushKind =
  | 'paint' // brush / pencil / mask paint
  | 'erase'
  | 'clone'
  | 'heal-mask' // spot healing: records where to heal
  | 'dodge'
  | 'burn'
  | 'sponge'
  | 'blur'
  | 'sharpen'
  | 'smudge'
  | 'bg-erase' // background eraser: erases pixels close to the sampled color
  | 'color-replace' // recolors pixels close to the sampled color, keeping their tone
  | 'history'; // paints back pixels from a history state

export interface BrushParams {
  kind: BrushKind;
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  /** Pulled-string stabilizer radius in document pixels (0 = paint exactly under the pointer). */
  smoothRadius: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  color: string;
  aliased: boolean; // pencil
  hide?: boolean; // mask painting with black
  lockAlpha?: boolean; // paint only where the layer already has pixels
  strength: number;
  exposure: number;
  range: 'shadows' | 'midtones' | 'highlights';
  spongeMode: 'saturate' | 'desaturate';
  /** Pixels to clone from: `canvas` sits at (x, y) in doc space; (dx, dy) = source − destination. */
  cloneSource?: { canvas: HTMLCanvasElement; x: number; y: number; dx: number; dy: number };
  /** Color match tolerance 0..255 (background eraser, color replacement). */
  tolerance?: number;
  sampling?: 'continuous' | 'once';
  /** Background eraser: pixels within tolerance of this color are never erased. */
  protect?: [number, number, number] | null;
  /** Color replacement: the new color and how it is applied. */
  replace?: { rgb: [number, number, number]; mode: 'color' | 'hue' | 'saturation' | 'luminosity' };
  /** History brush: RGBA of the source state, laid out exactly like the target canvas. */
  history?: Uint8ClampedArray;
}

// ------------------------------------------------------------ W3C non-separable blend math
// (Compositing and Blending Level 1, §10.2 — the definition Color/Hue/Saturation/Luminosity modes use)

type RGB = [number, number, number];
const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: RGB = [c[0], c[1], c[2]];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB;
  if (x > 255) out = out.map((v) => l + ((v - l) * (255 - l)) / (x - l)) as RGB;
  return out;
}
function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}
const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c: RGB, s: number): RGB {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [lo, mid, hi] = idx;
  const out: RGB = [0, 0, 0];
  if (c[hi] > c[lo]) {
    out[mid] = ((c[mid] - c[lo]) * s) / (c[hi] - c[lo]);
    out[hi] = s;
  }
  out[lo] = 0;
  return out;
}

/** Recolors `px` with `src` using a non-separable blend mode. Pure, tested. */
export function blendNonSeparable(px: RGB, src: RGB, mode: 'color' | 'hue' | 'saturation' | 'luminosity'): RGB {
  switch (mode) {
    case 'color':
      return setLum(src, lum(px));
    case 'hue':
      return setLum(setSat(src, sat(px)), lum(px));
    case 'saturation':
      return setLum(setSat(px, sat(src)), lum(px));
    case 'luminosity':
      return setLum(px, lum(src));
  }
}

/** 1 inside the tolerance, fading to 0 just past it (soft edge of a few levels). Pure, tested. */
export function colorMatch(r: number, g: number, b: number, ref: RGB, tolerance: number): number {
  const dist = Math.max(Math.abs(r - ref[0]), Math.abs(g - ref[1]), Math.abs(b - ref[2]));
  if (dist <= tolerance) return 1;
  const soft = Math.max(1, tolerance * 0.15);
  return dist >= tolerance + soft ? 0 : 1 - (dist - tolerance) / soft;
}

export interface StrokeTarget {
  canvas: HTMLCanvasElement;
  ox: number; // target canvas origin in document space
  oy: number;
}

// ------------------------------------------------------------ brush tips

const tipCache = new Map<string, HTMLCanvasElement>();

/** Alpha falloff for normalized distance d (0 center .. 1 edge). Pure, tested. */
export function tipAlpha(d: number, hardness: number): number {
  if (d >= 1) return 0;
  const h = Math.min(0.99, Math.max(0, hardness));
  if (d <= h) return 1;
  const t = (d - h) / (1 - h);
  return (1 - t) * (1 - t) * (1 + 2 * t); // 1 - smoothstep(t)
}

function makeTip(diameter: number, hardness: number, color: string, aliased: boolean): HTMLCanvasElement {
  const d = Math.max(1, Math.ceil(diameter));
  const key = `${d}|${aliased ? 1 : Math.round(hardness * 100)}|${color}|${aliased}`;
  const hit = tipCache.get(key);
  if (hit) return hit;
  if (tipCache.size > 96) tipCache.clear();
  const size = d + 2;
  const c = createCanvas(size, size);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(size, size);
  const r = diameter / 2;
  const cx = size / 2;
  const hex = color.replace('#', '');
  const cr = parseInt(hex.slice(0, 2), 16);
  const cg = parseInt(hex.slice(2, 4), 16);
  const cb = parseInt(hex.slice(4, 6), 16);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cx) / Math.max(0.5, r);
      const a = aliased ? (dist <= 1 ? 1 : 0) : tipAlpha(dist, hardness);
      const i = (y * size + x) * 4;
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tipCache.set(key, c);
  return c;
}

// ------------------------------------------------------------ stabilizer

/**
 * Pulled-string stabilizer. The paint point trails the pointer on a string of length
 * `radius` and only moves once the pointer pulls it taut, which is independent of the
 * input event rate (unlike per-event easing). `release` closes the gap so strokes always
 * end exactly where the pointer was let go.
 */
export class Stabilizer {
  anchor: { x: number; y: number } | null = null;
  private raw: { x: number; y: number } | null = null;
  constructor(readonly radius: number) {}

  /** Feeds a pointer position; returns true when the paint point moved. */
  push(x: number, y: number): boolean {
    this.raw = { x, y };
    if (!this.anchor || this.radius <= 0) {
      this.anchor = { x, y };
      return true;
    }
    const dx = x - this.anchor.x;
    const dy = y - this.anchor.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.radius) return false;
    const k = (d - this.radius) / d;
    this.anchor = { x: this.anchor.x + dx * k, y: this.anchor.y + dy * k };
    return true;
  }

  /** Snaps the paint point onto the last pointer position; returns true if it moved. */
  release(): boolean {
    if (!this.raw || !this.anchor || (this.raw.x === this.anchor.x && this.raw.y === this.anchor.y)) return false;
    this.anchor = { ...this.raw };
    return true;
  }
}

// ------------------------------------------------------------ stroke

export class Stroke {
  private base: HTMLCanvasElement;
  private buf: HTMLCanvasElement | null = null;
  private dirty: Rect | null = null;
  private last: { x: number; y: number; p: number } | null = null;
  private stabilizer: Stabilizer;
  private lastPressure = 1;
  private residual = 0;
  private selAlpha: Uint8ClampedArray | null = null;
  private carry: ImageData | null = null;
  private sampled: RGB | null = null;
  /** Sharpen works from the pixels as they were when the stroke began, scaled by brush coverage. */
  private sharpenBase: Uint8ClampedArray | null = null;
  private coverage: Float32Array | null = null;
  readonly touched: { r: Rect | null } = { r: null };

  constructor(
    readonly p: BrushParams,
    readonly target: StrokeTarget,
    readonly selection: HTMLCanvasElement | null,
    readonly docW: number,
    readonly docH: number
  ) {
    this.stabilizer = new Stabilizer(p.smoothRadius);
    this.base = cloneCanvas(target.canvas);
    if (this.usesBuffer) this.buf = createCanvas(target.canvas.width, target.canvas.height);
    if (selection && !this.usesBuffer) {
      this.selAlpha = ctx2d(selection).getImageData(0, 0, selection.width, selection.height).data;
    }
  }

  private get usesBuffer() {
    const k = this.p.kind;
    return k === 'paint' || k === 'erase' || k === 'clone' || k === 'heal-mask';
  }

  /** Untouched pixels from before the stroke. */
  get original() {
    return this.base;
  }

  get mask() {
    return this.buf;
  }

  /** Where paint is currently being laid down (lags the pointer only while stabilizing). */
  get anchor(): { x: number; y: number } | null {
    return this.stabilizer.anchor;
  }

  /**
   * Adds an input point in document coordinates. Returns true if pixels changed.
   * With a stabilizer radius the paint point trails the pointer on a "string" of that
   * length: it only moves once the pointer pulls the string taut. This is independent of
   * the input event rate, unlike per-event easing.
   */
  add(x: number, y: number, pressure = 1): boolean {
    this.lastPressure = pressure;
    return this.stabilizer.push(x, y) ? this.lay(pressure) : false;
  }

  /** Adds the pointer-up position, keeping the last real pressure (pens report 0 on lift-off). */
  release(x: number, y: number) {
    this.add(x, y, this.lastPressure);
  }

  /** Ends the stroke exactly at the last pointer position, closing any stabilizer gap. */
  finish() {
    if (this.stabilizer.release()) this.lay(this.lastPressure);
    this.flush();
  }

  private lay(pressure: number): boolean {
    const a = this.stabilizer.anchor!;
    const pt = { x: a.x - this.target.ox, y: a.y - this.target.oy, p: pressure };
    if (!this.last) {
      this.dab(pt.x, pt.y, pt.p);
      this.last = pt;
      this.flush();
      return true;
    }
    const dx = pt.x - this.last.x;
    const dy = pt.y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const diameter = this.p.size * (this.p.pressureSize ? Math.max(0.05, pt.p) : 1);
    const step = Math.max(this.p.kind === 'smudge' ? 1 : 0.6, diameter * Math.max(0.02, this.p.spacing));
    let t = step - this.residual;
    let any = false;
    while (t <= dist) {
      const f = t / dist;
      this.dab(this.last.x + dx * f, this.last.y + dy * f, this.last.p + (pt.p - this.last.p) * f);
      t += step;
      any = true;
    }
    this.residual = dist - (t - step);
    this.last = pt;
    if (any) this.flush();
    return any;
  }

  private markDirty(r: Rect) {
    const clipped = intersectRect(roundRectOut(r), { x: 0, y: 0, width: this.target.canvas.width, height: this.target.canvas.height });
    if (!clipped) return null;
    this.dirty = unionRect(this.dirty, clipped);
    this.touched.r = unionRect(this.touched.r, clipped);
    return clipped;
  }

  private dab(x: number, y: number, pressure: number) {
    const p = this.p;
    const diameter = Math.max(1, p.size * (p.pressureSize ? Math.max(0.05, pressure) : 1));
    const r = diameter / 2;
    const alpha = p.flow * (p.pressureOpacity ? pressure : 1);
    const rect = this.markDirty({ x: x - r - 1, y: y - r - 1, width: diameter + 2, height: diameter + 2 });
    if (!rect) return;

    if (this.buf) {
      const bctx = ctx2d(this.buf);
      if (p.kind === 'clone' && p.cloneSource) {
        const src = p.cloneSource;
        const tip = makeTip(diameter, p.hardness, '#000000', false);
        const patch = scratch('clonePatch', tip.width, tip.height);
        const pctx = ctx2d(patch);
        const tx = Math.round(x - tip.width / 2);
        const ty = Math.round(y - tip.height / 2);
        // Doc position of this dab, shifted by the clone offset
        pctx.drawImage(src.canvas, src.x - (tx + this.target.ox + src.dx), src.y - (ty + this.target.oy + src.dy));
        pctx.globalCompositeOperation = 'destination-in';
        pctx.drawImage(tip, 0, 0);
        bctx.globalAlpha = alpha;
        bctx.drawImage(patch, tx, ty);
        bctx.globalAlpha = 1;
        return;
      }
      const tip = makeTip(diameter, p.hardness, p.kind === 'paint' ? p.color : '#ffffff', p.aliased);
      bctx.globalAlpha = alpha;
      const tx = p.aliased ? Math.round(x - tip.width / 2) : x - tip.width / 2;
      const ty = p.aliased ? Math.round(y - tip.height / 2) : y - tip.height / 2;
      // Max-blend approximation: drawing with source-over at flow builds up within opacity ceiling
      bctx.drawImage(tip, tx, ty);
      bctx.globalAlpha = 1;
      return;
    }
    this.retouchDab(x, y, r, rect);
  }

  /** Per-pixel retouching dabs operating directly on the target. */
  private retouchDab(x: number, y: number, r: number, rect: Rect) {
    const p = this.p;
    const ctx = ctx2d(this.target.canvas);
    const pad = p.kind === 'blur' || p.kind === 'sharpen' ? 1 : 0;
    const ex = intersectRect(
      { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 },
      { x: 0, y: 0, width: this.target.canvas.width, height: this.target.canvas.height }
    );
    if (!ex) return;
    const img = ctx.getImageData(ex.x, ex.y, ex.width, ex.height);
    const d = img.data;
    const src = p.kind === 'blur' || p.kind === 'sharpen' ? new Uint8ClampedArray(d) : d;
    const W = ex.width;
    const strength =
      p.kind === 'dodge' || p.kind === 'burn'
        ? p.exposure * 0.12
        : p.kind === 'bg-erase'
          ? 1
          : p.kind === 'color-replace' || p.kind === 'history'
            ? p.opacity * p.flow
            : p.strength;

    // Background eraser / color replacement compare pixels to the color under the brush centre
    let ref: RGB | null = null;
    if (p.kind === 'bg-erase' || p.kind === 'color-replace') {
      if (!this.sampled || p.sampling !== 'once') {
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        if (cx >= 0 && cy >= 0 && cx < this.base.width && cy < this.base.height) {
          const c = ctx2d(this.base).getImageData(cx, cy, 1, 1).data;
          // Sampling a transparent spot leaves the previous sample in place
          if (c[3] > 0) this.sampled = [c[0], c[1], c[2]];
        }
      }
      ref = this.sampled;
      if (!ref) return;
    }
    const tol = p.tolerance ?? 32;
    const TW = this.target.canvas.width;

    if (p.kind === 'smudge' && !this.carry) {
      this.carry = pixelsLike(this.target.canvas, new Uint8ClampedArray(d), ex.width, ex.height);
    }

    for (let py = 0; py < ex.height; py++) {
      for (let px = 0; px < ex.width; px++) {
        const gx = ex.x + px;
        const gy = ex.y + py;
        const dist = Math.hypot(gx + 0.5 - x, gy + 0.5 - y) / r;
        if (dist >= 1) continue;
        let w = tipAlpha(dist, p.hardness) * strength;
        if (this.selAlpha) {
          const sx = gx + this.target.ox;
          const sy = gy + this.target.oy;
          if (sx < 0 || sy < 0 || sx >= this.docW || sy >= this.docH) continue;
          w *= this.selAlpha[(sy * this.docW + sx) * 4 + 3] / 255;
        }
        if (w <= 0) continue;
        const i = (py * W + px) * 4;
        let R = d[i], G = d[i + 1], B = d[i + 2];
        switch (p.kind) {
          case 'bg-erase': {
            if (!d[i + 3]) continue;
            if (p.protect && colorMatch(R, G, B, p.protect, tol) > 0) continue;
            const m = colorMatch(R, G, B, ref!, tol);
            if (m > 0) d[i + 3] = Math.round(d[i + 3] * (1 - w * m));
            continue;
          }
          case 'color-replace': {
            if (!d[i + 3]) continue;
            const m = colorMatch(R, G, B, ref!, tol) * w;
            if (m <= 0) continue;
            const out = blendNonSeparable([R, G, B], p.replace!.rgb, p.replace!.mode);
            R += (out[0] - R) * m;
            G += (out[1] - G) * m;
            B += (out[2] - B) * m;
            break;
          }
          case 'history': {
            // Blend toward the source in premultiplied space so transparency restores cleanly
            const h = p.history!;
            const j = (gy * TW + gx) * 4;
            const a0 = d[i + 3] / 255;
            const a1 = h[j + 3] / 255;
            const a = a0 + (a1 - a0) * w;
            if (a <= 0) {
              d[i + 3] = 0;
              continue;
            }
            R = (R * a0 + (h[j] * a1 - R * a0) * w) / a;
            G = (G * a0 + (h[j + 1] * a1 - G * a0) * w) / a;
            B = (B * a0 + (h[j + 2] * a1 - B * a0) * w) / a;
            d[i + 3] = Math.round(a * 255);
            break;
          }
          case 'dodge':
          case 'burn': {
            const L = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
            const rw = p.range === 'shadows' ? (1 - L) * (1 - L) : p.range === 'highlights' ? L * L : 1 - (2 * L - 1) * (2 * L - 1);
            const k = w * Math.max(0.05, rw);
            if (p.kind === 'dodge') {
              R += (255 - R) * k;
              G += (255 - G) * k;
              B += (255 - B) * k;
            } else {
              R *= 1 - k;
              G *= 1 - k;
              B *= 1 - k;
            }
            break;
          }
          case 'sponge': {
            const L = 0.299 * R + 0.587 * G + 0.114 * B;
            const k = w * 0.15 * (p.spongeMode === 'saturate' ? -1 : 1);
            R += (L - R) * k;
            G += (L - G) * k;
            B += (L - B) * k;
            break;
          }
          case 'blur': {
            if (px === 0 || py === 0 || px === ex.width - 1 || py === ex.height - 1) continue;
            if (!d[i + 3]) continue;
            // Neighbours count by their alpha: transparent pixels are not black
            let sr = 0, sg = 0, sb = 0, sa = 0;
            for (let ky = -1; ky <= 1; ky++)
              for (let kx = -1; kx <= 1; kx++) {
                const j = ((py + ky) * W + px + kx) * 4;
                const a = src[j + 3];
                sr += src[j] * a;
                sg += src[j + 1] * a;
                sb += src[j + 2] * a;
                sa += a;
              }
            if (!sa) continue;
            const k = w * 0.5;
            R += (sr / sa - R) * k;
            G += (sg / sa - G) * k;
            B += (sb / sa - B) * k;
            break;
          }
          case 'sharpen': {
            // Unsharp mask of the stroke's starting pixels, by the most coverage this stroke has
            // given the pixel: dabs overlapping inside one stroke don't compound (each new stroke adds)
            const TH = this.target.canvas.height;
            if (!this.sharpenBase) {
              this.sharpenBase = ctx2d(this.base).getImageData(0, 0, TW, TH).data;
              this.coverage = new Float32Array(TW * TH);
            }
            const o = this.sharpenBase;
            const gi = gy * TW + gx;
            if (!o[gi * 4 + 3] || gx === 0 || gy === 0 || gx === TW - 1 || gy === TH - 1) continue;
            const cov = Math.max(this.coverage![gi], w);
            this.coverage![gi] = cov;
            let sr = 0, sg = 0, sb = 0, sa = 0;
            for (let ky = -1; ky <= 1; ky++)
              for (let kx = -1; kx <= 1; kx++) {
                const j = ((gy + ky) * TW + gx + kx) * 4;
                const a = o[j + 3];
                sr += o[j] * a;
                sg += o[j + 1] * a;
                sb += o[j + 2] * a;
                sa += a;
              }
            const j0 = gi * 4;
            const k = cov * 1.2;
            R = o[j0] + (o[j0] - sr / sa) * k;
            G = o[j0 + 1] + (o[j0 + 1] - sg / sa) * k;
            B = o[j0 + 2] + (o[j0 + 2] - sb / sa) * k;
            break;
          }
          case 'smudge': {
            // The previous dab's pixels at the same place in its box. Boxes differ by a pixel as the
            // pointer moves between pixels; requiring equal sizes skipped most dabs (nothing smeared)
            const c = this.carry!;
            const j = (Math.min(c.height - 1, py) * c.width + Math.min(c.width - 1, px)) * 4;
            const k = w * 0.9;
            R += (c.data[j] - R) * k;
            G += (c.data[j + 1] - G) * k;
            B += (c.data[j + 2] - B) * k;
            d[i + 3] += (c.data[j + 3] - d[i + 3]) * k;
            break;
          }
        }
        d[i] = R;
        d[i + 1] = G;
        d[i + 2] = B;
      }
    }
    if (p.kind === 'smudge') {
      // Pick up the smeared result for the next dab
      this.carry = pixelsLike(this.target.canvas, new Uint8ClampedArray(d), ex.width, ex.height);
    }
    ctx.putImageData(img, ex.x, ex.y);
  }

  /** Recomposites the dirty region: base + stroke buffer × opacity, clipped to selection. */
  flush() {
    const r = this.dirty;
    this.dirty = null;
    if (!r || !this.buf) return;
    const p = this.p;
    const tctx = ctx2d(this.target.canvas);
    tctx.save();
    tctx.clearRect(r.x, r.y, r.width, r.height);
    tctx.drawImage(this.base, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    const tmp = scratch('strokeTmp', r.width, r.height);
    const t = ctx2d(tmp);
    t.drawImage(this.buf, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
    if (this.selection) {
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(this.selection, -(r.x + this.target.ox), -(r.y + this.target.oy));
    }
    if (p.kind === 'heal-mask') {
      // Preview: tint the area to be healed
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = 'rgba(255, 70, 120, 1)';
      t.fillRect(0, 0, r.width, r.height);
      tctx.globalAlpha = 0.45;
    } else {
      tctx.globalAlpha = p.opacity;
    }
    tctx.globalCompositeOperation = p.kind === 'erase' || p.hide ? 'destination-out' : p.lockAlpha ? 'source-atop' : 'source-over';
    tctx.drawImage(tmp, r.x, r.y);
    tctx.restore();
  }

  /** Restores the target to its pre-stroke pixels. */
  restoreOriginal() {
    const ctx = ctx2d(this.target.canvas);
    ctx.clearRect(0, 0, this.target.canvas.width, this.target.canvas.height);
    ctx.drawImage(this.base, 0, 0);
  }
}
