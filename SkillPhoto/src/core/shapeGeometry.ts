// Live shape geometry: per-corner radii and corner styles on rectangles, rounded points and inner radius
// on polygons/stars, pie + donut on ellipses, and true-curve spirals. Everything is built as Bézier
// anchors, so the canvas, SVG export, hit testing and Convert to Path all see the same outline.
// Shapes without these settings return null and keep their original drawing.

import type { PathAnchor, ShapeProps } from './types';

export type CornerStyle = NonNullable<ShapeProps['cornerStyle']>;

export const CORNER_STYLES: { id: CornerStyle; label: string; hint: string }[] = [
  { id: 'round', label: 'Round', hint: 'Circular corners' },
  { id: 'smooth', label: 'Smooth', hint: 'Continuous (squircle) corners, softer than a circle' },
  { id: 'chamfer', label: 'Cut', hint: 'Straight 45° cut, a sharp bevel' },
  { id: 'scoop', label: 'Scoop', hint: 'Inverted round corners, like a ticket' },
  { id: 'notch', label: 'Notch', hint: 'Square bite out of each corner' },
];

/** Star inner radius used when none is set (fraction of the outer radius). */
export const DEFAULT_STAR_INNER = 0.45;
export const DEFAULT_SPIRAL_TURNS = 3.5;
const KAPPA = 0.5522847498;

type Pt = { x: number; y: number };
export interface LiveRings {
  rings: PathAnchor[][];
  closed: boolean;
}

const corner = (p: Pt): PathAnchor => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y, type: 'corner' });

/** Live settings that apply to a shape type (the rest of the next-shape extras are left out). */
export function extrasFor(type: ShapeProps['shape'], x: Partial<ShapeProps> | undefined): Partial<ShapeProps> {
  if (!x) return {};
  const pick = (...keys: (keyof ShapeProps)[]) => Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, x[k]])) as Partial<ShapeProps>;
  switch (type) {
    case 'rectangle':
    case 'round-rect':
      return pick('radii', 'cornerStyle');
    case 'polygon':
      return pick('pointRadius');
    case 'star':
      return pick('pointRadius', 'innerRatio');
    case 'ellipse':
      return pick('pieStart', 'pieEnd', 'hole');
    case 'spiral':
      return pick('turns');
    case 'line':
    case 'arrow':
    case 'arc':
      return pick('arrowStart', 'arrowEnd', 'strokeDash');
    default:
      return {};
  }
}

/** The four corner radii (top-left, top-right, bottom-right, bottom-left) as set, before clamping. */
export function cornerRadii(s: Pick<ShapeProps, 'radius' | 'radii' | 'shape'>): [number, number, number, number] {
  if (s.radii) return [...s.radii];
  const r = s.shape === 'round-rect' ? s.radius || 16 : s.radius || 0;
  return [r, r, r, r];
}

/** True when the shape needs this module's outline rather than the built-in canvas primitive. */
export function hasLiveGeometry(s: ShapeProps): boolean {
  switch (s.shape) {
    case 'rectangle':
    case 'round-rect':
      return !!s.radii || (!!s.cornerStyle && s.cornerStyle !== 'round' && s.radius > 0);
    case 'polygon':
    case 'star':
      return (s.pointRadius ?? 0) > 0 || (s.shape === 'star' && s.innerRatio !== undefined);
    case 'ellipse':
      return (s.hole ?? 0) > 0 || isPie(s);
    case 'spiral':
      return true;
    default:
      return false;
  }
}

const isPie = (s: ShapeProps) => {
  const a = s.pieStart ?? 0;
  const b = s.pieEnd ?? 360;
  return Math.abs(b - a) < 359.999;
};

/** Outline in box pixels (0..w, 0..h), or null when the shape has no live geometry. */
function ringsPx(s: ShapeProps, w: number, h: number): LiveRings | null {
  if (!hasLiveGeometry(s) || !(w > 0) || !(h > 0)) return null;
  switch (s.shape) {
    case 'rectangle':
    case 'round-rect':
      return { rings: [rectRing(w, h, cornerRadii(s), s.cornerStyle ?? 'round')], closed: true };
    case 'polygon':
    case 'star':
      return { rings: [polyRing(s, w, h)], closed: true };
    case 'ellipse':
      return { rings: ellipseRings(s, w, h), closed: true };
    case 'spiral':
      return { rings: [spiralRing(s.turns ?? DEFAULT_SPIRAL_TURNS, w, h)], closed: false };
  }
  return null;
}

/** Live outline normalised to the layer box (0..1), the space path layers use. */
export function liveShapeRings(s: ShapeProps, w: number, h: number): LiveRings | null {
  const r = ringsPx(s, Math.abs(w), Math.abs(h));
  if (!r) return null;
  const W = Math.abs(w) || 1;
  const H = Math.abs(h) || 1;
  return {
    closed: r.closed,
    rings: r.rings.map((ring) => ring.map((a) => ({ ...a, x: a.x / W, y: a.y / H, ix: a.ix / W, iy: a.iy / H, ox: a.ox / W, oy: a.oy / H }))),
  };
}

/** Adds the live outline to the current canvas path. Returns false (drawing nothing) for other shapes. */
export function liveShapePath(ctx: Pick<CanvasRenderingContext2D, 'moveTo' | 'bezierCurveTo' | 'closePath'>, s: ShapeProps, x: number, y: number, w: number, h: number): boolean {
  const r = ringsPx(s, Math.abs(w), Math.abs(h));
  if (!r) return false;
  const ox = Math.min(x, x + w);
  const oy = Math.min(y, y + h);
  for (const ring of r.rings) {
    ring.forEach((a, i) => {
      if (i === 0) return ctx.moveTo(ox + a.x, oy + a.y);
      const p = ring[i - 1];
      ctx.bezierCurveTo(ox + p.ox, oy + p.oy, ox + a.ix, oy + a.iy, ox + a.x, oy + a.y);
    });
    if (r.closed && ring.length > 1) {
      const l = ring[ring.length - 1];
      const f = ring[0];
      ctx.bezierCurveTo(ox + l.ox, oy + l.oy, ox + f.ix, oy + f.iy, ox + f.x, oy + f.y);
      ctx.closePath();
    }
  }
  return true;
}

/** Radii scaled down together so neighbouring corners never overlap (the CSS border-radius rule). */
export function clampRadii(w: number, h: number, r: readonly number[], reach = 1): number[] {
  const R = r.map((v) => Math.max(0, v) * reach);
  const fit = (len: number, a: number, b: number) => (a + b > 0 ? len / (a + b) : Infinity);
  const f = Math.min(1, fit(w, R[0], R[1]), fit(w, R[3], R[2]), fit(h, R[0], R[3]), fit(h, R[1], R[2]));
  return R.map((v) => v * f);
}

// Corners clockwise from top-left: the corner point, the edge direction arriving and leaving
const RECT_CORNERS = (w: number, h: number) => [
  { p: { x: 0, y: 0 }, din: { x: 0, y: -1 }, dout: { x: 1, y: 0 } },
  { p: { x: w, y: 0 }, din: { x: 1, y: 0 }, dout: { x: 0, y: 1 } },
  { p: { x: w, y: h }, din: { x: 0, y: 1 }, dout: { x: -1, y: 0 } },
  { p: { x: 0, y: h }, din: { x: -1, y: 0 }, dout: { x: 0, y: -1 } },
];

export function rectRing(w: number, h: number, radii: readonly number[], style: CornerStyle): PathAnchor[] {
  // Smooth corners start further along each edge than a circle of the same radius
  const reach = style === 'smooth' ? 1.4 : 1;
  const L = clampRadii(w, h, radii, reach);
  const out: PathAnchor[] = [];
  RECT_CORNERS(w, h).forEach(({ p, din, dout }, i) => {
    const r = L[i];
    if (r < 1e-6) return void out.push(corner(p));
    const A = { x: p.x - din.x * r, y: p.y - din.y * r };
    const B = { x: p.x + dout.x * r, y: p.y + dout.y * r };
    switch (style) {
      case 'chamfer':
        out.push(corner(A), corner(B));
        break;
      case 'notch':
        out.push(corner(A), corner({ x: A.x + dout.x * r, y: A.y + dout.y * r }), corner(B));
        break;
      case 'scoop': {
        // Quarter circle around the corner point, bulging into the shape
        const k = r * KAPPA;
        out.push({ ...corner(A), ox: A.x + dout.x * k, oy: A.y + dout.y * k });
        out.push({ ...corner(B), ix: B.x - din.x * k, iy: B.y - din.y * k });
        break;
      }
      default: {
        // Round: circle handles (κ). Smooth: longer handles over a longer run give a curvature-continuous corner
        const k = style === 'smooth' ? r * 0.75 : r * KAPPA;
        out.push({ x: A.x, y: A.y, ix: A.x, iy: A.y, ox: A.x + din.x * k, oy: A.y + din.y * k, type: 'smooth' });
        out.push({ x: B.x, y: B.y, ix: B.x - dout.x * k, iy: B.y - dout.y * k, ox: B.x, oy: B.y, type: 'smooth' });
      }
    }
  });
  return out;
}

/** Polygon or star vertices (outer, inner, outer…), starting at 12 o'clock. */
export function polyVertices(s: ShapeProps, w: number, h: number): Pt[] {
  const n = Math.max(3, s.sides ?? (s.shape === 'star' ? 5 : 6));
  const star = s.shape === 'star';
  const total = star ? n * 2 : n;
  const inner = Math.min(0.98, Math.max(0.02, s.innerRatio ?? DEFAULT_STAR_INNER));
  const pts: Pt[] = [];
  for (let i = 0; i < total; i++) {
    const a = (i * 2 * Math.PI) / total - Math.PI / 2;
    const r = star && i % 2 === 1 ? inner : 1;
    pts.push({ x: w / 2 + (w / 2) * r * Math.cos(a), y: h / 2 + (h / 2) * r * Math.sin(a) });
  }
  return pts;
}

function polyRing(s: ShapeProps, w: number, h: number): PathAnchor[] {
  return roundVertices(polyVertices(s, w, h), s.pointRadius ?? 0);
}

/**
 * Rounds every vertex of a closed polygon with a circular fillet whose tangent runs `r` px along each
 * edge (capped at half of the shorter neighbouring edge).
 */
export function roundVertices(v: Pt[], r: number): PathAnchor[] {
  if (r <= 0) return v.map(corner);
  const out: PathAnchor[] = [];
  const n = v.length;
  for (let i = 0; i < n; i++) {
    const P = v[(i - 1 + n) % n];
    const V = v[i];
    const N = v[(i + 1) % n];
    const l1 = Math.hypot(V.x - P.x, V.y - P.y);
    const l2 = Math.hypot(N.x - V.x, N.y - V.y);
    if (l1 < 1e-9 || l2 < 1e-9) {
      out.push(corner(V));
      continue;
    }
    const d1 = { x: (V.x - P.x) / l1, y: (V.y - P.y) / l1 };
    const d2 = { x: (N.x - V.x) / l2, y: (N.y - V.y) / l2 };
    const turn = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
    if (turn < 1e-4) {
      out.push(corner(V));
      continue;
    }
    const L = Math.min(r, l1 / 2, l2 / 2);
    // Circular arc: radius R = L / tan(Δ/2), handle = 4/3·tan(Δ/4)·R
    const k = ((4 / 3) * Math.tan(turn / 4) * L) / Math.tan(turn / 2);
    const A = { x: V.x - d1.x * L, y: V.y - d1.y * L };
    const B = { x: V.x + d2.x * L, y: V.y + d2.y * L };
    out.push({ x: A.x, y: A.y, ix: A.x, iy: A.y, ox: A.x + d1.x * k, oy: A.y + d1.y * k, type: 'smooth' });
    out.push({ x: B.x, y: B.y, ix: B.x - d2.x * k, iy: B.y - d2.y * k, ox: B.x, oy: B.y, type: 'smooth' });
  }
  return out;
}

/** Arc of an ellipse as Bézier anchors from a0 to a1 (radians, either direction), ≤ 90° per segment. */
function arcAnchors(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): PathAnchor[] {
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const step = (a1 - a0) / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const pts: PathAnchor[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + step * i;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = cx + rx * c;
    const y = cy + ry * s;
    const tx = -rx * s * k;
    const ty = ry * c * k;
    pts.push({ x, y, ix: x - tx, iy: y - ty, ox: x + tx, oy: y + ty, type: 'smooth' });
  }
  return pts;
}

/** Joins two anchor runs end to start (the first run's last anchor and the second's first coincide). */
function sealRing(ring: PathAnchor[]): PathAnchor[] {
  // A closed full circle repeats its start point at the end: merge the two
  const f = ring[0];
  const l = ring[ring.length - 1];
  if (ring.length > 2 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) {
    ring[0] = { ...f, ix: l.ix, iy: l.iy };
    ring.pop();
  }
  return ring;
}

function ellipseRings(s: ShapeProps, w: number, h: number): PathAnchor[][] {
  const cx = w / 2;
  const cy = h / 2;
  const hole = Math.min(0.95, Math.max(0, s.hole ?? 0));
  const start = ((s.pieStart ?? 0) * Math.PI) / 180;
  let end = ((s.pieEnd ?? 360) * Math.PI) / 180;
  if (end <= start) end += Math.PI * 2;
  const full = !isPie(s);
  const outer = arcAnchors(cx, cy, w / 2, h / 2, start, full ? start + Math.PI * 2 : end);
  if (full) {
    // Donut: outer ring plus the hole drawn the other way round, so non-zero filling leaves it empty
    const inner = arcAnchors(cx, cy, (w / 2) * hole, (h / 2) * hole, start + Math.PI * 2, start);
    return [sealRing(outer), sealRing(inner)];
  }
  const first = outer[0];
  const last = outer[outer.length - 1];
  outer[0] = { ...first, ix: first.x, iy: first.y, type: 'corner' };
  outer[outer.length - 1] = { ...last, ox: last.x, oy: last.y, type: 'corner' };
  if (hole <= 0) return [[...outer, corner({ x: cx, y: cy })]];
  // Ring segment: outer arc forward, inner arc back
  const inner = arcAnchors(cx, cy, (w / 2) * hole, (h / 2) * hole, end, start);
  const fi = inner[0];
  const li = inner[inner.length - 1];
  inner[0] = { ...fi, ix: fi.x, iy: fi.y, type: 'corner' };
  inner[inner.length - 1] = { ...li, ox: li.x, oy: li.y, type: 'corner' };
  return [[...outer, ...inner]];
}

/** Archimedean spiral from the centre outwards, one smooth anchor per eighth of a turn. */
export function spiralRing(turns: number, w: number, h: number): PathAnchor[] {
  const T = Math.max(0.25, Math.min(50, turns)) * Math.PI * 2;
  const steps = Math.max(2, Math.ceil(T / (Math.PI / 4)));
  const dt = T / steps;
  const sx = w / 2;
  const sy = h / 2;
  const pts: PathAnchor[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = dt * i;
    const r = t / T;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const x = sx + sx * r * c;
    const y = sy + sy * r * sn;
    // dP/dt of r(t)·(cos t, sin t) with r' = 1/T, scaled by dt/3 for the handles
    const dx = sx * (c / T - r * sn) * (dt / 3);
    const dy = sy * (sn / T + r * c) * (dt / 3);
    pts.push({ x, y, ix: x - dx, iy: y - dy, ox: x + dx, oy: y + dy, type: 'smooth' });
  }
  return pts;
}

// ── Live corners on path anchors ────────────────────────────────────────────────────────────────
// A path anchor with `corner > 0` is drawn with a circular fillet of that radius (px). The anchor
// itself stays a sharp point, so it can still be moved and the rounding follows. Curved sides are
// trimmed exactly (de Casteljau), not approximated by their handle lines.

type Seg = [Pt, Pt, Pt, Pt];
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const samePt = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const unit = (a: Pt, b: Pt): Pt | null => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return l < 1e-9 ? null : { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

/** Sub-curve of a cubic between t0 and t1. */
function subCubic(s: Seg, t0: number, t1: number): Seg {
  const split = (c: Seg, t: number): [Seg, Seg] => {
    const ab = lerp(c[0], c[1], t), bc = lerp(c[1], c[2], t), cd = lerp(c[2], c[3], t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
    return [[c[0], ab, abc, m], [m, bcd, cd, c[3]]];
  };
  let c = s;
  if (t1 < 1) c = split(c, t1)[0];
  if (t0 > 0) c = split(c, t0 / t1)[1];
  return c;
}

// 16-point Gauss–Legendre nodes / weights on [-1, 1] (exact for straight sides, ~1e-9 on curves)
const GL_X = [-0.0950125098, 0.0950125098, -0.2816035508, 0.2816035508, -0.4580167777, 0.4580167777, -0.6178762444, 0.6178762444, -0.7554044084, 0.7554044084, -0.8656312024, 0.8656312024, -0.9445750231, 0.9445750231, -0.9894009350, 0.9894009350];
const GL_W = [0.1894506105, 0.1894506105, 0.1826034150, 0.1826034150, 0.1691565194, 0.1691565194, 0.1495959888, 0.1495959888, 0.1246289713, 0.1246289713, 0.0951585117, 0.0951585117, 0.0622535239, 0.0622535239, 0.0271524594, 0.0271524594];

const speed = (s: Seg, t: number) => {
  const u = 1 - t;
  const dx = 3 * u * u * (s[1].x - s[0].x) + 6 * u * t * (s[2].x - s[1].x) + 3 * t * t * (s[3].x - s[2].x);
  const dy = 3 * u * u * (s[1].y - s[0].y) + 6 * u * t * (s[2].y - s[1].y) + 3 * t * t * (s[3].y - s[2].y);
  return Math.hypot(dx, dy);
};

/** Arc length of a cubic from 0 to t. */
function arcLength(s: Seg, t = 1): number {
  let sum = 0;
  for (let i = 0; i < 16; i++) sum += GL_W[i] * speed(s, (t / 2) * (GL_X[i] + 1));
  return (sum * t) / 2;
}

/** Parameter at arc length `d` from the start (or from the end when `fromEnd`), by bisection. */
function tAtLength(s: Seg, total: number, d: number, fromEnd: boolean): number {
  const target = fromEnd ? total - d : d;
  if (target <= 0) return 0;
  if (target >= total) return 1;
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (arcLength(s, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** True when the anchor's own handles are retracted, so a live corner can round it. */
export const isSharpAnchor = (a: PathAnchor) => samePt({ x: a.ix, y: a.iy }, a) && samePt({ x: a.ox, y: a.oy }, a);

export interface CornerInfo {
  /** Anchor index. */
  index: number;
  /** Unit directions from the anchor toward the previous and the next side. */
  toPrev: Pt;
  toNext: Pt;
  /** Interior angle (radians). */
  angle: number;
  /** Largest radius that still fits (each side gives at most half of its length). */
  maxRadius: number;
}

function ringSegs(ring: PathAnchor[], closed: boolean): Seg[] {
  const n = ring.length;
  const segs: Seg[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    segs.push([{ x: a.x, y: a.y }, { x: a.ox, y: a.oy }, { x: b.ix, y: b.iy }, { x: b.x, y: b.y }]);
  }
  return segs;
}

const segLen = (s: Seg) => arcLength(s);

/** Every anchor of a ring (in px) that a live corner can round, with its geometry. */
export function pathCorners(ring: PathAnchor[], closed: boolean): CornerInfo[] {
  const n = ring.length;
  if (n < 3 && !(closed && n >= 2)) return [];
  const segs = ringSegs(ring, closed);
  const out: CornerInfo[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    const a = ring[i];
    if (!isSharpAnchor(a)) continue;
    const inSeg = segs[(i - 1 + n) % n];
    const outSeg = segs[i];
    // Direction toward the previous side: its in-handle at this anchor, else the curve's far control points
    const toPrev = unit(a, samePt(inSeg[2], a) ? (samePt(inSeg[1], a) ? inSeg[0] : inSeg[1]) : inSeg[2]);
    const toNext = unit(a, samePt(outSeg[1], a) ? (samePt(outSeg[2], a) ? outSeg[3] : outSeg[2]) : outSeg[1]);
    if (!toPrev || !toNext) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, toPrev.x * toNext.x + toPrev.y * toNext.y)));
    if (angle < 1e-3 || angle > Math.PI - 1e-3) continue; // a cusp or a straight run: nothing to round
    const half = Math.min(segLen(inSeg), segLen(outSeg)) / 2;
    out.push({ index: i, toPrev, toNext, angle, maxRadius: half * Math.tan(angle / 2) });
  }
  return out;
}

/** True when any anchor of the shape carries a live corner. */
export const hasPathCorners = (s: ShapeProps) =>
  s.shape === 'path' && [s.points ?? [], ...(s.compoundPoints ?? [])].some((r) => r.some((a) => (a.corner ?? 0) > 0));

/** A ring (px) with every live corner replaced by its fillet; the result has no `corner` fields. */
export function filletRing(ring: PathAnchor[], closed: boolean): PathAnchor[] {
  const n = ring.length;
  const corners = new Map(pathCorners(ring, closed).filter((c) => (ring[c.index].corner ?? 0) > 0).map((c) => [c.index, c]));
  const strip = ring.map(({ corner: _c, ...a }) => a);
  if (!corners.size) return strip;
  const segs = ringSegs(ring, closed);
  const lens = segs.map((s) => arcLength(s));
  // Distance trimmed off each side of every rounded corner: d = r / tan(θ/2), at most half a side
  const trim = new Map<number, number>();
  for (const [i, c] of corners) {
    const lin = lens[(i - 1 + n) % n], lout = lens[i];
    const d = Math.min(ring[i].corner! / Math.tan(c.angle / 2), lin / 2, lout / 2);
    trim.set(i, d);
  }
  // Trim every side by the corners at its ends
  const cut = segs.map((s, k) => {
    const a = k, b = (k + 1) % n;
    const t0 = trim.has(a) ? tAtLength(s, lens[k], trim.get(a)!, false) : 0;
    const t1 = trim.has(b) ? tAtLength(s, lens[k], trim.get(b)!, true) : 1;
    return t0 > 0 || t1 < 1 ? subCubic(s, t0, Math.max(t0 + 1e-6, t1)) : s;
  });
  const out: PathAnchor[] = [];
  for (let i = 0; i < n; i++) {
    const inS = closed || i > 0 ? cut[(i - 1 + n) % n] : null;
    const outS = closed || i < n - 1 ? cut[i] : null;
    const a = strip[i];
    if (!corners.has(i) || !inS || !outS) {
      out.push({ ...a, ix: inS ? inS[2].x : a.ix, iy: inS ? inS[2].y : a.iy, ox: outS ? outS[1].x : a.ox, oy: outS ? outS[1].y : a.oy });
      continue;
    }
    // The arc from the end of the incoming side to the start of the outgoing one
    const q1 = inS[3], q2 = outS[0];
    const t1 = unit(samePt(inS[2], q1) ? inS[0] : inS[2], q1) ?? corners.get(i)!.toPrev;
    const t2 = unit(q2, samePt(outS[1], q2) ? outS[3] : outS[1]) ?? corners.get(i)!.toNext;
    const phi = Math.acos(Math.max(-1, Math.min(1, t1.x * t2.x + t1.y * t2.y)));
    const chord = Math.hypot(q2.x - q1.x, q2.y - q1.y);
    const r = phi > 1e-6 ? chord / (2 * Math.sin(phi / 2)) : 0;
    const k = (4 / 3) * Math.tan(phi / 4) * r;
    out.push(
      { x: q1.x, y: q1.y, ix: inS[2].x, iy: inS[2].y, ox: q1.x + t1.x * k, oy: q1.y + t1.y * k, type: 'smooth' },
      { x: q2.x, y: q2.y, ix: q2.x - t2.x * k, iy: q2.y - t2.y * k, ox: outS[1].x, oy: outS[1].y, type: 'smooth' }
    );
  }
  return out;
}

const scaleRing = (ring: PathAnchor[], sx: number, sy: number, ox = 0, oy = 0): PathAnchor[] =>
  ring.map((a) => ({ ...a, x: ox + a.x * sx, y: oy + a.y * sy, ix: ox + a.ix * sx, iy: oy + a.iy * sy, ox: ox + a.ox * sx, oy: oy + a.oy * sy }));

/** Rings of a path shape in document px (box at x, y, w, h) with live corners filleted. */
export function filletedRings(s: ShapeProps, x: number, y: number, w: number, h: number): PathAnchor[][] {
  const rings = s.compoundPoints?.length ? s.compoundPoints : [s.points ?? []];
  const closed = s.compoundPoints?.length ? true : !!s.closed;
  return rings.map((r) => filletRing(scaleRing(r, w, h, x, y), closed));
}

/** The path with its live corners turned into real anchors (normalised to the same box). */
export function bakePathCorners(s: ShapeProps, w: number, h: number): ShapeProps {
  if (!hasPathCorners(s)) return s;
  const W = w || 1, H = h || 1;
  const rings = filletedRings(s, 0, 0, W, H).map((r) => scaleRing(r, 1 / W, 1 / H));
  return s.compoundPoints?.length ? { ...s, points: rings[0], compoundPoints: rings } : { ...s, points: rings[0] };
}

/**
 * A rectangle's round corners as a 4-anchor path with live corners, so it stays re-roundable after
 * its points are edited. Null for other corner styles (they are baked as before).
 */
export function rectAsLiveCornerPath(s: ShapeProps, w: number, h: number): PathAnchor[] | null {
  if (s.shape !== 'rectangle' && s.shape !== 'round-rect') return null;
  if ((s.cornerStyle ?? 'round') !== 'round') return null;
  const R = clampRadii(Math.abs(w), Math.abs(h), cornerRadii(s));
  const box = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  return box.map((p, i) => ({ ...corner(p), ...(R[i] > 0 ? { corner: R[i] } : {}) }));
}
