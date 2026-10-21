// On-canvas gradient annotator (Gradient tool on a shape that has a gradient): the gradient line with its
// start (square) and end (circle) handles and a dot per colour stop. Drag the ends to move them (Shift
// snaps the angle to 45°), drag a stop along the line, pull it off the line to delete it, click the
// line to add a stop. Works on rotated shapes. Pure geometry: no store access.

import type { Layer, ShapeGradient } from './types';
import { colorAt } from './gradientStops';

type Pt = { x: number; y: number };

export type AnnotatorHit =
  | { kind: 'start' | 'end' }
  | { kind: 'stop'; index: number }
  | { kind: 'line'; t: number };

/** Screen-px radius for grabbing a handle. */
export const ANNOTATOR_HIT = 8;
/** Screen px off the line that deletes a dragged stop. */
const PULL_OFF = 40;

/** The stop picked on the canvas or in the Appearance panel (shared, so both show the same one). */
export const gradientPick = { layer: null as string | null, stop: 0 };

/** Picks a stop of a layer's gradient (both the canvas and the Appearance panel follow). */
export function pickGradientStop(layer: string, stop: number) {
  gradientPick.layer = layer;
  gradientPick.stop = stop;
}

function frame(l: Layer) {
  const a = ((l.rotation ?? 0) * Math.PI) / 180;
  return { cx: l.x + l.width / 2, cy: l.y + l.height / 2, cos: Math.cos(a), sin: Math.sin(a) };
}

/** Box-normalised point (0..1) → document point, with the layer's live rotation. */
function toDoc(l: Layer, u: number, v: number): Pt {
  const f = frame(l);
  const x = l.x + u * l.width - f.cx, y = l.y + v * l.height - f.cy;
  return { x: f.cx + x * f.cos - y * f.sin, y: f.cy + x * f.sin + y * f.cos };
}

/** Document point → box-normalised point. */
function toBox(l: Layer, p: Pt): Pt {
  const f = frame(l);
  const dx = p.x - f.cx, dy = p.y - f.cy;
  const x = dx * f.cos + dy * f.sin, y = -dx * f.sin + dy * f.cos;
  return { x: (x + f.cx - l.x) / (l.width || 1), y: (y + f.cy - l.y) / (l.height || 1) };
}

export interface AnnotatorGeometry {
  a: Pt;
  b: Pt;
  stops: (Pt & { color: string; offset: number })[];
  /** Radial gradients: the radius in document px (drawn as a ring around `a`). */
  radius?: number;
}

/** The shape's gradient, when it has a usable one. */
export const gradientOf = (l: Layer | null | undefined): ShapeGradient | null => {
  const g = l?.kind === 'shape' ? l.shape?.gradient : undefined;
  return g && g.stops.length >= 2 && l?.shape?.fillEnabled ? g : null;
};

export function annotatorGeometry(l: Layer): AnnotatorGeometry | null {
  const g = gradientOf(l);
  if (!g) return null;
  const a = toDoc(l, g.x0, g.y0), b = toDoc(l, g.x1, g.y1);
  return {
    a,
    b,
    stops: g.stops.map((s) => ({ x: a.x + (b.x - a.x) * s.offset, y: a.y + (b.y - a.y) * s.offset, color: s.color, offset: s.offset })),
    radius: g.type === 'radial' ? Math.hypot(b.x - a.x, b.y - a.y) : undefined,
  };
}

/** Projection of p on the segment a→b: parameter t (unclamped) and distance. */
function project(a: Pt, b: Pt, p: Pt): { t: number; d: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, d: Math.hypot(p.x - q.x, p.y - q.y) };
}

/** What a press at p grabs: a stop beats the ends (they share a point at 0 % / 100 %), then the line. */
export function annotatorHit(l: Layer, p: Pt, zoom: number): AnnotatorHit | null {
  const geo = annotatorGeometry(l);
  if (!geo) return null;
  const tol = ANNOTATOR_HIT / zoom;
  const near = (q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);
  // Stops sit on the line; inner stops first, so the end stops don't hide them
  let best: { i: number; d: number } | null = null;
  geo.stops.forEach((s, i) => {
    const d = near(s);
    const inner = s.offset > 0.001 && s.offset < 0.999;
    if (d <= tol && (!best || d < best.d - (inner ? 0.5 / zoom : 0))) best = { i, d };
  });
  const endA = near(geo.a), endB = near(geo.b);
  // The end handles are drawn just outside the line ends, so a press right on an end moves the end
  if (endA <= tol * 0.6) return { kind: 'start' };
  if (endB <= tol * 0.6) return { kind: 'end' };
  if (best) return { kind: 'stop', index: (best as { i: number }).i };
  if (endA <= tol) return { kind: 'start' };
  if (endB <= tol) return { kind: 'end' };
  const pr = project(geo.a, geo.b, p);
  if (pr.t > 0 && pr.t < 1 && pr.d <= tol * 0.75) return { kind: 'line', t: pr.t };
  return null;
}

export interface AnnotatorDrag {
  gradient: ShapeGradient;
  /** A stop dragged off the line: it is removed (preview shows it gone). */
  removed?: boolean;
  readout: string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The gradient after dragging `hit` from `start` to `p`, computed from the layer as the drag began. */
export function dragAnnotator(l0: Layer, hit: AnnotatorHit, p: Pt, m: { shift: boolean; zoom: number }): AnnotatorDrag | null {
  const g = gradientOf(l0);
  const geo = annotatorGeometry(l0);
  if (!g || !geo) return null;
  if (hit.kind === 'start' || hit.kind === 'end') {
    const other = hit.kind === 'start' ? geo.b : geo.a;
    let q = p;
    if (m.shift) {
      // Snap the line's angle to 45° steps, keeping its length to the pointer
      const ang = Math.round(Math.atan2(p.y - other.y, p.x - other.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p.x - other.x, p.y - other.y);
      q = { x: other.x + Math.cos(ang) * len, y: other.y + Math.sin(ang) * len };
    }
    const u = toBox(l0, q);
    const next = hit.kind === 'start' ? { ...g, x0: r3(u.x), y0: r3(u.y) } : { ...g, x1: r3(u.x), y1: r3(u.y) };
    const a2 = hit.kind === 'start' ? q : geo.a, b2 = hit.kind === 'start' ? geo.b : q;
    return { gradient: next, readout: `${Math.round((Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180) / Math.PI)}° · ${Math.round(Math.hypot(b2.x - a2.x, b2.y - a2.y))} px` };
  }
  if (hit.kind === 'stop') {
    const pr = project(geo.a, geo.b, p);
    if (pr.d * m.zoom > PULL_OFF && g.stops.length > 2) {
      return { gradient: { ...g, stops: g.stops.filter((_, i) => i !== hit.index) }, removed: true, readout: 'Release to delete the stop' };
    }
    let t = Math.max(0, Math.min(1, pr.t));
    if (m.shift) t = Math.round(t * 20) / 20;
    return { gradient: { ...g, stops: g.stops.map((s, i) => (i === hit.index ? { ...s, offset: r3(t) } : s)) }, readout: `Stop ${Math.round(t * 100)}%` };
  }
  return null;
}

/** A click on the line: a new stop there, in the gradient's own colour at that point. */
export function addStopAt(l: Layer, t: number): { gradient: ShapeGradient; index: number } | null {
  const g = gradientOf(l);
  if (!g) return null;
  const stops = [...g.stops, { offset: r3(t), color: colorAt(g.stops, t) }];
  return { gradient: { ...g, stops }, index: stops.length - 1 };
}
