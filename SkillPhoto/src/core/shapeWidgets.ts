// On-canvas live shape widgets (Illustrator's Live Corners, done for every live shape):
// - rectangle: a dot inside each corner; drag it toward the centre to round all corners,
//   ⌥-drag rounds only that corner, ⌥-click cycles the corner style;
// - polygon: a diamond that sets the number of sides, and a dot inside the top point that rounds every point;
// - star: the same, plus a handle on the first inner point that sets the inner radius;
// - ellipse: a pie start / end handle on the rim and a hole handle for donuts;
// - path: a dot inside every sharp corner (Live Corners on any path); drag rounds every corner,
//   ⌥-drag only that one, ⌥-click makes that corner sharp again. The anchors stay editable.
// Everything is computed in the layer's frame (centre, size, live rotation), so the widgets sit on the
// outline as drawn at any rotation and zoom. Pure geometry: no store access.

import type { Layer, PathAnchor, ShapeProps } from './types';
import { CORNER_STYLES, clampRadii, cornerRadii, pathCorners, polyVertices, type CornerInfo } from './shapeGeometry';

type Pt = { x: number; y: number };

export type WidgetKind = 'corner' | 'sides' | 'point-round' | 'star-inner' | 'pie-start' | 'pie-end' | 'hole' | 'path-corner';

export interface ShapeWidget {
  kind: WidgetKind;
  /** Corner index (rectangle: 0 top-left, clockwise; path: the anchor index). */
  index: number;
  /** Path corners: the sub-path (0 = the main ring). */
  ring?: number;
  /** Position in document space. */
  x: number;
  y: number;
  /** True when the setting it controls is at its limit (drawn red, like Illustrator's maximum-radius arc). */
  atMax?: boolean;
}

/** Minimum distance of a widget from its corner / point, in screen px, so it never sits on a frame handle. */
const INSET = 16;
/** Widgets hide on shapes smaller than this on screen (they would cover the shape). */
const MIN_SCREEN = 30;
export const WIDGET_HIT = 7;

interface LocalFrame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  cos: number;
  sin: number;
}

function frameOf(l: Layer): LocalFrame {
  const a = ((l.rotation ?? 0) * Math.PI) / 180;
  return { cx: l.x + l.width / 2, cy: l.y + l.height / 2, w: Math.abs(l.width), h: Math.abs(l.height), cos: Math.cos(a), sin: Math.sin(a) };
}
const toDoc = (f: LocalFrame, x: number, y: number): Pt => ({ x: f.cx + x * f.cos - y * f.sin, y: f.cy + x * f.sin + y * f.cos });
const toLocal = (f: LocalFrame, p: Pt): Pt => {
  const dx = p.x - f.cx;
  const dy = p.y - f.cy;
  return { x: dx * f.cos + dy * f.sin, y: -dx * f.sin + dy * f.cos };
};

/** Live (unconverted) shape whose geometry the widgets edit. */
export function widgetShape(l: Layer | null | undefined): (Layer & { shape: ShapeProps }) | null {
  if (!l || l.kind !== 'shape' || !l.shape || l.locked || !l.visible) return null;
  const s = l.shape;
  if (s.points || s.compoundPoints) return null;
  return ['rectangle', 'round-rect', 'polygon', 'star', 'ellipse'].includes(s.shape) ? (l as Layer & { shape: ShapeProps }) : null;
}

/** Path layer whose sharp corners get Live Corner widgets. */
export function widgetPath(l: Layer | null | undefined): (Layer & { shape: ShapeProps }) | null {
  if (!l || l.kind !== 'shape' || !l.shape || l.locked || !l.visible) return null;
  const s = l.shape;
  return s.shape === 'path' && s.points?.length ? (l as Layer & { shape: ShapeProps }) : null;
}

/** A layer with any on-canvas widgets: a live shape or a path. */
export const widgetTarget = (l: Layer | null | undefined) => widgetShape(l) ?? widgetPath(l);

/** More corners than this and the dots would bury the artwork (traced art): use the Properties panel. */
const MAX_PATH_CORNERS = 48;

interface PathCornerGeo extends CornerInfo {
  ring: number;
  /** The anchor in the layer's local frame (px from the box centre, unrotated). */
  at: { x: number; y: number };
  /** Unit bisector pointing into the corner. */
  bis: { x: number; y: number };
  radius: number;
}

const pathRings = (s: ShapeProps) => (s.compoundPoints?.length ? s.compoundPoints : [s.points ?? []]);
const pathClosed = (s: ShapeProps) => (s.compoundPoints?.length ? true : !!s.closed);

/** Every roundable corner of a path layer, in the layer's local frame. */
export function pathCornerGeometry(l: Layer): PathCornerGeo[] {
  const s = l.shape!;
  const W = l.width, H = l.height;
  const out: PathCornerGeo[] = [];
  pathRings(s).forEach((ring, ri) => {
    const px = ring.map((a) => ({ ...a, x: a.x * W - W / 2, y: a.y * H - H / 2, ix: a.ix * W - W / 2, iy: a.iy * H - H / 2, ox: a.ox * W - W / 2, oy: a.oy * H - H / 2 }));
    for (const c of pathCorners(px, pathClosed(s))) {
      const bx = c.toPrev.x + c.toNext.x, by = c.toPrev.y + c.toNext.y;
      const bl = Math.hypot(bx, by) || 1;
      out.push({ ...c, ring: ri, at: { x: px[c.index].x, y: px[c.index].y }, bis: { x: bx / bl, y: by / bl }, radius: ring[c.index].corner ?? 0 });
    }
  });
  return out;
}

function pathWidgets(l: Layer & { shape: ShapeProps }, zoom: number): ShapeWidget[] {
  const f = frameOf(l);
  if (Math.max(f.w, f.h) * zoom < MIN_SCREEN) return [];
  const geo = pathCornerGeometry(l);
  if (geo.length > MAX_PATH_CORNERS) return [];
  const inset = INSET / zoom;
  return geo.map((g) => {
    // The dot marks the centre of the corner arc, never closer to the anchor than the inset
    const r = Math.min(g.radius, g.maxRadius);
    const D = Math.max(r / Math.sin(g.angle / 2), inset);
    return { kind: 'path-corner' as const, index: g.index, ring: g.ring, ...toDoc(f, g.at.x + g.bis.x * D, g.at.y + g.bis.y * D), atMax: g.radius > 0 && g.radius >= g.maxRadius - 0.5 };
  });
}

/** The path's rings with new corner radii (0 removes the corner). */
function withCorners(s: ShapeProps, radius: (ring: number, index: number, cur: number) => number | null): Partial<ShapeProps> {
  const rings = pathRings(s).map((ring, ri) =>
    ring.map((a, i): PathAnchor => {
      const r = radius(ri, i, a.corner ?? 0);
      if (r === null) return a;
      const { corner: _c, ...rest } = a;
      return r > 0 ? { ...rest, corner: r } : rest;
    })
  );
  return s.compoundPoints?.length ? { points: rings[0], compoundPoints: rings } : { points: rings[0] };
}

/** ⌥-click on a path corner widget: that corner becomes sharp. */
export function sharpenPathCorner(s: ShapeProps, w: ShapeWidget): Partial<ShapeProps> {
  return withCorners(s, (ri, i) => (ri === (w.ring ?? 0) && i === w.index ? 0 : null));
}

// Rectangle corners clockwise from top-left: unit direction from the corner toward the inside
const INWARD: Pt[] = [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }];

/** Largest radius a corner can take (half the shorter side). */
export const maxCornerRadius = (w: number, h: number) => Math.min(w, h) / 2;

/** Every widget of a shape layer, in document space. Empty when the shape is too small on screen. */
export function shapeWidgets(layer: Layer, zoom: number): ShapeWidget[] {
  const path = widgetPath(layer);
  if (path) return pathWidgets(path, zoom);
  const l = widgetShape(layer);
  if (!l) return [];
  const f = frameOf(l);
  if (Math.min(f.w, f.h) * zoom < MIN_SCREEN) return [];
  const s = l.shape;
  const inset = INSET / zoom;
  const out: ShapeWidget[] = [];
  const hw = f.w / 2;
  const hh = f.h / 2;
  switch (s.shape) {
    case 'rectangle':
    case 'round-rect': {
      const set = cornerRadii(s);
      const eff = clampRadii(f.w, f.h, set);
      const max = maxCornerRadius(f.w, f.h);
      INWARD.forEach((d, i) => {
        // The widget marks the centre of the corner arc, never closer to the corner than the inset
        const r = Math.max(eff[i], inset);
        const c = toDoc(f, -d.x * hw + d.x * r, -d.y * hh + d.y * r);
        out.push({ kind: 'corner', index: i, ...c, atMax: eff[i] >= max - 0.5 });
      });
      break;
    }
    case 'polygon':
    case 'star': {
      const v = polyVertices(s, f.w, f.h).map((p) => ({ x: p.x - hw, y: p.y - hh }));
      // Rounding: a dot inside every outer point (any of them rounds all), the top one only on dense shapes
      const step = s.shape === 'star' ? 2 : 1;
      const outer = v.length / step;
      const pr = s.pointRadius ?? 0;
      for (let k = 0; k < v.length; k += step) {
        if (outer > 16 && k > 0) break;
        const p = v[k];
        const d = Math.max(Math.hypot(p.x, p.y), 1e-6);
        const along = Math.min(Math.max(pr, inset), d * 0.6);
        out.push({ kind: 'point-round', index: k, ...toDoc(f, p.x - (p.x / d) * along, p.y - (p.y / d) * along), atMax: pr > 0 && along >= d * 0.6 - 1e-6 });
      }
      if (s.shape === 'star') out.push({ kind: 'star-inner', index: 1, ...toDoc(f, v[1].x, v[1].y) });
      // Sides: a diamond just outside the right edge of the box, at mid-height
      out.push({ kind: 'sides', index: 0, ...toDoc(f, hw + inset, 0) });
      break;
    }
    case 'ellipse': {
      const a0 = s.pieStart ?? 0;
      const a1 = s.pieEnd ?? 360;
      const at = (deg: number, k = 1) => {
        const a = (deg * Math.PI) / 180;
        return toDoc(f, hw * k * Math.cos(a), hh * k * Math.sin(a));
      };
      const full = Math.abs(a1 - a0) >= 359.999;
      out.push({ kind: 'pie-start', index: 0, ...at(a0) });
      // A full ellipse has one pie handle; dragging it opens the pie
      if (!full) out.push({ kind: 'pie-end', index: 0, ...at(a1) });
      // Hole: on the axis opposite the pie start, at the hole radius (inset from the centre when there is none)
      const hole = s.hole ?? 0;
      const mid = full ? a0 + 180 : (a0 + ((((a1 - a0) % 360) + 360) % 360) / 2);
      const minK = inset / Math.max(1e-6, Math.min(hw, hh));
      out.push({ kind: 'hole', index: 0, ...at(mid, Math.min(0.95, Math.max(hole, minK))), atMax: hole >= 0.95 });
      break;
    }
  }
  return out;
}

/** The widget under a document point, or null. */
export function widgetAt(layer: Layer, p: Pt, zoom: number): ShapeWidget | null {
  const tol = WIDGET_HIT / zoom;
  let best: ShapeWidget | null = null;
  let bd = Infinity;
  for (const w of shapeWidgets(layer, zoom)) {
    const d = Math.hypot(w.x - p.x, w.y - p.y);
    if (d <= tol && d < bd) {
      best = w;
      bd = d;
    }
  }
  return best;
}

export interface WidgetMods {
  /** ⌥: only the grabbed corner. */
  alt: boolean;
  /** Shift: snap to round steps (radius 5 px, angles 15°). */
  shift: boolean;
  /** View zoom: lengths round to whole px, or to 0.1 px when zoomed in to 400% and more. */
  zoom?: number;
}

const snapStep = (v: number, step: number, on: boolean, zoom = 1) => (on ? Math.round(v / step) * step : zoom >= 4 ? Math.round(v * 10) / 10 : Math.round(v));
const norm360 = (a: number) => ((a % 360) + 360) % 360;

/**
 * Shape settings for a widget drag from `start` to `p`, computed from the shape as it was when the
 * drag began (`l0`), so nothing accumulates while the pointer moves. Returns the patch and a readout.
 */
export function dragWidget(l0: Layer, w: ShapeWidget, start: Pt, p: Pt, m: WidgetMods): { patch: Partial<ShapeProps>; readout: string } | null {
  if (w.kind === 'path-corner') return dragPathCorner(l0, w, start, p, m);
  const l = widgetShape(l0);
  if (!l) return null;
  const s = l.shape;
  const f = frameOf(l);
  const q0 = toLocal(f, start);
  const q = toLocal(f, p);
  const hw = f.w / 2;
  const hh = f.h / 2;
  switch (w.kind) {
    case 'corner': {
      const d = INWARD[w.index];
      // Movement toward the centre along the corner's diagonal
      const delta = ((q.x - q0.x) * d.x + (q.y - q0.y) * d.y) / 2;
      const max = maxCornerRadius(f.w, f.h);
      const set = cornerRadii(s);
      const eff = clampRadii(f.w, f.h, set);
      const fit = (v: number) => Math.min(max, Math.max(0, snapStep(v, 5, m.shift, m.zoom)));
      if (m.alt) {
        const next = [...eff] as [number, number, number, number];
        next[w.index] = fit(eff[w.index] + delta);
        return { patch: { radii: next }, readout: `${['↖', '↗', '↘', '↙'][w.index]} ${Math.round(next[w.index])} px` };
      }
      if (!s.radii || set.every((r) => r === set[0])) {
        // All corners alike: one radius from the grabbed corner's own (visible) value
        const r = fit(eff[w.index] + delta);
        return { patch: { radius: r, radii: undefined }, readout: `Radius ${Math.round(r)} px${r >= max - 0.5 ? ' · max' : ''}` };
      }
      // Corners differ: move them all by the same amount, keeping their differences
      const next = eff.map((r) => fit(r + delta)) as [number, number, number, number];
      return { patch: { radii: next }, readout: `Radii ${next.map(Math.round).join(' · ')} px` };
    }
    case 'point-round': {
      const v = polyVertices(s, f.w, f.h)[w.index] ?? polyVertices(s, f.w, f.h)[0];
      const top = { x: v.x - hw, y: v.y - hh };
      const len = Math.max(Math.hypot(top.x, top.y), 1e-6);
      // Inward along the bisector (toward the centre) rounds more
      const delta = -((q.x - q0.x) * top.x + (q.y - q0.y) * top.y) / len;
      const r = Math.max(0, snapStep((s.pointRadius ?? 0) + delta, 5, m.shift, m.zoom));
      return { patch: { pointRadius: r }, readout: `Round points ${Math.round(r)} px` };
    }
    case 'star-inner': {
      // Distance from the centre in the ellipse's normalised space, measured where the pointer is
      const rr = Math.hypot(q.x / Math.max(hw, 1e-6), q.y / Math.max(hh, 1e-6));
      const k = Math.min(0.98, Math.max(0.02, m.shift ? Math.round(rr * 20) / 20 : Math.round(rr * 1000) / 1000));
      return { patch: { innerRatio: k }, readout: `Inner ${Math.round(k * 100)}%` };
    }
    case 'sides': {
      // Up adds sides, down removes them: one side per 12 px of drag on screen-independent doc units
      const step = Math.max(6, Math.min(f.w, f.h) / 16);
      const n0 = s.sides ?? (s.shape === 'star' ? 5 : 6);
      const n = Math.max(3, Math.min(s.shape === 'star' ? 60 : 64, Math.round(n0 - (q.y - q0.y) / step)));
      return { patch: { sides: n }, readout: `${n} ${s.shape === 'star' ? 'points' : 'sides'}` };
    }
    case 'pie-start':
    case 'pie-end': {
      const deg = norm360((Math.atan2(q.y / Math.max(hh, 1e-6), q.x / Math.max(hw, 1e-6)) * 180) / Math.PI);
      const a = m.shift ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
      const a0 = s.pieStart ?? 0;
      const a1 = s.pieEnd ?? 360;
      const full = Math.abs(a1 - a0) >= 359.999;
      if (w.kind === 'pie-start') {
        // From a full ellipse the end stays where the start was
        const end = full ? norm360(a0) || 360 : a1;
        const start = norm360(a);
        const sweep = norm360(end - start) || 360;
        return { patch: { pieStart: start, pieEnd: end }, readout: `Pie ${Math.round(sweep)}° · from ${Math.round(start)}°` };
      }
      const end = norm360(a) || 360;
      const sweep = norm360(end - a0) || 360;
      return { patch: { pieEnd: end }, readout: `Pie ${Math.round(sweep)}° · to ${Math.round(end)}°` };
    }
    case 'hole': {
      const rr = Math.hypot(q.x / Math.max(hw, 1e-6), q.y / Math.max(hh, 1e-6));
      const minK = INSET / Math.max(1e-6, Math.min(hw, hh)); // dragging back into the centre removes the hole
      const k = rr < minK * 0.5 ? 0 : Math.min(0.95, m.shift ? Math.round(rr * 20) / 20 : Math.round(rr * 1000) / 1000);
      return { patch: { hole: k > 0 ? k : undefined }, readout: k > 0 ? `Hole ${Math.round(k * 100)}%` : 'No hole' };
    }
  }
}

function dragPathCorner(l0: Layer, w: ShapeWidget, start: Pt, p: Pt, m: WidgetMods): { patch: Partial<ShapeProps>; readout: string } | null {
  const l = widgetPath(l0);
  if (!l) return null;
  const f = frameOf(l);
  const q0 = toLocal(f, start);
  const q = toLocal(f, p);
  const geo = pathCornerGeometry(l);
  const g = geo.find((c) => c.ring === (w.ring ?? 0) && c.index === w.index);
  if (!g) return null;
  // Movement into the corner along its bisector; the arc centre sits r / sin(θ/2) from the anchor
  const dr = ((q.x - q0.x) * g.bis.x + (q.y - q0.y) * g.bis.y) * Math.sin(g.angle / 2);
  const fit = (v: number, max: number) => Math.min(max, Math.max(0, snapStep(v, 5, m.shift, m.zoom)));
  const cur = (c: PathCornerGeo) => Math.min(c.radius, c.maxRadius);
  const r = fit(cur(g) + dr, g.maxRadius);
  const max = r >= g.maxRadius - 0.5 ? ' · max' : '';
  if (m.alt) {
    return { patch: withCorners(l.shape, (ri, i) => (ri === g.ring && i === g.index ? r : null)), readout: `Corner ${Math.round(r)} px${max}` };
  }
  const key = (ri: number, i: number) => `${ri}:${i}`;
  const all = new Map(geo.map((c) => [key(c.ring, c.index), c]));
  if (geo.every((c) => Math.abs(cur(c) - cur(geo[0])) < 0.01)) {
    // All corners alike: one radius for every corner
    return { patch: withCorners(l.shape, (ri, i) => (all.has(key(ri, i)) ? r : null)), readout: `Corners ${Math.round(r)} px${max}` };
  }
  // Corners differ: shift them all by the same amount, keeping their differences
  return {
    patch: withCorners(l.shape, (ri, i) => {
      const c = all.get(key(ri, i));
      return c ? fit(cur(c) + (r - cur(g)), c.maxRadius) : null;
    }),
    readout: `Corners +${Math.round(r - cur(g))} px`,
  };
}

/** ⌥-click on a corner widget: the next corner style (Illustrator cycles Round → Inverted → Chamfer). */
export function nextCornerStyle(s: ShapeProps): Partial<ShapeProps> {
  const ids = CORNER_STYLES.map((c) => c.id);
  const cur = s.cornerStyle ?? 'round';
  const next = ids[(ids.indexOf(cur) + 1) % ids.length];
  // A sharp rectangle shows nothing for any style: give it a visible radius first
  const radius = s.radii ? s.radius : s.radius || 0;
  const patch: Partial<ShapeProps> = { cornerStyle: next };
  if (!s.radii && radius <= 0) patch.radius = 12;
  return patch;
}

export const WIDGET_LABELS: Record<WidgetKind, string> = {
  corner: 'Drag to round corners · ⌥ drag: one corner · ⌥ click: corner style',
  sides: 'Drag up / down to change the number of sides',
  'point-round': 'Drag inward to round every point',
  'star-inner': 'Drag to set the inner radius',
  'pie-start': 'Drag around the rim to open a pie',
  'pie-end': 'Drag to set where the pie ends',
  hole: 'Drag outward to cut a hole (donut)',
  'path-corner': 'Drag to round the corners · ⌥ drag: this corner · ⌥ click: make it sharp',
};

