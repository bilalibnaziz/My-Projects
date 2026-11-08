import type { Doc, Layer, PathAnchor, ShapeProps, TextProps } from './types';
import { hasFx, shownText } from './types';
import { styledSurface } from './effects';
import { compositeCustom, isCustomBlend } from './blend';
import { warpText } from './warp';
import { drawLayout, layoutText } from './text';
import type { BlendMode } from './types';
import { createCanvas, ctx2d, rev, scratch, touch, spaceOf, pixelsLike } from './canvas';
import { filletedRings, hasPathCorners, liveShapePath } from './shapeGeometry';
import { flattenAnchors, maxWidth, variableStrokeOutline } from './strokeProfile';
import { getAdjustEngine, isIdentityAdjust } from './gl';

export interface Surface {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  /** Canvas pixels per document unit (default 1). Hi-res view renders draw vectors at the zoom. */
  d?: number;
}

/**
 * Where a render lands: target pixel = document point × s − (ox, oy), in a w × h target.
 * The identity view (s 1, no offset, document size) is the classic document-resolution render.
 */
export interface RenderView {
  s: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Pixel layers drawn at least this many times their size show hard pixels (default 8). */
  nearestFrom?: number;
}

const viewSig = (v: RenderView) => `@${v.s},${v.ox},${v.oy},${v.w}x${v.h}`;

/** Temporary pixel replacements used by live previews (transform, filters). */
export type Overrides = Map<string, Surface>;

// ---------------------------------------------------------------- text & shapes

const measureCtx = () => ctx2d(scratch('measure', 4, 4));

export function fontString(t: TextProps): string {
  return `${t.italic ? 'italic ' : ''}${t.weight} ${t.size}px ${JSON.stringify(t.font)}, system-ui, sans-serif`;
}

export function measureText(t: TextProps): { width: number; height: number; lines: { text: string; width: number }[] } {
  const L = layoutText(t);
  return { width: L.width, height: L.height, lines: L.lines.map((l) => ({ text: l.segments.map((s) => s.text).join(''), width: l.width })) };
}

function drawText(ctx: CanvasRenderingContext2D, t: TextProps, ox: number, oy: number) {
  drawLayout(ctx, t, layoutText(t), ox, oy);
}

export function shapePath(ctx: CanvasRenderingContext2D, s: ShapeProps, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  // Per-corner radii, corner styles, rounded points, pies, donuts and spirals (shapeGeometry.ts)
  if (liveShapePath(ctx, s, x, y, w, h)) return;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (s.shape) {
    case 'rectangle':
      if (s.radius > 0) ctx.roundRect(x, y, w, h, Math.min(s.radius, Math.abs(w) / 2, Math.abs(h) / 2));
      else ctx.rect(x, y, w, h);
      break;
    case 'ellipse':
      ctx.ellipse(cx, cy, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(cx, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    case 'path': {
      if (hasPathCorners(s)) {
        // Live corners: the filleted outline, in document px
        const closed = s.compoundPoints?.length ? true : !!s.closed;
        for (const ring of filletedRings(s, x, y, w, h)) {
          ring.forEach((a, i) => {
            if (i === 0) return ctx.moveTo(a.x, a.y);
            const p = ring[i - 1];
            ctx.bezierCurveTo(p.ox, p.oy, a.ix, a.iy, a.x, a.y);
          });
          if (closed && ring.length > 1) {
            const l = ring[ring.length - 1];
            const f = ring[0];
            ctx.bezierCurveTo(l.ox, l.oy, f.ix, f.iy, f.x, f.y);
            ctx.closePath();
          }
        }
        break;
      }
      // Normalised anchors scale with the layer box
      const drawSubPath = (pts: PathAnchor[], closed: boolean) => {
        const X = (v: number) => x + v * w;
        const Y = (v: number) => y + v * h;
        pts.forEach((a, i) => {
          if (i === 0) return ctx.moveTo(X(a.x), Y(a.y));
          const p = pts[i - 1];
          ctx.bezierCurveTo(X(p.ox), Y(p.oy), X(a.ix), Y(a.iy), X(a.x), Y(a.y));
        });
        if (closed && pts.length > 1) {
          const l = pts[pts.length - 1];
          const f = pts[0];
          ctx.bezierCurveTo(X(l.ox), Y(l.oy), X(f.ix), Y(f.iy), X(f.x), Y(f.y));
          ctx.closePath();
        }
      };

      if (s.compoundPoints && s.compoundPoints.length > 0) {
        for (const sub of s.compoundPoints) drawSubPath(sub, true);
      } else if (s.points && s.points.length > 0) {
        drawSubPath(s.points, !!s.closed);
      }
      break;
    }
    case 'polygon':
    case 'star': {
      const n = Math.max(3, s.sides ?? (s.shape === 'star' ? 5 : 6));
      const total = s.shape === 'star' ? n * 2 : n;
      for (let i = 0; i < total; i++) {
        const a = (i * 2 * Math.PI) / total - Math.PI / 2;
        const r = s.shape === 'star' && i % 2 === 1 ? 0.45 : 1;
        const px = cx + (Math.abs(w) / 2) * r * Math.cos(a);
        const py = cy + (Math.abs(h) / 2) * r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'line':
    case 'arrow': {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      if (s.shape === 'arrow' || s.arrowEnd) {
        const ang = Math.atan2(h, w);
        const head = Math.max(10, s.strokeWidth * 4);
        ctx.moveTo(x + w, y + h);
        ctx.lineTo(x + w - head * Math.cos(ang - 0.45), y + h - head * Math.sin(ang - 0.45));
        ctx.moveTo(x + w, y + h);
        ctx.lineTo(x + w - head * Math.cos(ang + 0.45), y + h - head * Math.sin(ang + 0.45));
      }
      if (s.arrowStart) {
        const ang = Math.atan2(-h, -w);
        const head = Math.max(10, s.strokeWidth * 4);
        ctx.moveTo(x, y);
        ctx.lineTo(x - head * Math.cos(ang - 0.45), y - head * Math.sin(ang - 0.45));
        ctx.moveTo(x, y);
        ctx.lineTo(x - head * Math.cos(ang + 0.45), y - head * Math.sin(ang + 0.45));
      }
      break;
    }
    case 'round-rect':
      ctx.roundRect(x, y, w, h, Math.min(s.radius || 16, Math.abs(w) / 2, Math.abs(h) / 2));
      break;
    case 'arc':
      ctx.moveTo(x, y + h);
      ctx.quadraticCurveTo(x, y, x + w, y);
      break;
    case 'spiral': {
      const turns = 3.5;
      const points = 120;
      const maxR = Math.min(Math.abs(w), Math.abs(h)) / 2;
      ctx.moveTo(cx, cy);
      for (let i = 1; i <= points; i++) {
        const theta = (i / points) * (turns * 2 * Math.PI);
        const r = maxR * (i / points);
        ctx.lineTo(cx + r * Math.cos(theta), cy + r * Math.sin(theta));
      }
      break;
    }
    case 'grid': {
      const rows = Math.max(2, s.sides ?? 4);
      const cols = Math.max(2, s.sides ?? 4);
      ctx.rect(x, y, w, h);
      for (let i = 1; i < cols; i++) {
        const gx = x + (w * i) / cols;
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + h);
      }
      for (let j = 1; j < rows; j++) {
        const gy = y + (h * j) / rows;
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
      }
      break;
    }
    case 'polar-grid': {
      const rings = Math.max(2, s.sides ?? 4);
      const spokes = 8;
      const rx = Math.abs(w) / 2;
      const ry = Math.abs(h) / 2;
      for (let i = 1; i <= rings; i++) {
        const f = i / rings;
        ctx.moveTo(cx + rx * f, cy);
        ctx.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2);
      }
      for (let j = 0; j < spokes; j++) {
        const a = (j * 2 * Math.PI) / spokes;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
      }
      break;
    }
    case 'flare': {
      const rx = Math.abs(w) / 2;
      const ry = Math.abs(h) / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.moveTo(cx + rx * 0.5, cy);
      ctx.ellipse(cx, cy, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2);
      const rays = 12;
      for (let k = 0; k < rays; k++) {
        const a = (k * 2 * Math.PI) / rays;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + rx * 1.5 * Math.cos(a), cy + ry * 1.5 * Math.sin(a));
      }
      break;
    }
    case 'graph': {
      // 5-bar vector column chart
      const bars = 5;
      const vals = [0.4, 0.75, 0.6, 0.95, 0.5];
      const bw = (w * 0.8) / bars;
      const gap = (w * 0.2) / (bars + 1);
      for (let b = 0; b < bars; b++) {
        const bx = x + gap + b * (bw + gap);
        const bh = h * vals[b];
        const by = y + h - bh;
        ctx.rect(bx, by, bw, bh);
      }
      break;
    }
  }
}

/** Flat colour, or the shape's gradient mapped onto its box. */
export function shapeFillStyle(ctx: CanvasRenderingContext2D, s: ShapeProps, x: number, y: number, w: number, h: number): string | CanvasGradient {
  const gr = s.gradient;
  if (!gr || gr.stops.length < 2) return s.fill;
  const x0 = x + gr.x0 * w, y0 = y + gr.y0 * h, x1 = x + gr.x1 * w, y1 = y + gr.y1 * h;
  const g = gr.type === 'radial' ? ctx.createRadialGradient(x0, y0, 0, x0, y0, Math.max(1, Math.hypot(x1 - x0, y1 - y0))) : ctx.createLinearGradient(x0, y0, x1, y1);
  for (const st of gr.stops) g.addColorStop(Math.max(0, Math.min(1, st.offset)), st.color);
  return g;
}

/** The same colour at zero alpha (fading to transparent black would darken the edge). */
function hexToTransparent(color: string): string {
  const m = /^#([0-9a-f]{6})/i.exec(color);
  if (!m) return 'rgba(0,0,0,0)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
}

function drawShape(ctx: CanvasRenderingContext2D, s: ShapeProps, x: number, y: number, w: number, h: number) {
  shapePath(ctx, s, x, y, w, h);
  const isLine = s.shape === 'line' || s.shape === 'arrow' || s.shape === 'arc' || s.shape === 'spiral' || (s.shape === 'path' && !s.closed);
  const base = ctx.globalAlpha;
  if (!isLine && s.fillEnabled && (s.fillOpacity ?? 1) > 0) {
    const rule = s.compoundPoints ? 'evenodd' : 'nonzero';
    ctx.globalAlpha = base * clamp01(s.fillOpacity ?? 1);
    ctx.fillStyle = shapeFillStyle(ctx, s, x, y, w, h);
    ctx.fill(rule);
    if (s.mesh?.length) {
      // Mesh points: soft colour spots, clipped to the shape
      ctx.save();
      ctx.clip(rule);
      const diag = Math.hypot(w, h);
      for (const m of s.mesh) {
        const cx = x + m.x * w;
        const cy = y + m.y * h;
        const r = Math.max(1, (m.spread ?? 0.45) * diag);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, m.color);
        g.addColorStop(1, hexToTransparent(m.color));
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    ctx.globalAlpha = base;
  }
  if ((s.strokeWidth > 0 || isLine) && (s.strokeOpacity ?? 1) > 0) {
    ctx.globalAlpha = base * clamp01(s.strokeOpacity ?? 1);
    strokeShape(ctx, s, x, y, w, h, isLine);
    ctx.globalAlpha = base;
  }
}

const clamp01 = (v: number) => (v > 1 ? 1 : v < 0 ? 0 : v);

function setStrokeStyle(ctx: CanvasRenderingContext2D, s: ShapeProps, width: number) {
  ctx.lineWidth = Math.max(1, width);
  ctx.lineJoin = s.strokeJoin ?? 'round';
  ctx.lineCap = s.strokeCap ?? 'round';
  if (s.strokeMiterLimit) ctx.miterLimit = s.strokeMiterLimit;
  ctx.setLineDash(s.strokeDash?.length ? s.strokeDash : []);
  ctx.strokeStyle = s.stroke;
}

/** Strokes the shape's current path: centred, inside or outside the outline, or with a variable width. */
function strokeShape(ctx: CanvasRenderingContext2D, s: ShapeProps, x: number, y: number, w: number, h: number, isLine: boolean) {
  const rule = s.compoundPoints ? 'evenodd' : 'nonzero';
  if (s.widthPoints?.length && s.shape === 'path' && s.strokeWidth > 0) {
    // Variable width: the stroke is a filled outline along each sub-path
    const subs = s.compoundPoints?.length ? s.compoundPoints : [s.points ?? []];
    const at = (a: PathAnchor): PathAnchor => ({ x: x + a.x * w, y: y + a.y * h, ix: x + a.ix * w, iy: y + a.iy * h, ox: x + a.ox * w, oy: y + a.oy * h });
    const docSubs = hasPathCorners(s) ? filletedRings(s, x, y, w, h) : subs.map((sub) => sub.map(at));
    ctx.beginPath();
    for (const sub of docSubs) {
      for (const ring of variableStrokeOutline(flattenAnchors(sub, !!s.closed), !!s.closed, s.strokeWidth, s.widthPoints, s.strokeCap ?? 'round')) {
        ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
      }
    }
    ctx.fillStyle = s.stroke;
    ctx.fill('evenodd');
    return;
  }
  const align = isLine ? 'center' : s.strokeAlign ?? 'center';
  if (align === 'inside') {
    // Twice the width, clipped to the shape: only the inner half shows
    ctx.save();
    ctx.clip(rule);
    setStrokeStyle(ctx, s, s.strokeWidth * 2);
    ctx.stroke();
    ctx.restore();
  } else if (align === 'outside') {
    // Twice the width on its own canvas, with the shape's inside cut away (works with no or translucent fill)
    const c = createCanvas(ctx.canvas.width, ctx.canvas.height);
    const o = ctx2d(c);
    o.setTransform(ctx.getTransform());
    shapePath(o, s, x, y, w, h);
    setStrokeStyle(o, s, s.strokeWidth * 2);
    o.stroke();
    o.globalCompositeOperation = 'destination-out';
    o.fill(rule);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  } else {
    setStrokeStyle(ctx, s, s.strokeWidth);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** How far a shape's stroke can reach past its outline, for render padding. */
export const strokeReach = (s: ShapeProps) => s.strokeWidth * maxWidth(s.widthPoints) * (s.strokeAlign === 'outside' ? 2 : 1);

let vectorCache = new WeakMap<Layer, Surface>();

/** Drops every cached text / shape render (e.g. after a font finishes loading). */
export function clearVectorCache() {
  vectorCache = new WeakMap();
  viewCache = new WeakMap();
}

/** Pixel surface (document coordinates) for any drawable layer. */
export function layerSurface(layer: Layer): Surface | null {
  if (layer.kind === 'raster') return layer.canvas ? { canvas: layer.canvas, x: layer.x, y: layer.y } : null;
  const cached = vectorCache.get(layer);
  if (cached) return cached;
  const rot = (layer.kind === 'text' || layer.kind === 'shape') && layer.rotation ? layer.rotation : 0;
  const pivot = layerPivot(layer);
  let surf: Surface | null = null;
  if (layer.kind === 'text' && layer.text) {
    const t = layer.text;
    const pad = Math.ceil(t.size * 0.5 + t.stroke * 2 + 4 + (t.box ? t.boxPad ?? 0 : 0));
    const m = measureText(t);
    const box = { x: Math.floor(layer.x) - pad, y: Math.floor(layer.y) - pad, w: m.width + pad * 2, h: m.height + pad * 2 };
    const warped = t.warp && t.warp.style !== 'none' && t.warp.bend;
    if (rot && !warped) return cacheSurface(layer, drawRotated(box, rot, pivot, (ctx) => drawText(ctx, t, pad, pad)));
    const c = createCanvas(box.w, box.h);
    drawText(ctx2d(c), t, pad, pad);
    surf = { canvas: c, x: box.x, y: box.y };
    if (warped) {
      const r = warpText(ctx2d(c).getImageData(0, 0, c.width, c.height).data, c.width, c.height, t.warp!.style, t.warp!.bend);
      const wc = createCanvas(r.width, r.height, spaceOf(c));
      ctx2d(wc).putImageData(pixelsLike(c, r.data as Uint8ClampedArray, r.width, r.height), 0, 0);
      surf = { canvas: wc, x: surf.x + Math.round(r.dx), y: surf.y + Math.round(r.dy) };
    }
  } else if (layer.kind === 'shape' && layer.shape) {
    const s = layer.shape;
    const pad = Math.ceil(strokeReach(s) * 4 + 16);
    const x0 = Math.min(layer.x, layer.x + layer.width);
    const y0 = Math.min(layer.y, layer.y + layer.height);
    const box = { x: Math.floor(x0) - pad, y: Math.floor(y0) - pad, w: Math.abs(layer.width) + pad * 2, h: Math.abs(layer.height) + pad * 2 };
    // Drawn straight into the rotated frame, so edges stay as crisp as an unrotated shape
    const draw = (ctx: CanvasRenderingContext2D) => drawShape(ctx, s, layer.x - box.x, layer.y - box.y, layer.width, layer.height);
    if (rot) return cacheSurface(layer, drawRotated(box, rot, pivot, draw));
    const c = createCanvas(box.w, box.h);
    draw(ctx2d(c));
    surf = { canvas: c, x: box.x, y: box.y };
  }
  if (surf && rot) surf = rotateSurface(surf, rot, pivot.x, pivot.y);
  return surf ? cacheSurface(layer, surf) : null;
}

function cacheSurface(layer: Layer, surf: Surface): Surface {
  vectorCache.set(layer, surf);
  return surf;
}

let viewCache = new WeakMap<Layer, { key: string; surf: Surface | null }>();

/**
 * A shape or text layer redrawn as vectors at the view's zoom, clipped to the visible target, so
 * edges stay sharp at any magnification. `undefined` means "no vector form" (pixel layers, warped
 * text): the caller scales the document-resolution surface instead.
 */
function viewSurface(layer: Layer, v: RenderView): Surface | null | undefined {
  let draw: (ctx: CanvasRenderingContext2D) => void;
  let box: { x: number; y: number; w: number; h: number };
  if (layer.kind === 'text') {
    const t = layer.text;
    if (!t) return null;
    if (t.warp && t.warp.style !== 'none' && t.warp.bend) return undefined;
    const pad = Math.ceil(t.size * 0.5 + t.stroke * 2 + 4 + (t.box ? t.boxPad ?? 0 : 0));
    const m = measureText(t);
    const tx = Math.floor(layer.x);
    const ty = Math.floor(layer.y);
    box = { x: tx - pad, y: ty - pad, w: m.width + pad * 2, h: m.height + pad * 2 };
    draw = (ctx) => drawText(ctx, t, tx, ty);
  } else if (layer.kind === 'shape') {
    const sh = layer.shape;
    if (!sh) return null;
    const pad = Math.ceil(strokeReach(sh) * 4 + 16);
    const x0 = Math.min(layer.x, layer.x + layer.width);
    const y0 = Math.min(layer.y, layer.y + layer.height);
    box = { x: x0 - pad, y: y0 - pad, w: Math.abs(layer.width) + pad * 2, h: Math.abs(layer.height) + pad * 2 };
    draw = (ctx) => drawShape(ctx, sh, layer.x, layer.y, layer.width, layer.height);
  } else return undefined;
  const key = viewSig(v);
  const hit = viewCache.get(layer);
  if (hit && hit.key === key) return hit.surf;
  const rot = layer.rotation ? layer.rotation : 0;
  const pivot = layerPivot(layer);
  const a = (rot * Math.PI) / 180;
  const r = rot ? rotatedBox(box, a, pivot.x, pivot.y) : { x0: box.x, y0: box.y, w: box.w, h: box.h };
  // Only the visible part is drawn, so a 64000% zoom costs no more than the screen
  const px0 = Math.max(-2, Math.floor(r.x0 * v.s - v.ox));
  const py0 = Math.max(-2, Math.floor(r.y0 * v.s - v.oy));
  const px1 = Math.min(v.w + 2, Math.ceil((r.x0 + r.w) * v.s - v.ox));
  const py1 = Math.min(v.h + 2, Math.ceil((r.y0 + r.h) * v.s - v.oy));
  let surf: Surface | null = null;
  if (px1 > px0 && py1 > py0) {
    const c = createCanvas(px1 - px0, py1 - py0);
    const ctx = ctx2d(c);
    ctx.setTransform(v.s, 0, 0, v.s, -v.ox - px0, -v.oy - py0);
    if (rot) {
      ctx.translate(pivot.x, pivot.y);
      ctx.rotate(a);
      ctx.translate(-pivot.x, -pivot.y);
    }
    draw(ctx);
    surf = { canvas: c, x: (px0 + v.ox) / v.s, y: (py0 + v.oy) / v.s, d: v.s };
  }
  viewCache.set(layer, { key, surf });
  return surf;
}


/** Centre of a layer's x / y / width / height box: the pivot of its live rotation. */
export function layerPivot(layer: Layer): { x: number; y: number } {
  return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
}

/** Document-space box of `box` rotated by `deg` about (cx, cy), in whole pixels. */
function rotatedBox(box: { x: number; y: number; w: number; h: number }, a: number, cx: number, cy: number) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]].map(([x, y]) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
  const y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
  return { x0, y0, w: Math.max(1, Math.ceil(Math.max(...pts.map((p) => p.x))) - x0), h: Math.max(1, Math.ceil(Math.max(...pts.map((p) => p.y))) - y0) };
}

/** Runs `draw` (which paints in `box`-local coordinates) rotated by `deg` about (cx, cy). */
function drawRotated(box: { x: number; y: number; w: number; h: number }, deg: number, pivot: { x: number; y: number }, draw: (ctx: CanvasRenderingContext2D) => void): Surface {
  const a = (deg * Math.PI) / 180;
  const r = rotatedBox(box, a, pivot.x, pivot.y);
  const c = createCanvas(r.w, r.h);
  const ctx = ctx2d(c);
  ctx.translate(pivot.x - r.x0, pivot.y - r.y0);
  ctx.rotate(a);
  ctx.translate(box.x - pivot.x, box.y - pivot.y);
  draw(ctx);
  return { canvas: c, x: r.x0, y: r.y0 };
}

/** Draws a surface rotated by `deg` (clockwise) about the document point (cx, cy). */
export function rotateSurface(surf: Surface, deg: number, cx: number, cy: number): Surface {
  return drawRotated({ x: surf.x, y: surf.y, w: surf.canvas.width, h: surf.canvas.height }, deg, { x: cx, y: cy }, (ctx) => {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(surf.canvas, 0, 0);
  });
}

/** Text layers keep width/height in sync with their measured content. */
export function syncTextBounds(layer: Layer): Pick<Layer, 'width' | 'height'> {
  if (!layer.text) return { width: layer.width, height: layer.height };
  const m = measureText(layer.text);
  return { width: Math.ceil(m.width), height: Math.ceil(m.height) };
}

// ---------------------------------------------------------------- compositing

export function layerSig(l: Layer, ov?: Surface): string {
  return `${l.v}:${rev(l.canvas)}:${rev(l.mask?.canvas)}${ov ? `:o${rev(ov.canvas)}` : ''}|`;
}

function maskedSurface(layer: Layer, surf: Surface, key: string): Surface {
  const m = layer.mask;
  if (!m || !m.enabled) return surf;
  const d = surf.d ?? 1;
  const tmp = scratch(key, surf.canvas.width, surf.canvas.height);
  const t = ctx2d(tmp);
  t.drawImage(surf.canvas, 0, 0);
  t.globalCompositeOperation = 'destination-in';
  if (d === 1) t.drawImage(m.canvas, m.x - surf.x, m.y - surf.y);
  else t.drawImage(m.canvas, (m.x - surf.x) * d, (m.y - surf.y) * d, m.canvas.width * d, m.canvas.height * d);
  return { canvas: tmp, x: surf.x, y: surf.y, d: surf.d };
}

/** Where a surface lands in the target: position, size and scale factor (1 = pixel for pixel). */
function placeRect(v: RenderView, surf: Surface) {
  const k = v.s / (surf.d ?? 1);
  let dx = surf.x * v.s - v.ox;
  let dy = surf.y * v.s - v.oy;
  if (Math.abs(k - 1) < 1e-9) {
    // Hi-res vector surfaces sit on whole target pixels; float error must not resample them
    if (Math.abs(dx - Math.round(dx)) < 1e-6) dx = Math.round(dx);
    if (Math.abs(dy - Math.round(dy)) < 1e-6) dy = Math.round(dy);
    return { dx, dy, dw: surf.canvas.width, dh: surf.canvas.height, k: 1 };
  }
  return { dx, dy, dw: surf.canvas.width * k, dh: surf.canvas.height * k, k };
}

/** Draws a surface into a target-space context, scaling it when its density differs. */
function drawAt(ctx: CanvasRenderingContext2D, v: RenderView, surf: Surface) {
  const r = placeRect(v, surf);
  if (r.k === 1) return ctx.drawImage(surf.canvas, r.dx, r.dy);
  // Pixel layers zoomed far in show their pixels (like the pixel grid); otherwise resample smoothly
  ctx.imageSmoothingEnabled = r.k < (v.nearestFrom ?? 8);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(surf.canvas, r.dx, r.dy, r.dw, r.dh);
}

/**
 * Draws `src` at (x, y) with an opacity and blend mode. `atop` is the "normal" behaviour for
 * adjustment layers and clipped layers (the backdrop keeps its alpha). Modes Canvas 2D lacks
 * go through the per-pixel compositor.
 */
function drawBlended(v: RenderView, target: HTMLCanvasElement, surf: Surface, alpha: number, blend: BlendMode, atop = false) {
  if (isCustomBlend(blend)) {
    const r = placeRect(v, surf);
    if (r.k === 1) return compositeCustom(target, surf.canvas, r.dx, r.dy, alpha, blend, atop);
    // The per-pixel compositor needs target-density pixels
    const tmp = scratch('blendResample', target.width, target.height);
    drawAt(ctx2d(tmp), v, surf);
    return compositeCustom(target, tmp, 0, 0, alpha, blend, atop);
  }
  const ctx = ctx2d(target);
  ctx.save();
  ctx.globalAlpha = alpha;
  // Pass Through only means something for a group drawn by compositeList; anything else draws normally
  const plain = blend === 'normal' || blend === 'pass-through';
  ctx.globalCompositeOperation = plain ? (atop ? 'source-atop' : 'source-over') : (blend as GlobalCompositeOperation);
  drawAt(ctx, v, surf);
  ctx.restore();
}

interface RenderCtx {
  doc: Doc;
  overrides?: Overrides;
  view: RenderView;
  /** '' for the identity (document-resolution) view. */
  vsig: string;
  /** Direct children per group id (undefined = top level), bottom to top. */
  kids: Map<string | undefined, Layer[]>;
}

function makeRc(doc: Doc, overrides?: Overrides, view?: RenderView): RenderCtx {
  const groups = new Set(doc.layers.filter((l) => l.kind === 'group').map((l) => l.id));
  const kids = new Map<string | undefined, Layer[]>();
  for (const l of doc.layers) {
    // A layer whose group isn't in this render (e.g. merging a subset) is drawn at the top level
    const p = l.parent && groups.has(l.parent) && l.parent !== l.id ? l.parent : undefined;
    const list = kids.get(p) ?? [];
    list.push(l);
    kids.set(p, list);
  }
  const v = view ?? { s: 1, ox: 0, oy: 0, w: doc.width, h: doc.height };
  const identity = v.s === 1 && v.ox === 0 && v.oy === 0 && v.w === doc.width && v.h === doc.height;
  return { doc, overrides, kids, view: v, vsig: identity ? '' : viewSig(v) };
}

/** A target-sized canvas as a surface (it covers exactly the view). */
function asTarget(rc: RenderCtx, canvas: HTMLCanvasElement): Surface {
  const v = rc.view;
  return { canvas, x: v.ox / v.s, y: v.oy / v.s, d: v.s };
}

/** Signature of a layer and, for a group, everything inside it. */
function nodeSig(rc: RenderCtx, l: Layer, seen = new Set<string>()): string {
  let s = layerSig(l, rc.overrides?.get(l.id));
  if (l.kind === 'group' && !seen.has(l.id)) {
    seen.add(l.id);
    s += '[';
    for (const c of rc.kids.get(l.id) ?? []) s += nodeSig(rc, c, seen);
    s += ']';
  }
  return s;
}

// Composited group contents, reused until something inside the group changes
const groupCache = new Map<string, { sig: string; canvas: HTMLCanvasElement }>();

function groupSurface(rc: RenderCtx, g: Layer, level: number, docRes = false): Surface {
  if (rc.vsig) return docRes ? groupSurface(makeRc(rc.doc, rc.overrides), g, level) : groupViewSurface(rc, g, level);
  const { width, height } = rc.doc;
  // Contents only: moving the group itself (its x / y) reuses the composited pixels
  let sig = `${width}x${height}|`;
  for (const c of rc.kids.get(g.id) ?? []) sig += nodeSig(rc, c, new Set([g.id]));
  let hit = groupCache.get(g.id);
  if (!hit || hit.sig !== sig || hit.canvas.width !== width || hit.canvas.height !== height) {
    const canvas = hit && hit.canvas.width === width && hit.canvas.height === height ? hit.canvas : createCanvas(width, height);
    ctx2d(canvas).clearRect(0, 0, width, height);
    // Nesting depth guards against corrupt files with parent cycles
    if (level < 32) compositeList(rc, canvas, rc.kids.get(g.id) ?? [], `G${g.id}|`, level + 1);
    touch(canvas);
    if (groupCache.size > 64 && !hit) groupCache.delete(groupCache.keys().next().value!);
    hit = { sig, canvas };
    groupCache.set(g.id, hit);
  }
  return { canvas: hit.canvas, x: Math.round(g.x), y: Math.round(g.y) };
}

/** Group contents composited straight at the view's zoom (vectors inside stay sharp). */
function groupViewSurface(rc: RenderCtx, g: Layer, level: number): Surface {
  const v = rc.view;
  const gx = Math.round(g.x);
  const gy = Math.round(g.y);
  const gv: RenderView = { ...v, ox: v.ox - gx * v.s, oy: v.oy - gy * v.s };
  const crc: RenderCtx = { ...rc, view: gv, vsig: viewSig(gv) };
  let sig = `${crc.vsig}|`;
  for (const c of rc.kids.get(g.id) ?? []) sig += nodeSig(crc, c, new Set([g.id]));
  const id = `v${g.id}`;
  let hit = groupCache.get(id);
  if (!hit || hit.sig !== sig) {
    const canvas = hit && hit.canvas.width === v.w && hit.canvas.height === v.h ? hit.canvas : createCanvas(v.w, v.h);
    ctx2d(canvas).clearRect(0, 0, canvas.width, canvas.height);
    if (level < 32) compositeList(crc, canvas, rc.kids.get(g.id) ?? [], `G${g.id}|`, level + 1);
    touch(canvas);
    if (groupCache.size > 64 && !hit) groupCache.delete(groupCache.keys().next().value!);
    hit = { sig, canvas };
    groupCache.set(id, hit);
  }
  return asTarget(rc, hit.canvas);
}

/**
 * Fast path of a view render: an opaque, normal-blend shape or text with no mask or effects is
 * painted straight into the target with the view transform — no intermediate canvas per layer.
 */
function drawVectorDirect(rc: RenderCtx, target: HTMLCanvasElement, layer: Layer): boolean {
  if (rc.overrides?.has(layer.id) || hasFx(layer) || (layer.mask && layer.mask.enabled)) return false;
  const t = layer.kind === 'text' ? layer.text : undefined;
  const sh = layer.kind === 'shape' ? layer.shape : undefined;
  if (!t && !sh) return false;
  if (t && t.warp && t.warp.style !== 'none' && t.warp.bend) return false;
  const v = rc.view;
  const ctx = ctx2d(target);
  ctx.save();
  ctx.setTransform(v.s, 0, 0, v.s, -v.ox, -v.oy);
  if (layer.rotation) {
    const p = layerPivot(layer);
    ctx.translate(p.x, p.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-p.x, -p.y);
  }
  if (t) drawText(ctx, t, Math.floor(layer.x), Math.floor(layer.y));
  else drawShape(ctx, sh!, layer.x, layer.y, layer.width, layer.height);
  ctx.restore();
  return true;
}

/**
 * Pixels of a layer for the current render. `docRes` asks for document resolution (layer effects
 * work in document pixels); otherwise shapes and text come back drawn at the view's zoom.
 */
function surfaceOf(rc: RenderCtx, layer: Layer, level: number, docRes = false): Surface | null {
  if (layer.kind === 'group') return rc.overrides?.get(layer.id) ?? groupSurface(rc, layer, level, docRes);
  const ov = rc.overrides?.get(layer.id);
  if (ov) return ov;
  if (rc.vsig && !docRes) {
    const vs = viewSurface(layer, rc.view);
    if (vs !== undefined) return vs;
  }
  return layerSurface(layer);
}

/** Draws one layer onto `target` (which also serves as the source for adjustment layers). */
function drawLayer(rc: RenderCtx, target: HTMLCanvasElement, layer: Layer, belowSig: string, level: number, asBase = false) {
  const opacity = asBase ? 1 : layer.opacity;
  const blend = asBase ? 'normal' : layer.blend;
  const key = `${level}${asBase ? 'b' : ''}`;
  if (layer.kind === 'adjustment') {
    if (!layer.adjust || isIdentityAdjust(layer.adjust)) return;
    const engine = getAdjustEngine();
    if (!engine) return;
    const adjusted = engine.process(target, layer.adjust, `${key}/${target.width}x${target.height}${rc.vsig}/${belowSig}`);
    let src = asTarget(rc, adjusted);
    src = maskedSurface(layer, src, `adjmask${key}`);
    drawBlended(rc.view, target, src, opacity, blend, true);
    return;
  }
  if (rc.vsig && !asBase && opacity * (layer.fill ?? 1) >= 1 && blend === 'normal' && drawVectorDirect(rc, target, layer)) return;
  const surf = surfaceOf(rc, layer, level, hasFx(layer));
  if (!surf) return;
  let src: Surface;
  let alpha = opacity;
  if (hasFx(layer)) {
    // Fill opacity is baked into the styled pixels. As a clip base, the effects underneath were
    // already drawn by compositeList, so only the front part goes into the clipping group.
    const st = styledSurface(layer, surf);
    src = asBase ? st.front : st.full;
  } else {
    src = maskedSurface(layer, surf, `mask${key}`);
    alpha *= layer.fill ?? 1;
  }
  drawBlended(rc.view, target, src, alpha, blend);
}

/** Composites a list of sibling layers onto `target`. Returns the accumulated signature. */
/**
 * A pass-through group: its contents straight onto the target (so a soft-light or adjustment layer inside
 * works on everything below the group). With group opacity or a mask, the contents go onto a copy of
 * what's below, which is then mixed back by that opacity and mask.
 */
function drawPassThrough(rc: RenderCtx, target: HTMLCanvasElement, g: Layer, sig: string, level: number) {
  if (level >= 32) return; // Nesting guard (corrupt files with parent cycles)
  const kids = rc.kids.get(g.id) ?? [];
  const gx = Math.round(g.x);
  const gy = Math.round(g.y);
  // A dragged group's pending offset moves its contents
  const view = gx || gy ? { ...rc.view, ox: rc.view.ox - gx * rc.view.s, oy: rc.view.oy - gy * rc.view.s } : rc.view;
  const crc: RenderCtx = view === rc.view ? rc : { ...rc, view, vsig: rc.vsig ? viewSig(view) : '' };
  const masked = !!g.mask?.enabled;
  if (g.opacity >= 1 && !masked) {
    compositeList(crc, target, kids, `P${g.id}|${sig}`, level + 1);
    return;
  }
  const mix = scratch(`pass${level}`, target.width, target.height);
  const m = ctx2d(mix);
  m.save();
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.globalAlpha = 1;
  m.globalCompositeOperation = 'copy';
  m.drawImage(target, 0, 0);
  m.restore();
  compositeList(crc, mix, kids, `P${g.id}|${sig}`, level + 1);
  if (masked) {
    m.save();
    m.globalCompositeOperation = 'destination-in';
    drawAt(m, rc.view, { canvas: g.mask!.canvas, x: g.mask!.x, y: g.mask!.y });
    m.restore();
  }
  const t = ctx2d(target);
  t.save();
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalAlpha = g.opacity;
  t.globalCompositeOperation = 'source-over';
  t.drawImage(mix, 0, 0);
  t.restore();
}

function compositeList(rc: RenderCtx, target: HTMLCanvasElement, list: Layer[], sig: string, level: number): string {
  let i = 0;
  while (i < list.length) {
    const base = list[i];
    let j = i + 1;
    while (j < list.length && list[j].clip) j++;
    const clipEnd = j;
    const visible = base.visible && base.opacity > 0;

    // A pass-through group's contents blend with what's below it, as if they weren't grouped
    if (base.kind === 'group' && base.blend === 'pass-through' && clipEnd === i + 1 && !hasFx(base)) {
      if (visible) drawPassThrough(rc, target, base, sig, level);
      sig += nodeSig(rc, base);
      i++;
      continue;
    }

    if (clipEnd === i + 1 || base.kind === 'adjustment') {
      if (visible) drawLayer(rc, target, base, sig, level);
      sig += nodeSig(rc, base);
      // Adjustment layers can't be clip bases; treat clipped children as normal layers.
      i++;
      continue;
    }

    // Clipping group: base defines the alpha, clipped layers paint inside it.
    let clipSig = '';
    for (let k = i; k < clipEnd; k++) clipSig += nodeSig(rc, list[k]);
    if (visible) {
      if (hasFx(base)) {
        const surf = surfaceOf(rc, base, level, true);
        if (surf) {
          const behind = styledSurface(base, surf).behind;
          drawBlended(rc.view, target, behind, base.opacity, base.blend);
        }
      }
      const clip = scratch(`clip${level}`, target.width, target.height);
      drawLayer(rc, clip, base, 'g', level, true);
      let inner = `clip:${base.v}`;
      for (let k = i + 1; k < clipEnd; k++) {
        const c = list[k];
        if (c.visible && c.opacity > 0) {
          if (c.kind === 'adjustment') {
            drawLayer(rc, clip, c, inner, level);
          } else {
            const styled = hasFx(c);
            const surf = surfaceOf(rc, c, level, styled);
            if (surf) {
              const src = styled ? styledSurface(c, surf).full : maskedSurface(c, surf, `clipmask${level}`);
              const tmp = scratch(`clipTmp${level}`, target.width, target.height);
              const t = ctx2d(tmp);
              drawAt(t, rc.view, src);
              t.globalCompositeOperation = 'destination-in';
              t.drawImage(clip, 0, 0);
              drawBlended(rc.view, clip, asTarget(rc, tmp), c.opacity * (styled ? 1 : c.fill ?? 1), c.blend, true);
            }
          }
        }
        inner += nodeSig(rc, c);
      }
      drawBlended(rc.view, target, asTarget(rc, clip), base.opacity, base.blend);
    }
    sig += clipSig;
    i = clipEnd;
  }
  return sig;
}

/** Renders a whole document into `target` (resized to doc dimensions). */
export function renderDocument(doc: Doc, target: HTMLCanvasElement, overrides?: Overrides): void {
  if (target.width !== doc.width || target.height !== doc.height) {
    target.width = doc.width;
    target.height = doc.height;
  }
  ctx2d(target).clearRect(0, 0, doc.width, doc.height);
  const rc = makeRc(doc, overrides);
  compositeList(rc, target, rc.kids.get(undefined) ?? [], `${doc.width}x${doc.height}|`, 0);
}

/**
 * Viewport renderer with a "below the active layer" cache: while painting or dragging
 * an adjustment slider, everything underneath is reused instead of recomposited.
 */
export class DocRenderer {
  output = createCanvas(1, 1, 'srgb');
  private below = createCanvas(1, 1, 'srgb');
  private belowSig = '';
  private lastSig = '';

  /** With a `view`, renders that part of the document at its zoom (output is view.w × view.h). */
  render(doc: Doc, overrides?: Overrides, view?: RenderView): HTMLCanvasElement {
    // The buffers work in the document's colour space (an sRGB buffer would clip a P3 photo on screen)
    const space = doc.colorSpace ?? 'srgb';
    if (spaceOf(this.output) !== space) {
      this.output = createCanvas(1, 1, space);
      this.below = createCanvas(1, 1, space);
      this.invalidate();
    }
    const rc = makeRc(doc, overrides, view);
    const width = rc.view.w;
    const height = rc.view.h;
    const top = rc.kids.get(undefined) ?? [];
    // Split at the top-level item that contains the active layer
    const byId = new Map(doc.layers.map((l) => [l.id, l]));
    let active = byId.get(doc.activeId);
    for (let n = 0; active?.parent && byId.get(active.parent)?.kind === 'group' && n < 32; n++) active = byId.get(active.parent);
    let split = Math.max(0, top.findIndex((l) => l.id === active?.id));
    while (split > 0 && top[split].clip) split--;

    let prefix = `${width}x${height}${rc.vsig}|`;
    for (let i = 0; i < split; i++) prefix += nodeSig(rc, top[i]);
    let full = prefix;
    for (let i = split; i < top.length; i++) full += nodeSig(rc, top[i]);
    if (full === this.lastSig && this.output.width === width && this.output.height === height) return this.output;

    if (prefix !== this.belowSig || this.below.width !== width || this.below.height !== height) {
      this.below.width = width;
      this.below.height = height;
      ctx2d(this.below).clearRect(0, 0, width, height);
      compositeList(rc, this.below, top.slice(0, split), `${width}x${height}${rc.vsig}|`, 0);
      this.belowSig = prefix;
    }
    if (this.output.width !== width || this.output.height !== height) {
      this.output.width = width;
      this.output.height = height;
    }
    const ctx = ctx2d(this.output);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.below, 0, 0);
    compositeList(rc, this.output, top.slice(split), prefix, 0);
    this.lastSig = full;
    return this.output;
  }

  invalidate() {
    this.lastSig = '';
    this.belowSig = '';
  }

  /** Changes whenever the output pixels change (for display caches). */
  get signature() {
    return this.lastSig;
  }
}

// ---------------------------------------------------------------- thumbnails

const thumbCache = new WeakMap<object, { key: string; url: HTMLCanvasElement }>();

export function layerThumb(layer: Layer, docW: number, docH: number, size = 40, mask = false): HTMLCanvasElement {
  // Pixel layers key on their pixels and position (not the record version), so a drag that only
  // moves the layer re-thumbnails without re-reading the whole canvas each frame
  const ident = layer.kind === 'raster' ? `r${rev(layer.canvas)}@${layer.x},${layer.y}` : `v${layer.v}`;
  const key = `${ident}:${rev(layer.mask?.canvas)}:${mask}:${docW}x${docH}`;
  const hit = thumbCache.get(layer.canvas ?? layer);
  if (hit && hit.key === key && !mask) return hit.url;
  const s = Math.min(size / docW, size / docH);
  const c = createCanvas(Math.max(1, Math.round(docW * s)), Math.max(1, Math.round(docH * s)));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  if (mask && layer.mask) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const tmp = createCanvas(c.width, c.height);
    const t = ctx2d(tmp);
    t.fillStyle = '#fff';
    t.fillRect(0, 0, c.width, c.height);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(layer.mask.canvas, layer.mask.x * s, layer.mask.y * s, layer.mask.canvas.width * s, layer.mask.canvas.height * s);
    ctx.drawImage(tmp, 0, 0);
    return c;
  }
  const surf = layerSurface(layer);
  if (surf) ctx.drawImage(surf.canvas, surf.x * s, surf.y * s, surf.canvas.width * s, surf.canvas.height * s);
  if (!mask) thumbCache.set(layer.canvas ?? layer, { key, url: c });
  return c;
}
