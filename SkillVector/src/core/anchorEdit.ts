// The anchor picked with Direct Selection / Anchor Point, as the Properties panel edits it: position,
// point type (corner, smooth, symmetric, or broken "cusp" handles), handle lengths, stepping through
// the anchors and deleting one. Works in document pixels; paths store anchors normalised to their box.

import type { Layer, PathAnchor } from './types';
import { withLayer } from './types';
import { store } from './store';
import { interaction, refitPathBox } from './tools';
import { pathCorners } from './shapeGeometry';

export type AnchorKind = 'corner' | 'smooth' | 'symmetric' | 'cusp';

export interface AnchorInfo {
  layer: Layer;
  index: number;
  count: number;
  closed: boolean;
  /** Document position. */
  x: number;
  y: number;
  kind: AnchorKind;
  /** Handle lengths in document px (0 = retracted). */
  inLen: number;
  outLen: number;
  /** Live corner radius (px), and the largest that fits; null when the point can't be rounded (smooth / end). */
  corner: number;
  maxCorner: number | null;
}

type DocAnchor = PathAnchor;

const EPS = 1e-6;

function toDocAnchors(l: Layer): DocAnchor[] {
  const W = l.width || 1;
  const H = l.height || 1;
  return (l.shape?.points ?? []).map((a) => ({
    ...a, x: l.x + a.x * W, y: l.y + a.y * H, ix: l.x + a.ix * W, iy: l.y + a.iy * H, ox: l.x + a.ox * W, oy: l.y + a.oy * H,
  }));
}

/** Writes document-space anchors back into the layer (normalised, box refitted around them). */
function fromDocAnchors(l: Layer, pts: DocAnchor[]): Layer {
  const W = l.width || 1;
  const H = l.height || 1;
  const n = (a: DocAnchor): PathAnchor => ({
    ...a, x: (a.x - l.x) / W, y: (a.y - l.y) / H, ix: (a.ix - l.x) / W, iy: (a.iy - l.y) / H, ox: (a.ox - l.x) / W, oy: (a.oy - l.y) / H,
  });
  return refitPathBox(withLayer(l, { shape: { ...l.shape!, points: pts.map(n) } }));
}

/** Classifies an anchor by its handles. */
export function anchorKind(a: DocAnchor): AnchorKind {
  const ix = a.ix - a.x, iy = a.iy - a.y, ox = a.ox - a.x, oy = a.oy - a.y;
  const li = Math.hypot(ix, iy);
  const lo = Math.hypot(ox, oy);
  if (li < EPS && lo < EPS) return 'corner';
  if (li < EPS || lo < EPS) return 'cusp';
  // Handles pointing in opposite directions = a smooth point
  const cos = (ix * ox + iy * oy) / (li * lo);
  if (cos > -0.999) return 'cusp';
  return Math.abs(li - lo) < Math.max(0.01, 0.005 * Math.max(li, lo)) ? 'symmetric' : 'smooth';
}

/** The selected anchor of the active path, or null. */
export function selectedAnchor(): AnchorInfo | null {
  const l = store.activeLayer;
  const i = interaction.selectedAnchorIndex;
  if (!l || i === null || interaction.selectedAnchorLayer !== l.id) return null;
  const s = l.shape;
  if (l.kind !== 'shape' || !s?.points || s.compoundPoints?.length || l.rotation) return null;
  const pts = toDocAnchors(l);
  const a = pts[i];
  if (!a) return null;
  const c = pathCorners(pts, !!s.closed).find((k) => k.index === i);
  return {
    layer: l, index: i, count: pts.length, closed: s.closed !== false, x: a.x, y: a.y, kind: anchorKind(a),
    inLen: Math.hypot(a.ix - a.x, a.iy - a.y), outLen: Math.hypot(a.ox - a.x, a.oy - a.y),
    corner: c ? Math.min(a.corner ?? 0, c.maxRadius) : 0, maxCorner: c ? c.maxRadius : null,
  };
}

function commitAnchors(info: AnchorInfo, pts: DocAnchor[], label: string) {
  const doc = store.doc;
  if (!doc) return;
  const next = fromDocAnchors(info.layer, pts);
  store.commit(label, { layers: doc.layers.map((l) => (l.id === info.layer.id ? next : l)) }, { coalesce: `${label}:${info.layer.id}:${info.index}` });
}

/** Moves the anchor (with its handles) to a document position. */
export function moveAnchorTo(x?: number, y?: number) {
  const info = selectedAnchor();
  if (!info) return;
  const pts = toDocAnchors(info.layer);
  const a = pts[info.index];
  const dx = (x ?? a.x) - a.x;
  const dy = (y ?? a.y) - a.y;
  pts[info.index] = { ...a, x: a.x + dx, y: a.y + dy, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy };
  commitAnchors(info, pts, 'Move Anchor Point');
}

/** Neighbours of anchor i (null at the ends of an open path). */
function neighbours(pts: DocAnchor[], i: number, closed: boolean): [DocAnchor | null, DocAnchor | null] {
  const n = pts.length;
  const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 1] : null;
  const next = i < n - 1 ? pts[i + 1] : closed ? pts[0] : null;
  return [prev, next];
}

/**
 * Anchor with smooth handles. The direction follows the curve (the existing handles if the point
 * already has a direction, otherwise the line from the previous to the next anchor); lengths keep
 * the current ones, or a third of the distance to each neighbour.
 */
export function smoothAnchor(pts: DocAnchor[], i: number, closed: boolean, symmetric: boolean): DocAnchor {
  const a = pts[i];
  const [prev, next] = neighbours(pts, i, closed);
  let dx = a.ox - a.ix;
  let dy = a.oy - a.iy;
  if (Math.hypot(dx, dy) < EPS || anchorKind(a) === 'cusp') {
    const p = prev ?? a;
    const q = next ?? a;
    dx = q.x - p.x;
    dy = q.y - p.y;
  }
  const d = Math.hypot(dx, dy);
  if (d < EPS) return a;
  const ux = dx / d;
  const uy = dy / d;
  const li0 = Math.hypot(a.ix - a.x, a.iy - a.y);
  const lo0 = Math.hypot(a.ox - a.x, a.oy - a.y);
  let li = li0 > EPS ? li0 : prev ? Math.hypot(a.x - prev.x, a.y - prev.y) / 3 : 0;
  let lo = lo0 > EPS ? lo0 : next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : 0;
  if (symmetric) li = lo = (li + lo) / 2 || Math.max(li, lo);
  return { ...a, ix: a.x - ux * li, iy: a.y - uy * li, ox: a.x + ux * lo, oy: a.y + uy * lo, type: 'smooth' };
}

/** Converts the selected anchor to a corner (handles retracted), smooth or symmetric point. */
export function convertAnchor(kind: Exclude<AnchorKind, 'cusp'>) {
  const info = selectedAnchor();
  if (!info) return;
  const pts = toDocAnchors(info.layer);
  const a = pts[info.index];
  pts[info.index] = kind === 'corner' ? { ...a, ix: a.x, iy: a.y, ox: a.x, oy: a.y, type: 'corner' } : { ...smoothAnchor(pts, info.index, info.closed, kind === 'symmetric'), corner: undefined };
  commitAnchors(info, pts, kind === 'corner' ? 'Convert to Corner' : kind === 'smooth' ? 'Convert to Smooth' : 'Convert to Symmetric');
}

/** Sets one handle's length, keeping its direction (a retracted handle grows along the curve). */
export function setHandleLength(which: 'in' | 'out', len: number) {
  const info = selectedAnchor();
  if (!info) return;
  const pts = toDocAnchors(info.layer);
  let a = pts[info.index];
  const hx = which === 'in' ? a.ix - a.x : a.ox - a.x;
  const hy = which === 'in' ? a.iy - a.y : a.oy - a.y;
  let l = Math.hypot(hx, hy);
  let ux = hx / (l || 1);
  let uy = hy / (l || 1);
  if (l < EPS) {
    // No direction yet: take it from the smooth version of this point
    const sm = smoothAnchor(pts, info.index, info.closed, false);
    const sx = which === 'in' ? sm.ix - sm.x : sm.ox - sm.x;
    const sy = which === 'in' ? sm.iy - sm.y : sm.oy - sm.y;
    l = Math.hypot(sx, sy);
    if (l < EPS) return;
    ux = sx / l;
    uy = sy / l;
  }
  const L = Math.max(0, len);
  a = which === 'in' ? { ...a, ix: a.x + ux * L, iy: a.y + uy * L } : { ...a, ox: a.x + ux * L, oy: a.y + uy * L };
  pts[info.index] = a;
  commitAnchors(info, pts, 'Handle Length');
}

/** Live corner radius of the selected anchor (0 = sharp). The anchor itself does not move. */
export function setAnchorCorner(r: number) {
  const info = selectedAnchor();
  if (!info || info.maxCorner === null) return;
  const pts = toDocAnchors(info.layer);
  const { corner: _c, ...a } = pts[info.index];
  const v = Math.max(0, Math.min(r, info.maxCorner));
  pts[info.index] = v > 0 ? { ...a, corner: v } : a;
  commitAnchors(info, pts, 'Corner Radius');
}

/** Selects the previous / next anchor (wraps on closed paths). */
export function stepAnchor(delta: number) {
  const info = selectedAnchor();
  if (!info) return;
  const n = info.count;
  const i = info.closed ? (info.index + delta + n) % n : Math.max(0, Math.min(n - 1, info.index + delta));
  interaction.selectedAnchorIndex = i;
  store.emit();
}

/** Deletes the selected anchor; the curve closes over the gap. Paths keep at least 2 (open) / 3 (closed) points. */
export function deleteSelectedAnchor() {
  const info = selectedAnchor();
  if (!info) return;
  if (info.count <= (info.closed ? 3 : 2)) {
    store.toast('A path needs at least ' + (info.closed ? 3 : 2) + ' anchor points');
    return;
  }
  const pts = toDocAnchors(info.layer);
  pts.splice(info.index, 1);
  const doc = store.doc!;
  const next = fromDocAnchors(info.layer, pts);
  interaction.selectedAnchorIndex = Math.min(info.index, pts.length - 1);
  store.commit('Delete Anchor Point', { layers: doc.layers.map((l) => (l.id === info.layer.id ? next : l)) });
}
