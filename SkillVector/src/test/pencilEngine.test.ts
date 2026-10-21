import { describe, expect, it } from 'vitest';
import {
  StreamLineStabilizer,
  bezierSegmentsToAnchors,
  detectQuickShape,
  editPathWithStroke,
  evalCubicBezier,
  fitCurves,
  fitStroke,
  sculptPath,
  anchorsToNormalizedShape,
  type Pt2D,
} from '../core/pencilEngine';
import type { PathAnchor } from '../core/types';

/** Dense samples along a path's Bézier segments. */
function sample(anchors: PathAnchor[], closed: boolean, per = 40): Pt2D[] {
  const out: Pt2D[] = [];
  const n = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < n; i++) {
    const a = anchors[i], b = anchors[(i + 1) % anchors.length];
    for (let k = 0; k <= per; k++) {
      out.push(evalCubicBezier({ x: a.x, y: a.y }, { x: a.ox, y: a.oy }, { x: b.ix, y: b.iy }, { x: b.x, y: b.y }, k / per));
    }
  }
  return out;
}

const circlePts = (cx: number, cy: number, r: number, from: number, to: number, n: number): Pt2D[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

/** Points every `step` along straight segments through the vertices. */
function polyPts(verts: Pt2D[], step = 2, closed = false): Pt2D[] {
  const out: Pt2D[] = [];
  const v = closed ? [...verts, verts[0]] : verts;
  for (let i = 0; i < v.length - 1; i++) {
    const d = Math.hypot(v[i + 1].x - v[i].x, v[i + 1].y - v[i].y);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) out.push({ x: v[i].x + ((v[i + 1].x - v[i].x) * k) / n, y: v[i].y + ((v[i + 1].y - v[i].y) * k) / n });
  }
  out.push({ ...v[v.length - 1] });
  return out;
}

// Deterministic jitter
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const jitter = (pts: Pt2D[], amt: number) => pts.map((p) => ({ x: p.x + rnd() * amt, y: p.y + rnd() * amt }));

describe('StreamLine rope stabilizer', () => {
  it('trails exactly one rope length behind the pen and catches up on release', () => {
    const stab = new StreamLineStabilizer(10);
    expect(stab.update({ x: 0, y: 0 }).point).toMatchObject({ x: 0, y: 0 });
    // Inside the rope the line doesn't move
    expect(stab.update({ x: 5, y: 0 }).point.x).toBe(0);
    // Pulled taut: the anchor sits 10 behind the pen
    expect(stab.update({ x: 50, y: 0 }).point.x).toBeCloseTo(40, 6);
    expect(stab.update({ x: 50, y: 30 }).point.y).toBeGreaterThan(0);
    expect(stab.flush({ x: 100, y: 100 })).toMatchObject({ x: 100, y: 100 });
  });

  it('passes points through unchanged with no rope', () => {
    const stab = new StreamLineStabilizer(0);
    stab.update({ x: 0, y: 0 });
    expect(stab.update({ x: 3, y: 4 }).point).toMatchObject({ x: 3, y: 4 });
  });
});

describe('Curve fitting accuracy', () => {
  it('evaluates cubic Béziers at the ends and middle', () => {
    const [p0, p1, p2, p3] = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 0 }];
    expect(evalCubicBezier(p0, p1, p2, p3, 0)).toMatchObject({ x: 0, y: 0 });
    expect(evalCubicBezier(p0, p1, p2, p3, 1)).toMatchObject({ x: 100, y: 0 });
    expect(evalCubicBezier(p0, p1, p2, p3, 0.5).y).toBeCloseTo(37.5);
  });

  it('fits a semicircle within the tolerance using few segments', () => {
    const pts = circlePts(100, 100, 100, 0, Math.PI, 180);
    const tol = 1;
    const segs = fitCurves(pts, tol);
    expect(segs.length).toBeLessThanOrEqual(3);
    const anchors = bezierSegmentsToAnchors(segs);
    expect(anchors[0]).toMatchObject({ x: 200, y: 100 });
    expect(anchors[anchors.length - 1].x).toBeCloseTo(0, 6);
    for (const p of sample(anchors, false)) expect(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 100)).toBeLessThan(tol * 1.05);
    // Interior joints are smooth
    for (const a of anchors.slice(1, -1)) expect(a.type).toBe('smooth');
  });

  it('keeps sharp corners as exact corner anchors with straight sides', () => {
    const pts = polyPts([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }], 2);
    const anchors = fitStroke(pts, 1);
    const corner = anchors.find((a) => Math.hypot(a.x - 200, a.y) < 0.01);
    expect(corner).toBeDefined();
    expect(corner!.type).toBe('corner');
    expect(anchors.length).toBe(3);
    for (const p of sample(anchors, false)) {
      const d = Math.min(Math.abs(p.y), Math.abs(p.x - 200));
      expect(d).toBeLessThan(1);
    }
  });

  it('smooths out hand jitter on a straight stroke', () => {
    const pts = jitter(polyPts([{ x: 0, y: 0 }, { x: 300, y: 100 }], 1.5), 0.8);
    const anchors = fitStroke(pts, 3);
    expect(anchors.length).toBe(2);
  });

  it('closes a circle seamlessly (smooth where the ends meet) and stays on the circle', () => {
    const pts = circlePts(0, 0, 80, 0, Math.PI * 2, 200);
    const anchors = fitStroke(pts, 0.75, { closed: true });
    expect(anchors[0].type).toBe('smooth');
    for (const p of sample(anchors, true)) expect(Math.abs(Math.hypot(p.x, p.y) - 80)).toBeLessThan(0.8);
  });

  it('fits a closed square as four exact corners', () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const anchors = fitStroke(polyPts(sq, 2, true), 1, { closed: true });
    expect(anchors.length).toBe(4);
    for (const c of sq) expect(anchors.some((a) => Math.hypot(a.x - c.x, a.y - c.y) < 0.5 && a.type === 'corner')).toBe(true);
  });
});

describe('QuickShape recognition', () => {
  it('recognises a straight line and keeps its direction', () => {
    const qs = detectQuickShape(jitter(polyPts([{ x: 200, y: 50 }, { x: 20, y: 140 }], 3), 1.5), 20);
    expect(qs?.kind).toBe('line');
    expect(Math.hypot(qs!.from!.x - 200, qs!.from!.y - 50)).toBeLessThan(3);
    expect(qs?.to?.x).toBeLessThan(qs!.from!.x);
  });

  it('turns a gentle curve into an arc, not a line', () => {
    const pts = circlePts(150, 400, 300, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5, 60);
    const qs = detectQuickShape(pts, 20);
    expect(qs?.kind).toBe('arc');
    for (const p of sample(qs!.anchors!, false)) expect(Math.abs(Math.hypot(p.x - 150, p.y - 400) - 300)).toBeLessThan(1);
  });

  it('recognises a wobbly circle with the right centre and size', () => {
    const qs = detectQuickShape(jitter(circlePts(200, 200, 80, 0, Math.PI * 2, 72), 2), 30);
    expect(qs?.kind).toBe('circle');
    expect(qs!.rect.x + qs!.rect.width / 2).toBeCloseTo(200, -0.5);
    expect(qs!.rect.width / 2).toBeGreaterThan(76);
    expect(qs!.rect.width / 2).toBeLessThan(84);
  });

  it('recognises a rotated ellipse with its angle', () => {
    const t = (30 * Math.PI) / 180;
    const pts = Array.from({ length: 91 }, (_, i) => {
      const a = (i / 90) * Math.PI * 2;
      const x = 120 * Math.cos(a), y = 50 * Math.sin(a);
      return { x: 300 + x * Math.cos(t) - y * Math.sin(t), y: 300 + x * Math.sin(t) + y * Math.cos(t) };
    });
    const qs = detectQuickShape(pts, 30);
    expect(qs?.kind).toBe('ellipse');
    expect(qs!.rotation).toBeCloseTo(30, 0);
    expect(qs!.rect.width).toBeCloseTo(240, -1);
    expect(qs!.rect.height).toBeCloseTo(100, -1);
  });

  it('recognises a hand-drawn rectangle as an upright rectangle', () => {
    const pts = jitter(polyPts([{ x: 50, y: 50 }, { x: 250, y: 52 }, { x: 251, y: 150 }, { x: 49, y: 149 }], 3, true), 1.5);
    const qs = detectQuickShape(pts, 30);
    expect(qs?.kind).toBe('rectangle');
    expect(qs!.rotation).toBeUndefined();
    expect(qs!.rect.width).toBeCloseTo(200, -1);
    expect(qs!.rect.height).toBeCloseTo(98.5, -1);
  });

  it('recognises a rotated rectangle with its angle, and a square', () => {
    const t = (25 * Math.PI) / 180;
    const corners = [[-100, -40], [100, -40], [100, 40], [-100, 40]].map(([x, y]) => ({ x: 300 + x * Math.cos(t) - y * Math.sin(t), y: 300 + x * Math.sin(t) + y * Math.cos(t) }));
    const qs = detectQuickShape(polyPts(corners, 3, true), 30);
    expect(qs?.kind).toBe('rectangle');
    expect(qs!.rotation).toBeCloseTo(25, 0);
    expect(qs!.rect.width).toBeCloseTo(200, -1);
    const sq = detectQuickShape(polyPts([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 97 }, { x: 0, y: 100 }], 3, true), 30);
    expect(sq?.kind).toBe('square');
    expect(sq!.rect.width).toBe(sq!.rect.height);
  });

  it('keeps an arbitrary triangle’s exact corners', () => {
    const tri = [{ x: 0, y: 0 }, { x: 200, y: 40 }, { x: 60, y: 160 }];
    const qs = detectQuickShape(polyPts(tri, 3, true), 30);
    expect(qs?.kind).toBe('triangle');
    expect(qs!.anchors).toHaveLength(3);
    for (const c of tri) expect(qs!.anchors!.some((a) => Math.hypot(a.x - c.x, a.y - c.y) < 4)).toBe(true);
  });

  it('recognises a five-pointed star', () => {
    const verts = Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 ? 40 : 100;
      return { x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) };
    });
    expect(detectQuickShape(polyPts(verts, 3, true), 30)?.kind).toBe('star');
  });

  it('leaves freehand curves alone', () => {
    // An S-curve
    const s = Array.from({ length: 80 }, (_, i) => ({ x: i * 4, y: 60 * Math.sin((i / 79) * Math.PI * 2) }));
    expect(detectQuickShape(s, 20)).toBeNull();
    // A lumpy blob
    const blob = Array.from({ length: 121 }, (_, i) => {
      const a = (i / 120) * Math.PI * 2;
      const r = 100 + 35 * Math.sin(a * 3) + 15 * Math.cos(a * 5);
      return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
    });
    expect(detectQuickShape(blob, 30)).toBeNull();
  });
});

describe('Edit selected paths', () => {
  const line: PathAnchor[] = [
    { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0, type: 'corner' },
    { x: 300, y: 0, ix: 300, iy: 0, ox: 300, oy: 0, type: 'corner' },
  ];

  it('reshapes the stretch between where the stroke starts and ends', () => {
    const stroke = [{ x: 100, y: 3 }, ...circlePts(150, 0, 50, Math.PI, 2 * Math.PI, 40).slice(1, -1), { x: 200, y: 2 }];
    const r = editPathWithStroke(line, false, stroke, 12, 1);
    expect(r?.mode).toBe('reshape');
    expect(r!.closed).toBe(false);
    // The ends of the original path are untouched and the new stretch joins it exactly on the line
    expect(r!.anchors[0]).toMatchObject({ x: 0, y: 0 });
    expect(r!.anchors[r!.anchors.length - 1]).toMatchObject({ x: 300, y: 0 });
    expect(r!.anchors.some((a) => Math.abs(a.x - 100) < 1 && Math.abs(a.y) < 1e-6)).toBe(true);
    // …and passes over the arch's top
    const top = Math.min(...sample(r!.anchors, false).map((p) => p.y));
    expect(top).toBeCloseTo(-50, -0.5);
  });

  it('reshapes the same way when the stroke is drawn right to left', () => {
    const stroke = [{ x: 200, y: 2 }, { x: 150, y: -50 }, { x: 100, y: 2 }];
    const r = editPathWithStroke(line, false, polyPts(stroke, 2), 12, 1);
    expect(r?.mode).toBe('reshape');
    expect(r!.anchors[0]).toMatchObject({ x: 0, y: 0 });
    expect(r!.anchors[r!.anchors.length - 1]).toMatchObject({ x: 300, y: 0 });
  });

  it('extends an open path from its end', () => {
    const r = editPathWithStroke(line, false, polyPts([{ x: 302, y: 1 }, { x: 300, y: 200 }], 2), 12, 1);
    expect(r?.mode).toBe('extend');
    expect(r!.anchors[0]).toMatchObject({ x: 0, y: 0 });
    expect(r!.anchors[1]).toMatchObject({ x: 300, y: 0 });
    expect(r!.anchors[r!.anchors.length - 1].y).toBeCloseTo(200, 0);
  });

  it('closes an open path drawn from one end to the other', () => {
    const r = editPathWithStroke(line, false, polyPts([{ x: 301, y: 2 }, { x: 150, y: 150 }, { x: 1, y: 1 }], 2), 12, 1);
    expect(r?.mode).toBe('close');
    expect(r!.closed).toBe(true);
    // No duplicate anchor where the loop closes
    const first = r!.anchors[0], last = r!.anchors[r!.anchors.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(1);
  });

  it('reshapes a closed path and keeps it closed', () => {
    const sq: PathAnchor[] = [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y]) => ({ x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' as const }));
    const r = editPathWithStroke(sq, true, polyPts([{ x: 30, y: 1 }, { x: 50, y: -40 }, { x: 70, y: 1 }], 2), 12, 1);
    expect(r?.mode).toBe('reshape');
    expect(r!.closed).toBe(true);
    // The other three corners are still there
    for (const c of [[100, 100], [0, 100], [100, 0]]) expect(r!.anchors.some((a) => a.x === c[0] && a.y === c[1])).toBe(true);
    expect(Math.min(...sample(r!.anchors, true).map((p) => p.y))).toBeLessThan(-30);
  });

  it('ignores strokes away from the path', () => {
    expect(editPathWithStroke(line, false, polyPts([{ x: 50, y: 100 }, { x: 250, y: 100 }], 2), 12, 1)).toBeNull();
    expect(sculptPath(line, polyPts([{ x: 50, y: 100 }, { x: 250, y: 100 }], 2), 12).didReshape).toBe(false);
  });
});

describe('Normalisation', () => {
  it('converts anchors to normalized ShapeProps in a 0..1 box', () => {
    const anchors: PathAnchor[] = [
      { x: 100, y: 200, ix: 100, iy: 200, ox: 120, oy: 200 },
      { x: 300, y: 400, ix: 280, iy: 400, ox: 300, oy: 400 },
    ];
    const { layerRect, shape } = anchorsToNormalizedShape(anchors, false, '#ff0000', '#000000', 3, false);
    expect(layerRect).toMatchObject({ x: 100, y: 200, width: 200, height: 200 });
    expect(shape.shape).toBe('path');
    expect(shape.points?.[0]).toMatchObject({ x: 0, y: 0 });
    expect(shape.points?.[1]).toMatchObject({ x: 1, y: 1 });
  });

  it('keeps a perfectly horizontal path finite', () => {
    const { shape } = anchorsToNormalizedShape(fitStroke(polyPts([{ x: 0, y: 10 }, { x: 100, y: 10 }]), 1), false, '#000', '#000', 1, false);
    for (const p of shape.points!) expect(Number.isFinite(p.y)).toBe(true);
  });
});
