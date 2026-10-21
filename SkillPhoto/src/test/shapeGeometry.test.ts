import { describe, expect, it } from 'vitest';
import type { PathAnchor, ShapeProps } from '../core/types';
import { clampRadii, extrasFor, hasLiveGeometry, liveShapePath, liveShapeRings, rectRing, roundVertices, spiralRing } from '../core/shapeGeometry';
import { convertToEditablePath } from '../core/vectorOps';
import { makeLayer } from '../core/types';

type Pt = { x: number; y: number };

/** Flattens a closed Bézier ring into a dense polygon. */
function flatten(ring: PathAnchor[], closed = true, steps = 64): Pt[] {
  const out: Pt[] = [];
  const n = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y,
      });
    }
  }
  return out;
}

/** Signed shoelace area. */
const area = (pts: Pt[]) => pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p.x * q.y - q.x * p.y;
}, 0) / 2;

const base: ShapeProps = { shape: 'rectangle', fill: '#000', fillEnabled: true, stroke: '#000', strokeWidth: 0, radius: 0 };
const bbox = (pts: Pt[]) => ({
  x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
  y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)),
});

describe('rectangle corners', () => {
  it('leaves plain and uniformly rounded rectangles to the built-in drawing', () => {
    expect(hasLiveGeometry(base)).toBe(false);
    expect(hasLiveGeometry({ ...base, radius: 12 })).toBe(false);
    expect(hasLiveGeometry({ ...base, radius: 12, cornerStyle: 'round' })).toBe(false);
    expect(hasLiveGeometry({ ...base, radius: 12, cornerStyle: 'chamfer' })).toBe(true);
    expect(hasLiveGeometry({ ...base, radii: [0, 4, 0, 0] })).toBe(true);
  });

  it('scales neighbouring radii down together so they never overlap (CSS rule)', () => {
    expect(clampRadii(100, 100, [100, 100, 0, 0])).toEqual([50, 50, 0, 0]);
    expect(clampRadii(200, 100, [10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
    // No radius at all must stay zero, not divide by zero
    expect(clampRadii(100, 50, [0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  const W = 200, H = 120, r = 20;
  const cases: [ShapeProps['cornerStyle'], number][] = [
    ['round', W * H - (4 - Math.PI) * r * r],
    ['chamfer', W * H - 4 * (r * r) / 2],
    ['notch', W * H - 4 * r * r],
    ['scoop', W * H - Math.PI * r * r],
  ];
  for (const [style, expected] of cases) {
    it(`${style} corners cut the exact area`, () => {
      const ring = rectRing(W, H, [r, r, r, r], style!);
      const pts = flatten(ring);
      expect(Math.abs(area(pts))).toBeCloseTo(expected, -1);
      expect(bbox(pts)).toEqual({ x0: 0, x1: W, y0: 0, y1: H });
    });
  }

  it('smooth corners stay inside the box and are softer than round ones', () => {
    const round = Math.abs(area(flatten(rectRing(W, H, [r, r, r, r], 'round'))));
    const smooth = Math.abs(area(flatten(rectRing(W, H, [r, r, r, r], 'smooth'))));
    expect(smooth).toBeLessThan(round);
    expect(smooth).toBeGreaterThan(W * H - 4 * (1.4 * r) ** 2);
  });

  it('keeps sharp corners exact when only some corners are rounded', () => {
    const ring = rectRing(W, H, [r, 0, 0, 0], 'round');
    const corners = ring.filter((a) => a.type === 'corner').map((a) => [a.x, a.y]);
    expect(corners).toEqual([[W, 0], [W, H], [0, H]]);
    expect(Math.abs(area(flatten(ring)))).toBeCloseTo(W * H - (1 - Math.PI / 4) * r * r, -1);
  });
});

describe('polygons and stars', () => {
  it('uses the inner radius of a star', () => {
    const s: ShapeProps = { ...base, shape: 'star', sides: 5, innerRatio: 0.3 };
    const rings = liveShapeRings(s, 100, 100)!;
    const ring = rings.rings[0];
    expect(ring).toHaveLength(10);
    const d = (a: PathAnchor) => Math.hypot(a.x - 0.5, a.y - 0.5);
    expect(d(ring[0])).toBeCloseTo(0.5);
    expect(d(ring[1])).toBeCloseTo(0.15);
  });

  it('rounds the points of a square with true circular fillets', () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const ring = roundVertices(sq, 10);
    expect(Math.abs(area(flatten(ring)))).toBeCloseTo(100 * 100 - (4 - Math.PI) * 100, -1);
  });

  it('caps the rounding at half of the shorter edge', () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }];
    const ring = roundVertices(tri, 1000);
    for (const a of ring) {
      expect(a.x).toBeGreaterThanOrEqual(-1e-9);
      expect(a.x).toBeLessThanOrEqual(10 + 1e-9);
    }
  });
});

describe('ellipse pies and donuts', () => {
  const e: ShapeProps = { ...base, shape: 'ellipse' };
  const W = 200, H = 100;
  const full = Math.PI * 100 * 50;

  it('a quarter pie has a quarter of the area', () => {
    const r = liveShapeRings({ ...e, pieStart: 0, pieEnd: 90 }, W, H)!;
    const pts = flatten(r.rings[0].map((a) => ({ ...a, x: a.x * W, y: a.y * H, ix: a.ix * W, iy: a.iy * H, ox: a.ox * W, oy: a.oy * H })));
    expect(Math.abs(area(pts))).toBeCloseTo(full / 4, -1);
  });

  it('a donut leaves its hole empty under non-zero filling', () => {
    const r = liveShapeRings({ ...e, hole: 0.5 }, W, H)!;
    expect(r.rings).toHaveLength(2);
    const px = (ring: PathAnchor[]) => flatten(ring.map((a) => ({ ...a, x: a.x * W, y: a.y * H, ix: a.ix * W, iy: a.iy * H, ox: a.ox * W, oy: a.oy * H })));
    const outer = area(px(r.rings[0]));
    const inner = area(px(r.rings[1]));
    // Opposite winding: the signed areas add up to the ring area
    expect(Math.sign(outer)).toBe(-Math.sign(inner));
    expect(Math.abs(outer + inner)).toBeCloseTo(full * 0.75, -1);
  });

  it('a gauge wraps past 360°', () => {
    const r = liveShapeRings({ ...e, pieStart: 135, pieEnd: 45, hole: 0.7 }, W, H)!;
    const pts = flatten(r.rings[0].map((a) => ({ ...a, x: a.x * W, y: a.y * H, ix: a.ix * W, iy: a.iy * H, ox: a.ox * W, oy: a.oy * H })));
    expect(Math.abs(area(pts))).toBeCloseTo(full * (1 - 0.49) * 0.75, -1);
  });

  it('Convert to Path keeps the donut hole as a compound path', () => {
    const l = makeLayer({ kind: 'shape', name: 'Donut', x: 0, y: 0, width: W, height: H, shape: { ...e, hole: 0.5 } });
    const p = convertToEditablePath(l);
    expect(p.shape!.shape).toBe('path');
    expect(p.shape!.compoundPoints).toHaveLength(2);
  });
});

describe('spiral and drawing', () => {
  it('runs from the centre to the edge', () => {
    const ring = spiralRing(3, 100, 100);
    expect(ring[0].x).toBeCloseTo(50);
    expect(ring[0].y).toBeCloseTo(50);
    const last = ring[ring.length - 1];
    expect(Math.hypot(last.x - 50, last.y - 50)).toBeCloseTo(50);
  });

  it('draws the live outline into a canvas path at the layer position', () => {
    const calls: string[] = [];
    const ctx = {
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      bezierCurveTo: (...a: number[]) => calls.push(`C${a[4]},${a[5]}`),
      closePath: () => calls.push('Z'),
    };
    expect(liveShapePath(ctx, { ...base, radius: 10, cornerStyle: 'chamfer' }, 50, 60, 100, 80)).toBe(true);
    expect(calls[0]).toBe('M50,70');
    expect(calls.at(-1)).toBe('Z');
    expect(liveShapePath(ctx, base, 0, 0, 10, 10)).toBe(false);
  });

  it('only passes the settings that fit the shape being drawn', () => {
    const x: Partial<ShapeProps> = { radii: [1, 2, 3, 4], innerRatio: 0.3, hole: 0.5, turns: 5 };
    expect(extrasFor('rectangle', x)).toEqual({ radii: [1, 2, 3, 4] });
    expect(extrasFor('star', x)).toEqual({ innerRatio: 0.3 });
    expect(extrasFor('ellipse', x)).toEqual({ hole: 0.5 });
    expect(extrasFor('triangle', x)).toEqual({});
  });
});
