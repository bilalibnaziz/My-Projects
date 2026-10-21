/**
 * 2D Polygon Boolean Clipping Engine (Union, Difference, Intersection, Exclude).
 *
 * Greiner–Hormann clipping: every crossing is inserted into both rings on the edge it lies on, in
 * order along that edge, then the result is traced by entry/exit flags. Degenerate input (a vertex on
 * the other ring's edge, or overlapping collinear edges — common with aligned rectangles) is resolved by
 * nudging the second ring by a fraction of a pixel, which no output can show.
 *
 * Results use the even-odd rule: outer rings are counter-clockwise, holes are clockwise.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type PolygonRing = Point2D[];

export type BooleanOperation = 'unite' | 'minus-front' | 'intersect' | 'exclude';

interface PolyNode {
  pt: Point2D;
  next: PolyNode;
  prev: PolyNode;
  isIntersection: boolean;
  peer: PolyNode | null;
  entry: boolean;
  visited: boolean;
}

interface Hit {
  i: number; // edge index in A
  j: number; // edge index in B
  t: number; // position along A's edge
  u: number; // position along B's edge
  pt: Point2D;
  na?: PolyNode;
  nb?: PolyNode;
}

/** Signed area: positive for counter-clockwise rings, negative for clockwise. */
export function polygonArea(ring: PolygonRing): number {
  let area = 0;
  const n = ring.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
  }
  return area / 2;
}

export function ensureCcw(ring: PolygonRing): PolygonRing {
  if (polygonArea(ring) < 0) {
    return [...ring].reverse();
  }
  return [...ring];
}

export function pointInPolygon(pt: Point2D, ring: PolygonRing): boolean {
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Even-odd containment across several rings (how compound paths are filled). */
export function pointInRings(pt: Point2D, rings: PolygonRing[]): boolean {
  let inside = false;
  for (const r of rings) if (pointInPolygon(pt, r)) inside = !inside;
  return inside;
}

/** Proper crossing of two segments (endpoints excluded), or null. */
export function segmentIntersection(
  p1: Point2D,
  p2: Point2D,
  q1: Point2D,
  q2: Point2D
): { pt: Point2D; t: number; u: number } | null {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = q2.x - q1.x;
  const dy2 = q2.y - q1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((q1.x - p1.x) * dy2 - (q1.y - p1.y) * dx2) / denom;
  const u = ((q1.x - p1.x) * dy1 - (q1.y - p1.y) * dx1) / denom;
  const eps = 1e-9;
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return { pt: { x: p1.x + t * dx1, y: p1.y + t * dy1 }, t, u };
  }
  return null;
}

/** Drops repeated points and points on a straight line (tol = sine of the bend angle). */
export function simplifyRing(ring: PolygonRing, tol = 1e-3): PolygonRing {
  const deduped: PolygonRing = [];
  for (const p of ring) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6) deduped.push(p);
  }
  while (deduped.length > 2) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-6) break;
    deduped.pop();
  }
  if (deduped.length <= 3) return deduped;

  const result: PolygonRing = [];
  const n = deduped.length;
  for (let i = 0; i < n; i++) {
    const pPrev = deduped[(i - 1 + n) % n];
    const pCurr = deduped[i];
    const pNext = deduped[(i + 1) % n];
    const dx1 = pCurr.x - pPrev.x;
    const dy1 = pCurr.y - pPrev.y;
    const dx2 = pNext.x - pCurr.x;
    const dy2 = pNext.y - pCurr.y;
    const sin = Math.abs(dx1 * dy2 - dy1 * dx2) / (Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2));
    if (dx1 * dx2 + dy1 * dy2 > 0 && sin <= tol) continue; // straight-through point
    result.push(pCurr);
  }
  return result.length >= 3 ? result : deduped;
}

const PARAM_EPS = 1e-9;
/** Pieces smaller than this (px²) are slivers left by the sub-pixel nudge, never real geometry. */
const MIN_PIECE_AREA = 1e-3;

/** Every crossing between the rings, and whether touching or collinear contact makes the input degenerate. */
function findHits(a: PolygonRing, b: PolygonRing): { hits: Hit[]; degenerate: boolean } {
  const hits: Hit[] = [];
  let degenerate = false;
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = a[(i + 1) % a.length];
    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const len1 = Math.hypot(dx1, dy1);
    if (len1 === 0) continue;
    for (let j = 0; j < b.length; j++) {
      const q1 = b[j];
      const q2 = b[(j + 1) % b.length];
      const dx2 = q2.x - q1.x;
      const dy2 = q2.y - q1.y;
      const len2 = Math.hypot(dx2, dy2);
      if (len2 === 0) continue;
      const denom = dx1 * dy2 - dy1 * dx2;
      const wx = q1.x - p1.x;
      const wy = q1.y - p1.y;
      if (Math.abs(denom) <= 1e-12 * len1 * len2) {
        // Parallel: degenerate only when the edges lie on one line and overlap
        if (Math.abs(wx * dy1 - wy * dx1) / len1 > 1e-9) continue;
        const s1 = (wx * dx1 + wy * dy1) / (len1 * len1);
        const s2 = ((q2.x - p1.x) * dx1 + (q2.y - p1.y) * dy1) / (len1 * len1);
        if (Math.max(Math.min(s1, s2), 0) < Math.min(Math.max(s1, s2), 1) + PARAM_EPS) degenerate = true;
        continue;
      }
      const t = (wx * dy2 - wy * dx2) / denom;
      const u = (wx * dy1 - wy * dx1) / denom;
      if (t < -PARAM_EPS || t > 1 + PARAM_EPS || u < -PARAM_EPS || u > 1 + PARAM_EPS) continue;
      if (t < PARAM_EPS || t > 1 - PARAM_EPS || u < PARAM_EPS || u > 1 - PARAM_EPS) {
        degenerate = true; // touches at a vertex
        continue;
      }
      hits.push({ i, j, t, u, pt: { x: p1.x + t * dx1, y: p1.y + t * dy1 } });
    }
  }
  return { hits, degenerate };
}

function makeNode(pt: Point2D, isIntersection: boolean): PolyNode {
  const n = { pt, isIntersection, peer: null, entry: false, visited: false } as unknown as PolyNode;
  n.next = n;
  n.prev = n;
  return n;
}

/** Builds the ring's node loop with each crossing inserted on its own edge, in order along it. */
function buildLoop(
  ring: PolygonRing,
  hits: Hit[],
  edgeOf: (h: Hit) => number,
  paramOf: (h: Hit) => number,
  slot: 'na' | 'nb'
): PolyNode[] {
  const byEdge = new Map<number, Hit[]>();
  for (const h of hits) {
    const e = edgeOf(h);
    const list = byEdge.get(e);
    if (list) list.push(h);
    else byEdge.set(e, [h]);
  }
  const nodes: PolyNode[] = [];
  for (let e = 0; e < ring.length; e++) {
    nodes.push(makeNode(ring[e], false));
    const list = byEdge.get(e);
    if (!list) continue;
    list.sort((x, y) => paramOf(x) - paramOf(y));
    for (const h of list) {
      const n = makeNode(h.pt, true);
      h[slot] = n;
      nodes.push(n);
    }
  }
  for (let k = 0; k < nodes.length; k++) {
    nodes[k].next = nodes[(k + 1) % nodes.length];
    nodes[k].prev = nodes[(k - 1 + nodes.length) % nodes.length];
  }
  return nodes;
}

/** Marks each crossing as entering or leaving the other ring, walking from a vertex. */
function markEntries(nodes: PolyNode[], other: PolygonRing, flip: boolean) {
  let inside = pointInPolygon(nodes[0].pt, other);
  for (const n of nodes) {
    if (!n.isIntersection) continue;
    n.entry = !inside !== flip;
    inside = !inside;
  }
}

function cleanRing(ring: PolygonRing): PolygonRing {
  const r = simplifyRing(ring, 0);
  return Math.abs(polygonArea(r)) > 1e-9 ? r : [];
}

/** True when the two rings overlap, touch, or one contains the other. */
export function polygonsInteract(polyA: PolygonRing, polyB: PolygonRing): boolean {
  const a = cleanRing(polyA);
  const b = cleanRing(polyB);
  if (a.length < 3 || b.length < 3) return false;
  const { hits, degenerate } = findHits(a, b);
  if (hits.length || degenerate) return true;
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

/** Boolean of two simple rings. Output rings follow the even-odd rule (holes are clockwise). */
export function clipPolygons(polyA: PolygonRing, polyB: PolygonRing, op: BooleanOperation): PolygonRing[] {
  const a = ensureCcw(cleanRing(polyA));
  const bOrig = ensureCcw(cleanRing(polyB));
  if (a.length < 3 || bOrig.length < 3) {
    if (op === 'intersect') return [];
    if (op === 'minus-front') return a.length >= 3 ? [a] : [];
    return [a, bOrig].filter((r) => r.length >= 3);
  }
  if (op === 'exclude') {
    return [...clipPolygons(a, bOrig, 'minus-front'), ...clipPolygons(bOrig, a, 'minus-front')];
  }

  // Resolve touching / collinear contact by nudging B by a sub-pixel amount
  let b = bOrig;
  let found = findHits(a, b);
  for (let k = 1; found.degenerate && k <= 6; k++) {
    const dx = 3.7e-5 * k;
    const dy = 2.3e-5 * k;
    b = bOrig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    found = findHits(a, b);
  }
  const { hits } = found;

  if (hits.length === 0) {
    const aInB = pointInPolygon(a[0], b);
    const bInA = pointInPolygon(b[0], a);
    switch (op) {
      case 'unite':
        if (aInB) return [b];
        if (bInA) return [a];
        return [a, b];
      case 'intersect':
        if (aInB) return [a];
        if (bInA) return [b];
        return [];
      case 'minus-front':
        if (aInB) return [];
        if (bInA) return [a, [...b].reverse()];
        return [a];
    }
  }

  const aNodes = buildLoop(a, hits, (h) => h.i, (h) => h.t, 'na');
  const bNodes = buildLoop(b, hits, (h) => h.j, (h) => h.u, 'nb');
  for (const h of hits) {
    h.na!.peer = h.nb!;
    h.nb!.peer = h.na!;
  }
  // Intersect: no flips. Unite: flip both. A − B: flip A only.
  markEntries(aNodes, b, op !== 'intersect');
  markEntries(bNodes, a, op === 'unite');

  const out: PolygonRing[] = [];
  const maxSteps = (aNodes.length + bNodes.length) * 2;
  for (const h of hits) {
    const start = h.na!;
    if (start.visited) continue;
    const ring: PolygonRing = [];
    let cur = start;
    let steps = 0;
    do {
      cur.visited = true;
      cur.peer!.visited = true;
      const forward = cur.entry;
      do {
        cur = forward ? cur.next : cur.prev;
        ring.push(cur.pt);
      } while (!cur.isIntersection && ++steps < maxSteps);
      cur = cur.peer!;
    } while (!cur.visited && ++steps < maxSteps);
    const r = simplifyRing(ring);
    if (r.length >= 3 && Math.abs(polygonArea(r)) > MIN_PIECE_AREA) out.push(r);
  }
  return orientByNesting(out);
}

/**
 * Traced rings come out wound by traversal direction, not by role. Make every ring nested inside an even
 * number of others counter-clockwise (an outer edge) and the rest clockwise (holes).
 */
export function orientByNesting(rings: PolygonRing[]): PolygonRing[] {
  return rings.map((r, i) => {
    const probe = { x: (r[0].x + r[1].x) / 2, y: (r[0].y + r[1].y) / 2 };
    const depth = rings.reduce((d, o, j) => (j !== i && pointInPolygon(probe, o) ? d + 1 : d), 0);
    const ccw = ensureCcw(r);
    return depth % 2 === 0 ? ccw : ccw.reverse();
  });
}

/** Union of any number of rings: overlapping pieces merge, and holes enclosed between them are kept. */
export function uniteRings(rings: PolygonRing[]): PolygonRing[] {
  let outers: PolygonRing[] = [];
  let holes: PolygonRing[] = [];
  for (const raw of rings) {
    let merged = ensureCcw(cleanRing(raw));
    if (merged.length < 3) continue;
    // The new piece fills whatever part of an existing hole it covers
    const piece = merged;
    holes = holes.flatMap((h) => clipPolygons(ensureCcw(h), piece, 'minus-front').map((r) => ensureCcw(r).reverse()));
    const keep: PolygonRing[] = [];
    for (const o of outers) {
      if (!polygonsInteract(merged, o)) {
        keep.push(o);
        continue;
      }
      const res = clipPolygons(merged, o, 'unite');
      const pos = res.filter((r) => polygonArea(r) > 0).sort((x, y) => polygonArea(y) - polygonArea(x));
      holes.push(...res.filter((r) => polygonArea(r) < 0));
      merged = pos[0] ?? merged;
      keep.push(...pos.slice(1));
    }
    outers = [...keep, merged];
  }
  return [...outers, ...holes];
}

/** The region of `back` that none of `fronts` covers. */
export function subtractRings(back: PolygonRing, fronts: PolygonRing[]): PolygonRing[] {
  const cutter = uniteRings(fronts);
  let result: PolygonRing[] = [ensureCcw(back)];
  // The cutter's outer pieces are disjoint, so each can be cut from every remaining piece in turn
  for (const c of cutter.filter((r) => polygonArea(r) > 0)) {
    const holes = result.filter((r) => polygonArea(r) < 0);
    const pieces = result.filter((r) => polygonArea(r) > 0).flatMap((r) => clipPolygons(r, c, 'minus-front'));
    result = [...pieces, ...holes];
  }
  // Parts of the back shape inside a hole of the cutter survive
  for (const h of cutter.filter((r) => polygonArea(r) < 0)) result.push(...clipPolygons(back, ensureCcw(h), 'intersect'));
  return result;
}

/** One region of a planar split: an outer ring with its holes (even-odd), plus a point inside it. */
export interface Region {
  rings: PolygonRing[];
  inside: Point2D;
}

/** Groups even-odd rings into regions: each hole belongs to the smallest outer ring around it. */
export function ringsToRegions(rings: PolygonRing[]): Region[] {
  const outers = rings.filter((r) => polygonArea(r) > MIN_PIECE_AREA);
  const holes = rings.filter((r) => polygonArea(r) < -MIN_PIECE_AREA);
  const groups = outers.map((o) => ({ outer: o, holes: [] as PolygonRing[] }));
  for (const h of holes) {
    const owner = groups
      .filter((g) => pointInPolygon(h[0], g.outer))
      .sort((a, b) => polygonArea(a.outer) - polygonArea(b.outer))[0];
    owner?.holes.push(h);
  }
  const out: Region[] = [];
  for (const g of groups) {
    const rs = [g.outer, ...g.holes];
    const inside = interiorPoint(rs);
    if (inside) out.push({ rings: rs, inside });
  }
  return out;
}

/** A point strictly inside an even-odd region (just inside one of its edges), or null for slivers. */
export function interiorPoint(rings: PolygonRing[]): Point2D | null {
  const outer = rings[0];
  const n = outer.length;
  // Try edges longest first, stepping inwards by a fraction of the edge length
  const order = [...outer.keys()].sort((i, j) => {
    const li = Math.hypot(outer[(i + 1) % n].x - outer[i].x, outer[(i + 1) % n].y - outer[i].y);
    const lj = Math.hypot(outer[(j + 1) % n].x - outer[j].x, outer[(j + 1) % n].y - outer[j].y);
    return lj - li;
  });
  for (const i of order.slice(0, 12)) {
    const a = outer[i];
    const b = outer[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    // Counter-clockwise outer ring: the inside is to the left of each edge
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (const d of [0.5, 0.15, 0.03, 0.005].map((f) => Math.min(f * len, 4))) {
      const p = { x: (a.x + b.x) / 2 + nx * d, y: (a.y + b.y) / 2 + ny * d };
      if (pointInRings(p, rings)) return p;
    }
  }
  return null;
}

function regionIntersect(r: Region, ring: PolygonRing): Region[] {
  const [outer, ...holes] = r.rings;
  return clipPolygons(outer, ring, 'intersect').flatMap((piece) => ringsToRegions(holes.length ? subtractRings(piece, holes.map(ensureCcw)) : [piece]));
}

function regionMinus(r: Region, ring: PolygonRing): Region[] {
  const [outer, ...holes] = r.rings;
  return ringsToRegions(subtractRings(outer, [ring, ...holes.map(ensureCcw)]));
}

/**
 * Splits shapes into every region their outlines form (Pathfinder ▸ Divide, and what the Shape Builder
 * picks from). Each region lists which shapes cover it.
 */
export function divideRings(shapes: PolygonRing[]): (Region & { owners: number[] })[] {
  let regions: Region[] = [];
  shapes.forEach((raw, i) => {
    const ring = ensureCcw(cleanRing(raw));
    if (ring.length < 3) return;
    const next: Region[] = [];
    for (const r of regions) next.push(...regionIntersect(r, ring), ...regionMinus(r, ring));
    // The part of this shape no earlier shape covers
    const earlier = shapes.slice(0, i).map((s) => ensureCcw(cleanRing(s))).filter((s) => s.length >= 3);
    next.push(...ringsToRegions(earlier.length ? subtractRings(ring, earlier) : [ring]));
    regions = next;
  });
  return regions.map((r) => ({ ...r, owners: shapes.map((s, i) => (pointInPolygon(r.inside, s) ? i : -1)).filter((i) => i >= 0) }));
}
