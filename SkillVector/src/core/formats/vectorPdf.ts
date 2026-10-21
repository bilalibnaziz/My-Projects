// Vector PDF export. Shapes go out as real PDF paths: the renderer's own drawing calls (drawShape)
// run against a recording 2D context that turns paths, fills, strokes, clips and gradients into PDF
// operators, so every shape type, stroke alignment or width profile matches the screen. Text goes out
// as vector outlines (textOutlines.ts). What PDF cannot say natively — pixel layers, layer effects,
// masks, adjustment layers — is placed as a high-resolution image of just that area. One page per artboard.

import type { Doc, Layer } from '../types';
import { hasFx } from '../types';
import { DocRenderer, drawLayerVector, renderDocument } from '../render';
import { alphaBounds, createCanvas, ctx2d } from '../canvas';
import { deflate } from './pdf';
import { textToOutlines } from '../textOutlines';

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const n3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const pt = (p: [number, number]) => `${n3(p[0])} ${n3(p[1])}`;

// ---------------------------------------------------------------- colours

let colorCtx: CanvasRenderingContext2D | null = null;
/** Any CSS colour → [r, g, b, a] (0..1). */
export function parseColor(c: string): [number, number, number, number] {
  colorCtx ??= ctx2d(createCanvas(1, 1));
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = c;
  const v = String(colorCtx.fillStyle);
  if (v.startsWith('#')) {
    const n = parseInt(v.slice(1, 7), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) return [0, 0, 0, 1];
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1];
}

// ---------------------------------------------------------------- recording context

class Grad {
  stops: [number, string][] = [];
  constructor(
    readonly type: 'linear' | 'radial',
    readonly coords: number[],
  ) {}
  addColorStop(o: number, c: string) {
    this.stops.push([o, c]);
  }
}

export interface Shading {
  type: 'linear' | 'radial';
  coords: number[];
  stops: [number, [number, number, number]][];
}

interface St {
  m: M;
  fill: string | Grad;
  stroke: string | Grad;
  lw: number;
  join: string;
  cap: string;
  miter: number;
  dash: number[];
  dashOff: number;
  alpha: number;
  font: string;
}

/**
 * A stand-in CanvasRenderingContext2D that writes PDF operators. Anything it can't express sets
 * `bad`, and the caller falls back to an image of the layer.
 */
export class PdfRecorder {
  out: string[] = [];
  bad: string | null = null;
  shadings: Shading[] = [];
  alphas: number[] = [];
  readonly canvas = { width: 1, height: 1 };
  textAlign = 'left';
  textBaseline = 'alphabetic';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'high';
  private path: string[] = [];
  private cur: [number, number] | null = null;
  private start: [number, number] | null = null;
  private st: St = { m: [...ID] as M, fill: '#000000', stroke: '#000000', lw: 1, join: 'miter', cap: 'butt', miter: 10, dash: [], dashOff: 0, alpha: 1, font: '10px sans-serif' };
  private stack: St[] = [];

  // --- state
  set fillStyle(v: string | Grad) { this.st.fill = v; }
  get fillStyle() { return this.st.fill; }
  set strokeStyle(v: string | Grad) { this.st.stroke = v; }
  get strokeStyle() { return this.st.stroke; }
  set lineWidth(v: number) { this.st.lw = v; }
  get lineWidth() { return this.st.lw; }
  set lineJoin(v: string) { this.st.join = v; }
  get lineJoin() { return this.st.join; }
  set lineCap(v: string) { this.st.cap = v; }
  get lineCap() { return this.st.cap; }
  set miterLimit(v: number) { this.st.miter = v; }
  get miterLimit() { return this.st.miter; }
  set lineDashOffset(v: number) { this.st.dashOff = v; }
  get lineDashOffset() { return this.st.dashOff; }
  set globalAlpha(v: number) { this.st.alpha = v; }
  get globalAlpha() { return this.st.alpha; }
  set font(v: string) { this.st.font = v; }
  get font() { return this.st.font; }
  set globalCompositeOperation(v: string) { if (v !== 'source-over') this.bad ??= `composite ${v}`; }
  get globalCompositeOperation() { return 'source-over'; }
  set shadowBlur(v: number) { if (v > 0) this.bad ??= 'shadow'; }
  get shadowBlur() { return 0; }
  shadowColor = 'transparent';
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  set filter(v: string) { if (v && v !== 'none') this.bad ??= 'filter'; }
  get filter() { return 'none'; }
  setLineDash(a: number[]) { this.st.dash = [...a]; }
  getLineDash() { return [...this.st.dash]; }

  save() {
    this.stack.push({ ...this.st, dash: [...this.st.dash], m: [...this.st.m] as M });
    this.out.push('q');
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.st = s;
    this.out.push('Q');
  }

  // --- transforms (applied to the coordinates we write)
  transform(a: number, b: number, c: number, d: number, e: number, f: number) { this.st.m = mul(this.st.m, [a, b, c, d, e, f]); }
  setTransform(a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number) {
    if (typeof a === 'object') { const t = a as DOMMatrix; this.st.m = [t.a ?? 1, t.b ?? 0, t.c ?? 0, t.d ?? 1, t.e ?? 0, t.f ?? 0]; }
    else this.st.m = [a ?? 1, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0];
  }
  resetTransform() { this.st.m = [...ID] as M; }
  getTransform() { const m = this.st.m; return new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]); }
  translate(x: number, y: number) { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a: number) { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }

  // --- paths
  beginPath() { this.path = []; this.cur = this.start = null; }
  moveTo(x: number, y: number) {
    const p = ap(this.st.m, x, y);
    this.path.push(`${pt(p)} m`);
    this.cur = this.start = p;
  }
  lineTo(x: number, y: number) {
    if (!this.cur) return this.moveTo(x, y);
    const p = ap(this.st.m, x, y);
    this.path.push(`${pt(p)} l`);
    this.cur = p;
  }
  bezierCurveTo(ax: number, ay: number, bx: number, by: number, x: number, y: number) {
    if (!this.cur) this.moveTo(ax, ay);
    const p = ap(this.st.m, x, y);
    this.path.push(`${pt(ap(this.st.m, ax, ay))} ${pt(ap(this.st.m, bx, by))} ${pt(p)} c`);
    this.cur = p;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    if (!this.cur) this.moveTo(cx, cy);
    // Raise to a cubic, in user space
    const inv = this.st.m;
    const det = inv[0] * inv[3] - inv[1] * inv[2];
    const ux = ((this.cur![0] - inv[4]) * inv[3] - (this.cur![1] - inv[5]) * inv[2]) / det;
    const uy = (-(this.cur![0] - inv[4]) * inv[1] + (this.cur![1] - inv[5]) * inv[0]) / det;
    this.bezierCurveTo(ux + (2 / 3) * (cx - ux), uy + (2 / 3) * (cy - uy), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
  }
  closePath() {
    if (!this.path.length) return;
    this.path.push('h');
    this.cur = this.start;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  roundRect(x: number, y: number, w: number, h: number, radii?: number | number[] | DOMPointInit) {
    const r0 = Array.isArray(radii) ? Number(radii[0] ?? 0) : typeof radii === 'number' ? radii : 0;
    const r = Math.max(0, Math.min(r0, Math.abs(w) / 2, Math.abs(h) / 2));
    if (!r) return this.rect(x, y, w, h);
    const sx = Math.sign(w) || 1;
    const sy = Math.sign(h) || 1;
    const rx = r * sx;
    const ry = r * sy;
    const k = 0.5523;
    this.moveTo(x + rx, y);
    this.lineTo(x + w - rx, y);
    this.bezierCurveTo(x + w - rx + rx * k, y, x + w, y + ry - ry * k, x + w, y + ry);
    this.lineTo(x + w, y + h - ry);
    this.bezierCurveTo(x + w, y + h - ry + ry * k, x + w - rx + rx * k, y + h, x + w - rx, y + h);
    this.lineTo(x + rx, y + h);
    this.bezierCurveTo(x + rx - rx * k, y + h, x, y + h - ry + ry * k, x, y + h - ry);
    this.lineTo(x, y + ry);
    this.bezierCurveTo(x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y);
    this.closePath();
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
    if (ccw && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI - 1e-9) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (a: number): [number, number] => {
      const x = rx * Math.cos(a), y = ry * Math.sin(a);
      return [cx + x * cr - y * sr, cy + x * sr + y * cr];
    };
    const D = (a: number): [number, number] => {
      const x = -rx * Math.sin(a), y = ry * Math.cos(a);
      return [x * cr - y * sr, x * sr + y * cr];
    };
    const p0 = P(a0);
    if (this.cur) this.lineTo(p0[0], p0[1]);
    else this.moveTo(p0[0], p0[1]);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const da = sweep / n;
    const k = (4 / 3) * Math.tan(da / 4);
    for (let i = 0; i < n; i++) {
      const s = a0 + da * i, e = s + da;
      const ps = P(s), pe = P(e), ds = D(s), de = D(e);
      this.bezierCurveTo(ps[0] + ds[0] * k, ps[1] + ds[1] * k, pe[0] - de[0] * k, pe[1] - de[1] * k, pe[0], pe[1]);
    }
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  arcTo() { this.bad ??= 'arcTo'; }

  // --- painting
  private scaleOf() { const m = this.st.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }
  private alphaOp(a: number) {
    if (a >= 0.999) return '';
    let i = this.alphas.findIndex((x) => Math.abs(x - a) < 1e-4);
    if (i < 0) i = this.alphas.push(a) - 1;
    return `/GA${i} gs `;
  }
  /** Paint for fill or stroke: a colour operator, or null for a gradient (handled by the caller). */
  private paint(p: string | Grad, stroke: boolean): string | null {
    if (p instanceof Grad) return null;
    const [r, g, b, a] = parseColor(p);
    return `${this.alphaOp(a * this.st.alpha)}${n3(r)} ${n3(g)} ${n3(b)} ${stroke ? 'RG' : 'rg'}`;
  }
  private shading(g: Grad): number | null {
    if (g.stops.length < 1) return null;
    const stops = [...g.stops].sort((a, b) => a[0] - b[0]).map(([o, c]) => {
      const [r, gg, b, a] = parseColor(c);
      if (a < 0.999) this.bad ??= 'translucent gradient';
      return [Math.max(0, Math.min(1, o)), [r, gg, b]] as [number, [number, number, number]];
    });
    return this.shadings.push({ type: g.type, coords: g.coords, stops }) - 1;
  }
  fill(rule?: string | Path2D) {
    if (typeof rule === 'object') { this.bad ??= 'Path2D'; return; }
    if (!this.path.length) return;
    const op = rule === 'evenodd' ? 'f*' : 'f';
    const c = this.paint(this.st.fill, false);
    if (c !== null) {
      this.out.push(`q ${c} ${this.path.join(' ')} ${op} Q`);
      return;
    }
    const sh = this.shading(this.st.fill as Grad);
    if (sh === null) return;
    const m = this.st.m;
    this.out.push(`q ${this.alphaOp(this.st.alpha)}${this.path.join(' ')} ${rule === 'evenodd' ? 'W*' : 'W'} n ${m.map(n3).join(' ')} cm /SH${sh} sh Q`);
  }
  stroke(p?: Path2D) {
    if (p) { this.bad ??= 'Path2D'; return; }
    if (!this.path.length) return;
    const c = this.paint(this.st.stroke, true);
    if (c === null) { this.bad ??= 'gradient stroke'; return; }
    const k = this.scaleOf();
    const join = { miter: 0, round: 1, bevel: 2 }[this.st.join] ?? 0;
    const cap = { butt: 0, round: 1, square: 2 }[this.st.cap] ?? 0;
    const dash = this.st.dash.length ? `[${this.st.dash.map((d) => n3(d * k)).join(' ')}] ${n3(this.st.dashOff * k)} d ` : '';
    this.out.push(`q ${c} ${n3(this.st.lw * k)} w ${join} j ${cap} J ${n3(this.st.miter)} M ${dash}${this.path.join(' ')} S Q`);
  }
  clip(rule?: string | Path2D) {
    if (typeof rule === 'object') { this.bad ??= 'Path2D'; return; }
    if (!this.path.length) return;
    this.out.push(`${this.path.join(' ')} ${rule === 'evenodd' ? 'W*' : 'W'} n`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const keep = [this.path, this.cur, this.start] as const;
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    [this.path, this.cur, this.start] = [keep[0], keep[1], keep[2]];
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    const keep = [this.path, this.cur, this.start] as const;
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    [this.path, this.cur, this.start] = [keep[0], keep[1], keep[2]];
  }
  clearRect() { this.bad ??= 'clearRect'; }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number) { return new Grad('linear', [x0, y0, x1, y1]); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) { return new Grad('radial', [x0, y0, r0, x1, y1, r1]); }
  createConicGradient() { this.bad ??= 'conic gradient'; return new Grad('linear', [0, 0, 1, 0]); }
  createPattern() { this.bad ??= 'pattern'; return null; }
  fillText() { this.bad ??= 'text'; }
  strokeText() { this.bad ??= 'text'; }
  measureText(t: string) {
    colorCtx ??= ctx2d(createCanvas(1, 1));
    colorCtx.font = this.st.font;
    return colorCtx.measureText(t);
  }
  drawImage() { this.bad ??= 'image'; }
  putImageData() { this.bad ??= 'pixels'; }
  getImageData(): ImageData { this.bad ??= 'pixels'; return new ImageData(1, 1); }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }
}

// ---------------------------------------------------------------- document walk

const BLEND: Record<string, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight',
  difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};

interface Img {
  w: number;
  h: number;
  rgb: Uint8Array;
  alpha?: Uint8Array;
  /** Placement in document units. */
  x: number;
  y: number;
  dw: number;
  dh: number;
}

/** An element of the page in paint order. */
type Item = { kind: 'vector'; ops: string[]; shadings: Shading[]; alphas: number[]; opacity: number; blend: string } | { kind: 'image'; img: number; opacity: number; blend: string };

export interface VectorPdfStats {
  vectorLayers: number;
  imageLayers: number;
  /** Why layers became images (for the export summary). */
  reasons: Record<string, number>;
}

const childrenOf = (layers: Layer[], parent: string | undefined) => layers.filter((l) => (l.parent ?? undefined) === parent);
function descendants(layers: Layer[], id: string): Layer[] {
  const out: Layer[] = [];
  for (const c of childrenOf(layers, id)) out.push(c, ...(c.kind === 'group' ? descendants(layers, c.id) : []));
  return out;
}

/**
 * Builds a vector PDF. `dpi` sets the page size (document px per inch); `imageDpi` the resolution of
 * the parts that have to be images.
 */
export async function buildVectorPdf(doc: Doc, opts: { dpi?: number; imageDpi?: number; title?: string } = {}): Promise<{ bytes: Uint8Array; stats: VectorPdfStats }> {
  const dpi = opts.dpi ?? 72;
  const imageDpi = opts.imageDpi ?? 300;
  const stats: VectorPdfStats = { vectorLayers: 0, imageLayers: 0, reasons: {} };
  const images: Img[] = [];
  const items: Item[] = [];
  const reason = (r: string) => (stats.reasons[r] = (stats.reasons[r] ?? 0) + 1);

  /** Renders some layers (with their contents) as one image, cropped to what they draw. */
  const rasterize = (layers: Layer[], why: string, vectorish: boolean) => {
    const ids = new Set(layers.map((l) => l.id));
    const sub = doc.layers.filter((l) => ids.has(l.id));
    const subDoc: Doc = { ...doc, layers: sub.map((l) => (l.parent && !ids.has(l.parent) ? { ...l, parent: undefined } : l)) };
    const probe = createCanvas(doc.width, doc.height);
    renderDocument(subDoc, probe);
    const bb = alphaBounds(probe, 0);
    if (!bb) return;
    const pad = 1;
    const bx = Math.max(0, bb.x - pad), by = Math.max(0, bb.y - pad);
    const bw = Math.min(doc.width, bb.x + bb.width + pad) - bx, bh = Math.min(doc.height, bb.y + bb.height + pad) - by;
    // Vector art and text are re-rendered sharp at print resolution; plain pixels keep their own
    let s = vectorish ? Math.max(1, imageDpi / dpi) : 1;
    while (bw * s * bh * s > 40e6 && s > 1) s = Math.max(1, s / 1.5);
    const view = { s, ox: bx * s, oy: by * s, w: Math.max(1, Math.ceil(bw * s)), h: Math.max(1, Math.ceil(bh * s)) };
    const out = new DocRenderer().render(subDoc, undefined, view);
    const data = ctx2d(out).getImageData(0, 0, out.width, out.height).data;
    const n = out.width * out.height;
    const rgb = new Uint8Array(n * 3);
    const alpha = new Uint8Array(n);
    let opaque = true;
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3];
      alpha[i] = a;
      if (a < 255) opaque = false;
      // Unpremultiplied colour; fully transparent pixels take white so edges never fringe dark
      rgb[i * 3] = a ? data[i * 4] : 255;
      rgb[i * 3 + 1] = a ? data[i * 4 + 1] : 255;
      rgb[i * 3 + 2] = a ? data[i * 4 + 2] : 255;
    }
    images.push({ w: out.width, h: out.height, rgb, alpha: opaque ? undefined : alpha, x: bx, y: by, dw: out.width / s, dh: out.height / s });
    items.push({ kind: 'image', img: images.length - 1, opacity: 1, blend: 'Normal' });
    stats.imageLayers += layers.filter((l) => l.kind !== 'group').length || 1;
    reason(why);
  };

  const plain = (l: Layer) => !(l.mask && l.mask.enabled) && !hasFx(l) && !!BLEND[l.blend] && (l.fill ?? 1) >= 0.999;

  const emit = (list: Layer[]) => {
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      let j = i + 1;
      while (j < list.length && list[j].clip) j++;
      if (!l.visible) { i = j - 1; continue; }
      if (j > i + 1) {
        // Clipping stack: one image
        const stack = list.slice(i, j).filter((x) => x.visible);
        rasterize(stack.flatMap((x) => [x, ...(x.kind === 'group' ? descendants(doc.layers, x.id) : [])]), 'clipping mask', true);
        i = j - 1;
        continue;
      }
      if (l.kind === 'group') {
        const kids = childrenOf(doc.layers, l.id);
        if (plain(l) && l.opacity >= 0.999 && l.blend === 'normal' && !kids.some((k) => k.kind === 'adjustment')) emit(kids);
        else rasterize([l, ...descendants(doc.layers, l.id)], 'group opacity / blend / effects', true);
        continue;
      }
      if (l.kind === 'shape' && l.shape && plain(l)) {
        const rec = new PdfRecorder();
        drawLayerVector(rec as unknown as CanvasRenderingContext2D, l);
        if (!rec.bad) {
          items.push({ kind: 'vector', ops: rec.out, shadings: rec.shadings, alphas: rec.alphas, opacity: l.opacity, blend: BLEND[l.blend] });
          stats.vectorLayers++;
          continue;
        }
        rasterize([l], rec.bad, true);
        continue;
      }
      if (l.kind === 'adjustment') continue;
      if (l.kind === 'text' && l.text && plain(l)) {
        // Text goes out as its vector outlines (traced at high resolution: no fonts to embed)
        const parts = textToOutlines(doc, l);
        const recs = (parts ?? []).map((p) => {
          const rec = new PdfRecorder();
          drawLayerVector(rec as unknown as CanvasRenderingContext2D, p);
          return rec;
        });
        if (parts && recs.every((r) => !r.bad)) {
          recs.forEach((rec) => items.push({ kind: 'vector', ops: rec.out, shadings: rec.shadings, alphas: rec.alphas, opacity: l.opacity, blend: BLEND[l.blend] }));
          stats.vectorLayers++;
          continue;
        }
      }
      rasterize([l], l.kind === 'text' ? 'text' : l.kind === 'shape' ? 'effects / mask' : 'pixels', l.kind !== 'raster');
    }
  };

  const top = childrenOf(doc.layers, undefined);
  // Adjustment layers recolour everything under them: flatten up to the topmost one
  const lastAdj = top.map((l) => l.kind === 'adjustment').lastIndexOf(true);
  if (lastAdj >= 0) {
    const under = top.slice(0, lastAdj + 1);
    rasterize(under.flatMap((x) => [x, ...(x.kind === 'group' ? descendants(doc.layers, x.id) : [])]), 'adjustment layer', true);
  }
  emit(top.slice(lastAdj + 1));

  // ------------------------------------------------------------ write the file
  const pages = doc.artboards?.length ? doc.artboards.map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height })) : [{ x: 0, y: 0, w: doc.width, h: doc.height }];
  const u = 72 / dpi;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => {
    const x = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(x);
    pos += x.length;
  };
  let next = 3;
  const alloc = () => next++;
  const obj = (n: number, body: string | Uint8Array, stream?: Uint8Array) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
    push(body);
    if (stream) {
      push('\nstream\n');
      push(stream);
      push('\nendstream');
    }
    push('\nendobj\n');
  };

  // Images (shared by every page)
  const imgObj: number[] = [];
  for (const im of images) {
    const n = alloc();
    const data = await deflate(im.rgb);
    let smask = 0;
    if (im.alpha) {
      smask = alloc();
      const a = await deflate(im.alpha);
      obj(smask, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${a.length} >>`, a);
    }
    obj(n, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask ? ` /SMask ${smask} 0 R` : ''} /Length ${data.length} >>`, data);
    imgObj.push(n);
  }

  // Shadings and graphics states, named per item
  const shadingRes: string[] = [];
  const gsRes: string[] = [];
  const gsCache = new Map<string, string>();
  const gsName = (ca: number, bm: string) => {
    const key = `${n3(ca)}|${bm}`;
    let name = gsCache.get(key);
    if (!name) {
      const n = alloc();
      obj(n, `<< /Type /ExtGState /ca ${n3(ca)} /CA ${n3(ca)} /BM /${bm} >>`);
      name = `G${gsCache.size}`;
      gsCache.set(key, name);
      gsRes.push(`/${name} ${n} 0 R`);
    }
    return name;
  };
  const bodies: string[] = [];
  items.forEach((it, k) => {
    const wrap: string[] = ['q'];
    if (it.opacity < 0.999 || it.blend !== 'Normal') wrap.push(`/${gsName(it.opacity, it.blend)} gs`);
    if (it.kind === 'image') {
      const im = images[it.img];
      wrap.push(`${n3(im.dw)} 0 0 ${n3(-im.dh)} ${n3(im.x)} ${n3(im.y + im.dh)} cm /I${it.img} Do`);
    } else {
      // Per-item resource names: /GA<i> → this item's alpha states, /SH<i> → its shadings
      let ops = it.ops.join('\n');
      ops = ops.replace(/\/GA(\d+) gs/g, (_, i) => `/${gsName(it.alphas[+i], 'Normal')} gs`);
      ops = ops.replace(/\/SH(\d+) sh/g, (_, i) => {
        const s = it.shadings[+i];
        const n = alloc();
        const fn = shadingFunction(s.stops);
        const coords = s.type === 'linear' ? s.coords : s.coords;
        obj(n, `<< /ShadingType ${s.type === 'linear' ? 2 : 3} /ColorSpace /DeviceRGB /Coords [${coords.map(n3).join(' ')}] /Function ${fn} /Extend [true true] >>`);
        const name = `S${shadingRes.length}`;
        shadingRes.push(`/${name} ${n} 0 R`);
        return `/${name} sh`;
      });
      wrap.push(ops);
    }
    wrap.push('Q');
    bodies[k] = wrap.join('\n');
  });
  const content = bodies.join('\n');

  const pageObjs: number[] = [];
  for (const p of pages) {
    const pn = alloc();
    const cn = alloc();
    const W = p.w * u;
    const H = p.h * u;
    // Document space (y down, px) → page space (y up, points), cropped to the artboard
    const head = `${n3(u)} 0 0 ${n3(-u)} 0 ${n3(H)} cm 1 0 0 1 ${n3(-p.x)} ${n3(-p.y)} cm ${n3(p.x)} ${n3(p.y)} ${n3(p.w)} ${n3(p.h)} re W n`;
    const stream = await deflate(enc.encode(`q ${head}\n${content}\nQ`));
    obj(cn, `<< /Length ${stream.length} /Filter /FlateDecode >>`, stream);
    const res = `<< /XObject << ${imgObj.map((n, i) => `/I${i} ${n} 0 R`).join(' ')} >> /ExtGState << ${gsRes.join(' ')} >> /Shading << ${shadingRes.join(' ')} >> >>`;
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n3(W)} ${n3(H)}] /Resources ${res} /Contents ${cn} 0 R >>`);
    pageObjs.push(pn);
  }
  const head0 = enc.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  // Catalog and page tree go first in numbering but are written last; offsets are what matter
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageObjs.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjs.length} >>`);
  const info = alloc();
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  obj(info, `<< /Title (${esc(opts.title ?? doc.title)}) /Producer (Skill Vector) >>`);
  // Assemble: header first, so every recorded offset moves by its length
  const xref = pos + head0.length;
  let tail = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i++) tail += `${String((offsets[i] ?? 0) + head0.length).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${next} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const all = [head0, ...chunks, enc.encode(tail)];
  const total = all.reduce((a, c) => a + c.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of all) {
    bytes.set(c, o);
    o += c.length;
  }
  return { bytes, stats };
}

/** A PDF function mapping 0..1 to the gradient's colours (stitched for more than two stops). */
function shadingFunction(stops: Shading['stops']): string {
  const s = stops.length === 1 ? [stops[0], [1, stops[0][1]] as Shading['stops'][number]] : stops;
  const seg = (a: Shading['stops'][number], b: Shading['stops'][number]) => `<< /FunctionType 2 /Domain [0 1] /C0 [${a[1].map(n3).join(' ')}] /C1 [${b[1].map(n3).join(' ')}] /N 1 >>`;
  // Pad to 0 and 1 so the domain is covered
  const full = [...s];
  if (full[0][0] > 0) full.unshift([0, full[0][1]]);
  if (full[full.length - 1][0] < 1) full.push([1, full[full.length - 1][1]]);
  if (full.length === 2) return seg(full[0], full[1]);
  const fns: string[] = [];
  const bounds: number[] = [];
  for (let i = 0; i < full.length - 1; i++) {
    fns.push(seg(full[i], full[i + 1]));
    if (i > 0) bounds.push(full[i][0]);
  }
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${bounds.map(n3).join(' ')}] /Encode [${fns.map(() => '0 1').join(' ')}] >>`;
}
