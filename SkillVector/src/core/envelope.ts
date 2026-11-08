/**
 * Object ▸ Envelope Distort ▸ Make with Warp: Illustrator's 15 warp styles on real vector paths.
 *
 * The whole selection warps as one (its joint bounds are the envelope). Every Bézier segment is cut
 * into short pieces (de Casteljau), and each piece's anchors and handles go through the warp, so
 * straight edges bend into true curves and the result stays an editable path, not pixels.
 */
import type { Layer, PathAnchor } from './types';
import { store } from './store';
import type { DocAnchor } from './vectorOps';
import { docSubpaths, isEditableShape, withDocSubpaths } from './vectorTools';

export type WarpStyle =
  | 'arc'
  | 'arc-lower'
  | 'arc-upper'
  | 'arch'
  | 'bulge'
  | 'shell-lower'
  | 'shell-upper'
  | 'flag'
  | 'wave'
  | 'fish'
  | 'rise'
  | 'fisheye'
  | 'inflate'
  | 'squeeze'
  | 'twist';

export const WARP_STYLES: { id: WarpStyle; label: string }[] = [
  { id: 'arc', label: 'Arc' },
  { id: 'arc-lower', label: 'Arc Lower' },
  { id: 'arc-upper', label: 'Arc Upper' },
  { id: 'arch', label: 'Arch' },
  { id: 'bulge', label: 'Bulge' },
  { id: 'shell-lower', label: 'Shell Lower' },
  { id: 'shell-upper', label: 'Shell Upper' },
  { id: 'flag', label: 'Flag' },
  { id: 'wave', label: 'Wave' },
  { id: 'fish', label: 'Fish' },
  { id: 'rise', label: 'Rise' },
  { id: 'fisheye', label: 'Fisheye' },
  { id: 'inflate', label: 'Inflate' },
  { id: 'squeeze', label: 'Squeeze' },
  { id: 'twist', label: 'Twist' },
];

export interface WarpOptions {
  style: WarpStyle;
  /** −100..100 % */
  bend: number;
  /** Perspective-like distortion, −100..100 % */
  distortH: number;
  distortV: number;
  vertical: boolean;
}

export const DEFAULT_WARP: WarpOptions = { style: 'arc', bend: 50, distortH: 0, distortV: 0, vertical: false };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type P = { x: number; y: number };

/**
 * The warp in a unit frame: s, t ∈ [−1, 1] across the envelope (t = −1 is the top), b = bend −1..1.
 * Returns the displaced (s, t). One unit = half the envelope's width / height.
 */
function warpUnit(style: WarpStyle, s: number, t: number, b: number, aspect: number): [number, number] {
  const hump = 1 - s * s; // 1 in the middle, 0 at the sides
  switch (style) {
    case 'arc': {
      // Bend along a circle: the middle line becomes an arc of b·180°, rows stay concentric
      if (Math.abs(b) < 1e-4) return [s, t];
      const R = 2 / (b * Math.PI); // radius of the middle line, in half-widths
      const theta = (s * b * Math.PI) / 2;
      // `aspect` = half-height / half-width converts rows into the arc's units; rows above the middle sit further out
      const r = R - t * aspect;
      return [r * Math.sin(theta), (R - r * Math.cos(theta)) / aspect];
    }
    case 'arc-lower':
      return [s, t + b * hump * ((t + 1) / 2)];
    case 'arc-upper':
      return [s, t - b * hump * ((1 - t) / 2)];
    case 'arch':
      return [s, t - b * hump];
    case 'bulge':
      return [s, t + b * hump * t];
    case 'shell-lower':
      return [s, t - b * s * s * ((t + 1) / 2)];
    case 'shell-upper':
      return [s, t + b * s * s * ((1 - t) / 2)];
    case 'flag':
      return [s, t + b * 0.5 * Math.sin(Math.PI * s)];
    case 'wave':
      return [s, t + b * 0.5 * Math.sin(Math.PI * s) * t];
    case 'fish': {
      const u = (s + 1) / 2;
      return [s, t + b * t * (Math.sin(Math.PI * u) * (1 - u) * 1.6 - u * 0.6)];
    }
    case 'rise': {
      const u = (s + 1) / 2;
      const ss = u * u * (3 - 2 * u);
      return [s, t - b * (ss - 0.5) * 2];
    }
    case 'fisheye': {
      const r2 = s * s + t * t;
      if (r2 >= 1) return [s, t];
      const k = 1 + b * (1 - r2) * 0.6;
      return [s * k, t * k];
    }
    case 'inflate':
      return [s + b * s * (1 - t * t) * 0.3, t + b * t * hump];
    case 'squeeze':
      return [s - b * s * (1 - t * t) * 0.5, t + b * t * s * s * 0.5];
    case 'twist': {
      const r = Math.hypot(s, t);
      if (r >= 1.42) return [s, t];
      const a = b * Math.PI * Math.max(0, 1 - r / 1.42);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      return [s * c - t * sn, s * sn + t * c];
    }
  }
}

/** Maps one document point through the warp of `box`. */
export function warpPoint(p: P, box: Box, o: WarpOptions): P {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const hw = Math.max(1e-6, box.w / 2);
  const hh = Math.max(1e-6, box.h / 2);
  let s = (p.x - cx) / hw;
  let t = (p.y - cy) / hh;
  const b = Math.max(-1, Math.min(1, o.bend / 100));
  // Vertical: the same warp turned 90° (columns bend instead of rows)
  if (o.vertical) [s, t] = [t, s];
  const aspect = o.vertical ? hw / hh : hh / hw;
  let [ws, wt] = warpUnit(o.style, s, t, b, aspect);
  if (o.vertical) [ws, wt] = [wt, ws];
  // Distortion: one side grows, the other shrinks (a flat perspective)
  const dh = Math.max(-1, Math.min(1, o.distortH / 100));
  const dv = Math.max(-1, Math.min(1, o.distortV / 100));
  const fy = 1 + dh * ws * 0.5;
  const fx = 1 + dv * wt * 0.5;
  return { x: cx + ws * fx * hw, y: cy + wt * fy * hh };
}

// ---------------------------------------------------------------- Bézier subdivision

type Seg = [P, P, P, P];

const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** de Casteljau: the piece of a cubic between t0 and t1. */
function piece(c: Seg, t0: number, t1: number): Seg {
  const split = (s: Seg, t: number): [Seg, Seg] => {
    const [p0, p1, p2, p3] = s;
    const a = lerp(p0, p1, t), b = lerp(p1, p2, t), cc = lerp(p2, p3, t);
    const d = lerp(a, b, t), e = lerp(b, cc, t);
    const m = lerp(d, e, t);
    return [[p0, a, d, m], [m, e, cc, p3]];
  };
  const right = t0 > 0 ? split(c, t0)[1] : c;
  const rel = t0 < 1 ? (t1 - t0) / (1 - t0) : 1;
  return rel < 1 ? split(right, rel)[0] : right;
}

const segLength = (c: Seg) => Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) + Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y) + Math.hypot(c[3].x - c[2].x, c[3].y - c[2].y);

const isStraight = (a: DocAnchor, b: DocAnchor) => Math.abs(a.ox - a.x) + Math.abs(a.oy - a.y) < 1e-6 && Math.abs(b.ix - b.x) + Math.abs(b.iy - b.y) < 1e-6;

/**
 * Warps one subpath. Each segment is cut into pieces about `step` long (at least `minPieces` on a curve),
 * so the warped result follows the warp closely; the original anchors keep their corner / smooth type.
 */
export function warpSubpath(sub: DocAnchor[], closed: boolean, box: Box, o: WarpOptions, step: number): PathAnchor[] {
  const n = sub.length;
  if (!n) return [];
  const w = (p: P) => warpPoint(p, box, o);
  const segCount = closed ? n : n - 1;
  // Pieces as cubic Béziers in document space
  type Out = { a: P; i: P; o: P; corner: boolean };
  const pts: Out[] = sub.map((p) => ({ a: { x: p.x, y: p.y }, i: { x: p.ix, y: p.iy }, o: { x: p.ox, y: p.oy }, corner: false }));
  const out: Out[] = [];
  for (let k = 0; k < n; k++) {
    const p = sub[k];
    const sharpIn = Math.abs(p.ix - p.x) + Math.abs(p.iy - p.y) < 1e-6;
    const sharpOut = Math.abs(p.ox - p.x) + Math.abs(p.oy - p.y) < 1e-6;
    const crossIn = (p.ix - p.x) * (p.oy - p.y) - (p.iy - p.y) * (p.ox - p.x);
    pts[k].corner = sharpIn || sharpOut || Math.abs(crossIn) > 1e-3 * (1 + Math.hypot(p.ix - p.x, p.iy - p.y) * Math.hypot(p.ox - p.x, p.oy - p.y));
  }
  // First anchor: in-handle from the closing segment (filled in below)
  out.push({ a: pts[0].a, i: pts[0].a, o: pts[0].a, corner: pts[0].corner });
  for (let k = 0; k < segCount; k++) {
    const A = sub[k];
    const B = sub[(k + 1) % n];
    const straight = isStraight(A, B);
    const c: Seg = straight
      ? [{ x: A.x, y: A.y }, lerp(A, B, 1 / 3), lerp(A, B, 2 / 3), { x: B.x, y: B.y }]
      : [{ x: A.x, y: A.y }, { x: A.ox, y: A.oy }, { x: B.ix, y: B.iy }, { x: B.x, y: B.y }];
    const pieces = Math.max(straight ? 1 : 2, Math.min(48, Math.ceil(segLength(c) / step)));
    for (let j = 0; j < pieces; j++) {
      const pc = piece(c, j / pieces, (j + 1) / pieces);
      out[out.length - 1].o = pc[1];
      const last = j === pieces - 1;
      const isWrap = last && closed && k === segCount - 1;
      if (isWrap) {
        out[0].i = pc[2];
      } else {
        out.push({ a: pc[3], i: pc[2], o: pc[3], corner: last ? pts[(k + 1) % n].corner : false });
      }
    }
  }
  if (!closed) {
    out[0].i = out[0].a;
    out[out.length - 1].o = out[out.length - 1].a;
  }
  return out.map((p) => {
    const a = w(p.a);
    const i = w(p.i);
    const oo = w(p.o);
    return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: oo.x, oy: oo.y, type: p.corner ? 'corner' : 'smooth' };
  });
}

// ---------------------------------------------------------------- selection

/** Shapes the warp acts on: selected shapes, and shapes inside selected groups. */
export function envelopeTargets(layers: Layer[], ids: string[]): Layer[] {
  const picked = new Set(ids);
  const byId = new Map(layers.map((l) => [l.id, l]));
  const inPicked = (l: Layer): boolean => {
    let cur: Layer | undefined = l;
    while (cur) {
      if (picked.has(cur.id)) return true;
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return false;
  };
  return layers.filter((l) => isEditableShape(l) && inPicked(l));
}

/** Joint bounds of the target shapes' anchors and handles, in document space. */
export function envelopeBox(targets: Layer[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of targets) {
    for (const sub of docSubpaths(l).subs) {
      for (const a of sub) {
        x0 = Math.min(x0, a.x);
        y0 = Math.min(y0, a.y);
        x1 = Math.max(x1, a.x);
        y1 = Math.max(y1, a.y);
      }
    }
  }
  if (!Number.isFinite(x0) || x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The warped copies of the target layers (same ids, styles and stacking). */
export function warpLayers(layers: Layer[], ids: string[], o: WarpOptions): Map<string, Layer> {
  const targets = envelopeTargets(layers, ids);
  const box = envelopeBox(targets);
  const out = new Map<string, Layer>();
  if (!box) return out;
  const step = Math.max(box.w, box.h) / 24;
  for (const l of targets) {
    const { layer, subs, closed } = docSubpaths(l);
    const warped = subs.map((sub) => warpSubpath(sub, closed, box, o, step));
    out.set(l.id, withDocSubpaths(layer, warped, closed));
  }
  return out;
}

/** Live preview on the canvas (not an undo step). */
export function previewWarp(ids: string[], o: WarpOptions) {
  const doc = store.doc;
  if (!doc) return;
  const base = doc.history[doc.hIndex].layers;
  const changed = warpLayers(base, ids, o);
  store.live({ layers: base.map((l) => changed.get(l.id) ?? l) });
}

/** Records the warp as one undo step. Returns how many shapes changed. */
export function commitWarp(ids: string[], o: WarpOptions): number {
  const doc = store.doc;
  if (!doc) return 0;
  const base = doc.history[doc.hIndex].layers;
  const changed = warpLayers(base, ids, o);
  if (!changed.size || (!o.bend && !o.distortH && !o.distortV)) {
    store.revert();
    if (!changed.size) store.toast('Envelope Distort: select shapes or a group (convert text with Create Outlines first)');
    return 0;
  }
  store.commit(`Warp: ${WARP_STYLES.find((w) => w.id === o.style)?.label ?? o.style}`, { layers: base.map((l) => changed.get(l.id) ?? l) }, { icon: 'shape' });
  return changed.size;
}
