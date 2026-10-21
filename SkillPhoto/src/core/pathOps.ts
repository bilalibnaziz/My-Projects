/**
 * Object ▸ Path: Offset Path and Round Corners on any shape (curves included, compound paths too).
 */
import type { Layer, PathAnchor } from './types';
import { withLayer } from './types';
import { store } from './store';
import { flattenDocPath, offsetPolyline, ringsToShapeLayer, type DocAnchor } from './vectorOps';
import { polygonArea, type PolygonRing } from './polygonClipping';
import { docSubpaths, isEditableShape, withDocSubpaths } from './pathHelpers';

/**
 * Offset Path: a new path `d` px outside the shape (inside when negative), placed just behind it with
 * the same style. Curves are flattened, offset with mitred joins (bevelled when very sharp) and refitted.
 */
export function offsetPathLayer(l: Layer, d: number): Layer | null {
  if (!isEditableShape(l) || !d) return null;
  const { subs, closed } = docSubpaths(l);
  if (!closed) return null;
  const curved = new Set<string>();
  const rings: PolygonRing[] = [];
  // The outer ring decides which side is "outside"; holes offset the opposite way so they shrink
  const outerSign = Math.sign(polygonArea(flattenDocPath(subs[0], true))) || 1;
  for (const sub of subs) {
    const line = flattenDocPath(sub, true, curved).filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-6);
    if (line.length < 3) continue;
    const grow = offsetPolyline(line, d, true);
    const shrink = offsetPolyline(line, -d, true);
    const sameWay = Math.sign(polygonArea(line)) === outerSign;
    // Outward for the outline = the candidate with the larger area; holes take the other one
    const bigger = Math.abs(polygonArea(grow)) > Math.abs(polygonArea(shrink)) ? grow : shrink;
    const smaller = bigger === grow ? shrink : grow;
    const pick = (d > 0) === sameWay ? bigger : smaller;
    // An inset larger than the shape flips the ring inside out: drop it
    if (Math.sign(polygonArea(pick)) !== Math.sign(polygonArea(line))) continue;
    rings.push(pick);
  }
  if (!rings.length) return null;
  return ringsToShapeLayer(rings, l.shape!, `${l.name} Offset`, l, curved);
}

/** Object ▸ Path ▸ Offset Path… on every selected closed shape. */
export function offsetSelected(d: number): number {
  const doc = store.doc;
  if (!doc) return 0;
  const made: { src: string; layer: Layer }[] = [];
  for (const l of store.selectedLayers) {
    const o = offsetPathLayer(l, d);
    if (o) made.push({ src: l.id, layer: o });
  }
  if (!made.length) {
    store.toast('Offset Path: select a closed shape (an inset bigger than the shape leaves nothing)');
    return 0;
  }
  const bySrc = new Map(made.map((m) => [m.src, m.layer]));
  // Each offset goes right behind its source, in the same group
  const layers = doc.layers.flatMap((l) => {
    const o = bySrc.get(l.id);
    return o ? [withLayer(o, { parent: l.parent }), l] : [l];
  });
  store.commit('Offset Path', { layers, activeId: made[made.length - 1].layer.id }, { icon: 'shape' });
  store.setSelectedLayers(made.map((m) => m.layer.id));
  return made.length;
}

const same = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) < 1e-6 && Math.abs(ay - by) < 1e-6;
const KAPPA = 0.5522847498;

/** Corner anchors (no handles) replaced by a round arc of radius r; smooth points and curves stay. */
export function roundAnchors(sub: DocAnchor[], closed: boolean, r: number): PathAnchor[] {
  const n = sub.length;
  const out: PathAnchor[] = [];
  for (let i = 0; i < n; i++) {
    const p = sub[i];
    const isEnd = !closed && (i === 0 || i === n - 1);
    const sharp = same(p.ix, p.iy, p.x, p.y) && same(p.ox, p.oy, p.x, p.y);
    if (isEnd || !sharp || n < 3) {
      out.push({ ...p, type: sharp ? 'corner' : 'smooth' });
      continue;
    }
    const a = sub[(i - 1 + n) % n];
    const b = sub[(i + 1) % n];
    // Towards the neighbours (their handle if the segment is curved, else the anchor)
    const ta = same(a.ox, a.oy, a.x, a.y) ? a : { x: a.ox, y: a.oy };
    const tb = same(b.ix, b.iy, b.x, b.y) ? b : { x: b.ix, y: b.iy };
    const la = Math.hypot(ta.x - p.x, ta.y - p.y);
    const lb = Math.hypot(tb.x - p.x, tb.y - p.y);
    if (la < 1e-6 || lb < 1e-6) {
      out.push({ ...p, type: 'corner' });
      continue;
    }
    // A corner can use at most half of each side
    const rr = Math.min(r, la / 2, lb / 2);
    const p1 = { x: p.x + ((ta.x - p.x) / la) * rr, y: p.y + ((ta.y - p.y) / la) * rr };
    const p2 = { x: p.x + ((tb.x - p.x) / lb) * rr, y: p.y + ((tb.y - p.y) / lb) * rr };
    out.push(
      { x: p1.x, y: p1.y, ix: p1.x, iy: p1.y, ox: p1.x + (p.x - p1.x) * KAPPA, oy: p1.y + (p.y - p1.y) * KAPPA, type: 'corner' },
      { x: p2.x, y: p2.y, ix: p2.x + (p.x - p2.x) * KAPPA, iy: p2.y + (p.y - p2.y) * KAPPA, ox: p2.x, oy: p2.y, type: 'corner' }
    );
  }
  return out;
}

/** Object ▸ Path ▸ Round Corners…: live rectangles get a corner radius; other shapes get round arcs. */
export function roundCornersSelected(r: number): number {
  const doc = store.doc;
  if (!doc || r <= 0) return 0;
  const changed = new Map<string, Layer>();
  for (const l of store.selectedLayers) {
    if (!isEditableShape(l)) continue;
    const s = l.shape!;
    if ((s.shape === 'rectangle' || s.shape === 'round-rect') && !s.points) {
      changed.set(l.id, withLayer(l, { shape: { ...s, shape: 'round-rect', radius: r } }));
      continue;
    }
    const { layer, subs, closed } = docSubpaths(l);
    const rounded = subs.map((sub) => roundAnchors(sub, closed, r));
    if (rounded.every((sub, i) => sub.length === subs[i].length)) continue;
    changed.set(l.id, withDocSubpaths(layer, rounded, closed));
  }
  if (!changed.size) {
    store.toast('Round Corners: select a shape with sharp corners');
    return 0;
  }
  store.commit('Round Corners', { layers: doc.layers.map((l) => changed.get(l.id) ?? l) }, { icon: 'shape' });
  return changed.size;
}
