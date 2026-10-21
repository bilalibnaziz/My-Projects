/**
 * Variable-width strokes (Width tool, width profiles): the stroke is drawn as a filled outline whose
 * width follows width points placed along the path. Pure geometry, no store or canvas.
 */
import type { PathAnchor, ShapeProps } from './types';

type Pt = { x: number; y: number };

/** A width point: position along the path (0..1 of its length) and width as a multiple of the stroke weight. */
export interface WidthPoint {
  t: number;
  w: number;
}

/** Width profiles offered in the Stroke panel (Illustrator-style presets). */
export const WIDTH_PROFILES: { id: string; label: string; points: WidthPoint[] }[] = [
  { id: 'uniform', label: 'Uniform', points: [] },
  { id: 'lens', label: 'Lens', points: [{ t: 0, w: 0 }, { t: 0.5, w: 1 }, { t: 1, w: 0 }] },
  { id: 'taper-end', label: 'Taper End', points: [{ t: 0, w: 1 }, { t: 1, w: 0 }] },
  { id: 'taper-start', label: 'Taper Start', points: [{ t: 0, w: 0 }, { t: 1, w: 1 }] },
  { id: 'bulge', label: 'Bulge', points: [{ t: 0, w: 0.5 }, { t: 0.5, w: 1.6 }, { t: 1, w: 0.5 }] },
  { id: 'pinch', label: 'Pinch', points: [{ t: 0, w: 1 }, { t: 0.5, w: 0.15 }, { t: 1, w: 1 }] },
  { id: 'brush', label: 'Brush Stroke', points: [{ t: 0, w: 0.1 }, { t: 0.15, w: 1 }, { t: 0.7, w: 0.85 }, { t: 1, w: 0 }] },
];

export const sortWidthPoints = (pts: WidthPoint[]) => [...pts].sort((a, b) => a.t - b.t);

/**
 * Width multiplier at t: smooth (eased) between the points. Like Illustrator, the path's ends keep the
 * stroke weight (×1) unless a point sits on them.
 */
export function widthAt(pts: WidthPoint[] | undefined, t: number): number {
  if (!pts?.length) return 1;
  const s = sortWidthPoints(pts);
  if (s[0].t > 0) s.unshift({ t: 0, w: 1 });
  if (s[s.length - 1].t < 1) s.push({ t: 1, w: 1 });
  if (t <= s[0].t) return s[0].w;
  const last = s[s.length - 1];
  if (t >= last.t) return last.w;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].t) {
      const a = s[i - 1];
      const b = s[i];
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      const e = u * u * (3 - 2 * u);
      return a.w + (b.w - a.w) * e;
    }
  }
  return last.w;
}

/** Widest multiplier of a profile (for the render padding). */
export const maxWidth = (pts: WidthPoint[] | undefined) => Math.max(1, ...(pts ?? []).map((p) => p.w));

const cubic = (a: number, b: number, c: number, d: number, t: number) => {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
};

/** Flattens one sub-path of anchors (already in drawing coordinates) to a polyline. */
export function flattenAnchors(anchors: PathAnchor[], closed: boolean, tol = 0.5): Pt[] {
  const n = anchors.length;
  if (!n) return [];
  const out: Pt[] = [{ x: anchors[0].x, y: anchors[0].y }];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    const straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
    const len = Math.hypot(a.ox - a.x, a.oy - a.y) + Math.hypot(b.ix - a.ox, b.iy - a.oy) + Math.hypot(b.x - b.ix, b.y - b.iy);
    const steps = straight ? 1 : Math.max(2, Math.min(200, Math.ceil(Math.sqrt(len / tol))));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push({ x: cubic(a.x, a.ox, b.ix, b.x, t), y: cubic(a.y, a.oy, b.iy, b.y, t) });
    }
  }
  // Drop zero-length steps (they have no direction)
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > 1e-6);
}

/** Cumulative length at each vertex, and the total. */
export function arcLengths(poly: Pt[]): { at: number[]; total: number } {
  const at = [0];
  for (let i = 1; i < poly.length; i++) at.push(at[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  return { at, total: at[at.length - 1] };
}

/**
 * Outline of a variable-width stroke along `poly`. Open paths give one closed ring (left side out, right
 * side back, with round or square caps); closed paths give an outer and inner ring (fill with even-odd).
 */
export function variableStrokeOutline(poly: Pt[], closed: boolean, weight: number, pts: WidthPoint[] | undefined, cap: ShapeProps['strokeCap'] = 'round'): Pt[][] {
  const trimmed = closed && poly.length > 2 && Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) < 1e-6 ? poly.slice(0, -1) : poly;
  // Widths are set per vertex, so long straight runs need extra vertices for the profile to show
  const p = pts?.length ? densify(trimmed, closed) : trimmed;
  const n = p.length;
  if (n < 2) return [];
  const loop = closed ? [...p, p[0]] : p;
  const { at, total } = arcLengths(loop);
  if (total <= 0) return [];
  const left: Pt[] = [];
  const right: Pt[] = [];
  const dir = (a: Pt, b: Pt) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? p[i - 1] : closed ? p[n - 1] : null;
    const next = i < n - 1 ? p[i + 1] : closed ? p[0] : null;
    const d1 = prev ? dir(prev, p[i]) : dir(p[i], next!);
    const d2 = next ? dir(p[i], next) : d1;
    // Mitred normal: the average direction, lengthened at corners (capped so spikes stay short)
    let nx = -(d1.y + d2.y);
    let ny = d1.x + d2.x;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-6) {
      nx = -d1.y;
      ny = d1.x;
    } else {
      nx /= nl;
      ny /= nl;
    }
    const cos = nx * -d1.y + ny * d1.x;
    const miter = Math.min(2, 1 / Math.max(0.5, cos));
    const half = (weight * widthAt(pts, at[i] / total) * miter) / 2;
    left.push({ x: p[i].x + nx * half, y: p[i].y + ny * half });
    right.push({ x: p[i].x - nx * half, y: p[i].y - ny * half });
  }
  if (closed) return [left, right.reverse()];
  const capPts = (c: Pt, from: Pt, to: Pt, half: number, d: Pt): Pt[] => {
    if (half <= 0.01 || cap === 'butt' || !cap) return [];
    if (cap === 'square') return [{ x: from.x + d.x * half, y: from.y + d.y * half }, { x: to.x + d.x * half, y: to.y + d.y * half }];
    // Round: a half circle from one side to the other, bulging along d
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    const out: Pt[] = [];
    const steps = Math.max(4, Math.ceil(half));
    const sweep = Math.sign((from.x - c.x) * d.y - (from.y - c.y) * d.x) || 1;
    for (let k = 1; k < steps; k++) {
      const a = a0 + (sweep * Math.PI * k) / steps;
      out.push({ x: c.x + Math.cos(a) * half, y: c.y + Math.sin(a) * half });
    }
    return out;
  };
  const dEnd = dir(p[n - 2], p[n - 1]);
  const dStart = dir(p[1], p[0]);
  const hEnd = (weight * widthAt(pts, 1)) / 2;
  const hStart = (weight * widthAt(pts, 0)) / 2;
  const back = [...right].reverse();
  return [[...left, ...capPts(p[n - 1], left[n - 1], right[n - 1], hEnd, dEnd), ...back, ...capPts(p[0], right[0], left[0], hStart, dStart)]];
}

/** Adds vertices so no step is longer than 1/200 of the path (and never under 1 unit). */
function densify(poly: Pt[], closed: boolean): Pt[] {
  const loop = closed ? [...poly, poly[0]] : poly;
  const { total } = arcLengths(loop);
  const step = Math.max(1, total / 200);
  const out: Pt[] = [];
  for (let i = 0; i < loop.length - 1; i++) {
    const a = loop[i];
    const b = loop[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (!closed) out.push(loop[loop.length - 1]);
  return out;
}

/** Nearest point on a polyline: its position along the path (0..1), distance and location. */
export function nearestOnPath(poly: Pt[], q: Pt): { t: number; d: number; at: Pt } {
  const { at, total } = arcLengths(poly);
  let best = { t: 0, d: Infinity, at: poly[0] };
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy || 1;
    const u = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2));
    const x = a.x + vx * u;
    const y = a.y + vy * u;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d < best.d) best = { t: total > 0 ? (at[i - 1] + u * Math.sqrt(l2)) / total : 0, d, at: { x, y } };
  }
  return best;
}

/** Point on a polyline at t (0..1 of its length). */
export function pointAt(poly: Pt[], t: number): Pt {
  const { at, total } = arcLengths(poly);
  const L = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < poly.length; i++) {
    if (at[i] >= L) {
      const u = at[i] > at[i - 1] ? (L - at[i - 1]) / (at[i] - at[i - 1]) : 0;
      return { x: poly[i - 1].x + (poly[i].x - poly[i - 1].x) * u, y: poly[i - 1].y + (poly[i].y - poly[i - 1].y) * u };
    }
  }
  return poly[poly.length - 1];
}
