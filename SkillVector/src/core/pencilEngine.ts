/**
 * Vector Pencil engine for SkillVector.
 *
 * 1. StreamLine: a pulled-rope stabilizer (the rope length is in screen pixels, so it feels the same at every zoom).
 * 2. Curve fitting: Schneider's cubic fitting (Graphics Gems) with Newton reparameterization, sharp-corner
 *    detection (corners stay corners) and seamless closed paths (no kink where the ends meet).
 * 3. QuickShape: recognises lines, arcs, polylines, circles, ellipses (also rotated), rectangles and squares
 *    (also rotated), triangles, polygons and stars, and returns the clean geometry.
 * 4. Edit selected paths: a stroke that starts and ends on a selected path reshapes that stretch of it;
 *    one that starts at an open end extends the path, and one that runs from end to end closes it.
 */

import type { PathAnchor, Rect, ShapeProps, ShapeType } from './types';

export interface Pt2D {
  x: number;
  y: number;
  t?: number; // timestamp
}

export interface CubicBezierSegment {
  p0: Pt2D;
  p1: Pt2D; // outgoing handle from p0
  p2: Pt2D; // incoming handle to p3
  p3: Pt2D;
}

// ================================================================ vector helpers

const vDist = (a: Pt2D, b: Pt2D) => Math.hypot(b.x - a.x, b.y - a.y);
const vSub = (a: Pt2D, b: Pt2D): Pt2D => ({ x: a.x - b.x, y: a.y - b.y });
const vAdd = (a: Pt2D, b: Pt2D): Pt2D => ({ x: a.x + b.x, y: a.y + b.y });
const vScale = (v: Pt2D, s: number): Pt2D => ({ x: v.x * s, y: v.y * s });
const vDot = (a: Pt2D, b: Pt2D) => a.x * b.x + a.y * b.y;
function vNormalize(v: Pt2D): Pt2D {
  const len = Math.hypot(v.x, v.y);
  return len < 1e-12 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}
const lerp = (a: Pt2D, b: Pt2D, t: number): Pt2D => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function polyLength(pts: Pt2D[], closed = false): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += vDist(pts[i - 1], pts[i]);
  if (closed && pts.length > 1) len += vDist(pts[pts.length - 1], pts[0]);
  return len;
}

/** Drops points closer than `minStep` to the previous kept point; the exact last point is always kept. */
export function dedupePoints(points: Pt2D[], minStep = 0.5): Pt2D[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const out: Pt2D[] = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length - 1; i++) {
    if (vDist(points[i], out[out.length - 1]) >= minStep) out.push({ x: points[i].x, y: points[i].y });
  }
  const last = points[points.length - 1];
  // Replace a too-close tail rather than adding a micro segment
  if (out.length > 1 && vDist(out[out.length - 1], last) < minStep) out[out.length - 1] = { x: last.x, y: last.y };
  else if (vDist(out[out.length - 1], last) > 0) out.push({ x: last.x, y: last.y });
  return out;
}

/** Evenly spaced points along a polyline (by arc length): `count` points; open polylines keep both ends. */
export function resample(pts: Pt2D[], count: number, closed = false): Pt2D[] {
  const src = closed ? [...pts, pts[0]] : pts;
  const total = polyLength(src);
  if (src.length < 2 || total < 1e-9) return pts.map((p) => ({ x: p.x, y: p.y }));
  const n = Math.max(2, count);
  const steps = closed ? n : n - 1;
  const step = total / steps;
  const out: Pt2D[] = [{ x: src[0].x, y: src[0].y }];
  let seg = 1;
  let segStart = 0; // arc length at src[seg - 1]
  let segLen = vDist(src[0], src[1]);
  for (let k = 1; k < steps; k++) {
    const target = k * step;
    while (segStart + segLen < target && seg < src.length - 1) {
      segStart += segLen;
      seg++;
      segLen = vDist(src[seg - 1], src[seg]);
    }
    out.push(lerp(src[seg - 1], src[seg], segLen > 0 ? Math.min(1, (target - segStart) / segLen) : 0));
  }
  if (!closed) out.push({ x: src[src.length - 1].x, y: src[src.length - 1].y });
  return out;
}

// ================================================================ 1. StreamLine rope stabilizer

export class StreamLineStabilizer {
  private anchor: Pt2D | null = null;
  private ropeRadius: number;
  private smoothingFactor: number;

  /** `ropeRadius` is in document units (pass screen px ÷ zoom); `smoothingFactor` 1 = a pure rope. */
  constructor(ropeRadius = 12, smoothingFactor = 1) {
    this.ropeRadius = Math.max(0, ropeRadius);
    this.smoothingFactor = Math.min(1, Math.max(0.05, smoothingFactor));
  }

  public reset() {
    this.anchor = null;
  }

  public setRopeRadius(r: number) {
    this.ropeRadius = Math.max(0, r);
  }

  public update(raw: Pt2D): { point: Pt2D; raw: Pt2D; ropeActive: boolean } {
    if (!this.anchor || this.ropeRadius <= 0) {
      this.anchor = { x: raw.x, y: raw.y, t: raw.t };
      return { point: { ...this.anchor }, raw, ropeActive: false };
    }
    const dx = raw.x - this.anchor.x;
    const dy = raw.y - this.anchor.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.ropeRadius) {
      // The pen pulls the rope taut: the anchor moves along the rope until it is one rope length behind
      const pull = (dist - this.ropeRadius) * this.smoothingFactor;
      this.anchor.x += (dx / dist) * pull;
      this.anchor.y += (dy / dist) * pull;
    }
    return { point: { ...this.anchor }, raw, ropeActive: true };
  }

  /** On release the line catches up with the pen, so the stroke ends where the pen was lifted. */
  public flush(raw: Pt2D): Pt2D {
    this.anchor = { x: raw.x, y: raw.y, t: raw.t };
    return { ...this.anchor };
  }
}

// ================================================================ 2. Curve fitting

/** Evaluates a cubic Bézier at u in [0, 1]. */
export function evalCubicBezier(p0: Pt2D, p1: Pt2D, p2: Pt2D, p3: Pt2D, u: number): Pt2D {
  const t = 1 - u;
  const a = t * t * t, b = 3 * t * t * u, c = 3 * t * u * u, d = u * u * u;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function bezierDeriv(s: CubicBezierSegment, u: number): Pt2D {
  const t = 1 - u;
  return {
    x: 3 * t * t * (s.p1.x - s.p0.x) + 6 * t * u * (s.p2.x - s.p1.x) + 3 * u * u * (s.p3.x - s.p2.x),
    y: 3 * t * t * (s.p1.y - s.p0.y) + 6 * t * u * (s.p2.y - s.p1.y) + 3 * u * u * (s.p3.y - s.p2.y),
  };
}

function bezierDeriv2(s: CubicBezierSegment, u: number): Pt2D {
  const t = 1 - u;
  return {
    x: 6 * t * (s.p2.x - 2 * s.p1.x + s.p0.x) + 6 * u * (s.p3.x - 2 * s.p2.x + s.p1.x),
    y: 6 * t * (s.p2.y - 2 * s.p1.y + s.p0.y) + 6 * u * (s.p3.y - 2 * s.p2.y + s.p1.y),
  };
}

function chordLengthParameterize(pts: Pt2D[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u[i] = u[i - 1] + vDist(pts[i], pts[i - 1]);
  const total = u[u.length - 1];
  if (total <= 1e-12) return pts.map((_, i) => (pts.length > 1 ? i / (pts.length - 1) : 0));
  return u.map((d) => d / total);
}

/** Least-squares handle lengths along fixed end tangents (Schneider). */
function generateBezier(pts: Pt2D[], uPrime: number[], tHat1: Pt2D, tHat2: Pt2D): CubicBezierSegment {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const u = uPrime[i];
    const t = 1 - u;
    const b0 = t * t * t, b1 = 3 * t * t * u, b2 = 3 * t * u * u, b3 = u * u * u;
    const a1 = vScale(tHat1, b1);
    const a2 = vScale(tHat2, b2);
    c00 += vDot(a1, a1);
    c01 += vDot(a1, a2);
    c11 += vDot(a2, a2);
    const diff = vSub(pts[i], { x: (b0 + b1) * p0.x + (b2 + b3) * p3.x, y: (b0 + b1) * p0.y + (b2 + b3) * p3.y });
    x0 += vDot(diff, a1);
    x1 += vDot(diff, a2);
  }
  const det = c00 * c11 - c01 * c01;
  let alphaL = 0, alphaR = 0;
  if (Math.abs(det) > 1e-12) {
    alphaL = (x0 * c11 - x1 * c01) / det;
    alphaR = (c00 * x1 - c01 * x0) / det;
  }
  const segDist = vDist(p0, p3);
  const eps = 1e-6 * segDist;
  // A handle that wants to point backwards (its tangent is a hair off) collapses to zero, and the other
  // handle is solved alone, rather than forcing both to ⅓ of the chord
  if (alphaL < eps && alphaR >= eps && c11 > 1e-12) {
    alphaL = 0;
    alphaR = x1 / c11;
  } else if (alphaR < eps && alphaL >= eps && c00 > 1e-12) {
    alphaR = 0;
    alphaL = x0 / c00;
  }
  // Still degenerate or wildly long: fall back to the ⅓-chord rule (Schneider's heuristic)
  if (alphaL < 0 || alphaR < 0 || (alphaL < eps && alphaR < eps) || alphaL > segDist * 2 || alphaR > segDist * 2) {
    alphaL = alphaR = segDist / 3;
  }
  return { p0, p1: vAdd(p0, vScale(tHat1, alphaL)), p2: vAdd(p3, vScale(tHat2, alphaR)), p3 };
}

/** One Newton–Raphson step moving each parameter towards the closest point on the curve. */
function reparameterize(pts: Pt2D[], u: number[], s: CubicBezierSegment): number[] {
  return u.map((ui, i) => {
    const d = vSub(evalCubicBezier(s.p0, s.p1, s.p2, s.p3, ui), pts[i]);
    const d1 = bezierDeriv(s, ui);
    const d2 = bezierDeriv2(s, ui);
    const num = vDot(d, d1);
    const den = vDot(d1, d1) + vDot(d, d2);
    if (Math.abs(den) < 1e-12) return ui;
    return Math.min(1, Math.max(0, ui - num / den));
  });
}

function computeMaxError(pts: Pt2D[], u: number[], s: CubicBezierSegment): { maxErr: number; splitIdx: number } {
  let maxErr = 0;
  let splitIdx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const err = vDist(pts[i], evalCubicBezier(s.p0, s.p1, s.p2, s.p3, u[i]));
    if (err > maxErr) {
      maxErr = err;
      splitIdx = i;
    }
  }
  return { maxErr, splitIdx };
}

/**
 * Unit tangent at one end of a run of points: the slope at the end of a least-squares quadratic through the
 * points within `reach` of arc length. Unbiased on curves, and it averages out hand jitter.
 */
function endTangent(pts: Pt2D[], atStart: boolean, reach: number): Pt2D {
  const n = pts.length;
  const at = (k: number) => (atStart ? pts[k] : pts[n - 1 - k]);
  const origin = at(0);
  const ss: number[] = [0];
  const ps: Pt2D[] = [origin];
  let acc = 0;
  for (let k = 1; k < n; k++) {
    acc += vDist(at(k - 1), at(k));
    if (acc > reach && ps.length >= 2) break;
    ss.push(acc);
    ps.push(at(k));
  }
  const far = ps[ps.length - 1];
  if (ps.length < 5) return vNormalize(vSub(far, origin));
  // Normal equations for x(s), y(s) = a + b·s + c·s² (s scaled to 0..1 for conditioning)
  const S = ss[ss.length - 1] || 1;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, x0 = 0, x1 = 0, x2 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < ps.length; i++) {
    const t = ss[i] / S, t2 = t * t;
    s0 += 1; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2;
    x0 += ps[i].x; x1 += ps[i].x * t; x2 += ps[i].x * t2;
    y0 += ps[i].y; y1 += ps[i].y * t; y2 += ps[i].y * t2;
  }
  // Cramer's rule for the linear coefficient b
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-12) return vNormalize(vSub(far, origin));
  const bOf = (r0: number, r1: number, r2: number) => (s0 * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det;
  const tan = vNormalize({ x: bOf(x0, x1, x2), y: bOf(y0, y1, y2) });
  // Guard against a fit that turned round (a hook at the very end): fall back to the chord
  const chord = vNormalize(vSub(far, origin));
  return vDot(tan, chord) > 0.3 ? tan : chord;
}

/** Evenly resamples a run (spacing ≈ `spacing`) and smooths it lightly, keeping both ends exactly in place. */
function smoothRun(pts: Pt2D[], spacing: number, passes = 3): Pt2D[] {
  const len = polyLength(pts);
  const count = Math.max(2, Math.min(4000, Math.round(len / spacing) + 1));
  if (count < 5) return pts;
  let out = resample(pts, count);
  for (let p = 0; p < passes; p++) {
    const next = out.slice();
    for (let i = 1; i < out.length - 1; i++) {
      next[i] = { x: (out[i - 1].x + 2 * out[i].x + out[i + 1].x) / 4, y: (out[i - 1].y + 2 * out[i].y + out[i + 1].y) / 4 };
    }
    out = next;
  }
  return out;
}

function fitCubic(pts: Pt2D[], tHat1: Pt2D, tHat2: Pt2D, tol: number, out: CubicBezierSegment[], depth = 0) {
  const n = pts.length;
  if (n === 2) {
    const d = vDist(pts[0], pts[1]) / 3;
    out.push({ p0: pts[0], p1: vAdd(pts[0], vScale(tHat1, d)), p2: vAdd(pts[1], vScale(tHat2, d)), p3: pts[1] });
    return;
  }
  // A whole run that stays within tolerance of its chord is one straight segment (not a slightly bent one)
  if (depth === 0) {
    const p0 = pts[0], p3 = pts[n - 1];
    const chord = vDist(p0, p3);
    if (chord > tol * 4 && pts.every((p) => distToSegment(p, p0, p3) <= tol)) {
      out.push({ p0, p1: lerp(p0, p3, 1 / 3), p2: lerp(p0, p3, 2 / 3), p3 });
      return;
    }
  }
  let u = chordLengthParameterize(pts);
  let seg = generateBezier(pts, u, tHat1, tHat2);
  let { maxErr, splitIdx } = computeMaxError(pts, u, seg);
  if (maxErr <= tol) {
    out.push(seg);
    return;
  }
  // Close enough: refine the parameters (Newton) before giving up and splitting
  if (maxErr <= tol * 4) {
    for (let it = 0; it < 6; it++) {
      u = reparameterize(pts, u, seg);
      seg = generateBezier(pts, u, tHat1, tHat2);
      ({ maxErr, splitIdx } = computeMaxError(pts, u, seg));
      if (maxErr <= tol) {
        out.push(seg);
        return;
      }
    }
  }
  if (depth > 40) {
    out.push(seg);
    return;
  }
  splitIdx = Math.min(n - 2, Math.max(1, splitIdx));
  // The split point gets one tangent for both sides, so the joint is smooth
  const a = pts[Math.max(0, splitIdx - 2)];
  const b = pts[Math.min(n - 1, splitIdx + 2)];
  let center = vNormalize(vSub(b, a));
  if (center.x === 0 && center.y === 0) center = vNormalize(vSub(pts[splitIdx + 1], pts[splitIdx - 1]));
  fitCubic(pts.slice(0, splitIdx + 1), tHat1, vScale(center, -1), tol, out, depth + 1);
  fitCubic(pts.slice(splitIdx), center, tHat2, tol, out, depth + 1);
}

/**
 * Indices of sharp corners: the direction turns by more than `angleDeg` between the stretch `reach` before
 * a point and the stretch `reach` after it; only the sharpest point of each turn is kept.
 */
export function findCorners(pts: Pt2D[], reach: number, angleDeg = 70, closed = false): number[] {
  const n = pts.length;
  if (n < 3) return [];
  const at = (i: number) => pts[((i % n) + n) % n];
  const turn: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let j = i, back = 0;
    while (back < reach && (closed ? j > i - n + 1 : j > 0)) {
      back += vDist(at(j), at(j - 1));
      j--;
    }
    let k = i, fwd = 0;
    while (fwd < reach && (closed ? k < i + n - 1 : k < n - 1)) {
      fwd += vDist(at(k), at(k + 1));
      k++;
    }
    if (back < reach * 0.6 || fwd < reach * 0.6) continue;
    const v1 = vNormalize(vSub(at(i), at(j)));
    const v2 = vNormalize(vSub(at(k), at(i)));
    turn[i] = (Math.acos(Math.max(-1, Math.min(1, vDot(v1, v2)))) * 180) / Math.PI;
  }
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < angleDeg) continue;
    // Keep only the local maximum within `reach` of arc length on either side
    let isMax = true;
    let d = 0;
    for (let k = i + 1; isMax && (closed ? k < i + n : k < n); k++) {
      d += vDist(at(k - 1), at(k));
      if (d > reach) break;
      if (turn[((k % n) + n) % n] > turn[i]) isMax = false;
    }
    d = 0;
    for (let k = i - 1; isMax && (closed ? k > i - n : k >= 0); k--) {
      d += vDist(at(k + 1), at(k));
      if (d > reach) break;
      if (turn[((k % n) + n) % n] >= turn[i]) isMax = false;
    }
    if (isMax) corners.push(i);
  }
  return corners;
}

export interface FitOptions {
  /** Points closer than this to the previous one are dropped (document units). */
  minStep?: number;
  /** Treat the points as a closed loop (the last point joins the first without a kink). */
  closed?: boolean;
  /** Turns sharper than this (degrees) become corner anchors; 0 or less keeps everything smooth. */
  cornerAngle?: number;
  /** Arc length over which tangents and corners are measured (default 2.5 × maxError). */
  reach?: number;
  /** Resample and lightly smooth each run before fitting (for hand-drawn input; fitStroke turns it on). */
  smooth?: boolean;
}

/** Fits raw polyline points with as few cubic Bézier segments as the error tolerance allows. */
export function fitCurves(points: Pt2D[], maxError = 4, options: FitOptions = {}): CubicBezierSegment[] {
  const tol = Math.max(1e-3, maxError);
  const minStep = options.minStep ?? Math.min(0.5, tol / 4);
  let pts = dedupePoints(points, minStep);
  const closed = !!options.closed;
  // A closed loop must not repeat its first point at the end
  while (closed && pts.length > 3 && vDist(pts[0], pts[pts.length - 1]) < Math.max(minStep * 2, tol / 2)) pts.pop();
  if (pts.length < 2) return [];
  const reach = options.reach ?? tol * 2.5;
  const cornerAngle = options.cornerAngle ?? 0;
  let corners = cornerAngle > 0 ? findCorners(pts, reach, cornerAngle, closed) : [];

  const out: CubicBezierSegment[] = [];
  // Each run between corners is resampled and lightly smoothed (σ ≈ ½ tolerance) so jitter doesn't add anchors
  const prep = (piece: Pt2D[]) => (options.smooth ? smoothRun(piece, tol / 2) : piece);
  const fitPiece = (raw: Pt2D[]) => {
    if (raw.length < 2) return;
    const piece = prep(raw);
    const r = Math.min(reach * (options.smooth ? 3 : 1), polyLength(piece) / 2);
    fitCubic(piece, endTangent(piece, true, r), endTangent(piece, false, r), tol, out);
  };

  if (!closed) {
    const cuts = [0, ...corners.filter((c) => c > 0 && c < pts.length - 1), pts.length - 1];
    for (let i = 0; i < cuts.length - 1; i++) fitPiece(pts.slice(cuts[i], cuts[i + 1] + 1));
    return out;
  }

  if (pts.length < 3) return [];
  if (corners.length) {
    // Start the loop at a corner, so every piece runs corner to corner
    const c0 = corners[0];
    pts = [...pts.slice(c0), ...pts.slice(0, c0)];
    corners = corners.map((c) => c - c0);
    const ring = [...pts, pts[0]];
    const cuts = [...corners, pts.length];
    for (let i = 0; i < cuts.length - 1; i++) fitPiece(ring.slice(cuts[i], cuts[i + 1] + 1));
    return out;
  }
  // Smooth loop: one shared tangent where the loop starts and ends
  const ring = prep([...pts, pts[0]]);
  const r = Math.min(reach, polyLength(ring) / 6);
  const fwd = endTangent(ring, true, r);
  const back = endTangent(ring, false, r);
  let shared = vNormalize(vSub(fwd, back));
  if (shared.x === 0 && shared.y === 0) shared = fwd;
  fitCubic(ring, shared, vScale(shared, -1), tol, out);
  return out;
}

/** Smooth when the in and out handles are opposite (within ~3°), otherwise a corner. */
function anchorType(a: PathAnchor): 'smooth' | 'corner' {
  const vin = vSub({ x: a.x, y: a.y }, { x: a.ix, y: a.iy });
  const vout = vSub({ x: a.ox, y: a.oy }, { x: a.x, y: a.y });
  const li = Math.hypot(vin.x, vin.y);
  const lo = Math.hypot(vout.x, vout.y);
  if (li < 1e-9 || lo < 1e-9) return 'corner';
  return vDot(vin, vout) / (li * lo) > 0.9986 ? 'smooth' : 'corner';
}

/** Converts fitted cubic segments into anchors; a joint is smooth only where its handles line up. */
export function bezierSegmentsToAnchors(segments: CubicBezierSegment[], closed = false): PathAnchor[] {
  if (segments.length === 0) return [];
  const anchors: PathAnchor[] = [];
  const first = segments[0];
  anchors.push({ x: first.p0.x, y: first.p0.y, ix: first.p0.x, iy: first.p0.y, ox: first.p1.x, oy: first.p1.y, type: 'corner' });
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (isLast && closed) {
      anchors[0].ix = seg.p2.x;
      anchors[0].iy = seg.p2.y;
    } else {
      anchors.push({
        x: seg.p3.x,
        y: seg.p3.y,
        ix: seg.p2.x,
        iy: seg.p2.y,
        ox: isLast ? seg.p3.x : segments[i + 1].p1.x,
        oy: isLast ? seg.p3.y : segments[i + 1].p1.y,
        type: 'corner',
      });
    }
  }
  for (const a of anchors) a.type = anchorType(a);
  return anchors;
}

/** Fits a freehand stroke straight to path anchors (document space): the Pencil's main entry point. */
export function fitStroke(points: Pt2D[], tolerance: number, options: FitOptions = {}): PathAnchor[] {
  const segs = fitCurves(points, tolerance, { cornerAngle: 70, smooth: true, ...options });
  return bezierSegmentsToAnchors(segs, !!options.closed);
}

// ================================================================ 3. QuickShape recognition

export type RecognizedShapeKind =
  | 'circle' | 'ellipse' | 'square' | 'rectangle' | 'triangle' | 'polygon' | 'star' | 'line' | 'arc' | 'polyline' | 'arrow';

export interface QuickShapeResult {
  kind: RecognizedShapeKind;
  /** `path` results carry their exact geometry in `anchors` (document space). */
  shapeType: ShapeType;
  /** The unrotated box (for a line: the box spanning `from` and `to`). */
  rect: Rect;
  confidence: number;
  anchors?: PathAnchor[];
  closed: boolean;
  /** Clockwise rotation (degrees) of `rect` about its centre, for rotated rectangles and ellipses. */
  rotation?: number;
  /** Lines: the exact end points, so the direction is kept. */
  from?: Pt2D;
  to?: Pt2D;
}

const cornerAnchor = (p: Pt2D): PathAnchor => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y, type: 'corner' });

function distToSegment(p: Pt2D, a: Pt2D, b: Pt2D): number {
  const ab = vSub(b, a);
  const l2 = vDot(ab, ab);
  if (l2 < 1e-12) return vDist(p, a);
  const t = Math.max(0, Math.min(1, vDot(vSub(p, a), ab) / l2));
  return vDist(p, vAdd(a, vScale(ab, t)));
}

/** Ramer–Douglas–Peucker: indices of the kept vertices of an open polyline. */
function rdp(pts: Pt2D[], eps: number): number[] {
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxD = -1, idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(pts[i], pts[lo], pts[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return keep.flatMap((k, i) => (k ? [i] : []));
}

/** Max distance from the points to a polyline/polygon through `verts`. */
function polyDeviation(pts: Pt2D[], verts: Pt2D[], closed: boolean): number {
  let worst = 0;
  const m = verts.length;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 0; i < (closed ? m : m - 1); i++) best = Math.min(best, distToSegment(p, verts[i], verts[(i + 1) % m]));
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Turn (degrees, 0 = straight on) at each vertex of a closed polygon. */
function polygonTurns(v: Pt2D[]): number[] {
  return v.map((p, i) => {
    const a = vNormalize(vSub(p, v[(i - 1 + v.length) % v.length]));
    const b = vNormalize(vSub(v[(i + 1) % v.length], p));
    return (Math.acos(Math.max(-1, Math.min(1, vDot(a, b)))) * 180) / Math.PI;
  });
}

/** Merges near-straight vertices and vertices on very short edges of a closed polygon. */
function cleanPolygon(v: Pt2D[], minEdge: number): Pt2D[] {
  let out = v.slice();
  for (let guard = 0; guard < 64 && out.length > 3; guard++) {
    const turns = polygonTurns(out);
    let worst = -1, worstScore = Infinity;
    for (let i = 0; i < out.length; i++) {
      const e = Math.min(vDist(out[i], out[(i + 1) % out.length]), vDist(out[i], out[(i - 1 + out.length) % out.length]));
      const score = turns[i] < 22 ? turns[i] : e < minEdge ? 100 + e : Infinity;
      if (score < worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    if (worst < 0) break;
    out = out.filter((_, i) => i !== worst);
  }
  return out;
}

/** Circle through three points (null when they are collinear). */
function circleFrom3(a: Pt2D, b: Pt2D, c: Pt2D): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

/** Cubic anchors for a circular arc starting at angle a0 and sweeping `sweep` radians (either sign). */
export function arcAnchors(cx: number, cy: number, r: number, a0: number, sweep: number): PathAnchor[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  const anchors: PathAnchor[] = [];
  for (let i = 0; i <= pieces; i++) {
    const a = a0 + step * i;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    const tx = -Math.sin(a), ty = Math.cos(a);
    anchors.push({
      x, y,
      ix: i === 0 ? x : x - tx * k, iy: i === 0 ? y : y - ty * k,
      ox: i === pieces ? x : x + tx * k, oy: i === pieces ? y : y + ty * k,
      type: i === 0 || i === pieces ? 'corner' : 'smooth',
    });
  }
  return anchors;
}

function rotateAbout(p: Pt2D, c: Pt2D, ang: number): Pt2D {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

/** Wraps an angle (radians) into (-45°, 45°] and snaps it to 0 within `tolDeg` of an axis. */
function axisAngle(ang: number, tolDeg: number): number {
  let a = ang % (Math.PI / 2);
  if (a > Math.PI / 4) a -= Math.PI / 2;
  if (a <= -Math.PI / 4) a += Math.PI / 2;
  return Math.abs(a) < (tolDeg * Math.PI) / 180 ? 0 : a;
}

function anchorBox(anchors: PathAnchor[]): Rect {
  const xs = anchors.flatMap((a) => [a.x, a.ix, a.ox]);
  const ys = anchors.flatMap((a) => [a.y, a.iy, a.oy]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Width/height and angle of the box with semi-axes `a` (along `theta`) and `b`, as an upright box + rotation. */
function orientedBox(c: Pt2D, a: number, b: number, theta: number, snapDeg: number): { rect: Rect; rotation?: number } {
  // Express the rotation in (-45°, 45°]: a quarter turn swaps which semi-axis is the width
  const rot = axisAngle(theta, snapDeg);
  const quarterTurns = Math.round((theta - axisAngle(theta, 0)) / (Math.PI / 2));
  const swap = Math.abs(quarterTurns) % 2 === 1;
  const w = 2 * (swap ? b : a), h = 2 * (swap ? a : b);
  return { rect: { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h }, rotation: rot ? (rot * 180) / Math.PI : undefined };
}

/**
 * Recognises a rough gesture as a clean shape. `autoCloseThreshold` is how near (document units) the ends must be
 * for the gesture to count as closed; it also scales the smallest gesture considered (pass screen px ÷ zoom).
 */
export function detectQuickShape(points: Pt2D[], autoCloseThreshold = 24): QuickShapeResult | null {
  const raw = dedupePoints(points, autoCloseThreshold / 40);
  if (raw.length < 5) return null;
  const L = polyLength(raw);
  if (L < autoCloseThreshold * 1.5) return null;
  const start = raw[0];
  const end = raw[raw.length - 1];
  const gap = vDist(start, end);
  const isLoop = gap <= Math.max(autoCloseThreshold, L * 0.17);

  if (!isLoop) {
    const R = resample(raw, 96);
    // Line: nothing strays more than ~3.5% of its length from the chord
    const dev = Math.max(...R.map((p) => distToSegment(p, start, end)));
    if (dev <= Math.max(gap * 0.035, autoCloseThreshold * 0.1)) {
      const rect = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      return { kind: 'line', shapeType: 'line', rect, confidence: 1 - dev / Math.max(1, gap), closed: false, from: { x: start.x, y: start.y }, to: { x: end.x, y: end.y } };
    }
    // Arc: the circle through start, middle and end fits every point within ~4.5% of its radius
    const mid = R[Math.floor(R.length / 2)];
    const c = circleFrom3(start, mid, end);
    if (c && c.r < L * 4) {
      const rErr = Math.max(...R.map((p) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r)));
      if (rErr <= c.r * 0.045) {
        const a0 = Math.atan2(start.y - c.cy, start.x - c.cx);
        const am = Math.atan2(mid.y - c.cy, mid.x - c.cx);
        const a1 = Math.atan2(end.y - c.cy, end.x - c.cx);
        const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        // Sweep in the direction (increasing or decreasing angle) that passes through the middle
        const up = norm(am - a0) <= norm(a1 - a0);
        const sweep = up ? norm(a1 - a0) : -norm(a0 - a1);
        if (Math.abs(sweep) < Math.PI * 1.85) {
          const anchors = arcAnchors(c.cx, c.cy, c.r, a0, sweep);
          return { kind: 'arc', shapeType: 'path', rect: anchorBox(anchors), confidence: 1 - rErr / c.r, anchors, closed: false };
        }
      }
    }
    // Polyline: two to four straight strokes with clear corners
    const eps = Math.max(L * 0.025, autoCloseThreshold * 0.12);
    const idx = rdp(R, eps);
    if (idx.length >= 3 && idx.length <= 5) {
      const verts = idx.map((i) => R[i]);
      const minEdge = Math.min(...verts.slice(1).map((v, i) => vDist(v, verts[i])));
      const turns = verts.slice(1, -1).map((v, i) => {
        const p = verts[i], q = verts[i + 2];
        return (Math.acos(Math.max(-1, Math.min(1, vDot(vNormalize(vSub(v, p)), vNormalize(vSub(q, v)))))) * 180) / Math.PI;
      });
      if (minEdge >= L * 0.08 && turns.every((t) => t > 20) && polyDeviation(R, verts, false) <= eps * 1.3) {
        const anchors = verts.map(cornerAnchor);
        return { kind: 'polyline', shapeType: 'path', rect: anchorBox(anchors), confidence: 0.85, anchors, closed: false };
      }
    }
    return null;
  }

  // ---- closed gestures: cut an overshoot past the start, then resample evenly
  let cut = raw.length - 1, cutD = gap;
  for (let i = Math.floor(raw.length * 0.8); i < raw.length; i++) {
    const d = vDist(raw[i], start);
    if (d < cutD) {
      cutD = d;
      cut = i;
    }
  }
  const R = resample(raw.slice(0, cut + 1), 128, true);
  const P = polyLength(R, true);

  // Ellipse: principal axes from the second moments of the evenly sampled outline
  let mx = 0, my = 0;
  for (const p of R) {
    mx += p.x;
    my += p.y;
  }
  mx /= R.length;
  my /= R.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of R) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const centre = { x: mx, y: my };
  const local = R.map((p) => rotateAbout(p, centre, -theta));
  const lx0 = Math.min(...local.map((p) => p.x)), lx1 = Math.max(...local.map((p) => p.x));
  const ly0 = Math.min(...local.map((p) => p.y)), ly1 = Math.max(...local.map((p) => p.y));
  const a = (lx1 - lx0) / 2, b = (ly1 - ly0) / 2;
  if (a < 2 || b < 2) return null;
  const lc = { x: (lx0 + lx1) / 2, y: (ly0 + ly1) / 2 };
  const errs = local.map((p) => Math.abs(Math.hypot((p.x - lc.x) / a, (p.y - lc.y) / b) - 1));
  const meanErr = errs.reduce((s, e) => s + e, 0) / errs.length;
  const maxErr = Math.max(...errs);
  if (meanErr < 0.06 && maxErr < 0.17) {
    const c = rotateAbout(lc, centre, theta);
    if (Math.abs(a - b) / Math.max(a, b) < 0.1) {
      const r = (a + b) / 2;
      return { kind: 'circle', shapeType: 'ellipse', rect: { x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r }, confidence: 1 - meanErr, closed: true };
    }
    const box = orientedBox(c, a, b, theta, 7);
    return { kind: 'ellipse', shapeType: 'ellipse', rect: box.rect, rotation: box.rotation, confidence: 1 - meanErr, closed: true };
  }

  // Polygons: simplify the loop, starting from its point farthest from the centre (always a corner)
  let far = 0;
  R.forEach((p, i) => {
    if (vDist(p, centre) > vDist(R[far], centre)) far = i;
  });
  const ring = [...R.slice(far), ...R.slice(0, far), R[far]];
  const eps = P * 0.022;
  const idx = rdp(ring, eps);
  const verts = cleanPolygon(idx.slice(0, -1).map((i) => ring[i]), P * 0.05);
  if (verts.length < 3) return null;
  if (polyDeviation(R, verts, true) > eps * 1.6) return null;
  const turns = polygonTurns(verts);
  const k = verts.length;

  if (k === 4 && turns.every((t) => Math.abs(t - 90) < 20)) {
    // Rectangle: average the four edge directions (mod 90°, weighted by length) for its angle
    let sx = 0, sy = 0;
    for (let i = 0; i < 4; i++) {
      const e = vSub(verts[(i + 1) % 4], verts[i]);
      const ang = Math.atan2(e.y, e.x) * 4;
      const len = Math.hypot(e.x, e.y);
      sx += Math.cos(ang) * len;
      sy += Math.sin(ang) * len;
    }
    const rot = axisAngle(Math.atan2(sy, sx) / 4, 6);
    const c = { x: verts.reduce((s, v) => s + v.x, 0) / 4, y: verts.reduce((s, v) => s + v.y, 0) / 4 };
    const lv = verts.map((v) => rotateAbout(v, c, -rot));
    // Each side is the mean of its two opposite edges
    const xs = lv.map((p) => p.x).sort((m, n) => m - n);
    const ys = lv.map((p) => p.y).sort((m, n) => m - n);
    let w = (xs[2] + xs[3]) / 2 - (xs[0] + xs[1]) / 2;
    let h = (ys[2] + ys[3]) / 2 - (ys[0] + ys[1]) / 2;
    const square = Math.abs(w - h) / Math.max(w, h) < 0.08;
    if (square) w = h = (w + h) / 2;
    const cc = rotateAbout({ x: (xs[0] + xs[1] + xs[2] + xs[3]) / 4, y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4 }, c, rot);
    return {
      kind: square ? 'square' : 'rectangle', shapeType: 'rectangle',
      rect: { x: cc.x - w / 2, y: cc.y - h / 2, width: w, height: h },
      confidence: 0.9, closed: true, rotation: rot ? (rot * 180) / Math.PI : undefined,
    };
  }

  if (k === 3) {
    const box = anchorBox(verts.map(cornerAnchor));
    // An upright isosceles triangle stays a live Triangle shape; any other keeps its exact corners
    const [apex, b1, b2] = verts.slice().sort((m, n) => m.y - n.y);
    const baseLevel = Math.abs(b1.y - b2.y) < box.height * 0.08;
    const centred = Math.abs(apex.x - (b1.x + b2.x) / 2) < box.width * 0.07;
    if (baseLevel && centred) return { kind: 'triangle', shapeType: 'triangle', rect: box, confidence: 0.9, closed: true };
    const anchors = verts.map(cornerAnchor);
    return { kind: 'triangle', shapeType: 'path', rect: box, confidence: 0.88, anchors, closed: true };
  }

  if (k >= 8 && k % 2 === 0 && k <= 24) {
    // Star: the vertices alternate far / near from the centre
    const c = { x: verts.reduce((s, v) => s + v.x, 0) / k, y: verts.reduce((s, v) => s + v.y, 0) / k };
    const rs = verts.map((v) => vDist(v, c));
    const alt = rs.every((r, i) => {
      const prev = rs[(i - 1 + k) % k], next = rs[(i + 1) % k];
      return (r > prev * 1.15 && r > next * 1.15) || (r * 1.15 < prev && r * 1.15 < next);
    });
    if (alt) {
      const anchors = verts.map(cornerAnchor);
      return { kind: 'star', shapeType: 'path', rect: anchorBox(anchors), confidence: 0.85, anchors, closed: true };
    }
  }

  if (k >= 4 && k <= 8) {
    const anchors = verts.map(cornerAnchor);
    return { kind: 'polygon', shapeType: 'path', rect: anchorBox(anchors), confidence: 0.82, anchors, closed: true };
  }
  return null;
}

// ================================================================ 4. Edit selected paths (reshape / extend / close)

function segOf(anchors: PathAnchor[], i: number): CubicBezierSegment {
  const a = anchors[i];
  const b = anchors[(i + 1) % anchors.length];
  return { p0: { x: a.x, y: a.y }, p1: { x: a.ox, y: a.oy }, p2: { x: b.ix, y: b.iy }, p3: { x: b.x, y: b.y } };
}

/** The closest point on a path: segment index, parameter and distance. */
export function nearestOnPath(anchors: PathAnchor[], closed: boolean, p: Pt2D): { seg: number; t: number; d: number; pt: Pt2D } {
  const segCount = closed ? anchors.length : anchors.length - 1;
  let best = { seg: 0, t: 0, d: vDist(anchors[0], p), pt: { x: anchors[0].x, y: anchors[0].y } };
  for (let s = 0; s < segCount; s++) {
    const sg = segOf(anchors, s);
    const at = (t: number) => evalCubicBezier(sg.p0, sg.p1, sg.p2, sg.p3, t);
    const N = 48;
    let bt = 0, bd = Infinity;
    for (let i = 0; i <= N; i++) {
      const d = vDist(at(i / N), p);
      if (d < bd) {
        bd = d;
        bt = i / N;
      }
    }
    // Refine with a golden-section search around the best sample
    let lo = Math.max(0, bt - 1 / N), hi = Math.min(1, bt + 1 / N);
    for (let it = 0; it < 30; it++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      if (vDist(at(m1), p) < vDist(at(m2), p)) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const pt = at(t);
    const d = vDist(pt, p);
    if (d < best.d) best = { seg: s, t, d, pt };
  }
  return best;
}

/** Splits segment `seg` at `t` (de Casteljau); returns the new array and the index of the anchor at that point. */
function splitAt(anchors: PathAnchor[], seg: number, t: number): { anchors: PathAnchor[]; index: number; inserted: boolean } {
  const n = anchors.length;
  if (t <= 1e-4) return { anchors, index: seg, inserted: false };
  if (t >= 1 - 1e-4) return { anchors, index: (seg + 1) % n, inserted: false };
  const s = segOf(anchors, seg);
  const p01 = lerp(s.p0, s.p1, t), p12 = lerp(s.p1, s.p2, t), p23 = lerp(s.p2, s.p3, t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  const out = anchors.map((a) => ({ ...a }));
  out[seg] = { ...out[seg], ox: p01.x, oy: p01.y };
  const j = (seg + 1) % n;
  out[j] = { ...out[j], ix: p23.x, iy: p23.y };
  out.splice(seg + 1, 0, { x: m.x, y: m.y, ix: p012.x, iy: p012.y, ox: p123.x, oy: p123.y, type: 'smooth' });
  return { anchors: out, index: seg + 1, inserted: true };
}

export function reverseAnchors(anchors: PathAnchor[]): PathAnchor[] {
  return anchors.slice().reverse().map((a) => ({ ...a, ix: a.ox, iy: a.oy, ox: a.ix, oy: a.iy }));
}

/** Arc length of the forward run of segments from anchor i to anchor j (closed paths wrap). */
function runLength(anchors: PathAnchor[], i: number, j: number): number {
  const n = anchors.length;
  let len = 0;
  for (let k = i; k !== j; k = (k + 1) % n) {
    const s = segOf(anchors, k);
    let prev = s.p0;
    for (let q = 1; q <= 12; q++) {
      const p = evalCubicBezier(s.p0, s.p1, s.p2, s.p3, q / 12);
      len += vDist(prev, p);
      prev = p;
    }
  }
  return len;
}

/** Joins kept anchors (running P → Q) and new anchors (running Q → P) into one closed loop. */
function joinLoop(kept: PathAnchor[], fresh: PathAnchor[]): PathAnchor[] {
  const tail = fresh[fresh.length - 1];
  const out: PathAnchor[] = kept.map((a) => ({ ...a }));
  out[0] = { ...out[0], ix: tail.ix, iy: tail.iy };
  out[out.length - 1] = { ...out[out.length - 1], ox: fresh[0].ox, oy: fresh[0].oy };
  out.push(...fresh.slice(1, -1).map((a) => ({ ...a })));
  out[0].type = anchorType(out[0]);
  out[kept.length - 1].type = anchorType(out[kept.length - 1]);
  return out;
}

export interface PathEditResult {
  anchors: PathAnchor[];
  closed: boolean;
  mode: 'reshape' | 'extend' | 'close';
}

/**
 * Illustrator-style "edit selected paths" for a pencil stroke over an existing path (document space).
 * Returns null when the stroke neither starts nor ends on the path.
 */
export function editPathWithStroke(
  anchors: PathAnchor[],
  closed: boolean,
  stroke: Pt2D[],
  threshold: number,
  tolerance = 2,
  fit: FitOptions = {}
): PathEditResult | null {
  if (anchors.length < 2 || stroke.length < 2) return null;
  const pts = dedupePoints(stroke, fit.minStep ?? 0.5);
  if (pts.length < 2 || polyLength(pts) < threshold) return null;
  const fitRun = (run: Pt2D[]) => fitStroke(run, tolerance, { ...fit, closed: false });

  const n = anchors.length;
  const endpoint = (p: Pt2D) => {
    if (closed) return -1;
    const d0 = vDist(p, anchors[0]), d1 = vDist(p, anchors[n - 1]);
    if (Math.min(d0, d1) > threshold) return -1;
    return d0 <= d1 ? 0 : n - 1;
  };
  const epA = endpoint(pts[0]);
  const epB = endpoint(pts[pts.length - 1]);

  // Close: from one open end to the other
  if (epA >= 0 && epB >= 0 && epA !== epB) {
    // Orient the path so the stroke starts at its last anchor and ends at its first
    const base = epA === 0 ? reverseAnchors(anchors) : anchors.map((a) => ({ ...a }));
    const run = [{ x: base[base.length - 1].x, y: base[base.length - 1].y }, ...pts.slice(1, -1), { x: base[0].x, y: base[0].y }];
    const fresh = fitRun(run);
    if (fresh.length < 2) return null;
    return { anchors: joinLoop(base, fresh), closed: true, mode: 'close' };
  }

  // Reshape: both ends land on the path, at different places
  const hitA = nearestOnPath(anchors, closed, pts[0]);
  const hitB = nearestOnPath(anchors, closed, pts[pts.length - 1]);
  if (hitA.d <= threshold && hitB.d <= threshold && vDist(hitA.pt, hitB.pt) > threshold) {
    const sA = hitA.seg + hitA.t, sB = hitB.seg + hitB.t;
    const [first, second] = sA <= sB ? [hitA, hitB] : [hitB, hitA];
    const run0 = sA <= sB ? pts : pts.slice().reverse();
    // Split at the later point first so the earlier split doesn't shift its index
    const r2 = splitAt(anchors, second.seg, second.t);
    // Both on one segment: after the first split, the earlier point lies at t1 / t2 of its left half
    const t1 = first.seg === second.seg && r2.inserted ? first.t / second.t : first.t;
    const r1 = splitAt(r2.anchors, first.seg, t1);
    const A = r1.anchors;
    const i1 = r1.index;
    const i2 = r1.inserted && first.seg + 1 <= r2.index ? r2.index + 1 : r2.index;
    if (i1 !== i2) {
      const run = [{ x: A[i1].x, y: A[i1].y }, ...run0.slice(1, -1), { x: A[i2].x, y: A[i2].y }];
      const fresh = fitRun(run);
      if (fresh.length >= 2) {
        if (!closed) {
          const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
          const f = i1 < i2 ? fresh : reverseAnchors(fresh);
          const head = { ...A[lo], ox: f[0].ox, oy: f[0].oy };
          const tail = { ...A[hi], ix: f[f.length - 1].ix, iy: f[f.length - 1].iy };
          head.type = anchorType(head);
          tail.type = anchorType(tail);
          return { anchors: [...A.slice(0, lo), head, ...f.slice(1, -1), tail, ...A.slice(hi + 1)], closed: false, mode: 'reshape' };
        }
        // Closed: the stroke replaces the shorter of the two runs between the hits
        const m = A.length;
        const ring = (from: number, to: number) => {
          const out: PathAnchor[] = [];
          for (let k = from; ; k = (k + 1) % m) {
            out.push(A[k]);
            if (k === to) break;
          }
          return out;
        };
        const result = runLength(A, i1, i2) <= runLength(A, i2, i1)
          ? joinLoop(ring(i2, i1), fresh)
          : joinLoop(ring(i1, i2), reverseAnchors(fresh));
        return { anchors: result, closed: true, mode: 'reshape' };
      }
    }
  }

  // Extend: from an open end outwards (or drawn in towards an open end)
  if (epA >= 0 || epB >= 0) {
    const fromEnd = epA >= 0 ? epA : epB;
    const dir = epA >= 0 ? pts : pts.slice().reverse();
    const base = fromEnd === 0 ? reverseAnchors(anchors) : anchors.map((a) => ({ ...a }));
    const tip = base[base.length - 1];
    const fresh = fitRun([{ x: tip.x, y: tip.y }, ...dir.slice(1)]);
    if (fresh.length < 2) return null;
    const joint = { ...tip, ox: fresh[0].ox, oy: fresh[0].oy };
    joint.type = anchorType(joint);
    return { anchors: [...base.slice(0, -1), joint, ...fresh.slice(1)], closed: false, mode: 'extend' };
  }
  return null;
}

export interface SculptResult {
  updatedAnchors: PathAnchor[];
  didReshape: boolean;
}

/** Reshapes an open path with a stroke that starts and ends near it (kept for older callers). */
export function sculptPath(existingAnchors: PathAnchor[], newStrokePoints: Pt2D[], proximityThreshold = 24): SculptResult {
  const r = editPathWithStroke(existingAnchors, false, newStrokePoints, proximityThreshold, 2);
  return r ? { updatedAnchors: r.anchors, didReshape: true } : { updatedAnchors: existingAnchors, didReshape: false };
}

// ================================================================ 5. Bounds & normalisation

/** Document-space anchors → the layer box and 0..1 anchors (the box spans anchors and handles). */
export function normalizeAnchors(anchors: PathAnchor[]): { layerRect: Rect; points: PathAnchor[] } {
  const box = anchorBox(anchors);
  // A flat path (a straight horizontal or vertical line) keeps a tiny non-zero extent so points stay finite
  const width = Math.max(box.width, 1e-6);
  const height = Math.max(box.height, 1e-6);
  const nx = (v: number) => (v - box.x) / width;
  const ny = (v: number) => (v - box.y) / height;
  const points = anchors.map((a) => ({ ...a, x: nx(a.x), y: ny(a.y), ix: nx(a.ix), iy: ny(a.iy), ox: nx(a.ox), oy: ny(a.oy) }));
  return { layerRect: { x: box.x, y: box.y, width, height }, points };
}

export function anchorsToNormalizedShape(
  anchors: PathAnchor[],
  closed: boolean,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
  fillEnabled: boolean
): { layerRect: Rect; shape: ShapeProps } {
  const { layerRect, points } = normalizeAnchors(anchors);
  const shape: ShapeProps = {
    shape: 'path',
    points,
    closed,
    fill: fillColor,
    fillEnabled: closed && fillEnabled,
    stroke: strokeColor,
    strokeWidth: Math.max(0.1, strokeWidth),
    radius: 0,
    strokeCap: 'round',
    strokeJoin: 'round',
  };
  return { layerRect, shape };
}
