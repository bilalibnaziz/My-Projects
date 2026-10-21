// Pattern fills: parametric tiles (dots, stripes, grid, checker, diamonds, crosses, zigzag, waves,
// triangles, rings) built from simple primitives, so the canvas and the SVG export draw exactly the
// same tile. A pattern fill replaces the flat fill (like a gradient) and is mapped in document units,
// with its own scale, angle and offset, so it stays crisp at any zoom (tiles are rasterised at the
// view's resolution and cached).

import type { ShapeProps } from './types';
import { createCanvas, ctx2d } from './canvas';

export type PatternPreset = 'dots' | 'stripes' | 'grid' | 'checker' | 'diamonds' | 'crosses' | 'zigzag' | 'waves' | 'triangles' | 'rings';

export interface PatternFill {
  preset: PatternPreset;
  /** Ink colour of the motif. */
  fg: string;
  /** Background colour of the tile; undefined = transparent (the shape's flat fill shows through). */
  bg?: string;
  /** Tile size in document px. */
  size: number;
  /** Motif weight 0..1 (dot size, stripe thickness…). */
  weight: number;
  /** Rotation of the whole pattern (degrees). */
  angle: number;
}

export const PATTERN_PRESETS: { id: PatternPreset; label: string }[] = [
  { id: 'dots', label: 'Dots' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'grid', label: 'Grid' },
  { id: 'checker', label: 'Checker' },
  { id: 'diamonds', label: 'Diamonds' },
  { id: 'crosses', label: 'Crosses' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'waves', label: 'Waves' },
  { id: 'triangles', label: 'Triangles' },
  { id: 'rings', label: 'Rings' },
];

export const defaultPattern = (fg: string, bg?: string): PatternFill => ({ preset: 'dots', fg, bg, size: 24, weight: 0.5, angle: 0 });

type Prim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  /** A circle with a round hole (drawn with opposite windings, so the hole stays open). */
  | { kind: 'ring'; cx: number; cy: number; r: number; r2: number }
  | { kind: 'poly'; pts: number[] }
  /** Closed path of cubic segments: M x y, then [c1x c1y c2x c2y x y]… */
  | { kind: 'curve'; start: [number, number]; segs: number[][] };

/** The motif of one tile (s × s), every primitive filled with the ink colour. */
export function patternPrims(p: Pick<PatternFill, 'preset' | 'size' | 'weight'>): Prim[] {
  const s = p.size;
  const w = Math.max(0.02, Math.min(1, p.weight));
  switch (p.preset) {
    case 'dots':
      return [{ kind: 'circle', cx: s / 2, cy: s / 2, r: (s / 2) * w * 0.9 }];
    case 'stripes':
      return [{ kind: 'rect', x: 0, y: 0, w: s, h: s * w * 0.5 }];
    case 'grid': {
      const t = Math.max(0.5, s * w * 0.2);
      return [{ kind: 'rect', x: 0, y: 0, w: s, h: t }, { kind: 'rect', x: 0, y: t, w: t, h: s - t }];
    }
    case 'checker':
      return [{ kind: 'rect', x: 0, y: 0, w: s / 2, h: s / 2 }, { kind: 'rect', x: s / 2, y: s / 2, w: s / 2, h: s / 2 }];
    case 'diamonds': {
      const r = (s / 2) * w;
      return [{ kind: 'poly', pts: [s / 2, s / 2 - r, s / 2 + r, s / 2, s / 2, s / 2 + r, s / 2 - r, s / 2] }];
    }
    case 'crosses': {
      const arm = s * 0.35 * Math.max(0.3, w + 0.3), t = Math.max(0.5, s * w * 0.16);
      const c = s / 2;
      return [{ kind: 'rect', x: c - arm, y: c - t / 2, w: arm * 2, h: t }, { kind: 'rect', x: c - t / 2, y: c - arm, w: t, h: arm * 2 }];
    }
    case 'zigzag': {
      // A band zigzagging across the tile, joining its neighbours seamlessly
      const t = s * w * 0.3, a = s * 0.25;
      return [{ kind: 'poly', pts: [0, a, s / 2, a + s * 0.25, s, a, s, a + t, s / 2, a + s * 0.25 + t, 0, a + t] }];
    }
    case 'waves': {
      const t = s * w * 0.3, y = s * 0.35, amp = s * 0.15;
      const k = s / 4;
      return [{
        kind: 'curve', start: [0, y],
        segs: [
          [k, y - amp, s / 2 - k, y - amp, s / 2, y], [s / 2 + k, y + amp, s - k, y + amp, s, y],
          [s, y + t, s, y + t, s, y + t],
          [s - k, y + amp + t, s / 2 + k, y + amp + t, s / 2, y + t], [s / 2 - k, y - amp + t, k, y - amp + t, 0, y + t],
        ],
      }];
    }
    case 'triangles': {
      const h = s * w * 0.9, b = h * 0.58;
      return [{ kind: 'poly', pts: [s / 2, (s - h) / 2, s / 2 + b, (s + h) / 2, s / 2 - b, (s + h) / 2] }];
    }
    case 'rings': {
      const r = s * 0.4;
      return [{ kind: 'ring', cx: s / 2, cy: s / 2, r, r2: Math.max(0, r - Math.max(0.5, s * w * 0.2)) }];
    }
  }
}

function drawPrims(ctx: CanvasRenderingContext2D, prims: Prim[]) {
  ctx.beginPath();
  for (const p of prims) {
    if (p.kind === 'rect') ctx.rect(p.x, p.y, p.w, p.h);
    else if (p.kind === 'circle') {
      ctx.moveTo(p.cx + p.r, p.cy);
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
    } else if (p.kind === 'ring') {
      ctx.moveTo(p.cx + p.r, p.cy);
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
      ctx.moveTo(p.cx + p.r2, p.cy);
      ctx.arc(p.cx, p.cy, p.r2, 0, Math.PI * 2, true);
    } else if (p.kind === 'poly') {
      for (let i = 0; i < p.pts.length; i += 2) {
        if (i) ctx.lineTo(p.pts[i], p.pts[i + 1]);
        else ctx.moveTo(p.pts[i], p.pts[i + 1]);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(p.start[0], p.start[1]);
      for (const c of p.segs) ctx.bezierCurveTo(c[0], c[1], c[2], c[3], c[4], c[5]);
      ctx.closePath();
    }
  }
  ctx.fill();
}

/** The same motif wrapped onto the neighbouring tiles' edges, so shapes crossing an edge tile seamlessly. */
function drawWrapped(ctx: CanvasRenderingContext2D, prims: Prim[], s: number) {
  for (const dx of [-s, 0, s]) {
    for (const dy of [-s, 0, s]) {
      ctx.save();
      ctx.translate(dx, dy);
      drawPrims(ctx, prims);
      ctx.restore();
    }
  }
}

const tileCache = new Map<string, HTMLCanvasElement>();

/** One tile rasterised at `k` device px per document px (cached). */
export function patternTile(p: PatternFill, k: number): HTMLCanvasElement {
  const px = Math.max(2, Math.min(2048, Math.round(p.size * k)));
  const key = `${p.preset}|${p.fg}|${p.bg ?? ''}|${p.size}|${p.weight}|${px}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const c = createCanvas(px, px);
  const ctx = ctx2d(c);
  const f = px / p.size;
  ctx.scale(f, f);
  if (p.bg) {
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, p.size, p.size);
  }
  ctx.fillStyle = p.fg;
  drawWrapped(ctx, patternPrims(p), p.size);
  if (tileCache.size > 64) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, c);
  return c;
}

/** A canvas pattern for the shape's box at (x, y), at the context's current resolution; null without a pattern. */
export function patternStyle(ctx: CanvasRenderingContext2D, s: ShapeProps, x: number, y: number): CanvasPattern | null {
  const p = s.pattern;
  if (!p || typeof ctx.createPattern !== 'function') return null;
  const m = ctx.getTransform?.();
  const k = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1 : 1;
  const tile = patternTile(p, Math.min(8, k));
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return null;
  const f = p.size / tile.width;
  pat.setTransform?.(new DOMMatrix().translate(x, y).rotate(p.angle).scale(f, f));
  return pat;
}

/** SVG `<pattern>` definition (vector) for the shape's box at (x, y). */
export function patternSvg(id: string, p: PatternFill, x: number, y: number, n: (v: number) => string): string {
  const s = p.size;
  const one = (pr: Prim, dx: number, dy: number): string => {
    if (pr.kind === 'rect') return `<rect x="${n(pr.x + dx)}" y="${n(pr.y + dy)}" width="${n(pr.w)}" height="${n(pr.h)}"/>`;
    if (pr.kind === 'circle') return `<circle cx="${n(pr.cx + dx)}" cy="${n(pr.cy + dy)}" r="${n(pr.r)}"/>`;
    if (pr.kind === 'ring') {
      const ring = (r: number, sweep: 0 | 1) => `M${n(pr.cx + dx + r)} ${n(pr.cy + dy)}A${n(r)} ${n(r)} 0 1 ${sweep} ${n(pr.cx + dx - r)} ${n(pr.cy + dy)}A${n(r)} ${n(r)} 0 1 ${sweep} ${n(pr.cx + dx + r)} ${n(pr.cy + dy)}Z`;
      return `<path d="${ring(pr.r, 0)}${pr.r2 > 0 ? ring(pr.r2, 1) : ''}"/>`;
    }
    if (pr.kind === 'poly') return `<polygon points="${pr.pts.map((v, i) => n(v + (i % 2 ? dy : dx))).join(' ')}"/>`;
    return `<path d="M${n(pr.start[0] + dx)} ${n(pr.start[1] + dy)}${pr.segs.map((c) => `C${n(c[0] + dx)} ${n(c[1] + dy)} ${n(c[2] + dx)} ${n(c[3] + dy)} ${n(c[4] + dx)} ${n(c[5] + dy)}`).join('')}Z"/>`;
  };
  const prims = patternPrims(p);
  let body = '';
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) for (const pr of prims) body += one(pr, dx, dy);
  const bg = p.bg ? `<rect width="${n(s)}" height="${n(s)}" fill="${p.bg}"/>` : '';
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(s)}" height="${n(s)}" patternTransform="translate(${n(x)} ${n(y)})${p.angle ? ` rotate(${n(p.angle)})` : ''}">${bg}<g fill="${p.fg}">${body}</g></pattern>`;
}

/** A small preview of a preset (data URL), for the picker. */
export function patternPreview(p: PatternFill, px = 40): string {
  const c = createCanvas(px, px);
  const ctx = ctx2d(c);
  const tile = patternTile({ ...p, size: px / 2, angle: 0 }, 1);
  const pat = ctx.createPattern(tile, 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, px, px);
  }
  return c.toDataURL();
}
