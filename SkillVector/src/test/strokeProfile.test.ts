import { describe, expect, it } from 'vitest';
import { flattenAnchors, nearestOnPath, pointAt, variableStrokeOutline, widthAt, WIDTH_PROFILES } from '../core/strokeProfile';
import type { PathAnchor } from '../core/types';

const corner = (x: number, y: number): PathAnchor => ({ x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' });
const line = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];

// Half-width of an outline above/below the x axis at a given x
const halfAt = (ring: { x: number; y: number }[], x: number) => {
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
    const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return (bottom - top) / 2;
};

describe('width profiles', () => {
  it('interpolates width points smoothly; open ends return to the stroke weight', () => {
    const pts = [{ t: 0.2, w: 0 }, { t: 0.8, w: 2 }];
    expect(widthAt(undefined, 0.5)).toBe(1);
    expect(widthAt(pts, 0.2)).toBe(0);
    expect(widthAt(pts, 0.8)).toBe(2);
    expect(widthAt(pts, 0)).toBe(1);
    expect(widthAt(pts, 1)).toBe(1);
    expect(widthAt(pts, 0.5)).toBeCloseTo(1, 6);
    // Eased: slower near the points than linear
    expect(widthAt(pts, 0.3)).toBeLessThan(2 * (0.1 / 0.6));
    // Points on the ends override the weight there
    expect(widthAt([{ t: 0, w: 0 }, { t: 1, w: 3 }], 0)).toBe(0);
  });

  it('a lens profile is thin at the ends and full in the middle', () => {
    const lens = WIDTH_PROFILES.find((p) => p.id === 'lens')!.points;
    const [ring] = variableStrokeOutline(line, false, 20, lens, 'butt');
    expect(halfAt(ring, 50)).toBeCloseTo(10, 4);
    expect(halfAt(ring, 1)).toBeLessThan(1);
  });

  it('a profile shows along a straight two-point line too', () => {
    const [ring] = variableStrokeOutline([{ x: 0, y: 0 }, { x: 100, y: 0 }], false, 10, [{ t: 0.5, w: 8 }], 'butt');
    expect(halfAt(ring, 50)).toBeCloseTo(40, 0);
    expect(halfAt(ring, 1)).toBeLessThan(6);
  });

  it('a uniform stroke has constant width, and round caps extend past the ends', () => {
    const [ring] = variableStrokeOutline(line, false, 10, [], 'round');
    expect(halfAt(ring, 25)).toBeCloseTo(5, 6);
    expect(halfAt(ring, 75)).toBeCloseTo(5, 6);
    expect(Math.max(...ring.map((p) => p.x))).toBeGreaterThan(104);
    expect(Math.min(...ring.map((p) => p.x))).toBeLessThan(-4);
  });

  it('closed paths give an outer and an inner ring', () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const rings = variableStrokeOutline(sq, true, 10, []);
    expect(rings).toHaveLength(2);
    const span = (r: { x: number }[]) => Math.max(...r.map((p) => p.x)) - Math.min(...r.map((p) => p.x));
    expect(Math.max(span(rings[0]), span(rings[1]))).toBeCloseTo(110, 4);
    expect(Math.min(span(rings[0]), span(rings[1]))).toBeCloseTo(90, 4);
  });

  it('flattens curves and finds the nearest point along the path', () => {
    const a = { ...corner(0, 0), ox: 0, oy: -50 };
    const b = { ...corner(100, 0), ix: 100, iy: -50 };
    const poly = flattenAnchors([a, b], false);
    expect(poly.length).toBeGreaterThan(5);
    const top = pointAt(poly, 0.5);
    expect(top.x).toBeCloseTo(50, 0);
    expect(top.y).toBeCloseTo(-37.5, 0);
    const n = nearestOnPath(line, { x: 25, y: 7 });
    expect(n.t).toBeCloseTo(0.25, 6);
    expect(n.d).toBeCloseTo(7, 6);
  });
});
