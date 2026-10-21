import type { Layer, PathAnchor, ShapeProps } from './types';
import { makeLayer, uid, withLayer } from './types';
import { store } from './store';
import { layerBounds } from './align';
import { groupLayers } from './groups';
import { variableStrokeOutline } from './strokeProfile';
import { bakePathCorners, liveShapeRings, rectAsLiveCornerPath } from './shapeGeometry';
import { clipPolygons, divideRings, ensureCcw, pointInRings, subtractRings, uniteRings, type PolygonRing, type Point2D, type Region } from './polygonClipping';

// ================================================================ bezier geometry

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function cornerAnchor(x: number, y: number): PathAnchor {
  return { x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' };
}

export function smoothAnchor(x: number, y: number, handleDist = 30, angle = 0): PathAnchor {
  const dx = Math.cos(angle) * handleDist;
  const dy = Math.sin(angle) * handleDist;
  return {
    x,
    y,
    ix: x - dx,
    iy: y - dy,
    ox: x + dx,
    oy: y + dy,
    type: 'smooth',
  };
}

/** Converts any shape into normalised PathAnchors (0..1) so it can be edited point-by-point. */
export function shapeToNormPoints(s: ShapeProps, w: number, h: number): PathAnchor[] {
  if (s.points && s.points.length > 0) return [...s.points];
  const live = liveShapeRings(s, w, h);
  if (live) return live.rings[0];

  // Generate anchors in 0..1 normalised space
  const pts: PathAnchor[] = [];
  const KAPPA = 0.5522847498; // Cubic bezier circle approximation constant

  switch (s.shape) {
    case 'rectangle': {
      const r = s.radius > 0 ? Math.min(s.radius / Math.max(1, Math.min(w, h)), 0.5) : 0;
      if (r <= 0) {
        pts.push(cornerAnchor(0, 0));
        pts.push(cornerAnchor(1, 0));
        pts.push(cornerAnchor(1, 1));
        pts.push(cornerAnchor(0, 1));
      } else {
        const kr = r * KAPPA;
        pts.push({ x: r, y: 0, ix: r, iy: 0, ox: r, oy: 0, type: 'corner' });
        pts.push({ x: 1 - r, y: 0, ix: 1 - r, iy: 0, ox: 1 - r + kr, oy: 0, type: 'smooth' });
        pts.push({ x: 1, y: r, ix: 1, iy: r - kr, ox: 1, oy: r, type: 'smooth' });
        pts.push({ x: 1, y: 1 - r, ix: 1, iy: 1 - r, ox: 1, oy: 1 - r + kr, type: 'smooth' });
        pts.push({ x: 1 - r, y: 1, ix: 1 - r + kr, iy: 1, ox: 1 - r, oy: 1, type: 'smooth' });
        pts.push({ x: r, y: 1, ix: r, iy: 1, ox: r - kr, oy: 1, type: 'smooth' });
        pts.push({ x: 0, y: 1 - r, ix: 0, iy: 1 - r + kr, ox: 0, oy: 1 - r, type: 'smooth' });
        pts.push({ x: 0, y: r, ix: 0, iy: r, ox: 0, oy: r - kr, type: 'smooth' });
      }
      break;
    }
    case 'ellipse': {
      const kx = 0.5 * KAPPA;
      const ky = 0.5 * KAPPA;
      // Top, right, bottom, left
      pts.push({ x: 0.5, y: 0, ix: 0.5 - kx, iy: 0, ox: 0.5 + kx, oy: 0, type: 'smooth' });
      pts.push({ x: 1, y: 0.5, ix: 1, iy: 0.5 - ky, ox: 1, oy: 0.5 + ky, type: 'smooth' });
      pts.push({ x: 0.5, y: 1, ix: 0.5 + kx, iy: 1, ox: 0.5 - kx, oy: 1, type: 'smooth' });
      pts.push({ x: 0, y: 0.5, ix: 0, iy: 0.5 + ky, ox: 0, oy: 0.5 - ky, type: 'smooth' });
      break;
    }
    case 'triangle': {
      pts.push(cornerAnchor(0.5, 0));
      pts.push(cornerAnchor(1, 1));
      pts.push(cornerAnchor(0, 1));
      break;
    }
    case 'polygon':
    case 'star': {
      const sides = Math.max(3, s.sides || (s.shape === 'star' ? 5 : 6));
      const total = s.shape === 'star' ? sides * 2 : sides;
      for (let i = 0; i < total; i++) {
        const a = (i * 2 * Math.PI) / total - Math.PI / 2;
        const rad = s.shape === 'star' && i % 2 === 1 ? 0.225 : 0.5;
        const px = 0.5 + rad * Math.cos(a);
        const py = 0.5 + rad * Math.sin(a);
        pts.push(cornerAnchor(px, py));
      }
      break;
    }
    case 'line':
    case 'arrow': {
      pts.push(cornerAnchor(0, 0));
      pts.push(cornerAnchor(1, 1));
      break;
    }
    default:
      pts.push(cornerAnchor(0, 0), cornerAnchor(1, 1));
  }

  return pts;
}

/**
 * Converts a shape layer to an explicit editable bézier path layer if it wasn't one already.
 * A live rotation is baked into the points (rotation becomes 0), so point editing and the
 * Pathfinder see the shape exactly as drawn. `bake: false` keeps the rotation.
 */
export function convertToEditablePath(layer: Layer, bake = true, live = !bake): Layer {
  if (layer.kind !== 'shape' || !layer.shape) return layer;
  let out = layer;
  const rectLive = live && !(layer.shape.shape === 'path' && layer.shape.points) ? rectAsLiveCornerPath(layer.shape, layer.width, layer.height) : null;
  if (rectLive) {
    // Round rectangle corners stay live on the path's four anchors
    const { radii: _r, cornerStyle: _c, ...rest } = layer.shape;
    out = withLayer(layer, { shape: { ...rest, shape: 'path', radius: 0, points: rectLive, closed: true, compoundPoints: undefined } });
  } else if (!(layer.shape.shape === 'path' && layer.shape.points)) {
    const s = layer.shape;
    const pts = shapeToNormPoints(s, layer.width, layer.height);
    const live = liveShapeRings(s, layer.width, layer.height);
    const closed = live ? live.closed : s.shape !== 'line' && s.shape !== 'arrow';
    // A donut keeps its hole as a compound path (every ring listed, filled even-odd)
    const compoundPoints = live && live.rings.length > 1 ? live.rings : undefined;
    out = withLayer(layer, { shape: { ...s, shape: 'path', points: pts, closed, compoundPoints } });
  } else if (!live && out.shape) {
    // Geometry operations see the live corners as real arcs
    const baked = bakePathCorners(out.shape, Math.abs(out.width), Math.abs(out.height));
    if (baked !== out.shape) out = withLayer(out, { shape: baked });
  }
  return bake && out.rotation ? bakeRotation(out) : out;
}

/** Rotates a path layer's points by its live rotation and resets the rotation to 0. */
export function bakeRotation(layer: Layer): Layer {
  const s = layer.shape;
  if (!s?.points || !layer.rotation) return layer;
  const a = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const toDoc = (nx: number, ny: number) => {
    const x = layer.x + nx * layer.width - cx;
    const y = layer.y + ny * layer.height - cy;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  };
  const rings = [s.points, ...(s.compoundPoints ?? [])];
  const docRings = rings.map((ring) =>
    ring.map((p) => {
      const q = toDoc(p.x, p.y);
      const i = toDoc(p.ix, p.iy);
      const o = toDoc(p.ox, p.oy);
      return { ...p, x: q.x, y: q.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
    })
  );
  const all = docRings.flat();
  const xs = all.flatMap((p) => [p.x, p.ix, p.ox]);
  const ys = all.flatMap((p) => [p.y, p.iy, p.oy]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const norm = (ring: PathAnchor[]) =>
    ring.map((p) => ({
      ...p,
      x: (p.x - x) / (w || 1), y: (p.y - y) / (h || 1),
      ix: (p.ix - x) / (w || 1), iy: (p.iy - y) / (h || 1),
      ox: (p.ox - x) / (w || 1), oy: (p.oy - y) / (h || 1),
    }));
  const points = norm(docRings[0]);
  const compoundPoints = s.compoundPoints ? docRings.slice(1).map(norm) : undefined;
  return withLayer(layer, { x, y, width: w, height: h, rotation: undefined, shape: { ...s, points, compoundPoints } });
}

/** Mirrors a shape layer in place, staying vector. Its live rotation mirrors with it. */
export function flipShapeLayer(layer: Layer, dir: 'h' | 'v'): Layer {
  const path = convertToEditablePath(layer, false);
  const s = path.shape!;
  const flip = (ring: PathAnchor[]) =>
    ring.map((p) =>
      dir === 'h'
        ? { ...p, x: 1 - p.x, ix: 1 - p.ix, ox: 1 - p.ox }
        : { ...p, y: 1 - p.y, iy: 1 - p.iy, oy: 1 - p.oy }
    );
  const points = flip(s.points ?? []);
  const compoundPoints = s.compoundPoints?.map(flip);
  return withLayer(path, { shape: { ...s, points, compoundPoints }, rotation: path.rotation ? -path.rotation : undefined });
}

/** Toggles an anchor between smooth (tangent handles) and corner (handles retracted). */
export function toggleAnchorSmooth(anchor: PathAnchor): PathAnchor {
  const isCorner = anchor.ix === anchor.x && anchor.iy === anchor.y && anchor.ox === anchor.x && anchor.oy === anchor.y;
  if (isCorner) {
    // Make smooth: pull handles out horizontally
    const len = 0.15;
    return {
      x: anchor.x,
      y: anchor.y,
      ix: anchor.x - len,
      iy: anchor.y,
      ox: anchor.x + len,
      oy: anchor.y,
      type: 'smooth',
    };
  } else {
    // Retract handles to sharp corner
    return {
      x: anchor.x,
      y: anchor.y,
      ix: anchor.x,
      iy: anchor.y,
      ox: anchor.x,
      oy: anchor.y,
      type: 'corner',
    };
  }
}

/** Curvature tool algorithm: Computes smooth harmonic cubic bézier handles through point sequence. */
export function solveHarmonicCurvature(pts: { x: number; y: number }[], closed: boolean): PathAnchor[] {
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return [cornerAnchor(pts[0].x, pts[0].y)];
  if (n === 2) {
    return [cornerAnchor(pts[0].x, pts[0].y), cornerAnchor(pts[1].x, pts[1].y)];
  }

  const result: PathAnchor[] = [];
  const tension = 0.35;

  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];

    // Tangent vector
    const dx = (next.x - prev.x) * tension;
    const dy = (next.y - prev.y) * tension;

    result.push({
      x: cur.x,
      y: cur.y,
      ix: cur.x - dx,
      iy: cur.y - dy,
      ox: cur.x + dx,
      oy: cur.y + dy,
      type: 'smooth',
    });
  }

  if (!closed) {
    // Flatten end handles
    result[0].ix = result[0].x;
    result[0].iy = result[0].y;
    result[n - 1].ox = result[n - 1].x;
    result[n - 1].oy = result[n - 1].y;
  }

  return result;
}

// ================================================================ pathfinder / boolean operations

export type PathfinderOp = 'unite' | 'minus-front' | 'intersect' | 'exclude';

export type DocAnchor = { x: number; y: number; ix: number; iy: number; ox: number; oy: number };

/** Flattens a Bézier path in document space into points (16 samples per curved segment). */
export function flattenDocPath(docPts: DocAnchor[], closed: boolean, curved?: Set<string>): Point2D[] {
  const out: Point2D[] = [];
  const n = docPts.length;
  if (n === 0) return out;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p1 = docPts[i];
    const p2 = docPts[(i + 1) % n];
    const hasCurve = p1.ox !== p1.x || p1.oy !== p1.y || p2.ix !== p2.x || p2.iy !== p2.y;
    if (!hasCurve) {
      out.push({ x: p1.x, y: p1.y });
    } else {
      const steps = 16;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        const x = mt * mt * mt * p1.x + 3 * mt * mt * t * p1.ox + 3 * mt * t * t * p2.ix + t * t * t * p2.x;
        const y = mt * mt * mt * p1.y + 3 * mt * mt * t * p1.oy + 3 * mt * t * t * p2.iy + t * t * t * p2.y;
        out.push({ x, y });
        curved?.add(pointKey(x, y));
      }
      curved?.add(pointKey(p2.x, p2.y));
    }
  }
  if (!closed) out.push({ x: docPts[n - 1].x, y: docPts[n - 1].y });
  return out;
}

function shapeDocPtsToRing(docPts: DocAnchor[], curved?: Set<string>): PolygonRing {
  return flattenDocPath(docPts, true, curved);
}

/** Identity of a flattened point, to 0.01 px (survives the clipper's sub-pixel nudge). */
export function pointKey(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

/** Douglas–Peucker: drops points closer than `tol` to the line through their neighbours. */
export function simplifyPolyline(pts: Point2D[], tol: number): Point2D[] {
  if (pts.length <= 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d > far) {
      far = d;
      at = i;
    }
  }
  if (far <= tol) return [a, b];
  const left = simplifyPolyline(pts.slice(0, at + 1), tol);
  return [...left.slice(0, -1), ...simplifyPolyline(pts.slice(at), tol)];
}

/** Douglas–Peucker for a closed ring, split at the two points farthest apart. */
export function simplifyClosed(ring: Point2D[], tol: number): Point2D[] {
  if (ring.length <= 3) return ring;
  let k = 0;
  let far = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y);
    if (d > far) {
      far = d;
      k = i;
    }
  }
  const a = simplifyPolyline(ring.slice(0, k + 1), tol);
  const b = simplifyPolyline([...ring.slice(k), ring[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : ring;
}

/**
 * Turns flattened points back into Bézier anchors. Points sampled from curves (in `curved`, or every point
 * when `curved` is true) get smooth handles unless they bend sharper than `cornerDeg`; everything else, such as
 * original corners and boolean crossings, stays a corner.
 */
export function fitAnchors(pts: Point2D[], closed: boolean, curved: Set<string> | true, cornerDeg = 40): PathAnchor[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const isCurved = curved === true || curved.has(pointKey(p.x, p.y));
    if (!isCurved || !hasPrev || !hasNext || n < 3) return cornerAnchor(p.x, p.y);
    const a = pts[(i - 1 + n) % n];
    const c = pts[(i + 1) % n];
    const v1x = p.x - a.x, v1y = p.y - a.y, v2x = c.x - p.x, v2y = c.y - p.y;
    const turn = Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)) * (180 / Math.PI);
    if (turn > cornerDeg) return cornerAnchor(p.x, p.y);
    // Catmull-Rom tangent; each handle a third of its own segment
    const tx = c.x - a.x;
    const ty = c.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    const l1 = Math.hypot(v1x, v1y) / 3;
    const l2 = Math.hypot(v2x, v2y) / 3;
    return { x: p.x, y: p.y, ix: p.x - (tx / tl) * l1, iy: p.y - (ty / tl) * l1, ox: p.x + (tx / tl) * l2, oy: p.y + (ty / tl) * l2, type: 'smooth' as const };
  });
}

/** A shape layer whose path is `rings` (document space, even-odd), styled like `style`. */
export function ringsToShapeLayer(rings: PolygonRing[], style: ShapeProps, name: string, like: Layer, curved?: Set<string>): Layer {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const pt of ring) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
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
  const subPaths: PathAnchor[][] = rings.map((ring) =>
    curved?.size ? fitAnchors(simplifyClosed(ring, 0.15), true, curved).map(norm) : ring.map((pt) => cornerAnchor((pt.x - minX) / W, (pt.y - minY) / H))
  );
  return makeLayer({
    kind: 'shape',
    name,
    shape: {
      // Keeps every style setting (gradient, dashes, arrowheads…) of the source
      ...style,
      shape: 'path',
      points: subPaths[0] ?? [],
      compoundPoints: subPaths.length > 1 ? subPaths : undefined,
      closed: true,
      radius: 0,
      sides: 0,
    },
    x: minX,
    y: minY,
    width: W,
    height: H,
    opacity: like.opacity,
    blend: like.blend,
    fx: like.fx,
  });
}

/** Applies real boolean Pathfinder operation to selected vector shape layers. */
export function applyPathfinder(op: PathfinderOp): { applied: boolean; reason: string } {
  const doc = store.doc;
  if (!doc) return { applied: false, reason: 'No document' };
  const selected = store.selectedLayers.filter((l) => l.kind === 'shape' && l.shape);
  if (selected.length < 2) {
    store.toast('Select 2 or more shape layers for Pathfinder');
    return { applied: false, reason: 'Select 2 or more shape layers' };
  }

  // Convert shapes to document space points
  const prepared = selected.map((l) => {
    const layer = convertToEditablePath(l);
    const s = layer.shape!;
    const pts = s.points ?? [];
    const docPts = pts.map((p) => ({
      x: layer.x + p.x * layer.width,
      y: layer.y + p.y * layer.height,
      ix: layer.x + p.ix * layer.width,
      iy: layer.y + p.iy * layer.height,
      ox: layer.x + p.ox * layer.width,
      oy: layer.y + p.oy * layer.height,
    }));
    return { layer, docPts, shape: s };
  });

  const base = prepared[0];

  // Layers are ordered back to front, so rings[0] is the backmost shape
  const curved = new Set<string>();
  const rings = prepared.map((p) => shapeDocPtsToRing(p.docPts, curved));
  let currentRings: PolygonRing[];
  switch (op) {
    case 'unite':
      currentRings = uniteRings(rings);
      break;
    case 'minus-front':
      currentRings = subtractRings(rings[0], rings.slice(1));
      break;
    case 'intersect':
      currentRings = rings.slice(1).reduce((acc, r) => acc.flatMap((a) => clipPolygons(a, r, 'intersect')), [rings[0]]);
      break;
    case 'exclude':
      // Even-odd filling of the stacked rings is exactly the exclusive-or of all shapes
      currentRings = rings.length === 2 ? clipPolygons(rings[0], rings[1], 'exclude') : rings;
      break;
  }

  if (currentRings.length === 0) {
    store.toast(`Pathfinder: ${op} resulted in empty geometry`, 'info');
    return { applied: false, reason: 'Empty geometry' };
  }

  // Compute union bounding box purely from resulting geometry
  const name = op === 'unite' ? 'Unite Shape' : op === 'minus-front' ? 'Minus Front' : op === 'intersect' ? 'Intersect' : 'Exclude';
  const newLayer = ringsToShapeLayer(currentRings, base.shape, name, base.layer, curved);

  // Replace selected layers with the resulting shape
  const removeIds = new Set(selected.map((l) => l.id));
  const newLayers = doc.layers.filter((l) => !removeIds.has(l.id));
  newLayers.push(newLayer);

  store.commit(`Pathfinder: ${op}`, {
    layers: newLayers,
    activeId: newLayer.id,
  });
  store.setSelectedLayers([newLayer.id]);
  store.toast(`Pathfinder: ${op} applied`, 'success');
  return { applied: true, reason: 'Applied' };
}

/** The outline of a shape layer in document space (flattened Béziers). */
function shapeRing(l: Layer, curved?: Set<string>): PolygonRing {
  const layer = convertToEditablePath(l);
  const pts = layer.shape?.points ?? [];
  return shapeDocPtsToRing(
    pts.map((p) => ({
      x: layer.x + p.x * layer.width,
      y: layer.y + p.y * layer.height,
      ix: layer.x + p.ix * layer.width,
      iy: layer.y + p.iy * layer.height,
      ox: layer.x + p.ox * layer.width,
      oy: layer.y + p.oy * layer.height,
    })),
    curved
  );
}

export type BuilderRegion = Region & { owners: number[] };

let builderCache: { key: string; sources: Layer[]; regions: BuilderRegion[]; curved: Set<string> } | null = null;

/** Every region the selected shapes form (back to front), cached until the selection or a shape changes. */
export function shapeBuilderRegions(): { sources: Layer[]; regions: BuilderRegion[]; curved: Set<string> } | null {
  const sources = store.selectedLayers.filter((l) => l.kind === 'shape' && l.shape && l.visible);
  if (sources.length < 1) return null;
  const key = sources.map((l) => `${l.id}:${l.v}`).join('|');
  if (builderCache?.key !== key) {
    const curved = new Set<string>();
    builderCache = { key, sources, curved, regions: divideRings(sources.map((l) => shapeRing(l, curved))) };
  }
  return builderCache;
}

/** Index of the region under a document point, or -1. */
export function regionAt(regions: BuilderRegion[], x: number, y: number): number {
  return regions.findIndex((r) => pointInRings({ x, y }, r.rings));
}

/** Replaces the source shapes with one layer per region, keeping each region's topmost colour. */
function commitRegions(label: string, sources: Layer[], pieces: { rings: PolygonRing[]; owner: number }[], curved?: Set<string>): Layer[] {
  const doc = store.doc!;
  const made = pieces.map((p, i) => ringsToShapeLayer(p.rings, sources[p.owner].shape!, `${sources[p.owner].name} ${i + 1}`, sources[p.owner], curved));
  const ids = new Set(sources.map((l) => l.id));
  const at = doc.layers.findIndex((l) => ids.has(l.id));
  const rest = doc.layers.filter((l) => !ids.has(l.id));
  rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...made);
  store.commit(label, { layers: rest, activeId: made[made.length - 1]?.id ?? doc.activeId });
  if (made.length) store.setSelectedLayers(made.map((l) => l.id));
  builderCache = null;
  return made;
}

/** Pathfinder ▸ Divide: cuts the selected shapes into every region their outlines form. */
export function pathfinderDivide(): { applied: boolean; reason: string } {
  const b = store.doc && shapeBuilderRegions();
  if (!b || b.sources.length < 2) return { applied: false, reason: 'Select 2 or more shape layers' };
  commitRegions('Pathfinder: Divide', b.sources, b.regions.map((r) => ({ rings: r.rings, owner: Math.max(...r.owners) })), b.curved);
  return { applied: true, reason: 'Divided' };
}

export type PathfinderExtraOp = 'minus-back' | 'trim' | 'merge' | 'crop' | 'outline';

export const PATHFINDER_EXTRA_LABELS: Record<PathfinderExtraOp, string> = {
  'minus-back': 'Minus Back',
  trim: 'Trim',
  merge: 'Merge',
  crop: 'Crop',
  outline: 'Outline',
};

/** Regions grouped by a key, each group one compound layer (regions are disjoint, so even-odd keeps holes). */
function regionGroups(
  b: { sources: Layer[]; regions: BuilderRegion[]; curved: Set<string> },
  keyOf: (r: BuilderRegion) => { key: string; owner: number } | null,
  style: (owner: Layer) => ShapeProps,
  name: (owner: Layer, i: number) => string
): Layer[] {
  const groups = new Map<string, { owner: number; rings: PolygonRing[] }>();
  for (const r of b.regions) {
    const k = keyOf(r);
    if (!k) continue;
    const g = groups.get(k.key) ?? { owner: k.owner, rings: [] };
    // The group takes the frontmost owner's place in the stack
    g.owner = Math.max(g.owner, k.owner);
    g.rings.push(...r.rings);
    groups.set(k.key, g);
  }
  return [...groups.values()]
    .sort((x, y) => x.owner - y.owner)
    .map((g, i) => {
      const owner = b.sources[g.owner];
      return ringsToShapeLayer(g.rings, style(owner), name(owner, i), owner, b.curved);
    });
}

/**
 * Pathfinder ▸ Minus Back, Trim, Merge, Crop, Outline (Illustrator's lower Pathfinder row):
 * - Minus Back: the frontmost shape minus everything behind it.
 * - Trim: removes the hidden part of every filled shape; strokes are removed.
 * - Merge: Trim, then joins touching or overlapping shapes of the same fill colour.
 * - Crop: keeps what lies inside the frontmost shape (which is used up); strokes are removed.
 * - Outline: every region's outline as a stroke in its fill colour, with no fill.
 */
export function pathfinderExtra(op: PathfinderExtraOp): { applied: boolean; reason: string } {
  const doc = store.doc;
  const b = doc && shapeBuilderRegions();
  if (!doc || !b || b.sources.length < 2) return { applied: false, reason: 'Select 2 or more shape layers' };
  const label = PATHFINDER_EXTRA_LABELS[op];
  const top = b.sources.length - 1;
  const noStroke = (o: Layer): ShapeProps => ({ ...o.shape!, strokeWidth: 0, widthPoints: undefined, strokeAlign: undefined });
  const filled = (i: number) => b.sources[i].shape!.fillEnabled;
  let made: Layer[];
  if (op === 'minus-back') {
    const rings = b.sources.map((l) => shapeRing(l, b.curved));
    const front = subtractRings(rings[top], rings.slice(0, top));
    made = front.length ? [ringsToShapeLayer(front, b.sources[top].shape!, 'Minus Back', b.sources[top], b.curved)] : [];
  } else if (op === 'trim' || op === 'merge') {
    // The visible part of each region belongs to the frontmost filled shape over it
    made = regionGroups(
      b,
      (r) => {
        const owners = r.owners.filter(filled);
        if (!owners.length) return null;
        const owner = Math.max(...owners);
        return { key: op === 'merge' ? `fill:${b.sources[owner].shape!.fill}` : `owner:${owner}`, owner };
      },
      noStroke,
      (o) => o.name
    );
  } else if (op === 'crop') {
    made = regionGroups(
      b,
      (r) => {
        if (!r.owners.includes(top)) return null;
        const owners = r.owners.filter((i) => i !== top && filled(i));
        if (!owners.length) return null;
        const owner = Math.max(...owners);
        return { key: `owner:${owner}`, owner };
      },
      noStroke,
      (o) => o.name
    );
  } else {
    made = b.regions.map((r, i) => {
      const owner = b.sources[Math.max(...r.owners)];
      const l = ringsToShapeLayer(r.rings, owner.shape!, `Outline ${i + 1}`, owner, b.curved);
      return withLayer(l, { shape: { ...l.shape!, fillEnabled: false, stroke: owner.shape!.fillEnabled ? owner.shape!.fill : owner.shape!.stroke, strokeWidth: 1, widthPoints: undefined, strokeAlign: undefined } });
    });
  }
  if (!made.length) {
    store.toast(`Pathfinder: ${label} leaves nothing`, 'info');
    return { applied: false, reason: 'Empty geometry' };
  }
  const ids = new Set(b.sources.map((l) => l.id));
  const at = doc.layers.findIndex((l) => ids.has(l.id));
  const rest = doc.layers.filter((l) => !ids.has(l.id));
  rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...made);
  store.commit(`Pathfinder: ${label}`, { layers: rest, activeId: made[made.length - 1].id });
  store.setSelectedLayers(made.map((l) => l.id));
  builderCache = null;
  return { applied: true, reason: label };
}

/**
 * Shape Builder: merges the picked regions into one shape (or deletes them with `erase`). The other
 * regions stay as separate shapes, so the result can be built further.
 */
export function applyShapeBuilder(picked: number[], erase: boolean): boolean {
  const b = store.doc && shapeBuilderRegions();
  if (!b || !picked.length) return false;
  const chosen = new Set(picked.filter((i) => i >= 0 && i < b.regions.length));
  if (!chosen.size) return false;
  const pieces: { rings: PolygonRing[]; owner: number }[] = [];
  b.regions.forEach((r, i) => {
    if (!chosen.has(i)) pieces.push({ rings: r.rings, owner: Math.max(...r.owners) });
  });
  if (!erase) {
    const regions = [...chosen].map((i) => b.regions[i]);
    const outers = regions.map((r) => r.rings[0]);
    // A picked region's hole stays open unless another picked region fills it
    const openHoles = regions.flatMap((r, k) =>
      r.rings.slice(1).flatMap((h) => subtractRings(ensureCcw(h), outers.filter((_, j) => j !== k)).map((piece) => ensureCcw(piece).reverse()))
    );
    pieces.push({ rings: [...uniteRings(outers), ...openHoles], owner: Math.max(...regions[0].owners) });
  }
  commitRegions(erase ? 'Shape Builder: Delete' : 'Shape Builder', b.sources, pieces, b.curved);
  return true;
}

/**
 * Live Paint Bucket on overlapping shapes: cuts the selection into its regions (kept together in a
 * "Live Paint Group") and fills the region under (x, y) — or strokes it with `stroke`. One undo step.
 */
export function livePaintRegion(x: number, y: number, color: string, stroke = false): boolean {
  const doc = store.doc;
  const b = doc && shapeBuilderRegions();
  if (!doc || !b || b.sources.length < 2) return false;
  const hit = regionAt(b.regions, x, y);
  if (hit < 0) return false;
  const made = b.regions.map((r, i) => {
    const owner = b.sources[Math.max(...r.owners)];
    const l = ringsToShapeLayer(r.rings, owner.shape!, `Region ${i + 1}`, owner, b.curved);
    if (i !== hit) return l;
    const shape: ShapeProps = stroke
      ? { ...l.shape!, stroke: color, strokeWidth: Math.max(1, l.shape!.strokeWidth) }
      : { ...l.shape!, fill: color, fillEnabled: true, gradient: undefined, mesh: undefined };
    return withLayer(l, { shape });
  });
  const ids = new Set(b.sources.map((l) => l.id));
  const at = doc.layers.findIndex((l) => ids.has(l.id));
  const rest = doc.layers.filter((l) => !ids.has(l.id));
  rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...made);
  const grouped = groupLayers(rest, made.map((l) => l.id), 'Live Paint Group');
  if (!grouped) return false;
  store.commit(stroke ? 'Live Paint Stroke' : 'Live Paint Fill', { layers: grouped.layers, activeId: made[hit].id });
  store.setSelectedLayers([made[hit].id]);
  builderCache = null;
  return true;
}

/** Makes a compound path (⌘8) from multiple selected shapes. */
export function makeCompoundPath(): { created: boolean; reason: string } {
  const doc = store.doc;
  if (!doc) return { created: false, reason: 'No document' };
  const selected = store.selectedLayers.filter((l) => l.kind === 'shape' && l.shape);
  if (selected.length < 2) {
    store.toast('Select 2 or more shape layers to make a compound path');
    return { created: false, reason: 'Select 2 or more shape layers' };
  }
  const res = applyPathfinder('exclude');
  return { created: res.applied, reason: res.reason };
}

/** Releases a compound path back into individual separate shape layers. */
export function releaseCompoundPath(): { released: boolean; reason: string } {
  const doc = store.doc;
  if (!doc) return { released: false, reason: 'No document' };
  const active = store.activeLayer;
  if (!active || active.kind !== 'shape' || !active.shape?.compoundPoints?.length) {
    return { released: false, reason: 'Selected shape is not a compound path' };
  }
  const s = active.shape;
  const subs = s.compoundPoints ?? [];
  const newLayers: Layer[] = [];
  subs.forEach((sub, i) => {
    const l = makeLayer({
      kind: 'shape',
      name: `${active.name} Path ${i + 1}`,
      x: active.x,
      y: active.y,
      width: active.width,
      height: active.height,
      shape: {
        ...s,
        shape: 'path',
        points: sub,
        compoundPoints: undefined,
        closed: true,
      },
    });
    newLayers.push(l);
  });
  const layers = doc.layers.filter((l) => l.id !== active.id);
  store.commit('Release Compound Path', {
    layers: [...layers, ...newLayers],
    activeId: newLayers[0].id,
  });
  store.setSelectedLayers(newLayers.map((l) => l.id));
  store.toast('Compound path released');
  return { released: true, reason: 'Released' };
}

/** Joins two open paths (⌘J) or closes an open path. */
export function joinPaths(): { joined: boolean; reason: string } {
  const doc = store.doc;
  if (!doc) return { joined: false, reason: 'No document' };
  const selected = store.selectedLayers.filter((l) => l.kind === 'shape' && l.shape);
  if (!selected.length) return { joined: false, reason: 'No shape layers selected' };

  if (selected.length === 1) {
    const layer = convertToEditablePath(selected[0]);
    if (layer.shape?.points && !layer.shape.closed) {
      const updated = withLayer(layer, {
        shape: { ...layer.shape, closed: true },
      });
      store.commit('Join Path', {
        layers: doc.layers.map((l) => (l.id === layer.id ? updated : l)),
      });
      store.toast('Path closed');
      return { joined: true, reason: 'Path closed' };
    }
    return { joined: false, reason: 'Path is already closed' };
  }

  // Join two open paths end-to-end
  const a = convertToEditablePath(selected[0]);
  const b = convertToEditablePath(selected[1]);
  if (!a.shape?.points || !b.shape?.points) return { joined: false, reason: 'Could not extract shape points' };

  const ptsA = a.shape.points.map((p) => ({
    x: a.x + p.x * a.width,
    y: a.y + p.y * a.height,
    ix: a.x + (p.ix ?? p.x) * a.width,
    iy: a.y + (p.iy ?? p.y) * a.height,
    ox: a.x + (p.ox ?? p.x) * a.width,
    oy: a.y + (p.oy ?? p.y) * a.height,
  }));

  const ptsB = b.shape.points.map((p) => ({
    x: b.x + p.x * b.width,
    y: b.y + p.y * b.height,
    ix: b.x + (p.ix ?? p.x) * b.width,
    iy: b.y + (p.iy ?? p.y) * b.height,
    ox: b.x + (p.ox ?? p.x) * b.width,
    oy: b.y + (p.oy ?? p.y) * b.height,
  }));

  const joinedDoc = [...ptsA, ...ptsB];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of joinedDoc) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const W = Math.max(1, maxX - minX);
  const H = Math.max(1, maxY - minY);

  const normPoints = joinedDoc.map((p) => ({
    x: (p.x - minX) / W,
    y: (p.y - minY) / H,
    ix: (p.ix - minX) / W,
    iy: (p.iy - minY) / H,
    ox: (p.ox - minX) / W,
    oy: (p.oy - minY) / H,
  }));

  const newShape: ShapeProps = {
    ...a.shape,
    shape: 'path',
    points: normPoints,
    closed: false,
  };

  const newLayer = makeLayer({
    kind: 'shape',
    name: 'Joined Path',
    shape: newShape,
    x: minX,
    y: minY,
    width: W,
    height: H,
  });

  const removeIds = new Set([a.id, b.id]);
  const newLayers = doc.layers.filter((l) => !removeIds.has(l.id));
  newLayers.push(newLayer);

  store.commit('Join Paths', {
    layers: newLayers,
    activeId: newLayer.id,
  });
  store.setSelectedLayers([newLayer.id]);
  store.toast('Paths joined');
  return { joined: true, reason: 'Paths joined' };
}

/** Reverses the direction of points in a path. */
export function reversePoints(pts: PathAnchor[]): PathAnchor[] {
  return [...pts].reverse().map((p) => ({
    x: p.x,
    y: p.y,
    ix: p.ox,
    iy: p.oy,
    ox: p.ix,
    oy: p.iy,
    type: p.type,
  }));
}

/** Reverses the direction of points in a path layer. */
export function reversePath(layer: Layer): Layer {
  if (layer.kind !== 'shape' || !layer.shape?.points) return layer;
  return withLayer(layer, {
    shape: { ...layer.shape, points: reversePoints(layer.shape.points) },
  });
}

/** Inserts a new anchor point on a vector path closest to (docX, docY). */
export function addAnchorToLayerPath(layer: Layer, docX: number, docY: number): Layer {
  const editable = convertToEditablePath(layer);
  if (!editable.shape?.points || editable.shape.points.length < 2) return editable;
  const pts = [...editable.shape.points];
  const w = Math.max(1, editable.width);
  const h = Math.max(1, editable.height);
  const nx = (docX - editable.x) / w;
  const ny = (docY - editable.y) / h;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const nextIdx = (i + 1) % pts.length;
    const p1 = pts[i];
    const p2 = pts[nextIdx];
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const d = Math.hypot(mx - nx, my - ny);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = nextIdx;
    }
  }

  const prev = pts[(bestIdx - 1 + pts.length) % pts.length];
  const next = pts[bestIdx % pts.length];
  const midX = (prev.x + next.x) / 2;
  const midY = (prev.y + next.y) / 2;
  const newAnchor: PathAnchor = {
    x: midX,
    y: midY,
    ix: midX - (next.x - prev.x) * 0.15,
    iy: midY - (next.y - prev.y) * 0.15,
    ox: midX + (next.x - prev.x) * 0.15,
    oy: midY + (next.y - prev.y) * 0.15,
    type: 'smooth',
  };

  pts.splice(bestIdx, 0, newAnchor);
  return withLayer(editable, { shape: { ...editable.shape, points: pts } });
}

/** Deletes the anchor point closest to (docX, docY) if within tolerance. */
export function deleteAnchorFromLayerPath(layer: Layer, docX: number, docY: number, tolPx = 14): Layer {
  const editable = convertToEditablePath(layer);
  if (!editable.shape?.points || editable.shape.points.length <= 2) return editable;
  const pts = editable.shape.points;
  const w = editable.width;
  const h = editable.height;

  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const ax = editable.x + pts[i].x * w;
    const ay = editable.y + pts[i].y * h;
    const d = Math.hypot(ax - docX, ay - docY);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && bestDist <= tolPx) {
    const nextPts = pts.filter((_, idx) => idx !== bestIdx);
    return withLayer(editable, { shape: { ...editable.shape, points: nextPts } });
  }
  return editable;
}

/** Smoothes all anchor points on a vector layer by harmonizing control handles. */
export function smoothLayerPath(layer: Layer): Layer {
  const editable = convertToEditablePath(layer);
  if (!editable.shape?.points || editable.shape.points.length < 3) return editable;
  const pts = editable.shape.points.map((p) => ({ ...p }));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const dx = (next.x - prev.x) * 0.25;
    const dy = (next.y - prev.y) * 0.25;
    curr.ix = curr.x - dx;
    curr.iy = curr.y - dy;
    curr.ox = curr.x + dx;
    curr.oy = curr.y + dy;
    curr.type = 'smooth';
  }
  return withLayer(editable, { shape: { ...editable.shape, points: pts } });
}

/** Splits a vector path at the point closest to (docX, docY) (Scissors Tool). */
export function splitLayerPath(layer: Layer, docX: number, docY: number): Layer[] {
  const editable = convertToEditablePath(layer);
  if (!editable.shape?.points || editable.shape.points.length < 3) return [editable];
  const pts = editable.shape.points;
  const w = editable.width;
  const h = editable.height;

  let bestIdx = 1;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const ax = editable.x + pts[i].x * w;
    const ay = editable.y + pts[i].y * h;
    const d = Math.hypot(ax - docX, ay - docY);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  const p1 = pts.slice(0, bestIdx + 1);
  const p2 = pts.slice(bestIdx);
  const layer1 = withLayer(editable, { shape: { ...editable.shape, points: p1, closed: false } });
  const layer2 = makeLayer({
    kind: 'shape',
    name: `${editable.name} Cut`,
    shape: { ...editable.shape, points: p2, closed: false },
    x: editable.x,
    y: editable.y,
    width: editable.width,
    height: editable.height,
  });
  return [layer1, layer2];
}

/** Deforms vector anchor points using Illustrator liquify / reshape algorithms. */
export function distortVectorLayer(
  layer: Layer,
  type: 'warp' | 'twirl' | 'pucker' | 'bloat' | 'scallop' | 'crystallize' | 'wrinkle',
  cx: number,
  cy: number,
  radius: number,
  strength = 0.5,
  dragDx = 0,
  dragDy = 0
): Layer {
  const editable = convertToEditablePath(layer);
  if (!editable.shape?.points) return editable;
  const w = editable.width;
  const h = editable.height;

  const pts = editable.shape.points.map((p, idx) => {
    const ax = editable.x + p.x * w;
    const ay = editable.y + p.y * h;
    const d = Math.hypot(ax - cx, ay - cy);
    if (d > radius || radius <= 0) return p;

    const falloff = Math.pow(1 - d / radius, 2);
    let nax = ax;
    let nay = ay;

    switch (type) {
      case 'warp':
        nax += dragDx * falloff;
        nay += dragDy * falloff;
        break;
      case 'twirl': {
        const ang = (falloff * strength * Math.PI) / 3;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const rx = ax - cx;
        const ry = ay - cy;
        nax = cx + rx * cos - ry * sin;
        nay = cy + rx * sin + ry * cos;
        break;
      }
      case 'pucker':
        nax += (cx - ax) * falloff * strength * 0.6;
        nay += (cy - ay) * falloff * strength * 0.6;
        break;
      case 'bloat':
        nax -= (cx - ax) * falloff * strength * 0.6;
        nay -= (cy - ay) * falloff * strength * 0.6;
        break;
      case 'scallop': {
        const teeth = Math.sin(idx * 2) * radius * 0.25 * falloff * strength;
        nax += teeth;
        nay += teeth;
        break;
      }
      case 'crystallize': {
        const spike = ((Math.random() - 0.5) * radius * 0.5 + radius * 0.3) * falloff * strength;
        const dir = Math.atan2(ay - cy, ax - cx);
        nax += Math.cos(dir) * spike;
        nay += Math.sin(dir) * spike;
        break;
      }
      case 'wrinkle': {
        const noiseX = (Math.sin(ax * 0.05 + idx) + Math.cos(ay * 0.05)) * 12 * falloff * strength;
        const noiseY = (Math.cos(ax * 0.05) + Math.sin(ay * 0.05 + idx)) * 12 * falloff * strength;
        nax += noiseX;
        nay += noiseY;
        break;
      }
    }

    const nx = (nax - editable.x) / w;
    const ny = (nay - editable.y) / h;
    return {
      ...p,
      x: nx,
      y: ny,
      ix: p.ix + (nx - p.x),
      iy: p.iy + (ny - p.y),
      ox: p.ox + (nx - p.x),
      oy: p.oy + (ny - p.y),
    };
  });

  return withLayer(editable, { shape: { ...editable.shape, points: pts } });
}

// ================================================================ path simplify & outline stroke

/** Simplifies path points using Ramer-Douglas-Peucker algorithm. */
export function simplifyPathPoints(points: PathAnchor[], tolerance = 0.02): PathAnchor[] {
  if (points.length <= 2) return points;

  function ptDistToSegment(p: PathAnchor, a: PathAnchor, b: PathAnchor): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    return Math.hypot(p.x - px, p.y - py);
  }

  function rdp(pts: PathAnchor[]): PathAnchor[] {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let index = 0;
    const first = pts[0];
    const last = pts[pts.length - 1];

    for (let i = 1; i < pts.length - 1; i++) {
      const d = ptDistToSegment(pts[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }

    if (maxDist > tolerance) {
      const left = rdp(pts.slice(0, index + 1));
      const right = rdp(pts.slice(index));
      return [...left.slice(0, left.length - 1), ...right];
    }
    return [first, last];
  }

  return rdp(points);
}

/** Offsets a polyline sideways by `d` (positive = left of travel) with mitred joins (miter limit 4). */
export function offsetPolyline(pts: Point2D[], d: number, closed: boolean): Point2D[] {
  const n = pts.length;
  const normal = (a: Point2D, b: Point2D) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  };
  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const nIn = closed || i > 0 ? normal(pts[(i - 1 + n) % n], p) : null;
    const nOut = closed || i < n - 1 ? normal(p, pts[(i + 1) % n]) : null;
    if (!nIn || !nOut) {
      const m = (nIn ?? nOut)!;
      out.push({ x: p.x + m.x * d, y: p.y + m.y * d });
      continue;
    }
    const mx = nIn.x + nOut.x;
    const my = nIn.y + nOut.y;
    const ml = Math.hypot(mx, my); // 2·cos(half the turn)
    if (ml < 0.5) {
      // Sharper than the miter limit: bevel
      out.push({ x: p.x + nIn.x * d, y: p.y + nIn.y * d }, { x: p.x + nOut.x * d, y: p.y + nOut.y * d });
      continue;
    }
    const k = (2 * d) / (ml * ml);
    out.push({ x: p.x + mx * k, y: p.y + my * k });
  }
  return out;
}

/**
 * Converts a shape's stroke into a filled outline with the stroke's exact width, measured in document
 * pixels. Closed paths become a ring (outer edge plus a hole); open paths get butt ends.
 */
export function outlineStroke(layer: Layer): Layer {
  if (layer.kind !== 'shape' || !layer.shape) return layer;
  const editable = convertToEditablePath(layer);
  const s = editable.shape!;
  const half = (s.strokeWidth || 0) / 2;
  const subs = s.compoundPoints?.length ? s.compoundPoints : s.points ? [s.points] : [];
  if (half <= 0 || !subs.some((sub) => sub.length >= 2)) return layer;
  const closed = s.closed !== false;

  const rings: PolygonRing[] = [];
  for (const sub of subs) {
    if (sub.length < 2) continue;
    const docPts = sub.map((p) => ({
      x: editable.x + p.x * editable.width,
      y: editable.y + p.y * editable.height,
      ix: editable.x + p.ix * editable.width,
      iy: editable.y + p.iy * editable.height,
      ox: editable.x + p.ox * editable.width,
      oy: editable.y + p.oy * editable.height,
    }));
    const line = flattenDocPath(docPts, closed).filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-6);
    if (s.widthPoints?.length) {
      // Variable width: the same outline the renderer draws
      rings.push(...variableStrokeOutline(line, closed, s.strokeWidth, s.widthPoints, s.strokeCap ?? 'round'));
    } else if (closed) {
      rings.push(offsetPolyline(line, half, true), offsetPolyline(line, -half, true));
    } else {
      rings.push([...offsetPolyline(line, half, false), ...offsetPolyline(line, -half, false).reverse()]);
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const W = Math.max(1e-6, maxX - minX);
  const H = Math.max(1e-6, maxY - minY);
  const anchors = rings.map((r) => r.map((p) => cornerAnchor((p.x - minX) / W, (p.y - minY) / H)));

  return withLayer(editable, {
    name: `${editable.name} Outlined`,
    x: minX,
    y: minY,
    width: W,
    height: H,
    shape: {
      ...s,
      shape: 'path',
      points: anchors[0],
      compoundPoints: anchors.length > 1 ? anchors : undefined,
      closed: true,
      fill: s.stroke || '#000000',
      fillEnabled: true,
      stroke: '',
      strokeWidth: 0,
      strokeDash: undefined,
      widthPoints: undefined,
      strokeAlign: undefined,
    },
  });
}

/**
 * Object ▸ Simplify Path: drops anchors that sit within `tolerance` (a fraction of the shape's size) of
 * the outline and refits smooth Béziers through the rest.
 */
export function simplifyActivePath(tolerance = 0.004): { applied: boolean; reason: string; before: number; after: number } {
  const doc = store.doc;
  const layer = store.activeLayer;
  if (!doc || !layer || layer.kind !== 'shape' || !layer.shape) return { applied: false, reason: 'Select a shape first', before: 0, after: 0 };
  const editable = convertToEditablePath(layer);
  const s = editable.shape!;
  const pts = s.points ?? [];
  if (pts.length < 3) return { applied: false, reason: 'The path is already as simple as it gets', before: pts.length, after: pts.length };
  const closed = s.closed !== false;
  const docPts = pts.map((p) => ({
    x: editable.x + p.x * editable.width,
    y: editable.y + p.y * editable.height,
    ix: editable.x + p.ix * editable.width,
    iy: editable.y + p.iy * editable.height,
    ox: editable.x + p.ox * editable.width,
    oy: editable.y + p.oy * editable.height,
  }));
  const hadCurves = pts.some((p) => p.type === 'smooth' || p.ox !== p.x || p.oy !== p.y || p.ix !== p.x || p.iy !== p.y);
  // Hand-drawn polylines (pencil) are many short straight segments: treat them as curves too
  const dense = !hadCurves && pts.length > 12;
  const flat = flattenDocPath(docPts, closed);
  const tol = Math.max(0.5, Math.hypot(editable.width, editable.height) * tolerance);
  const kept = closed ? simplifyClosed(flat, tol) : simplifyPolyline(flat, tol);
  if (kept.length >= pts.length) return { applied: false, reason: 'Nothing to simplify', before: pts.length, after: pts.length };
  const anchors = fitAnchors(kept, closed, hadCurves || dense ? true : new Set());
  const x0 = editable.x, y0 = editable.y, W = editable.width || 1, H = editable.height || 1;
  const norm = anchors.map((a) => ({ ...a, x: (a.x - x0) / W, y: (a.y - y0) / H, ix: (a.ix - x0) / W, iy: (a.iy - y0) / H, ox: (a.ox - x0) / W, oy: (a.oy - y0) / H }));
  store.commit('Simplify Path', { layers: store.replaceLayer(withLayer(editable, { shape: { ...s, shape: 'path', points: norm, compoundPoints: undefined } })) });
  return { applied: true, reason: 'Simplified', before: pts.length, after: norm.length };
}

/** Object ▸ Outline Stroke on the active shape. A filled shape keeps its fill as its own layer below. */
export function outlineActiveStroke(): { applied: boolean; reason: string } {
  const doc = store.doc;
  const layer = store.activeLayer;
  if (!doc || !layer || layer.kind !== 'shape' || !layer.shape) return { applied: false, reason: 'Select a shape first' };
  if (!(layer.shape.strokeWidth > 0) || !layer.shape.stroke) return { applied: false, reason: 'The shape has no stroke' };
  const outline = withLayer(outlineStroke(layer), { id: uid() });
  if (outline.shape === layer.shape) return { applied: false, reason: 'Nothing to outline' };
  const replacement = layer.shape.fillEnabled
    ? [withLayer(layer, { shape: { ...layer.shape, strokeWidth: 0 } }), outline]
    : [outline];
  const layers = doc.layers.flatMap((l) => (l.id === layer.id ? replacement : [l]));
  store.commit('Outline Stroke', { layers, activeId: outline.id });
  return { applied: true, reason: 'Outlined' };
}


