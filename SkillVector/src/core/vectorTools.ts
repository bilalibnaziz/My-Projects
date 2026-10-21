// Vector tools that edit path geometry directly: Paintbrush, Blob Brush, Eraser, Path Eraser, Knife,
// Shaper, Shear, Reshape, Puppet Warp, the Liquify family (Warp, Twirl, Pucker, Bloat, Scallop,
// Crystallize, Wrinkle), Gradient / Mesh on shapes, Blend, Live Paint Bucket and the Symbol tools.
// Everything works in document space and writes back normalised shape layers, so results stay editable.

import { joinAlpha, splitAlpha } from './gradientStops';
import { addStopAt, annotatorHit, dragAnnotator, pickGradientStop } from './gradientAnnotator';
import type { AnnotatorHit } from './gradientAnnotator';
import { store } from './store';
import type { Layer, PathAnchor, ShapeProps, Slice } from './types';
import { defaultFx, makeLayer, uid, withLayer } from './types';
import { convertToEditablePath, smoothLayerPath, fitAnchors, flattenDocPath, simplifyClosed, simplifyPolyline, type DocAnchor } from './vectorOps';
import { clipPolygons, ensureCcw, orientByNesting, pointInRings, polygonArea, polygonsInteract, ringsToRegions, subtractRings, uniteRings, type PolygonRing, type Point2D } from './polygonClipping';
import { detectQuickShape, fitStroke, type QuickShapeResult } from './pencilEngine';
import { BUILTIN_SYMBOLS, currentSymbol, instanceOf } from './symbols';
import { flattenAnchors, nearestOnPath as nearestOnPolyline, pointAt, sortWidthPoints, widthAt, type WidthPoint } from './strokeProfile';

type Pt = Point2D;

// ================================================================ geometry helpers

export const isEditableShape = (l: Layer | null | undefined): l is Layer => !!l && l.kind === 'shape' && !!l.shape && !l.locked && l.visible;

/** Every sub-path of a shape layer in document space (live rotation baked in). */
export function docSubpaths(l: Layer): { layer: Layer; subs: DocAnchor[][]; closed: boolean } {
  const layer = convertToEditablePath(l);
  const s = layer.shape!;
  const lists = s.compoundPoints?.length ? s.compoundPoints : [s.points ?? []];
  const map = (p: PathAnchor): DocAnchor => ({
    x: layer.x + p.x * layer.width,
    y: layer.y + p.y * layer.height,
    ix: layer.x + p.ix * layer.width,
    iy: layer.y + p.iy * layer.height,
    ox: layer.x + p.ox * layer.width,
    oy: layer.y + p.oy * layer.height,
  });
  return { layer, subs: lists.map((ps) => ps.map(map)).filter((ps) => ps.length > 0), closed: !!s.closed };
}

/** `like` with new sub-paths (document space); keeps its id, style and settings. */
export function withDocSubpaths(like: Layer, subs: PathAnchor[][], closed: boolean, extra: Partial<ShapeProps> = {}): Layer {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sub of subs) {
    for (const a of sub) {
      minX = Math.min(minX, a.x, a.ix, a.ox);
      minY = Math.min(minY, a.y, a.iy, a.oy);
      maxX = Math.max(maxX, a.x, a.ix, a.ox);
      maxY = Math.max(maxY, a.y, a.iy, a.oy);
    }
  }
  const W = Math.max(1, maxX - minX);
  const H = Math.max(1, maxY - minY);
  const norm = (a: PathAnchor): PathAnchor => ({
    ...a,
    x: (a.x - minX) / W,
    y: (a.y - minY) / H,
    ix: (a.ix - minX) / W,
    iy: (a.iy - minY) / H,
    ox: (a.ox - minX) / W,
    oy: (a.oy - minY) / H,
  });
  const pts = subs.map((s) => s.map(norm));
  return withLayer(like, {
    x: minX,
    y: minY,
    width: W,
    height: H,
    rotation: 0,
    shape: { ...like.shape!, ...extra, shape: 'path', points: pts[0] ?? [], compoundPoints: pts.length > 1 ? pts : undefined, closed },
  });
}

/** A copy of `like` (new id) with the given sub-paths. */
function pieceOf(like: Layer, subs: PathAnchor[][], closed: boolean, name: string): Layer {
  const { id: _id, v: _v, ...rest } = like;
  return withDocSubpaths(makeLayer({ ...rest, name }), subs, closed);
}

function cubicAt(a: DocAnchor, b: DocAnchor, t: number): Pt {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * a.x + 3 * mt * mt * t * a.ox + 3 * mt * t * t * b.ix + t * t * t * b.x,
    y: mt * mt * mt * a.y + 3 * mt * mt * t * a.oy + 3 * mt * t * t * b.iy + t * t * t * b.y,
  };
}

/** Points along a sub-path about `step` apart; anchors are always included. */
export function samplePath(sub: DocAnchor[], closed: boolean, step: number): Pt[] {
  const out: Pt[] = [];
  const n = sub.length;
  if (!n) return out;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = sub[i];
    const b = sub[(i + 1) % n];
    const len = Math.hypot(a.ox - a.x, a.oy - a.y) + Math.hypot(b.ix - a.ox, b.iy - a.oy) + Math.hypot(b.x - b.ix, b.y - b.iy);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push(cubicAt(a, b, j / k));
  }
  if (!closed || n === 1) out.push({ x: sub[n - 1].x, y: sub[n - 1].y });
  return out;
}

/** Smooth anchors through a dense polyline; turns sharper than 50° stay corners. */
function refit(pts: Pt[], closed: boolean, tol = 0.5): PathAnchor[] {
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y, type: 'corner' as const }));
  const simple = closed ? simplifyClosed(pts, tol) : simplifyPolyline(pts, tol);
  return fitAnchors(simple, closed, true, 50);
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolyline(p: Pt, line: Pt[]): number {
  if (line.length === 1) return Math.hypot(p.x - line[0].x, p.y - line[0].y);
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, distToSeg(p, line[i], line[i + 1]));
  return d;
}

function dedupe(path: Pt[], min = 0.5): Pt[] {
  const out: Pt[] = [];
  for (const p of path) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) >= min) out.push({ x: p.x, y: p.y });
  return out;
}

function circleRing(c: Pt, r: number, n = 24): PolygonRing {
  const ring: PolygonRing = [];
  for (let k = 0; k < n; k++) ring.push({ x: c.x + r * Math.cos((k / n) * Math.PI * 2), y: c.y + r * Math.sin((k / n) * Math.PI * 2) });
  return ensureCcw(ring);
}

function capsuleRing(a: Pt, b: Pt, r: number, n = 10): PolygonRing {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const ring: PolygonRing = [];
  for (let k = 0; k <= n; k++) {
    const t = ang - Math.PI / 2 + (Math.PI * k) / n;
    ring.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) });
  }
  for (let k = 0; k <= n; k++) {
    const t = ang + Math.PI / 2 + (Math.PI * k) / n;
    ring.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) });
  }
  return ensureCcw(ring);
}

/** Outline of a round brush of `radius` dragged along `path` (even-odd rings). */
export function brushOutline(path: Pt[], radius: number): PolygonRing[] {
  const pts = simplifyPolyline(dedupe(path), Math.max(0.4, radius * 0.12));
  if (pts.length < 2 || (pts.length === 2 && Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 0.5)) return [circleRing(pts[0], radius)];
  return uniteRings(pts.slice(0, -1).map((p, i) => capsuleRing(p, pts[i + 1], radius)));
}

function ringsBox(rings: PolygonRing[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

const boxesTouch = (a: ReturnType<typeof ringsBox>, b: ReturnType<typeof ringsBox>) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** A closed shape's filled area as even-odd rings (outer edges counter-clockwise, holes clockwise). */
function layerRings(subs: DocAnchor[][]): PolygonRing[] {
  return orientByNesting(subs.map((s) => flattenDocPath(s, true)).filter((r) => r.length >= 3));
}

const totalArea = (rings: PolygonRing[]) => rings.reduce((a, r) => a + polygonArea(r), 0);

/** Replaces layers in place (each id by a list of pieces) as one undo step, selecting the pieces. */
function replaceLayers(label: string, replace: Map<string, Layer[]>) {
  const doc = store.doc!;
  const layers: Layer[] = [];
  const made: string[] = [];
  for (const l of doc.layers) {
    const r = replace.get(l.id);
    if (!r) layers.push(l);
    else {
      layers.push(...r);
      made.push(...r.map((x) => x.id));
    }
  }
  const active = made.length ? made[made.length - 1] : layers.some((l) => l.id === doc.activeId) ? doc.activeId : layers[layers.length - 1]?.id;
  store.commit(label, { layers, activeId: active });
  if (made.length) store.setSelectedLayers(made);
}

/** The shapes a cutting tool works on: the selected ones, or every shape it touches when none is selected. */
function cutTargets(box: ReturnType<typeof ringsBox>): Layer[] {
  const doc = store.doc!;
  const selected = store.selectedLayers.filter(isEditableShape);
  const pool = selected.length ? selected : doc.layers.filter(isEditableShape);
  return pool.filter((l) => {
    const pad = (l.shape?.strokeWidth ?? 0) / 2 + 1;
    const lb = { minX: l.x - pad, minY: l.y - pad, maxX: l.x + l.width + pad, maxY: l.y + l.height + pad };
    if (l.rotation) {
      const r = Math.hypot(l.width, l.height) / 2 + pad;
      const cx = l.x + l.width / 2, cy = l.y + l.height / 2;
      return boxesTouch({ minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r }, box);
    }
    return boxesTouch(lb, box);
  });
}

// ================================================================ path cutting (Path Eraser, Eraser on strokes)

/** Open runs of a path left after removing everything within `radius` of `line`; null when nothing is removed. */
function cutRuns(subs: DocAnchor[][], closed: boolean, line: Pt[], radius: number): Pt[][] | null {
  const runs: Pt[][] = [];
  let removed = false;
  for (const sub of subs) {
    const pts = samplePath(sub, closed, 1);
    const hit = pts.map((p) => distToPolyline(p, line) <= radius);
    if (!hit.some(Boolean)) {
      runs.push(closed ? [...pts, pts[0]] : pts);
      continue;
    }
    removed = true;
    if (hit.every(Boolean)) continue;
    let order = pts.map((_, i) => i);
    if (closed) {
      // Start just after a removed point so no run wraps around the seam
      const first = hit.indexOf(true);
      order = pts.map((_, i) => (first + i) % pts.length);
    }
    let cur: Pt[] = [];
    for (const i of order) {
      if (hit[i]) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
      } else cur.push(pts[i]);
    }
    if (cur.length >= 2) runs.push(cur);
  }
  return removed ? runs.filter((r) => r.length >= 2) : null;
}

/** Path Eraser: removes the parts of the selected paths (or any path) under the drag. */
export function pathEraseAlong(path: Pt[], radius: number): boolean {
  const doc = store.doc;
  if (!doc || !path.length) return false;
  const box = ringsBox([path.map((p) => ({ x: p.x, y: p.y }))]);
  const grown = { minX: box.minX - radius, minY: box.minY - radius, maxX: box.maxX + radius, maxY: box.maxY + radius };
  const replace = new Map<string, Layer[]>();
  for (const l of cutTargets(grown)) {
    const { layer, subs, closed } = docSubpaths(l);
    const runs = cutRuns(subs, closed, path, radius + (layer.shape!.strokeWidth || 1) / 2);
    if (!runs) continue;
    replace.set(l.id, runs.map((r, i) => (i === 0 ? withDocSubpaths(layer, [refit(r, false)], false) : pieceOf(layer, [refit(r, false)], false, `${l.name} ${i + 1}`))));
  }
  if (!replace.size) return false;
  replaceLayers('Path Eraser', replace);
  return true;
}

// ================================================================ Eraser (vector) and Knife

/** Eraser: cuts a brush-wide channel out of filled shapes and splits strokes under the drag. */
export function eraseAlong(path: Pt[], radius: number): boolean {
  const doc = store.doc;
  if (!doc || !path.length) return false;
  const cutter = brushOutline(path, radius);
  const cbox = ringsBox(cutter);
  const replace = new Map<string, Layer[]>();
  for (const l of cutTargets(cbox)) {
    const { layer, subs, closed } = docSubpaths(l);
    const s = layer.shape!;
    if (!closed || !s.fillEnabled) {
      const runs = cutRuns(subs, closed, path, radius + (s.strokeWidth || 1) / 2);
      if (runs) replace.set(l.id, runs.map((r, i) => (i === 0 ? withDocSubpaths(layer, [refit(r, false)], false) : pieceOf(layer, [refit(r, false)], false, `${l.name} ${i + 1}`))));
      continue;
    }
    const rings = layerRings(subs);
    if (!boxesTouch(ringsBox(rings), cbox)) continue;
    const before = totalArea(rings);
    const result = ringsToRegions(rings).flatMap((reg) => subtractRings(reg.rings[0], [...reg.rings.slice(1).map((h) => ensureCcw(h)), ...cutter]));
    const after = totalArea(result);
    if (Math.abs(before - after) < 0.5) continue;
    const regions = ringsToRegions(orientByNesting(result));
    replace.set(
      l.id,
      regions.map((reg, i) => {
        const subsOut = reg.rings.map((r) => refit(r, true, 0.35));
        return i === 0 ? withDocSubpaths(layer, subsOut, true) : pieceOf(layer, subsOut, true, `${l.name} ${i + 1}`);
      })
    );
  }
  if (!replace.size) return false;
  replaceLayers('Erase', replace);
  return true;
}

/**
 * Knife: splits every closed shape the drag fully crosses into separate shapes along the drawn line
 * (both ends of the cut must lie outside the shape).
 */
export function knifeAlong(path: Pt[], zoom = 1): boolean {
  const doc = store.doc;
  // Measured on screen, so a cut zoomed in is as precise as the drag
  const line = simplifyPolyline(dedupe(path, 1 / zoom), 0.5 / zoom);
  if (!doc || line.length < 2) return false;
  const lbox = ringsBox([line]);
  const replace = new Map<string, Layer[]>();
  for (const l of cutTargets(lbox)) {
    const { layer, subs, closed } = docSubpaths(l);
    if (!closed) continue;
    const rings = layerRings(subs);
    if (pointInRings(line[0], rings) || pointInRings(line[line.length - 1], rings)) continue;
    const side = halfPlane(line, ringsBox(rings));
    const pieces: PolygonRing[][] = [];
    for (const reg of ringsToRegions(rings)) {
      const holes = reg.rings.slice(1).map((h) => ensureCcw(h));
      const left = clipPolygons(reg.rings[0], side, 'intersect').filter((r) => polygonArea(r) > 0);
      const right = subtractRings(reg.rings[0], [side]).filter((r) => polygonArea(r) > 0);
      for (const piece of [...left, ...right]) {
        const cut = holes.length ? subtractRings(piece, holes) : [piece];
        for (const region of ringsToRegions(orientByNesting(cut))) pieces.push(region.rings);
      }
    }
    if (pieces.length < 2) continue;
    replace.set(l.id, pieces.map((rs, i) => {
      const subsOut = rs.map((r) => refit(r, true, 0.35));
      return i === 0 ? withDocSubpaths(layer, subsOut, true) : pieceOf(layer, subsOut, true, `${l.name} ${i + 1}`);
    }));
  }
  if (!replace.size) return false;
  replaceLayers('Knife', replace);
  return true;
}

/** The region on one side of a cut line: the line, extended far past `box` at both ends, closed by a big arc. */
function halfPlane(line: Pt[], box: ReturnType<typeof ringsBox>): PolygonRing {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const R = (Math.hypot(box.maxX - box.minX, box.maxY - box.minY) + Math.hypot(line[0].x - cx, line[0].y - cy) + Math.hypot(line[line.length - 1].x - cx, line[line.length - 1].y - cy)) * 4 + 100;
  const ext = (p: Pt, q: Pt): Pt => {
    const d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
    return { x: p.x + ((p.x - q.x) / d) * R, y: p.y + ((p.y - q.y) / d) * R };
  };
  const start = ext(line[0], line[1]);
  const end = ext(line[line.length - 1], line[line.length - 2]);
  const ring: PolygonRing = [start, ...line, end];
  // Back around the far side, counter-clockwise from the end to the start
  const a0 = Math.atan2(end.y - cy, end.x - cx);
  let a1 = Math.atan2(start.y - cy, start.x - cx);
  while (a1 <= a0) a1 += Math.PI * 2;
  const far = R * 3;
  for (let k = 1; k < 32; k++) {
    const a = a0 + ((a1 - a0) * k) / 32;
    ring.push({ x: cx + far * Math.cos(a), y: cy + far * Math.sin(a) });
  }
  return ensureCcw(ring);
}

// ================================================================ Paintbrush, Blob Brush, Shaper

/** Paintbrush: the drag becomes a smooth open path stroked with the foreground colour. */
export function paintbrushPath(path: Pt[], width: number, zoom = 1): Layer | null {
  const pts = dedupe(path, 0.75 / zoom);
  if (pts.length < 2) return null;
  // The tolerance is on screen (2.5 px), so strokes are as faithful zoomed in as zoomed out; corners stay sharp
  const tol = 2.5 / zoom;
  const anchors = fitStroke(pts, tol, { minStep: 0.75 / zoom, reach: Math.max(tol * 2.5, 6 / zoom) });
  if (anchors.length < 2) return null;
  const like = makeLayer({
    kind: 'shape',
    name: 'Brush Stroke',
    shape: { shape: 'path', fill: store.state.fg, fillEnabled: false, stroke: store.state.fg, strokeWidth: Math.max(1, width), radius: 0, strokeCap: 'round', strokeJoin: 'round' },
  });
  const layer = withDocSubpaths(like, [anchors], false);
  store.insertLayer(layer, undefined, 'Paintbrush');
  return layer;
}

/**
 * Blob Brush: the drag becomes a filled shape; it merges with blob shapes of the same colour it
 * touches, like Illustrator's.
 */
export function blobBrushPath(path: Pt[], radius: number): Layer | null {
  const doc = store.doc;
  if (!doc || !path.length) return null;
  const fill = store.state.fg;
  let rings = brushOutline(path, radius);
  const box = ringsBox(rings);
  const merged: Layer[] = [];
  for (const l of doc.layers) {
    if (!isEditableShape(l) || !l.name.startsWith('Blob') || l.shape!.fill.toLowerCase() !== fill.toLowerCase() || !l.shape!.closed) continue;
    const lr = layerRings(docSubpaths(l).subs).filter((r) => polygonArea(r) > 0);
    if (!boxesTouch(ringsBox(lr), box)) continue;
    const outers = rings.filter((r) => polygonArea(r) > 0);
    if (!lr.some((a) => outers.some((b) => polygonsInteract(a, b)))) continue;
    rings = uniteRings([...lr, ...rings]);
    merged.push(l);
  }
  const subs = rings.map((r) => refit(r, true, 0.35));
  const like = merged[0] ?? makeLayer({ kind: 'shape', name: 'Blob', shape: { shape: 'path', fill, fillEnabled: true, stroke: fill, strokeWidth: 0, radius: 0 } });
  const layer = withDocSubpaths(like, subs, true);
  const drop = new Set(merged.map((l) => l.id));
  if (merged.length) {
    // The merged blobs become one shape in the place of the first of them
    const layers = doc.layers.filter((l) => !drop.has(l.id) || l.id === merged[0].id).map((l) => (l.id === merged[0].id ? layer : l));
    store.commit('Blob Brush', { layers, activeId: layer.id });
  } else store.insertLayer(layer, undefined, 'Blob Brush');
  return layer;
}

/** Shaper: a rough gesture becomes a clean rectangle, ellipse, triangle, polygon or line. */
export function shaperGesture(path: Pt[], zoom: number): Layer | null {
  const pts = dedupe(path, 0.75 / zoom);
  const qs = detectQuickShape(pts, 28 / zoom) ?? classifyGesture(pts, 28 / zoom);
  if (!qs || qs.confidence < 0.5) {
    store.toast('Shaper: draw a rough rectangle, ellipse, triangle or straight line');
    return null;
  }
  const o = store.state.opts;
  const isLine = qs.shapeType === 'line' || qs.shapeType === 'arrow';
  const shape: ShapeProps = {
    shape: qs.shapeType === 'path' ? 'path' : qs.shapeType,
    fill: store.state.fg,
    fillEnabled: !isLine && qs.closed,
    stroke: isLine || !qs.closed ? store.state.fg : o.shapeStrokeColor || '#000000',
    strokeWidth: isLine || !qs.closed ? Math.max(2, o.shapeStrokeWidth || 2) : o.shapeStrokeWidth || 0,
    radius: 0,
    sides: qs.shapeType === 'star' ? 5 : 3,
    strokeCap: 'round',
    strokeJoin: 'round',
  };
  const name = `Shaper ${qs.kind.charAt(0).toUpperCase()}${qs.kind.slice(1)}`;
  let layer: Layer;
  if (qs.shapeType === 'path' && qs.anchors?.length) {
    layer = withDocSubpaths(makeLayer({ kind: 'shape', name, shape: { ...shape, shape: 'path' } }), [qs.anchors], qs.closed);
  } else if (qs.shapeType === 'line') {
    // A line keeps its direction: its box runs from the first point to the last
    const a = pts[0], b = pts[pts.length - 1];
    layer = makeLayer({ kind: 'shape', name, shape, x: a.x, y: a.y, width: b.x - a.x || 1, height: b.y - a.y || 1 });
  } else {
    layer = makeLayer({ kind: 'shape', name, shape, x: qs.rect.x, y: qs.rect.y, width: Math.max(2, qs.rect.width), height: Math.max(2, qs.rect.height), ...(qs.rotation ? { rotation: qs.rotation } : {}) });
  }
  store.insertLayer(layer, undefined, 'Shaper');
  return layer;
}

/**
 * Shaper's own recogniser: a closed gesture is classed by how much of its bounding box it fills
 * (rectangle ≈ 1, ellipse ≈ π/4, triangle ≈ ½); an open, nearly straight one is a line.
 */
function classifyGesture(pts: Pt[], closeTol: number): QuickShapeResult | null {
  if (pts.length < 5) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const a = pts[0], z = pts[pts.length - 1];
  const gap = Math.hypot(z.x - a.x, z.y - a.y);
  const box = ringsBox([pts]);
  const rect = { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
  if (gap > Math.max(closeTol, len * 0.2)) {
    if (gap / len > 0.92) return { kind: 'line', shapeType: 'line', rect, confidence: 0.9, closed: false };
    return null;
  }
  const fill = Math.abs(polygonArea(pts)) / Math.max(1, rect.width * rect.height);
  if (rect.width < 4 || rect.height < 4) return null;
  if (fill > 0.88) return { kind: 'rectangle', shapeType: 'rectangle', rect, confidence: 0.9, closed: true };
  if (fill > 0.66) return { kind: 'ellipse', shapeType: 'ellipse', rect, confidence: 0.85, closed: true };
  if (fill > 0.38) {
    // Triangle: the apex is the point farthest from the bottom edge's line
    return { kind: 'triangle', shapeType: 'polygon', rect, confidence: 0.8, closed: true };
  }
  return null;
}

// ================================================================ drag sessions (Shear, Reshape, Puppet Warp, Liquify, Gradient, Mesh, Symbols)

type Session =
  | { kind: 'shear'; start: Pt; base: { layer: Layer; subs: DocAnchor[][]; closed: boolean }[]; cx: number; cy: number; h: number; w: number }
  | { kind: 'reshape'; start: Pt; layer: Layer; subs: DocAnchor[][]; closed: boolean; grab: { s: number; i: number }; radius: number }
  | { kind: 'puppet'; start: Pt; layer: Layer; subs: DocAnchor[][]; closed: boolean; pin: number; pins: Pt[] }
  | { kind: 'liquify'; tool: LiquifyTool; last: Pt; layer: Layer; dense: Pt[][]; closed: boolean; step: number; moved: boolean }
  | { kind: 'gradient'; start: Pt; targets: Layer[]; radial: boolean }
  | { kind: 'gradient-edit'; start: Pt; layer: Layer; hit: AnnotatorHit; moved: boolean; zoom: number; shift: boolean }
  | { kind: 'mesh'; layerId: string; index: number; start: Pt }
  | { kind: 'width'; layer: Layer; poly: Pt[]; index: number; pts: WidthPoint[]; start: Pt; added: boolean }
  | { kind: 'smooth'; layer: Layer; subs: DocAnchor[][]; closed: boolean; r: number; moved: boolean; last: Pt }
  | { kind: 'symbols'; tool: ToolName; last: Pt; label: string; travel: number }
  | { kind: 'grid'; part: 'left' | 'right' | 'horizon' }
  | { kind: 'persp'; start: Pt; layer: Layer; subs: DocAnchor[][]; closed: boolean }
  | { kind: 'slice-new'; start: Pt }
  | { kind: 'slice-move'; id: string; start: Pt; orig: Slice; moved: boolean };

type ToolName = string;
export type LiquifyTool = 'warp' | 'twirl' | 'pucker' | 'bloat' | 'scallop' | 'crystallize' | 'wrinkle';

let session: Session | null = null;

/** Overlay state the viewport draws: puppet pins and the liquify / symbol brush ring. */
export const vectorOverlay = {
  pins: null as null | { layerId: string; pts: Pt[] },
  brush: null as null | { x: number; y: number; r: number },
  blendFirst: null as null | string,
  /** Slice tools: the slice being dragged out, and the selected slice. */
  sliceDraft: null as null | { x: number; y: number; width: number; height: number },
  activeSlice: null as null | string,
  /** A value shown next to the pointer while a session drags (gradient angle, stop %). */
  readout: null as null | { text: string; x: number; y: number },
};

export const sessionActive = () => !!session;

function replaceLive(layers: Layer[]) {
  const ids = new Map(layers.map((l) => [l.id, l]));
  store.live({ layers: store.doc!.layers.map((l) => ids.get(l.id) ?? l) });
}

// ---------------------------------------------------------------- Shear

export function shearDown(p: Pt, targets: Layer[]): boolean {
  const shapes = targets.filter(isEditableShape);
  if (!shapes.length) return false;
  const base = shapes.map((l) => docSubpaths(l));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of base) for (const s of b.subs) for (const a of s) {
    minX = Math.min(minX, a.x); minY = Math.min(minY, a.y); maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
  }
  session = { kind: 'shear', start: p, base, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  return true;
}

/** Horizontal shear about the centre; a mostly vertical drag (or Shift) shears vertically instead. */
function shearMove(p: Pt, shift: boolean) {
  const s = session as Extract<Session, { kind: 'shear' }>;
  const dx = p.x - s.start.x, dy = p.y - s.start.y;
  const vertical = shift || Math.abs(dy) > Math.abs(dx);
  const refY = Math.abs(s.start.y - s.cy) > 4 ? s.start.y - s.cy : s.h / 2;
  const refX = Math.abs(s.start.x - s.cx) > 4 ? s.start.x - s.cx : s.w / 2;
  const k = vertical ? dy / refX : dx / refY;
  const map = (x: number, y: number) => (vertical ? { x, y: y + k * (x - s.cx) } : { x: x + k * (y - s.cy), y });
  const out = s.base.map(({ layer, subs, closed }) =>
    withDocSubpaths(layer, subs.map((sub) => sub.map((a) => {
      const P = map(a.x, a.y), I = map(a.ix, a.iy), O = map(a.ox, a.oy);
      return { x: P.x, y: P.y, ix: I.x, iy: I.y, ox: O.x, oy: O.y, type: 'corner' as const };
    })), closed)
  );
  replaceLive(out);
}

// ---------------------------------------------------------------- Width tool

/** The first sub-path of a shape as a document-space polyline (where width points are measured). */
function widthPath(l: Layer): { layer: Layer; poly: Pt[] } | null {
  const { layer, subs, closed } = docSubpaths(l);
  const poly = subs[0]?.length >= 2 ? flattenAnchors(subs[0] as PathAnchor[], closed) : [];
  return poly.length >= 2 ? { layer, poly } : null;
}

/** Handles the viewport draws for the Width tool: each width point and its two side handles. */
export function widthHandles(l: Layer | null | undefined): { at: Pt; a: Pt; b: Pt }[] {
  if (!isEditableShape(l) || !l.shape!.widthPoints?.length) return [];
  const wp = widthPath(l);
  if (!wp) return [];
  return l.shape!.widthPoints.map((q) => {
    const at = pointAt(wp.poly, q.t);
    const ahead = pointAt(wp.poly, Math.min(1, q.t + 0.002));
    const behind = pointAt(wp.poly, Math.max(0, q.t - 0.002));
    const dl = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
    const nx = -(ahead.y - behind.y) / dl;
    const ny = (ahead.x - behind.x) / dl;
    const half = (l.shape!.strokeWidth * q.w) / 2;
    return { at, a: { x: at.x + nx * half, y: at.y + ny * half }, b: { x: at.x - nx * half, y: at.y - ny * half } };
  });
}

/**
 * Width tool press: on a width point grabs it (⌥ deletes it), elsewhere on the stroke adds a point there.
 * Dragging away from the path sets the width at that point. Shapes are converted to paths first.
 */
export function widthDown(p: Pt, l: Layer, zoom: number, alt: boolean): boolean {
  if (!isEditableShape(l) || !(l.shape!.strokeWidth > 0)) return false;
  const wp = widthPath(l);
  if (!wp) return false;
  const near = nearestOnPolyline(wp.poly, p);
  const reach = Math.max((l.shape!.strokeWidth * Math.max(1, ...(l.shape!.widthPoints ?? []).map((q) => q.w))) / 2, 4 / zoom) + 6 / zoom;
  if (near.d > reach) return false;
  const pts = sortWidthPoints(l.shape!.widthPoints ?? []);
  const total = wp.poly.reduce((acc, q, i) => (i ? acc + Math.hypot(q.x - wp.poly[i - 1].x, q.y - wp.poly[i - 1].y) : 0), 0);
  let index = pts.findIndex((q) => Math.abs(q.t - near.t) * total < 8 / zoom);
  if (alt) {
    if (index < 0) return true;
    pts.splice(index, 1);
    const layer = withLayer(wp.layer, { shape: { ...wp.layer.shape!, widthPoints: pts.length ? pts : undefined } });
    store.commit('Delete Width Point', { layers: store.doc!.layers.map((x) => (x.id === layer.id ? layer : x)) });
    return true;
  }
  const added = index < 0;
  if (added) {
    pts.push({ t: near.t, w: widthAt(pts, near.t) });
    const sorted = sortWidthPoints(pts);
    index = sorted.findIndex((q) => q.t === near.t);
    pts.splice(0, pts.length, ...sorted);
  }
  const layer = withLayer(wp.layer, { shape: { ...wp.layer.shape!, widthPoints: pts } });
  session = { kind: 'width', layer, poly: wp.poly, index, pts, start: p, added };
  replaceLive([layer]);
  return true;
}

function widthMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'width' }>;
  const at = pointAt(s.poly, s.pts[s.index].t);
  const sw = s.layer.shape!.strokeWidth || 1;
  const pts = s.pts.map((q, i) => (i === s.index ? { ...q, w: Math.min(40, Math.round(((2 * Math.hypot(p.x - at.x, p.y - at.y)) / sw) * 100) / 100) } : q));
  replaceLive([withLayer(s.layer, { shape: { ...s.layer.shape!, widthPoints: pts } })]);
}

// ---------------------------------------------------------------- Smooth tool

/** Smooth tool press on a path: brushing over it relaxes the anchors under the brush. */
export function smoothDown(p: Pt, l: Layer, r: number): boolean {
  if (!isEditableShape(l)) return false;
  const { layer, subs, closed } = docSubpaths(l);
  if (!subs.some((sub) => sub.length >= 3)) return false;
  session = { kind: 'smooth', layer, subs: subs.map((sub) => sub.map((a) => ({ ...a }))), closed, r, moved: false, last: p };
  vectorOverlay.brush = { x: p.x, y: p.y, r };
  store.requestRender();
  return true;
}

/**
 * One brush step: each anchor under the brush moves part of the way to the middle of its neighbours
 * (more near the centre) and gets smooth handles along their direction. Path ends stay put.
 */
function smoothMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'smooth' }>;
  vectorOverlay.brush = { x: p.x, y: p.y, r: s.r };
  if (Math.hypot(p.x - s.last.x, p.y - s.last.y) < 1) return store.requestRender();
  s.last = p;
  let touched = false;
  for (const sub of s.subs) {
    const n = sub.length;
    if (n < 3) continue;
    const next = sub.map((a) => ({ ...a }));
    for (let i = 0; i < n; i++) {
      if (!s.closed && (i === 0 || i === n - 1)) continue;
      const a = sub[i];
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d > s.r) continue;
      const w = 0.35 * (1 - d / s.r);
      const pa = sub[(i - 1 + n) % n];
      const pb = sub[(i + 1) % n];
      const x = a.x + ((pa.x + pb.x) / 2 - a.x) * w;
      const y = a.y + ((pa.y + pb.y) / 2 - a.y) * w;
      // Catmull-Rom tangent: a sixth of the neighbour-to-neighbour vector each way
      const tx = (pb.x - pa.x) / 6;
      const ty = (pb.y - pa.y) / 6;
      next[i] = { x, y, ix: x - tx, iy: y - ty, ox: x + tx, oy: y + ty };
      touched = true;
    }
    sub.splice(0, n, ...next);
  }
  if (!touched) return store.requestRender();
  s.moved = true;
  replaceLive([withDocSubpaths(s.layer, s.subs.map((sub) => sub.map((a) => ({ ...a, type: 'smooth' as const }))), s.closed)]);
}

// ---------------------------------------------------------------- Reshape

/** Reshape: grabs the path at the pointer (adding an anchor there if needed) and bends it with a soft falloff. */
export function reshapeDown(p: Pt, layer: Layer, zoom: number): boolean {
  if (!isEditableShape(layer)) return false;
  const { layer: L, subs, closed } = docSubpaths(layer);
  // Nearest anchor within reach, else the nearest point on the path becomes a new anchor
  let best = { s: -1, i: -1, d: Infinity };
  subs.forEach((sub, si) => sub.forEach((a, i) => {
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < best.d) best = { s: si, i, d };
  }));
  let work = subs.map((s) => s.map((a) => ({ ...a })));
  if (best.d > 10 / zoom) {
    const hit = nearestOnPath(work, closed, p);
    if (!hit || hit.d > 24 / zoom) return false;
    work = splitAt(work, closed, hit.s, hit.seg, hit.t);
    best = { s: hit.s, i: hit.seg + 1, d: 0 };
  }
  const box = { w: L.width, h: L.height };
  session = { kind: 'reshape', start: p, layer: L, subs: work, closed, grab: { s: best.s, i: best.i }, radius: Math.max(20, Math.hypot(box.w, box.h) * 0.45) };
  return true;
}

function reshapeMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'reshape' }>;
  const dx = p.x - s.start.x, dy = p.y - s.start.y;
  const g = s.subs[s.grab.s][s.grab.i];
  const out = s.subs.map((sub) => sub.map((a) => {
    const d = Math.hypot(a.x - g.x, a.y - g.y);
    const w = a === g ? 1 : Math.max(0, 1 - d / s.radius) ** 2;
    return { x: a.x + dx * w, y: a.y + dy * w, ix: a.ix + dx * w, iy: a.iy + dy * w, ox: a.ox + dx * w, oy: a.oy + dy * w, type: 'smooth' as const };
  }));
  replaceLive([withDocSubpaths(s.layer, out, s.closed)]);
}

function nearestOnPath(subs: DocAnchor[][], closed: boolean, p: Pt) {
  let best: { s: number; seg: number; t: number; d: number } | null = null;
  subs.forEach((sub, si) => {
    const segs = closed ? sub.length : sub.length - 1;
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k <= 24; k++) {
        const q = cubicAt(sub[i], sub[(i + 1) % sub.length], k / 24);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || d < best.d) best = { s: si, seg: i, t: k / 24, d };
      }
    }
  });
  return best as { s: number; seg: number; t: number; d: number } | null;
}

/** De Casteljau split of segment `seg` at t: inserts an anchor there without changing the curve. */
function splitAt(subs: DocAnchor[][], _closed: boolean, si: number, seg: number, t: number): DocAnchor[][] {
  const sub = subs[si];
  const a = sub[seg], b = sub[(seg + 1) % sub.length];
  const lerp = (p: Pt, q: Pt, u: number) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
  const p0 = { x: a.x, y: a.y }, p1 = { x: a.ox, y: a.oy }, p2 = { x: b.ix, y: b.iy }, p3 = { x: b.x, y: b.y };
  const p01 = lerp(p0, p1, t), p12 = lerp(p1, p2, t), p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  const na = { ...a, ox: p01.x, oy: p01.y };
  const nb = { ...b, ix: p23.x, iy: p23.y };
  const mid: DocAnchor = { x: m.x, y: m.y, ix: p012.x, iy: p012.y, ox: p123.x, oy: p123.y };
  const next = sub.map((x) => ({ ...x }));
  next[seg] = na;
  next[(seg + 1) % sub.length] = nb;
  next.splice(seg + 1, 0, mid);
  return subs.map((s, i) => (i === si ? next : s));
}

// ---------------------------------------------------------------- Puppet Warp

/**
 * Puppet Warp: click the shape to add pins (the first press also pins its two far ends), drag a pin to
 * bend the shape around the others. Alt-click a pin removes it.
 */
export function puppetDown(p: Pt, layer: Layer, zoom: number, alt: boolean): boolean {
  if (!isEditableShape(layer)) return false;
  const { layer: L, subs, closed } = docSubpaths(layer);
  if (vectorOverlay.pins?.layerId !== layer.id) vectorOverlay.pins = { layerId: layer.id, pts: [] };
  const pins = vectorOverlay.pins.pts;
  const near = pins.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 10 / zoom);
  if (alt) {
    if (near >= 0) pins.splice(near, 1);
    store.requestRender();
    return true;
  }
  let pin = near;
  if (pin < 0) {
    if (pins.length === 0) {
      // Anchor the two ends farthest apart so the first drag bends instead of moving the whole shape
      const all = subs.flat();
      let best = [0, 0], far = -1;
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
        if (d > far) { far = d; best = [i, j]; }
      }
      for (const k of best) if (all[k] && Math.hypot(all[k].x - p.x, all[k].y - p.y) > 12 / zoom) pins.push({ x: all[k].x, y: all[k].y });
    }
    pins.push({ x: p.x, y: p.y });
    pin = pins.length - 1;
  }
  session = { kind: 'puppet', start: p, layer: L, subs, closed, pin, pins: pins.map((q) => ({ ...q })) };
  store.requestRender();
  return true;
}

function puppetMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'puppet' }>;
  const dx = p.x - s.start.x, dy = p.y - s.start.y;
  // Inverse-distance weights: points near a fixed pin stay, points near the dragged pin follow it
  const move = (x: number, y: number) => {
    let sw = 0, mx = 0, my = 0;
    for (let j = 0; j < s.pins.length; j++) {
      const d2 = (x - s.pins[j].x) ** 2 + (y - s.pins[j].y) ** 2 + 1e-3;
      const w = 1 / (d2 * d2);
      sw += w;
      if (j === s.pin) { mx += w * dx; my += w * dy; }
    }
    return { x: x + mx / sw, y: y + my / sw };
  };
  const out = s.subs.map((sub) => sub.map((a) => {
    const P = move(a.x, a.y), I = move(a.ix, a.iy), O = move(a.ox, a.oy);
    return { x: P.x, y: P.y, ix: I.x, iy: I.y, ox: O.x, oy: O.y, type: 'smooth' as const };
  }));
  if (vectorOverlay.pins) vectorOverlay.pins.pts[s.pin] = { x: s.pins[s.pin].x + dx, y: s.pins[s.pin].y + dy };
  replaceLive([withDocSubpaths(s.layer, out, s.closed)]);
}

// ---------------------------------------------------------------- Liquify family

export function liquifyDown(p: Pt, layer: Layer, tool: LiquifyTool, radius: number): boolean {
  if (!isEditableShape(layer)) return false;
  const { layer: L, subs, closed } = docSubpaths(layer);
  // Dense points so the brush bends edges, not only the existing corners
  const step = Math.max(1.5, radius / 10);
  session = { kind: 'liquify', tool, last: p, layer: L, dense: subs.map((s) => samplePath(s, closed, step)), closed, step, moved: false };
  vectorOverlay.brush = { x: p.x, y: p.y, r: radius };
  if (tool !== 'warp') liquifyStep(p, radius, store.state.opts.strength || 0.5, false);
  return true;
}

function liquifyStep(p: Pt, radius: number, strength: number, alt: boolean) {
  const s = session as Extract<Session, { kind: 'liquify' }>;
  const ddx = p.x - s.last.x, ddy = p.y - s.last.y;
  s.last = p;
  vectorOverlay.brush = { x: p.x, y: p.y, r: radius };
  const k = Math.max(0.05, Math.min(1, strength));
  s.dense = s.dense.map((pts) => {
    const out: Pt[] = [];
    pts.forEach((q, i) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= radius) return out.push(q);
      const f = (1 - d / radius) ** 2;
      let x = q.x, y = q.y;
      switch (s.tool) {
        case 'warp':
          x += ddx * f; y += ddy * f;
          break;
        case 'twirl': {
          const a = f * k * 0.12 * (alt ? -1 : 1);
          x = p.x + dx * Math.cos(a) - dy * Math.sin(a);
          y = p.y + dx * Math.sin(a) + dy * Math.cos(a);
          break;
        }
        // Pull / push by a brush-sized step each move, never past the centre
        case 'pucker': {
          const m = Math.min(d, f * k * radius * 0.05);
          if (d > 0) { x -= (dx / d) * m; y -= (dy / d) * m; }
          break;
        }
        case 'bloat':
          if (d > 0) { x += (dx / d) * f * k * radius * 0.05; y += (dy / d) * f * k * radius * 0.05; }
          break;
        case 'scallop': {
          const m = Math.min(d, f * k * radius * 0.06 * (0.5 + 0.5 * Math.sin(i * 1.7)));
          if (d > 0) { x -= (dx / d) * m; y -= (dy / d) * m; }
          break;
        }
        case 'crystallize': {
          const m = f * k * radius * 0.06 * (0.5 + 0.5 * Math.sin(i * 1.7));
          if (d > 0) { x += (dx / d) * m; y += (dy / d) * m; }
          break;
        }
        case 'wrinkle': {
          const n = Math.sin(i * 12.9898 + q.x * 0.21) * 43758.5453;
          const r = (n - Math.floor(n) - 0.5) * 2;
          const len = d || 1;
          x += (-dy / len) * r * f * k * 2.4; y += (dx / len) * r * f * k * 2.4;
          break;
        }
      }
      // Keep the outline dense where it stretches
      const prev = out[out.length - 1];
      if (prev && Math.hypot(x - prev.x, y - prev.y) > s.step * 2) {
        const m = Math.ceil(Math.hypot(x - prev.x, y - prev.y) / s.step);
        for (let j = 1; j < m; j++) out.push({ x: prev.x + ((x - prev.x) * j) / m, y: prev.y + ((y - prev.y) * j) / m });
      }
      out.push({ x, y });
    });
    return out;
  });
  s.moved = true;
  const subs = s.dense.map((pts) => refit(pts, s.closed, 0.3));
  replaceLive([withDocSubpaths(s.layer, subs, s.closed)]);
}

// ---------------------------------------------------------------- Gradient and Mesh on shapes

/** Gradient tool on shapes: drag sets the gradient direction (Alt: radial) from the foreground to the background colour. */
export function gradientDown(p: Pt, targets: Layer[], radial: boolean, zoom = 1): boolean {
  const shapes = targets.filter((l) => isEditableShape(l) && l.shape!.fillEnabled);
  if (!shapes.length) return false;
  // On an existing gradient: its handles, stops and line edit it in place (gradientAnnotator.ts)
  for (const l of shapes.length === 1 ? shapes : shapes.filter((x) => x.id === store.activeLayer?.id)) {
    const hit = annotatorHit(l, p, zoom);
    if (hit) {
      session = { kind: 'gradient-edit', start: p, layer: l, hit, moved: false, zoom, shift: false };
      if (hit.kind === 'stop') pickGradientStop(l.id, hit.index);
      return true;
    }
  }
  session = { kind: 'gradient', start: p, targets: shapes, radial: radial || store.state.opts.gradientType === 'radial' };
  return true;
}

function gradientEditMove(p: Pt, shift: boolean) {
  const s = session as Extract<Session, { kind: 'gradient-edit' }>;
  if (!s.moved && Math.hypot(p.x - s.start.x, p.y - s.start.y) * s.zoom < 2) return;
  s.moved = true;
  s.shift = shift;
  const r = dragAnnotator(s.layer, s.hit, p, { shift, zoom: s.zoom });
  if (!r) return;
  replaceLive([withLayer(s.layer, { shape: { ...s.layer.shape!, gradient: r.gradient } })]);
  vectorOverlay.readout = { text: r.readout, x: p.x, y: p.y };
}

function gradientEditUp(s: Extract<Session, { kind: 'gradient-edit' }>, p: Pt) {
  vectorOverlay.readout = null;
  const l = s.layer;
  if (!s.moved) {
    if (s.hit.kind === 'line') {
      const r = addStopAt(l, s.hit.t);
      if (!r) return;
      pickGradientStop(l.id, r.index);
      store.updateLayer(l.id, { shape: { ...l.shape!, gradient: r.gradient } }, 'Add Gradient Stop', `gstop:${Date.now()}`);
    } else store.emit();
    return;
  }
  const r = dragAnnotator(l, s.hit, p, { shift: s.shift, zoom: s.zoom });
  if (!r) return store.revert();
  if (r.removed) pickGradientStop(l.id, 0);
  replaceLive([withLayer(l, { shape: { ...l.shape!, gradient: r.gradient } })]);
  const label = r.removed ? 'Delete Gradient Stop' : s.hit.kind === 'stop' ? 'Move Gradient Stop' : 'Gradient Direction';
  store.commit(label, { layers: store.doc!.layers });
}

function gradientMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'gradient' }>;
  replaceLive(s.targets.map((l) => applyGradient(l, s.start, p, s.radial)));
}

function applyGradient(l: Layer, a: Pt, b: Pt, radial: boolean): Layer {
  const W = l.width || 1, H = l.height || 1;
  let A = a, B = b;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 3) {
    // A click: the default left-to-right gradient across the shape
    A = radial ? { x: l.x + W / 2, y: l.y + H / 2 } : { x: l.x, y: l.y + H / 2 };
    B = radial ? { x: l.x + W, y: l.y + H / 2 } : { x: l.x + W, y: l.y + H / 2 };
  }
  const prev = l.shape!.gradient;
  const o = store.state.opts;
  // A new gradient follows the options bar: Foreground → Background / Transparent, Reverse, Reflected
  const c0 = store.state.fg;
  const c1 = o.gradientMode === 'fg-transparent' ? joinAlpha(splitAlpha(c0).hex, 0) : store.state.bg;
  const [from, to] = o.gradientReverse ? [c1, c0] : [c0, c1];
  const reflected = !radial && o.gradientType === 'reflected' && !prev?.stops?.length;
  const stops = prev?.stops?.length
    ? prev.stops
    : reflected
      ? [{ offset: 0, color: to }, { offset: 0.5, color: from }, { offset: 1, color: to }]
      : [{ offset: 0, color: from }, { offset: 1, color: to }];
  // Reflected: mirrored about the press point, so the line starts as far behind it as the drag went
  if (reflected) A = { x: 2 * A.x - B.x, y: 2 * A.y - B.y };
  return withLayer(l, {
    shape: {
      ...l.shape!,
      gradient: { type: radial ? 'radial' : 'linear', x0: (A.x - l.x) / W, y0: (A.y - l.y) / H, x1: (B.x - l.x) / W, y1: (B.y - l.y) / H, stops },
    },
  });
}

/** Mesh tool: click a shape to add a colour point (foreground colour), drag a point to move it, Alt-click removes it. */
export function meshDown(p: Pt, layer: Layer, zoom: number, alt: boolean): boolean {
  if (!isEditableShape(layer) || !layer.shape!.fillEnabled || layer.rotation) return false;
  const s = layer.shape!;
  const W = layer.width || 1, H = layer.height || 1;
  const mesh = [...(s.mesh ?? [])];
  const near = mesh.findIndex((m) => Math.hypot(layer.x + m.x * W - p.x, layer.y + m.y * H - p.y) <= 10 / zoom);
  if (alt) {
    if (near < 0) return true;
    mesh.splice(near, 1);
    store.commit('Remove Mesh Point', { layers: store.doc!.layers.map((l) => (l.id === layer.id ? withLayer(l, { shape: { ...s, mesh } }) : l)) });
    return true;
  }
  let index = near;
  if (index < 0) {
    mesh.push({ x: (p.x - layer.x) / W, y: (p.y - layer.y) / H, color: store.state.fg, spread: 0.45 });
    index = mesh.length - 1;
    store.live({ layers: store.doc!.layers.map((l) => (l.id === layer.id ? withLayer(l, { shape: { ...s, mesh } }) : l)) });
  }
  session = { kind: 'mesh', layerId: layer.id, index, start: p };
  return true;
}

function meshMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'mesh' }>;
  const l = store.doc!.layers.find((x) => x.id === s.layerId);
  if (!l?.shape?.mesh) return;
  const mesh = l.shape.mesh.map((m, i) => (i === s.index ? { ...m, x: (p.x - l.x) / (l.width || 1), y: (p.y - l.y) / (l.height || 1) } : m));
  replaceLive([withLayer(l, { shape: { ...l.shape, mesh } })]);
}

/** Every mesh point of the active layer, in document space (for the overlay). */
export function meshPoints(l: Layer | null): Pt[] {
  if (!l?.shape?.mesh) return [];
  return l.shape.mesh.map((m) => ({ x: l.x + m.x * l.width, y: l.y + m.y * l.height }));
}

// ---------------------------------------------------------------- Symbols

const SYMBOL_SIZE = 28;

export function symbolRadius() {
  return Math.max(30, (store.state.opts.size || 20) * 2);
}

function sprayOne(p: Pt): Layer {
  const r = symbolRadius();
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r * 0.6;
  const def = currentSymbol();
  // The built-in star takes the foreground colour; document symbols keep their own artwork
  const builtin = BUILTIN_SYMBOLS.some((b) => b.id === def.id);
  const like = builtin ? { ...def, shape: { ...def.shape, fill: store.state.fg, stroke: store.state.opts.shapeStrokeColor || '#000000' } } : def;
  // Natural size, capped so big artwork still sprays at brush scale
  const fit = Math.min(1, (SYMBOL_SIZE * 2.5) / Math.max(def.width, def.height));
  const scale = (builtin ? SYMBOL_SIZE / def.width : fit) * (0.8 + Math.random() * 0.4);
  return instanceOf(like, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, scale, { rotation: Math.round((Math.random() - 0.5) * 30) });
}

const SYMBOL_LABEL: Record<string, string> = {
  'symbol-sprayer': 'Spray Symbols',
  'symbol-shifter': 'Shift Symbols',
  'symbol-scruncher': 'Scrunch Symbols',
  'symbol-sizer': 'Size Symbols',
  'symbol-spinner': 'Spin Symbols',
  'symbol-stainer': 'Stain Symbols',
  'symbol-screener': 'Screen Symbols',
  'symbol-styler': 'Style Symbols',
};

export function symbolDown(p: Pt, tool: string, alt: boolean): boolean {
  const doc = store.doc;
  if (!doc) return false;
  if (tool !== 'symbol-sprayer' && !doc.layers.some((l) => l.symbol && !l.locked && l.visible)) {
    store.toast('No symbol instances yet: spray some with the Symbol Sprayer first');
    return true;
  }
  session = { kind: 'symbols', tool, last: p, label: tool === 'symbol-sprayer' && alt ? 'Remove Symbols' : SYMBOL_LABEL[tool] ?? 'Symbols', travel: 0 };
  vectorOverlay.brush = { x: p.x, y: p.y, r: symbolRadius() };
  if (tool === 'symbol-sprayer') {
    if (alt) symbolStep(p, true, true);
    else store.live({ layers: [...doc.layers, sprayOne(p)] });
    return true;
  }
  symbolStep(p, alt, true);
  return true;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return t < 0.5 ? a : b;
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

function symbolStep(p: Pt, alt: boolean, first = false) {
  const s = session as Extract<Session, { kind: 'symbols' }>;
  const doc = store.doc!;
  const R = symbolRadius();
  const ddx = p.x - s.last.x, ddy = p.y - s.last.y;
  s.travel += Math.hypot(ddx, ddy);
  s.last = p;
  vectorOverlay.brush = { x: p.x, y: p.y, r: R };
  if (s.tool === 'symbol-sprayer') {
    if (!first && s.travel < SYMBOL_SIZE * 0.7) return store.requestRender();
    s.travel = 0;
    if (alt) {
      // ⌥: removes the nearest instance of the chosen symbol under the brush
      const id = currentSymbol().id;
      let best: Layer | null = null;
      let bd = R;
      for (const l of doc.layers) {
        if (l.symbol !== id || l.locked || !l.visible) continue;
        const d = Math.hypot(l.x + l.width / 2 - p.x, l.y + l.height / 2 - p.y);
        if (d < bd) [best, bd] = [l, d];
      }
      if (best) store.live({ layers: doc.layers.filter((l) => l !== best) });
      else store.requestRender();
      return;
    }
    store.live({ layers: [...doc.layers, sprayOne(p)] });
    return;
  }
  const fg = store.state.fg;
  const layers = doc.layers.map((l) => {
    if (!l.symbol || l.locked || !l.visible) return l;
    const cx = l.x + l.width / 2, cy = l.y + l.height / 2;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d > R) return l;
    const w = 1 - d / R;
    switch (s.tool) {
      case 'symbol-shifter':
        return withLayer(l, { x: l.x + ddx * w, y: l.y + ddy * w });
      case 'symbol-scruncher': {
        const k = (alt ? -0.06 : 0.06) * w;
        return withLayer(l, { x: l.x + (p.x - cx) * k, y: l.y + (p.y - cy) * k });
      }
      case 'symbol-sizer': {
        const f = alt ? 1 / (1 + 0.05 * w) : 1 + 0.05 * w;
        const nw = Math.max(4, l.width * f), nh = Math.max(4, l.height * f);
        return withLayer(l, { x: cx - nw / 2, y: cy - nh / 2, width: nw, height: nh });
      }
      case 'symbol-spinner': {
        if (first || Math.hypot(ddx, ddy) < 0.5) return withLayer(l, { rotation: ((l.rotation ?? 0) + (alt ? -6 : 6) * w) % 360 });
        const target = (Math.atan2(ddy, ddx) * 180) / Math.PI;
        const cur = l.rotation ?? 0;
        const diff = ((((target - cur) % 360) + 540) % 360) - 180;
        return withLayer(l, { rotation: cur + diff * 0.25 * w });
      }
      case 'symbol-stainer':
        return l.shape ? withLayer(l, { shape: { ...l.shape, fill: mixHex(l.shape.fill, alt ? '#ffffff' : fg, 0.15 * w) } }) : l;
      case 'symbol-screener':
        return withLayer(l, { opacity: Math.max(0.1, Math.min(1, l.opacity + (alt ? 0.05 : -0.05) * w)) });
      case 'symbol-styler': {
        const fx = l.fx ?? defaultFx();
        if (alt) return l.fx?.dropShadow.enabled ? withLayer(l, { fx: { ...fx, dropShadow: { ...fx.dropShadow, enabled: false } } }) : l;
        return fx.dropShadow.enabled ? l : withLayer(l, { fx: { ...fx, dropShadow: { ...fx.dropShadow, enabled: true, distance: 4, size: 8, opacity: 40 } } });
      }
    }
    return l;
  });
  store.live({ layers });
}

// ---------------------------------------------------------------- Blend and Live Paint

/** Blend tool: click one object, then another; the steps between them are made as new shapes. */
export function blendClick(hit: Layer | null, steps = 5): boolean {
  const doc = store.doc;
  if (!doc) return false;
  if (!hit || hit.kind !== 'shape' || !hit.shape) {
    vectorOverlay.blendFirst = null;
    store.toast('Blend: click a shape, then a second shape');
    return true;
  }
  const first = vectorOverlay.blendFirst && doc.layers.find((l) => l.id === vectorOverlay.blendFirst);
  if (!first || first.id === hit.id) {
    vectorOverlay.blendFirst = hit.id;
    store.toast('Blend: now click the second shape');
    store.requestRender();
    return true;
  }
  vectorOverlay.blendFirst = null;
  const ia = doc.layers.findIndex((l) => l.id === first.id);
  const ib = doc.layers.findIndex((l) => l.id === hit.id);
  const [A, B] = ia < ib ? [first, hit] : [hit, first];
  const made = blendSteps(A, B, steps);
  const at = Math.min(ia, ib) + 1;
  const layers = [...doc.layers.slice(0, at), ...made, ...doc.layers.slice(at)];
  store.commit(`Blend (${steps} steps)`, { layers, activeId: B.id });
  store.setSelectedLayers([A.id, ...made.map((l) => l.id), B.id]);
  return true;
}

/** Shapes between A and B: matching paths morph point by point, otherwise box, colour and style blend. */
export function blendSteps(A: Layer, B: Layer, steps: number): Layer[] {
  const pa = docSubpaths(A), pb = docSubpaths(B);
  const morph = pa.subs.length === 1 && pb.subs.length === 1 && pa.subs[0].length === pb.subs[0].length && pa.closed === pb.closed;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const out: Layer[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const sa = A.shape!, sb = B.shape!;
    const style: Partial<ShapeProps> = {
      fill: mixHex(sa.fill, sb.fill, t),
      stroke: mixHex(sa.stroke, sb.stroke, t),
      strokeWidth: lerp(sa.strokeWidth, sb.strokeWidth, t),
      fillEnabled: t < 0.5 ? sa.fillEnabled : sb.fillEnabled,
      gradient: undefined,
      mesh: undefined,
    };
    const base = t < 0.5 ? A : B;
    const { id: _id, v: _v, ...rest } = base;
    const like = makeLayer({ ...rest, name: `Blend Step ${i}`, opacity: lerp(A.opacity, B.opacity, t), parent: A.parent, fx: undefined });
    if (morph) {
      const sub = pa.subs[0].map((a, k) => {
        const b = pb.subs[0][k];
        return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), ix: lerp(a.ix, b.ix, t), iy: lerp(a.iy, b.iy, t), ox: lerp(a.ox, b.ox, t), oy: lerp(a.oy, b.oy, t), type: 'corner' as const };
      });
      out.push(withDocSubpaths(withLayer(like, { shape: { ...like.shape!, ...style } }), [sub], pa.closed));
    } else {
      out.push(withLayer(like, {
        x: lerp(A.x, B.x, t),
        y: lerp(A.y, B.y, t),
        width: lerp(A.width, B.width, t),
        height: lerp(A.height, B.height, t),
        rotation: lerp(A.rotation ?? 0, B.rotation ?? 0, t),
        shape: { ...base.shape!, ...style },
      }));
    }
  }
  return out;
}

/** Live Paint Bucket: fills the clicked shape with the foreground colour (Alt: its stroke). */
export function paintBucket(hit: Layer | null, alt: boolean): boolean {
  if (!hit || hit.kind !== 'shape' || !hit.shape || hit.locked) return false;
  const fg = store.state.fg;
  const shape: ShapeProps = alt
    ? { ...hit.shape, stroke: fg, strokeWidth: Math.max(1, hit.shape.strokeWidth) }
    : { ...hit.shape, fill: fg, fillEnabled: true, gradient: undefined, mesh: undefined };
  store.commit(alt ? 'Live Paint Stroke' : 'Live Paint Fill', { layers: store.doc!.layers.map((l) => (l.id === hit.id ? withLayer(l, { shape }) : l)) });
  return true;
}

// ---------------------------------------------------------------- Perspective grid

export function perspectiveGrid() {
  const doc = store.doc;
  return doc?.perspective?.visible ? doc.perspective : null;
}

/**
 * Perspective Grid tool: the first click shows the grid; drag a vanishing point or the horizon to move it.
 * Shift-click hides the grid.
 */
export function gridDown(p: Pt, zoom: number, shift: boolean): boolean {
  const doc = store.doc;
  if (!doc) return false;
  if (shift && doc.perspective?.visible) {
    doc.perspective = { ...doc.perspective, visible: false };
    store.emit();
    return true;
  }
  if (!doc.perspective?.visible) {
    doc.perspective = doc.perspective ? { ...doc.perspective, visible: true } : { visible: true, horizon: Math.round(doc.height * 0.4), left: Math.round(doc.width * 0.05), right: Math.round(doc.width * 0.95) };
    store.emit();
    return true;
  }
  const g = doc.perspective;
  const tol = 12 / zoom;
  const part = Math.hypot(p.x - g.left, p.y - g.horizon) <= tol ? 'left' : Math.hypot(p.x - g.right, p.y - g.horizon) <= tol ? 'right' : Math.abs(p.y - g.horizon) <= tol ? 'horizon' : null;
  if (part) session = { kind: 'grid', part };
  return true;
}

function gridMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'grid' }>;
  const doc = store.doc!;
  const g = doc.perspective!;
  if (s.part === 'horizon') doc.perspective = { ...g, horizon: Math.round(p.y) };
  else if (s.part === 'left') doc.perspective = { ...g, horizon: Math.round(p.y), left: Math.round(Math.min(p.x, g.right - 10)) };
  else doc.perspective = { ...g, horizon: Math.round(p.y), right: Math.round(Math.max(p.x, g.left + 10)) };
  store.emit();
}

/**
 * Maps a document point onto the grid plane that recedes toward vanishing point `vx`: the box edge farther
 * from it keeps its height, lines converge on the horizon toward it, and depth foreshortens.
 */
function perspectiveMap(box: { x: number; y: number; w: number; h: number }, vx: number, horizon: number) {
  const towardLeft = vx < box.x + box.w / 2;
  const near = towardLeft ? box.x + box.w : box.x;
  const span = Math.abs(near - vx) || 1;
  return (x: number, y: number) => {
    // 0 at the near edge, 1 at the vanishing point; foreshortened so equal steps shrink with depth
    const u = Math.min(0.95, Math.abs(x - near) / span);
    const depth = u / (1 + u);
    const k = 1 - depth;
    return { x: near + (vx - near) * depth, y: horizon + (y - horizon) * k };
  };
}

/** Perspective Selection: drag a shape; on release it sits on the grid plane on its side of the view. */
export function perspDown(p: Pt, layer: Layer | null): boolean {
  if (!perspectiveGrid()) {
    store.toast('Show the grid first with the Perspective Grid tool (⇧P)');
    return true;
  }
  if (!isEditableShape(layer)) return false;
  const { layer: L, subs, closed } = docSubpaths(layer);
  session = { kind: 'persp', start: p, layer: L, subs, closed };
  perspMove(p);
  return true;
}

function perspMove(p: Pt) {
  const s = session as Extract<Session, { kind: 'persp' }>;
  const g = store.doc!.perspective!;
  const dx = p.x - s.start.x, dy = p.y - s.start.y;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sub of s.subs) for (const a of sub) {
    minX = Math.min(minX, a.x + dx); minY = Math.min(minY, a.y + dy); maxX = Math.max(maxX, a.x + dx); maxY = Math.max(maxY, a.y + dy);
  }
  const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const vx = box.x + box.w / 2 < (g.left + g.right) / 2 ? g.left : g.right;
  const map = perspectiveMap(box, vx, g.horizon);
  const out = s.subs.map((sub) => sub.map((a) => {
    const P = map(a.x + dx, a.y + dy), I = map(a.ix + dx, a.iy + dy), O = map(a.ox + dx, a.oy + dy);
    return { x: P.x, y: P.y, ix: I.x, iy: I.y, ox: O.x, oy: O.y, type: 'corner' as const };
  }));
  replaceLive([withDocSubpaths(s.layer, out, s.closed)]);
}

// ---------------------------------------------------------------- Slices

/** The topmost slice under a document point. */
export function sliceAt(p: Pt): Slice | null {
  const list = store.doc?.slices ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const sl = list[i];
    if (p.x >= sl.x && p.x <= sl.x + sl.width && p.y >= sl.y && p.y <= sl.y + sl.height) return sl;
  }
  return null;
}

/** Slice tool: drag out a new slice (on an existing one: select and move it). Slice Select: select and move. */
export function sliceDown(p: Pt, tool: 'slice' | 'slice-select'): boolean {
  const hit = sliceAt(p);
  if (hit) {
    vectorOverlay.activeSlice = hit.id;
    session = { kind: 'slice-move', id: hit.id, start: p, orig: { ...hit }, moved: false };
  } else if (tool === 'slice') {
    vectorOverlay.activeSlice = null;
    session = { kind: 'slice-new', start: p };
    vectorOverlay.sliceDraft = { x: p.x, y: p.y, width: 0, height: 0 };
  } else vectorOverlay.activeSlice = null;
  store.requestRender();
  return true;
}

function sliceMove(p: Pt) {
  const doc = store.doc!;
  const s = session!;
  if (s.kind === 'slice-new') {
    vectorOverlay.sliceDraft = { x: Math.round(Math.min(s.start.x, p.x)), y: Math.round(Math.min(s.start.y, p.y)), width: Math.round(Math.abs(p.x - s.start.x)), height: Math.round(Math.abs(p.y - s.start.y)) };
  } else if (s.kind === 'slice-move') {
    const dx = Math.round(p.x - s.start.x), dy = Math.round(p.y - s.start.y);
    s.moved = s.moved || dx !== 0 || dy !== 0;
    doc.slices = (doc.slices ?? []).map((sl) => (sl.id === s.id ? { ...sl, x: s.orig.x + dx, y: s.orig.y + dy } : sl));
  }
  store.requestRender();
}

function sliceUp() {
  const doc = store.doc!;
  const s = session!;
  if (s.kind === 'slice-new') {
    const r = vectorOverlay.sliceDraft;
    vectorOverlay.sliceDraft = null;
    if (!r || r.width < 4 || r.height < 4) return store.requestRender();
    const n = (doc.slices?.length ?? 0) + 1;
    const sl: Slice = { id: uid('slice'), name: `${doc.title.replace(/\.[a-z0-9]+$/i, '')}_${String(n).padStart(2, '0')}`, ...r };
    doc.slices = [...(doc.slices ?? []), sl];
    vectorOverlay.activeSlice = sl.id;
    store.commit('Make Slice', {}, { icon: 'artboard' });
  } else if (s.kind === 'slice-move' && s.moved) store.commit('Move Slice', {}, { icon: 'move' });
}

/** Deletes the selected slice; false when no slice is selected. */
export function deleteActiveSlice(): boolean {
  const doc = store.doc;
  const id = vectorOverlay.activeSlice;
  if (!doc || !id || !doc.slices?.some((sl) => sl.id === id)) return false;
  doc.slices = doc.slices.filter((sl) => sl.id !== id);
  vectorOverlay.activeSlice = null;
  store.commit('Delete Slice', {}, { icon: 'artboard' });
  return true;
}

/** Object ▸ Slice ▸ Delete All. */
export function deleteAllSlices(): boolean {
  const doc = store.doc;
  if (!doc?.slices?.length) return false;
  doc.slices = [];
  vectorOverlay.activeSlice = null;
  store.commit('Delete All Slices', {}, { icon: 'artboard' });
  return true;
}

/** Object ▸ Slice ▸ Create from Selection: one slice around the selected objects. */
export function sliceFromSelection(bounds: { x: number; y: number; width: number; height: number } | null): boolean {
  const doc = store.doc;
  if (!doc || !bounds || bounds.width < 1 || bounds.height < 1) return false;
  const n = (doc.slices?.length ?? 0) + 1;
  const sl: Slice = { id: uid('slice'), name: `${doc.title.replace(/\.[a-z0-9]+$/i, '')}_${String(n).padStart(2, '0')}`, x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
  doc.slices = [...(doc.slices ?? []), sl];
  vectorOverlay.activeSlice = sl.id;
  store.commit('Make Slice', {}, { icon: 'artboard' });
  return true;
}

// ---------------------------------------------------------------- pointer routing for the drag sessions

export function sessionMove(p: Pt, mods: { shift: boolean; alt: boolean }) {
  if (!session) return false;
  switch (session.kind) {
    case 'shear': shearMove(p, mods.shift); break;
    case 'reshape': reshapeMove(p); break;
    case 'puppet': puppetMove(p); break;
    case 'liquify': liquifyStep(p, vectorOverlay.brush?.r ?? 60, store.state.opts.strength || 0.5, mods.alt); break;
    case 'gradient': gradientMove(p); break;
    case 'gradient-edit': gradientEditMove(p, mods.shift); break;
    case 'mesh': meshMove(p); break;
    case 'width': widthMove(p); break;
    case 'smooth': smoothMove(p); break;
    case 'symbols': symbolStep(p, mods.alt); break;
    case 'slice-new':
    case 'slice-move': sliceMove(p); break;
    case 'grid': gridMove(p); break;
    case 'persp': perspMove(p); break;
  }
  return true;
}

const SESSION_LABEL: Record<Session['kind'], string> = {
  shear: 'Shear',
  reshape: 'Reshape',
  puppet: 'Puppet Warp',
  liquify: 'Liquify',
  gradient: 'Gradient',
  'gradient-edit': 'Edit Gradient',
  mesh: 'Mesh Point',
  width: 'Width Point',
  smooth: 'Smooth',
  symbols: 'Symbols',
  grid: 'Perspective Grid',
  persp: 'Attach to Perspective',
  'slice-new': 'Make Slice',
  'slice-move': 'Move Slice',
};

export function sessionUp(p: Pt): boolean {
  const s = session;
  if (!s) return false;
  session = null;
  vectorOverlay.brush = null;
  switch (s.kind) {
    case 'gradient-edit':
      gradientEditUp(s, p);
      return true;
    case 'gradient':
      // A click (no drag) applies the default gradient
      // From each shape as it was when the drag began (the live preview already carries a gradient)
      replaceLive(s.targets.map((l) => applyGradient(l, s.start, p, s.radial)));
      store.commit(s.radial ? 'Radial Gradient' : 'Linear Gradient', { layers: store.doc!.layers });
      return true;
    case 'liquify':
      store.commit(`Vector ${s.tool.charAt(0).toUpperCase()}${s.tool.slice(1)}`, { layers: store.doc!.layers });
      return true;
    case 'symbols':
      store.commit(s.label, { layers: store.doc!.layers });
      return true;
    case 'reshape':
    case 'shear':
    case 'puppet':
      if (Math.hypot(p.x - s.start.x, p.y - s.start.y) < 0.5) {
        store.revert();
        return true;
      }
      store.commit(SESSION_LABEL[s.kind], { layers: store.doc!.layers });
      return true;
    case 'mesh':
      store.commit(SESSION_LABEL[s.kind], { layers: store.doc!.layers });
      return true;
    case 'smooth':
      vectorOverlay.brush = null;
      if (!s.moved) {
        // A click smooths the whole path
        const sm = smoothLayerPath(s.layer);
        store.commit('Smooth Path', { layers: store.doc!.layers.map((l) => (l.id === sm.id ? sm : l)) });
        return true;
      }
      store.commit('Smooth', { layers: store.doc!.layers });
      return true;
    case 'width':
      // A click on the path adds a point at the current width; a click on a point without a drag changes nothing
      if (!s.added && Math.hypot(p.x - s.start.x, p.y - s.start.y) < 0.5) {
        store.revert();
        return true;
      }
      store.commit(s.added ? 'Add Width Point' : 'Width Point', { layers: store.doc!.layers });
      return true;
    case 'grid':
      return true;
    case 'persp':
      store.commit('Attach to Perspective', { layers: store.doc!.layers });
      return true;
    case 'slice-new':
    case 'slice-move':
      session = s;
      sliceUp();
      session = null;
      return true;
  }
}

export function cancelSession() {
  if (!session) return;
  session = null;
  vectorOverlay.brush = null;
  vectorOverlay.sliceDraft = null;
  store.revert();
}
