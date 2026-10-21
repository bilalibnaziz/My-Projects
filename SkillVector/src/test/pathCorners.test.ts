import { describe, expect, it } from 'vitest';
import type { PathAnchor, ShapeProps } from '../core/types';
import { makeLayer } from '../core/types';
import { bakePathCorners, filletRing, hasPathCorners, pathCorners, rectAsLiveCornerPath } from '../core/shapeGeometry';
import { convertToEditablePath } from '../core/vectorOps';
import { dragWidget, shapeWidgets, sharpenPathCorner, widgetAt } from '../core/shapeWidgets';

type Pt = { x: number; y: number };
const sharp = (x: number, y: number, corner?: number): PathAnchor => ({ x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner', ...(corner ? { corner } : {}) });

function flatten(ring: PathAnchor[], steps = 200): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y,
      });
    }
  }
  return out;
}
const area = (pts: Pt[]) => Math.abs(pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p.x * q.y - q.x * p.y;
}, 0) / 2);
/** Area a fillet of radius r cuts off a corner with interior angle θ. */
const cutOff = (r: number, th: number) => r * r / Math.tan(th / 2) - (r * r * (Math.PI - th)) / 2;

describe('live corners on path anchors', () => {
  it('rounds a rectangle path exactly like a rounded rectangle', () => {
    const ring = [sharp(0, 0, 10), sharp(100, 0, 10), sharp(100, 60, 10), sharp(0, 60, 10)];
    const out = filletRing(ring, true);
    expect(out).toHaveLength(8);
    expect(area(flatten(out))).toBeCloseTo(6000 - 4 * cutOff(10, Math.PI / 2), 0);
    expect(out.every((a) => a.corner === undefined)).toBe(true);
  });

  it('uses the true radius on any angle (right triangle 90/45/45)', () => {
    const r = 6;
    const ring = [sharp(0, 0, r), sharp(100, 0, r), sharp(0, 100, r)];
    const want = 5000 - cutOff(r, Math.PI / 2) - 2 * cutOff(r, Math.PI / 4);
    expect(area(flatten(filletRing(ring, true)))).toBeCloseTo(want, 0);
  });

  it('rounds only the anchors that carry a corner and keeps the rest sharp', () => {
    const ring = [sharp(0, 0, 20), sharp(100, 0), sharp(100, 100), sharp(0, 100)];
    const out = filletRing(ring, true);
    expect(out).toHaveLength(5);
    expect(out.slice(2).map((a) => [a.x, a.y])).toEqual([[100, 0], [100, 100], [0, 100]]);
  });

  it('caps the radius at half of the shorter side', () => {
    const ring = [sharp(0, 0, 500), sharp(40, 0, 500), sharp(40, 200, 500), sharp(0, 200, 500)];
    const out = filletRing(ring, true);
    // Two corners meet in the middle of the short side: a stadium of radius 20
    const a = area(flatten(out));
    expect(a).toBeCloseTo(8000 - 4 * cutOff(20, Math.PI / 2), 0);
    expect(pathCorners(ring, true)[0].maxRadius).toBeCloseTo(20, 6);
  });

  it('trims curved sides on the curve and joins them smoothly (G1)', () => {
    // A "D": straight left side, a bulging curve on the right (through a smooth mid anchor)
    const curved: PathAnchor[] = [sharp(0, 0, 12), sharp(0, 100, 12)];
    // Segment 0→1 curved via an extra mid anchor
    const mid: PathAnchor = { x: 70, y: 50, ix: 70, iy: 10, ox: 70, oy: 90, type: 'smooth' };
    const shape = [curved[0], mid, curved[1]];
    const out = filletRing(shape, true);
    expect(out.length).toBe(5);
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const din = { x: a.x - a.ix, y: a.y - a.iy };
      const dout = { x: a.ox - a.x, y: a.oy - a.y };
      const cross = din.x * dout.y - din.y * dout.x;
      const len = Math.hypot(din.x, din.y) * Math.hypot(dout.x, dout.y);
      if (len > 1e-9) expect(Math.abs(cross) / len).toBeLessThan(1e-6);
    }
    const before = area(flatten(shape.map(({ corner: _c, ...a }) => a)));
    const after = area(flatten(out));
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThan(200);
  });

  it('leaves smooth anchors and open ends alone', () => {
    const open = [sharp(0, 0, 10), sharp(50, 0, 10), sharp(50, 50, 10)];
    expect(filletRing(open, false)).toHaveLength(4);
  });

  it('a rounded rectangle converts to a 4-anchor path with live corners', () => {
    const s: ShapeProps = { shape: 'rectangle', fill: '#000', fillEnabled: true, stroke: '#000', strokeWidth: 0, radius: 0, radii: [4, 8, 12, 16] };
    expect(rectAsLiveCornerPath(s, 100, 60)!.map((a) => a.corner)).toEqual([4, 8, 12, 16]);
    const l = makeLayer({ kind: 'shape', name: 'Button', x: 0, y: 0, width: 100, height: 60, shape: s });
    const live = convertToEditablePath(l, true, true);
    expect(live.shape!.points).toHaveLength(4);
    expect(hasPathCorners(live.shape!)).toBe(true);
    // Geometry operations get the baked outline instead
    const baked = convertToEditablePath(live);
    expect(hasPathCorners(baked.shape!)).toBe(false);
    expect(baked.shape!.points!.length).toBe(8);
    const sh = bakePathCorners(live.shape!, 100, 60);
    expect(area(flatten(sh.points!.map((a) => ({ ...a, x: a.x * 100, y: a.y * 60, ix: a.ix * 100, iy: a.iy * 60, ox: a.ox * 100, oy: a.oy * 60 })))))
      .toBeCloseTo(6000 - [4, 8, 12, 16].reduce((t, r) => t + cutOff(r, Math.PI / 2), 0), 0);
  });

  describe('path corner widgets', () => {
    const tri = () => makeLayer({ kind: 'shape', name: 'Tri', x: 100, y: 100, width: 200, height: 200, shape: {
      shape: 'path', fill: '#000', fillEnabled: true, stroke: '#000', strokeWidth: 0, radius: 0, closed: true,
      points: [sharp(0, 0), sharp(1, 0), sharp(0, 1)],
    } });

    it('puts a dot inside every sharp corner, on the bisector', () => {
      const ws = shapeWidgets(tri(), 1);
      expect(ws.map((w) => w.kind)).toEqual(['path-corner', 'path-corner', 'path-corner']);
      // Right-angle corner at (100,100): bisector (1,1)/√2, at the 16 px inset
      expect(ws[0].x).toBeCloseTo(100 + 16 / Math.SQRT2, 6);
      expect(ws[0].y).toBeCloseTo(100 + 16 / Math.SQRT2, 6);
      expect(widgetAt(tri(), { x: ws[0].x + 2, y: ws[0].y }, 1)?.index).toBe(0);
    });

    it('drags round every corner by the distance moved, ⌥ only the grabbed one', () => {
      const l = tri();
      const w = shapeWidgets(l, 1)[0];
      // Moving 20√2 along the 90° corner's bisector = radius 20
      const to = { x: w.x + 20, y: w.y + 20 };
      const all = dragWidget(l, w, w, to, { alt: false, shift: false, zoom: 1 })!;
      expect(all.patch.points!.map((a) => a.corner)).toEqual([20, 20, 20]);
      const one = dragWidget(l, w, w, to, { alt: true, shift: false, zoom: 1 })!;
      expect(one.patch.points!.map((a) => a.corner)).toEqual([20, undefined, undefined]);
      expect(one.readout).toBe('Corner 20 px');
      // The widget then sits on the arc centre
      const rounded = { ...l, shape: { ...l.shape!, ...one.patch } };
      const w2 = shapeWidgets(rounded, 1)[0];
      expect(w2.x).toBeCloseTo(120, 6);
      expect(w2.y).toBeCloseTo(120, 6);
      // ⌥-click makes it sharp again
      expect(sharpenPathCorner(rounded.shape, w2).points!.every((a) => a.corner === undefined)).toBe(true);
    });

    it('stops at the largest radius that fits', () => {
      const l = tri();
      const w = shapeWidgets(l, 1)[0];
      const r = dragWidget(l, w, w, { x: w.x + 900, y: w.y + 900 }, { alt: true, shift: false, zoom: 1 })!;
      // Half the 200 px side: tan(45°)·100 = 100
      expect(r.patch.points![0].corner).toBeCloseTo(100, 6);
      expect(r.readout).toContain('max');
    });
  });
});
