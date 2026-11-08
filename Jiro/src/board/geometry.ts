import type { Anchor, BoardObj, ConnectorObj, End, Pt, Rect } from './types'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export function rectOf(o: { x: number; y: number; w: number; h: number }): Rect {
  return { x: o.x, y: o.y, w: o.w, h: o.h }
}

export function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function contains(outer: Rect, inner: Rect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

export function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// Cached per object, but validated against the geometry it was computed from: builders (AI tools,
// templates) adjust fresh objects in place, so identity alone isn't a safe key.
const boundsCache = new WeakMap<object, { x: number; y: number; w: number; h: number; r: number; b: Rect }>()

/** Axis-aligned bounds of a rotated rect (cached per object) */
export function rotatedBounds(o: Rect & { rotation?: number }): Rect {
  const r = o.rotation ?? 0
  const hit = boundsCache.get(o)
  if (hit && hit.x === o.x && hit.y === o.y && hit.w === o.w && hit.h === o.h && hit.r === r) return hit.b
  const b = computeRotatedBounds(o)
  boundsCache.set(o, { x: o.x, y: o.y, w: o.w, h: o.h, r, b })
  return b
}

function computeRotatedBounds(o: Rect & { rotation?: number }): Rect {
  const r = ((o.rotation ?? 0) * Math.PI) / 180
  if (!r) return rectOf(o)
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const w = o.w * c + o.h * s, h = o.w * s + o.h * c
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Point on a rect side for a fixed anchor */
export function anchorPoint(r: Rect, a: Exclude<Anchor, 'auto'>): Pt {
  switch (a) {
    case 'top': return { x: r.x + r.w / 2, y: r.y }
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h }
    case 'left': return { x: r.x, y: r.y + r.h / 2 }
    case 'right': return { x: r.x + r.w, y: r.y + r.h / 2 }
  }
}

/** Best side of `r` facing point `p` */
export function facingAnchor(r: Rect, p: Pt): Exclude<Anchor, 'auto'> {
  const c = center(r)
  const dx = (p.x - c.x) / Math.max(1, r.w), dy = (p.y - c.y) / Math.max(1, r.h)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

export function nearestAnchor(r: Rect, p: Pt): Exclude<Anchor, 'auto'> {
  let best: Exclude<Anchor, 'auto'> = 'top', bd = Infinity
  for (const a of ['top', 'right', 'bottom', 'left'] as const) {
    const q = anchorPoint(r, a)
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < bd) { bd = d; best = a }
  }
  return best
}

export interface ResolvedEnd {
  p: Pt
  side: Exclude<Anchor, 'auto'> | null
}

export function resolveEnds(c: ConnectorObj, objs: Record<string, BoardObj>): [ResolvedEnd, ResolvedEnd] {
  const ra = objs[c.from.id ?? '']
  const rb = objs[c.to.id ?? '']
  const freeA: Pt = { x: c.from.x, y: c.from.y }
  const freeB: Pt = { x: c.to.x, y: c.to.y }
  const otherA = rb ? center(rb) : freeB
  const otherB = ra ? center(ra) : freeA
  const solve = (e: End, o: BoardObj | undefined, other: Pt, free: Pt): ResolvedEnd => {
    if (!o) return { p: free, side: null }
    const side = !e.anchor || e.anchor === 'auto' ? facingAnchor(o, other) : e.anchor
    return { p: anchorPoint(o, side), side }
  }
  return [solve(c.from, ra, otherA, freeA), solve(c.to, rb, otherB, freeB)]
}

const dirOf = (side: ResolvedEnd['side']): Pt =>
  side === 'top' ? { x: 0, y: -1 } : side === 'bottom' ? { x: 0, y: 1 } : side === 'left' ? { x: -1, y: 0 } : side === 'right' ? { x: 1, y: 0 } : { x: 0, y: 0 }

/** Polyline points (straight / elbow) or cubic control points (curve) for a connector */
export function connectorPath(c: ConnectorObj, objs: Record<string, BoardObj>): { d: string; mid: Pt; a: Pt; b: Pt; angA: number; angB: number } {
  const [A, B] = resolveEnds(c, objs)
  const a = A.p, b = B.p
  if (c.style === 'curve') {
    const dist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4)
    const da = A.side ? dirOf(A.side) : norm({ x: b.x - a.x, y: b.y - a.y })
    const db = B.side ? dirOf(B.side) : norm({ x: a.x - b.x, y: a.y - b.y })
    const c1 = { x: a.x + da.x * dist, y: a.y + da.y * dist }
    const c2 = { x: b.x + db.x * dist, y: b.y + db.y * dist }
    const mid = cubicAt(a, c1, c2, b, 0.5)
    return {
      d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`,
      mid, a, b,
      angA: Math.atan2(a.y - c1.y, a.x - c1.x),
      angB: Math.atan2(b.y - c2.y, b.x - c2.x),
    }
  }
  if (c.style === 'elbow') {
    const pts = elbowPoints(a, A.side, b, B.side)
    const mid = polyMid(pts)
    const n = pts.length
    return {
      d: 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L'),
      mid, a, b,
      angA: Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x),
      angB: Math.atan2(pts[n - 1].y - pts[n - 2].y, pts[n - 1].x - pts[n - 2].x),
    }
  }
  return {
    d: `M${a.x},${a.y} L${b.x},${b.y}`,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    a, b,
    angA: Math.atan2(a.y - b.y, a.x - b.x),
    angB: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

function norm(p: Pt): Pt {
  const l = Math.hypot(p.x, p.y) || 1
  return { x: p.x / l, y: p.y / l }
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

function polyMid(pts: Pt[]): Pt {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let half = total / 2
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (half <= l && l > 0) {
      const t = half / l
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    half -= l
  }
  return pts[0]
}

/** Orthogonal route that leaves/enters each side perpendicular to it */
export function elbowPoints(a: Pt, sa: ResolvedEnd['side'], b: Pt, sb: ResolvedEnd['side']): Pt[] {
  const G = 24
  const da = sa ? dirOf(sa) : Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: Math.sign(b.x - a.x) || 1, y: 0 } : { x: 0, y: Math.sign(b.y - a.y) || 1 }
  const db = sb ? dirOf(sb) : { x: -da.x, y: -da.y }
  const a1 = { x: a.x + da.x * G, y: a.y + da.y * G }
  const b1 = { x: b.x + db.x * G, y: b.y + db.y * G }
  const pts: Pt[] = [a, a1]
  const horizA = da.x !== 0
  const horizB = db.x !== 0
  if (horizA && horizB) {
    const mx = (a1.x + b1.x) / 2
    if ((da.x > 0 && mx >= a1.x || da.x < 0 && mx <= a1.x) && (db.x > 0 && mx >= b1.x || db.x < 0 && mx <= b1.x)) {
      pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y })
    } else {
      const my = (a1.y + b1.y) / 2
      pts.push({ x: a1.x, y: my }, { x: b1.x, y: my })
    }
  } else if (!horizA && !horizB) {
    const my = (a1.y + b1.y) / 2
    if ((da.y > 0 && my >= a1.y || da.y < 0 && my <= a1.y) && (db.y > 0 && my >= b1.y || db.y < 0 && my <= b1.y)) {
      pts.push({ x: a1.x, y: my }, { x: b1.x, y: my })
    } else {
      const mx = (a1.x + b1.x) / 2
      pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y })
    }
  } else if (horizA) {
    pts.push({ x: b1.x, y: a1.y })
  } else {
    pts.push({ x: a1.x, y: b1.y })
  }
  pts.push(b1, b)
  // Drop collinear / duplicate points
  const out: Pt[] = []
  for (const p of pts) {
    const n = out.length
    if (n && Math.abs(out[n - 1].x - p.x) < 0.01 && Math.abs(out[n - 1].y - p.y) < 0.01) continue
    if (n >= 2) {
      const p0 = out[n - 2], p1 = out[n - 1]
      if ((Math.abs(p0.x - p1.x) < 0.01 && Math.abs(p1.x - p.x) < 0.01) || (Math.abs(p0.y - p1.y) < 0.01 && Math.abs(p1.y - p.y) < 0.01)) {
        out[n - 1] = p
        continue
      }
    }
    out.push(p)
  }
  return out.length >= 2 ? out : [a, b]
}

export function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Does a pen polyline pass within `r` of p? (points relative to origin ox/oy) */
export function polylineHit(points: number[], ox: number, oy: number, p: Pt, r: number) {
  for (let i = 2; i < points.length; i += 2) {
    if (distToSegment(p, { x: ox + points[i - 2], y: oy + points[i - 1] }, { x: ox + points[i], y: oy + points[i + 1] }) <= r) return true
  }
  if (points.length === 2) return Math.hypot(p.x - ox - points[0], p.y - oy - points[1]) <= r
  return false
}

/** Ramer–Douglas–Peucker on a flat point list */
export function simplify(points: number[], eps: number): number[] {
  const n = points.length / 2
  if (n <= 2) return points
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let md = 0, mi = -1
    const a = { x: points[s * 2], y: points[s * 2 + 1] }, b = { x: points[e * 2], y: points[e * 2 + 1] }
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment({ x: points[i * 2], y: points[i * 2 + 1] }, a, b)
      if (d > md) { md = d; mi = i }
    }
    if (md > eps && mi > 0) {
      keep[mi] = 1
      stack.push([s, mi], [mi, e])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1])
  return out
}

/** Smooth SVG path through points (quadratic midpoints) */
export function smoothPath(points: number[]): string {
  const n = points.length / 2
  if (n === 0) return ''
  if (n === 1) return `M${points[0]},${points[1]} l0.01,0`
  if (n === 2) return `M${points[0]},${points[1]} L${points[2]},${points[3]}`
  let d = `M${points[0]},${points[1]}`
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2], y = points[i * 2 + 1]
    const mx = (x + points[i * 2 + 2]) / 2, my = (y + points[i * 2 + 3]) / 2
    d += ` Q${x},${y} ${mx},${my}`
  }
  d += ` L${points[n * 2 - 2]},${points[n * 2 - 1]}`
  return d
}

export function hitTestConnector(c: ConnectorObj, objs: Record<string, BoardObj>, p: Pt, tol: number) {
  const [A, B] = resolveEnds(c, objs)
  if (c.style === 'elbow') {
    const pts = elbowPoints(A.p, A.side, B.p, B.side)
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= tol) return true
    return false
  }
  if (c.style === 'curve') {
    const path = connectorPath(c, objs)
    const m = /C([-\d.e]+),([-\d.e]+) ([-\d.e]+),([-\d.e]+)/.exec(path.d)
    if (!m) return false
    const c1 = { x: +m[1], y: +m[2] }, c2 = { x: +m[3], y: +m[4] }
    let prev = A.p
    for (let i = 1; i <= 24; i++) {
      const q = cubicAt(A.p, c1, c2, B.p, i / 24)
      if (distToSegment(p, prev, q) <= tol) return true
      prev = q
    }
    return false
  }
  return distToSegment(p, A.p, B.p) <= tol
}

const connCache = new WeakMap<ConnectorObj, { a?: BoardObj; b?: BoardObj; fx: number; fy: number; tx: number; ty: number; ax?: number; ay?: number; bx?: number; by?: number; r: Rect }>()

/** Bounds a connector covers (for culling and marquee); cached until the line or its ends change */
export function connectorBounds(c: ConnectorObj, objs: Record<string, BoardObj>): Rect {
  const a = c.from.id ? objs[c.from.id] : undefined
  const b = c.to.id ? objs[c.to.id] : undefined
  const hit = connCache.get(c)
  if (hit && hit.a === a && hit.b === b && hit.fx === c.from.x && hit.fy === c.from.y && hit.tx === c.to.x && hit.ty === c.to.y && hit.ax === a?.x && hit.ay === a?.y && hit.bx === b?.x && hit.by === b?.y) return hit.r
  const [A, B] = resolveEnds(c, objs)
  const n = normRect(A.p, B.p)
  const r = { x: n.x - 30, y: n.y - 30, w: n.w + 60, h: n.h + 60 }
  connCache.set(c, { a, b, fx: c.from.x, fy: c.from.y, tx: c.to.x, ty: c.to.y, ax: a?.x, ay: a?.y, bx: b?.x, by: b?.y, r })
  return r
}
