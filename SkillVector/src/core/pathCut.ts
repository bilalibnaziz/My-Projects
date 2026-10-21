// Scissors: cut a path at the exact point clicked on it (not the nearest anchor). The Bézier
// segment is split there (de Casteljau), so the curve keeps its shape. A closed path opens into one
// path that starts and ends at the cut; an open path becomes two.

import type { Layer, PathAnchor } from './types';
import { makeLayer, withLayer } from './types';
import { convertToEditablePath } from './vectorOps';

interface Pt {
  x: number;
  y: number;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Nearest point on the path to (x, y), in document units: segment index and curve parameter. */
export function nearestOnPath(layer: Layer, x: number, y: number): { seg: number; t: number; dist: number } | null {
  const s = layer.shape;
  const pts = s?.points;
  if (!s || !pts || pts.length < 2) return null;
  const D = (a: Pt): Pt => ({ x: layer.x + a.x * layer.width, y: layer.y + a.y * layer.height });
  const segs = s.closed ? pts.length : pts.length - 1;
  let best: { seg: number; t: number; dist: number } | null = null;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const P = [D(a), D({ x: a.ox, y: a.oy }), D({ x: b.ix, y: b.iy }), D(b)] as const;
    // Coarse samples, then refine around the best one
    let bt = 0;
    let bd = Infinity;
    for (let k = 0; k <= 64; k++) {
      const q = bez(P[0], P[1], P[2], P[3], k / 64);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) [bd, bt] = [d, k / 64];
    }
    let step = 1 / 64;
    for (let it = 0; it < 24; it++) {
      step /= 2;
      for (const t of [bt - step, bt + step]) {
        if (t < 0 || t > 1) continue;
        const q = bez(P[0], P[1], P[2], P[3], t);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < bd) [bd, bt] = [d, t];
      }
    }
    if (!best || bd < best.dist) best = { seg: i, t: bt, dist: bd };
  }
  return best;
}

/** Splits segment a→b at t. Returns the new middle anchor and the updated handles of a and b. */
function splitSegment(a: PathAnchor, b: PathAnchor, t: number) {
  const p0 = { x: a.x, y: a.y };
  const p1 = { x: a.ox, y: a.oy };
  const p2 = { x: b.ix, y: b.iy };
  const p3 = { x: b.x, y: b.y };
  const q0 = lerp(p0, p1, t);
  const q1 = lerp(p1, p2, t);
  const q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const m = lerp(r0, r1, t);
  return {
    a: { ...a, ox: q0.x, oy: q0.y },
    mid: { x: m.x, y: m.y, ix: r0.x, iy: r0.y, ox: r1.x, oy: r1.y, type: 'corner' } as PathAnchor,
    b: { ...b, ix: q2.x, iy: q2.y },
  };
}

/** Path points are relative to the layer box: refit the box to an open piece's anchors and handles. */
function fitted(layer: Layer, pts: PathAnchor[]): Layer {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of pts)
    for (const [u, v] of [[a.x, a.y], [a.ix, a.iy], [a.ox, a.oy]]) {
      x0 = Math.min(x0, u); x1 = Math.max(x1, u);
      y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
  const W = layer.width || 1;
  const H = layer.height || 1;
  const nw = Math.max((x1 - x0) * W, 1e-6);
  const nh = Math.max((y1 - y0) * H, 1e-6);
  const nx = layer.x + x0 * W;
  const ny = layer.y + y0 * H;
  const fx = (u: number) => (layer.x + u * W - nx) / nw;
  const fy = (v: number) => (layer.y + v * H - ny) / nh;
  const points = pts.map((a) => ({ ...a, x: fx(a.x), y: fy(a.y), ix: fx(a.ix), iy: fy(a.iy), ox: fx(a.ox), oy: fy(a.oy) }));
  return withLayer(layer, { x: nx, y: ny, width: nw, height: nh, shape: { ...layer.shape!, points, closed: false, compoundPoints: undefined } });
}

/**
 * Scissors at (x, y). `tol` is the pick distance in document units. Returns the replacement layers
 * (one for a closed path, two for an open one), or null when the click is not on the path.
 */
export function cutPathAt(layer: Layer, x: number, y: number, tol: number): Layer[] | null {
  if (layer.kind !== 'shape' || !layer.shape) return null;
  if (layer.shape.compoundPoints?.length) return null;
  const ed = layer.shape.points && !layer.rotation ? layer : convertToEditablePath(layer);
  const s = ed.shape;
  const pts = s?.points;
  if (!s || !pts || pts.length < 2) return null;
  const hit = nearestOnPath(ed, x, y);
  if (!hit || hit.dist > tol) return null;
  const n = pts.length;
  const i = hit.seg;
  const j = (i + 1) % n;
  // Cutting right at an anchor: use that anchor as the cut instead of a zero-length piece
  const atStart = hit.t < 1e-4;
  const atEnd = hit.t > 1 - 1e-4;
  let cut: PathAnchor;
  const work = pts.map((p) => ({ ...p }));
  let insertAfter = i;
  if (atStart || atEnd) {
    const k = atStart ? i : j;
    cut = { ...work[k] };
    insertAfter = -1;
    if (s.closed) {
      // Open the loop at anchor k: k is both the first and the last point
      const order = [...work.slice(k), ...work.slice(0, k)];
      const first = { ...order[0], ix: order[0].x, iy: order[0].y };
      const last = { ...order[0], ox: order[0].x, oy: order[0].y };
      return [fitted(ed, [first, ...order.slice(1), last])];
    }
    if (k === 0 || k === n - 1) return null; // the end of an open path: nothing to cut
    const a = work.slice(0, k + 1);
    const b = work.slice(k);
    a[a.length - 1] = { ...cut, ox: cut.x, oy: cut.y };
    b[0] = { ...cut, ix: cut.x, iy: cut.y };
    return [fitted(ed, a), fitted(makeLayer({ ...ed, kind: 'shape', name: `${ed.name} Cut` }), b)];
  }
  const sp = splitSegment(work[i], work[j], hit.t);
  work[i] = sp.a;
  work[j] = sp.b;
  cut = sp.mid;
  if (s.closed) {
    // One open path from the cut, round the loop, back to the cut
    const order = [...work.slice(j), ...work.slice(0, insertAfter + 1)];
    const first = { ...cut, ix: cut.x, iy: cut.y };
    const last = { ...cut, ox: cut.x, oy: cut.y };
    return [fitted(ed, [first, ...order, last])];
  }
  const a = [...work.slice(0, i + 1), { ...cut, ox: cut.x, oy: cut.y }];
  const b = [{ ...cut, ix: cut.x, iy: cut.y }, ...work.slice(j)];
  return [fitted(ed, a), fitted(makeLayer({ ...ed, kind: 'shape', name: `${ed.name} Cut` }), b)];
}
