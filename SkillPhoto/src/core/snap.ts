import type { Layer, Rect } from './types';
import { alphaBounds } from './canvas';
import { layerSurface } from './render';

/** Visible pixel bounds of a layer in document space (null for empty or adjustment layers). */
export function contentBounds(layer: Layer): Rect | null {
  if (layer.kind === 'adjustment') return null;
  const s = layerSurface(layer);
  if (!s) return null;
  const b = alphaBounds(s.canvas, 8);
  return b ? { x: b.x + s.x, y: b.y + s.y, width: b.width, height: b.height } : null;
}

export interface SnapStep {
  x?: { step: number; origin: number };
  y?: { step: number; origin: number };
}

export interface SnapTargets {
  xs: number[];
  ys: number[];
  /** Repeating grids (document grid, square / baseline layout grids): snap to the nearest multiple. */
  steps?: SnapStep[];
}

/** Lines a moving layer can snap to: canvas edges and centre, plus other layers' edges and centres. */
export function snapTargets(docW: number, docH: number, others: Rect[], extra?: { xs: number[]; ys: number[]; steps?: SnapStep[] }): SnapTargets {
  const xs = [0, docW / 2, docW];
  const ys = [0, docH / 2, docH];
  for (const r of others) {
    xs.push(r.x, r.x + r.width / 2, r.x + r.width);
    ys.push(r.y, r.y + r.height / 2, r.y + r.height);
  }
  if (extra) {
    xs.push(...extra.xs);
    ys.push(...extra.ys);
  }
  return { xs, ys, steps: extra?.steps };
}

/** Nearest target to `v` within `tol`: a listed line or a multiple of a repeating grid. */
function nearest(v: number, targets: number[], steps: SnapStep[] | undefined, axis: 'x' | 'y', tol: number): { d: number; guide: number } | null {
  let best: { d: number; guide: number } | null = null;
  const consider = (t: number) => {
    const d = t - v;
    if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, guide: t };
  };
  for (const t of targets) consider(t);
  for (const s of steps ?? []) {
    const g = s[axis];
    if (g && g.step > 0) consider(g.origin + Math.round((v - g.origin) / g.step) * g.step);
  }
  return best;
}

function snapAxis(start: number, size: number, delta: number, targets: number[], steps: SnapStep[] | undefined, axis: 'x' | 'y', tol: number, whole: boolean): { delta: number; guide: number | null } {
  // Left/top, centre and right/bottom edges of the moved box
  const edges = [start + delta, start + delta + size / 2, start + delta + size];
  let best: { d: number; guide: number } | null = null;
  for (const e of edges) {
    const n = nearest(e, targets, steps, axis, tol);
    if (n && (!best || Math.abs(n.d) < Math.abs(best.d))) best = n;
  }
  if (!best) return { delta, guide: null };
  // Pixel layers keep whole-pixel moves (no resampling); vector objects land exactly on the line
  return { delta: whole ? Math.round(delta + best.d) : delta + best.d, guide: best.guide };
}

/**
 * Adjusts a move delta so the box's edges or centre land on the nearest target within `tol`
 * (document pixels). Returns the snapped delta and the guide lines to draw.
 */
export function snapMove(box: Rect, dx: number, dy: number, targets: SnapTargets, tol: number, whole = true) {
  const sx = snapAxis(box.x, box.width, dx, targets.xs, targets.steps, 'x', tol, whole);
  const sy = snapAxis(box.y, box.height, dy, targets.ys, targets.steps, 'y', tol, whole);
  return { dx: sx.delta, dy: sy.delta, guideX: sx.guide, guideY: sy.guide };
}

/** Snaps one point (a new shape corner, a pen anchor, a resize handle) to the targets. */
export function snapPoint(x: number, y: number, targets: SnapTargets, tol: number) {
  const nx = nearest(x, targets.xs, targets.steps, 'x', tol);
  const ny = nearest(y, targets.ys, targets.steps, 'y', tol);
  return { x: nx ? x + nx.d : x, y: ny ? y + ny.d : y, guideX: nx?.guide ?? null, guideY: ny?.guide ?? null };
}
