import { describe, expect, it } from 'vitest';
import { makeLayer, withLayer } from '../core/types';
import type { Layer } from '../core/types';
import { envelopeBox, envelopeTargets, warpLayers, warpPoint, warpSubpath, WARP_STYLES, type WarpOptions } from '../core/envelope';
import { docSubpaths } from '../core/vectorTools';

const rect = (x: number, y: number, w: number, h: number) =>
  makeLayer({ kind: 'shape', name: 'R', x, y, width: w, height: h, shape: { shape: 'rectangle', fill: '#ff0000', fillEnabled: true, stroke: '#0000ff', strokeWidth: 2, radius: 0 } });
const box = { x: 0, y: 0, w: 200, h: 100 };
const opts = (o: Partial<WarpOptions>): WarpOptions => ({ style: 'arc', bend: 50, distortH: 0, distortV: 0, vertical: false, ...o });

/** Point on a cubic. */
const bez = (a: number, b: number, c: number, d: number, t: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;

describe('warp point maps', () => {
  it('every style is the identity at bend 0 and keeps the centre fixed', () => {
    for (const { id } of WARP_STYLES) {
      for (const p of [{ x: 0, y: 0 }, { x: 37, y: 81 }, { x: 200, y: 100 }]) {
        const q = warpPoint(p, box, opts({ style: id, bend: 0 }));
        expect(q.x).toBeCloseTo(p.x, 6);
        expect(q.y).toBeCloseTo(p.y, 6);
      }
      // Arch / Arc Lower / Arc Upper move the middle on purpose; Rise and Fish are lopsided
      if (!['rise', 'fish', 'arch', 'arc-lower', 'arc-upper'].includes(id)) {
        const c = warpPoint({ x: 100, y: 50 }, box, opts({ style: id, bend: 70 }));
        expect(Math.hypot(c.x - 100, c.y - 50)).toBeLessThan(1e-6);
      }
    }
  });

  it('Arc bends the middle line into a circle arc: +bend lifts the middle above the sides', () => {
    const mid = warpPoint({ x: 100, y: 50 }, box, opts({ bend: 100 }));
    const left = warpPoint({ x: 0, y: 50 }, box, opts({ bend: 100 }));
    const right = warpPoint({ x: 200, y: 50 }, box, opts({ bend: 100 }));
    expect(left.y).toBeGreaterThan(mid.y + 20);
    expect(left.y).toBeCloseTo(right.y, 6);
    // At 100 % the middle line is a half circle of length = the width: radius 200/π
    const R = 200 / Math.PI;
    expect(Math.hypot(left.x - 100, left.y - (mid.y + R))).toBeCloseTo(R, 4);
    // The top row lies further out than the bottom one (it gets longer)
    const tl = warpPoint({ x: 0, y: 0 }, box, opts({ bend: 100 }));
    const bl = warpPoint({ x: 0, y: 100 }, box, opts({ bend: 100 }));
    expect(Math.hypot(tl.x - 100, tl.y - (mid.y + R))).toBeGreaterThan(Math.hypot(bl.x - 100, bl.y - (mid.y + R)));
  });

  it('Bulge pushes the top edge up and the bottom edge down in the middle; Vertical turns it 90°', () => {
    const top = warpPoint({ x: 100, y: 0 }, box, opts({ style: 'bulge', bend: 50 }));
    const bottom = warpPoint({ x: 100, y: 100 }, box, opts({ style: 'bulge', bend: 50 }));
    expect(top.y).toBeLessThan(0);
    expect(bottom.y).toBeGreaterThan(100);
    expect(warpPoint({ x: 0, y: 0 }, box, opts({ style: 'bulge', bend: 50 })).y).toBeCloseTo(0, 6);
    const leftV = warpPoint({ x: 0, y: 50 }, box, opts({ style: 'bulge', bend: 50, vertical: true }));
    expect(leftV.x).toBeLessThan(0);
    expect(leftV.y).toBeCloseTo(50, 6);
  });

  it('horizontal distortion makes one side taller than the other', () => {
    const o = opts({ style: 'flag', bend: 0, distortH: 50 });
    const lh = warpPoint({ x: 0, y: 100 }, box, o).y - warpPoint({ x: 0, y: 0 }, box, o).y;
    const rh = warpPoint({ x: 200, y: 100 }, box, o).y - warpPoint({ x: 200, y: 0 }, box, o).y;
    expect(rh / lh).toBeCloseTo(1.25 / 0.75, 6);
  });
});

describe('warping paths', () => {
  it('a straight edge becomes a curve that follows the warp closely', () => {
    const o = opts({ style: 'arch', bend: 60 });
    const top = [
      { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
      { x: 200, y: 0, ix: 200, iy: 0, ox: 200, oy: 0 },
    ];
    const out = warpSubpath(top, false, box, o, 200 / 24);
    expect(out.length).toBeGreaterThan(10);
    // Sample the result and compare against warping the original line directly
    let worst = 0;
    for (let k = 0; k < out.length - 1; k++) {
      const a = out[k];
      const b = out[k + 1];
      for (const t of [0.25, 0.5, 0.75]) {
        const x = bez(a.x, a.ox, b.ix, b.x, t);
        const y = bez(a.y, a.oy, b.iy, b.y, t);
        // The exact warped curve passes through warp(x0, 0) where x0 maps to x (arch only moves y)
        const exact = warpPoint({ x, y: 0 }, box, o);
        worst = Math.max(worst, Math.abs(exact.y - y));
      }
    }
    expect(worst).toBeLessThan(0.5);
    // Ends stay corners, the new points in between are smooth
    expect(out[0].type).toBe('corner');
    expect(out[5].type).toBe('smooth');
  });

  it('closed paths keep their anchor count consistent and wrap the last segment', () => {
    const sq = [
      { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
      { x: 200, y: 0, ix: 200, iy: 0, ox: 200, oy: 0 },
      { x: 200, y: 100, ix: 200, iy: 100, ox: 200, oy: 100 },
      { x: 0, y: 100, ix: 0, iy: 100, ox: 0, oy: 100 },
    ];
    const out = warpSubpath(sq, true, box, opts({ style: 'flag', bend: 40 }), 25);
    // 200/25 = 8 pieces on long sides, 100/25 = 4 on short ones → 24 anchors, each corner once
    expect(out).toHaveLength(24);
    expect(out.filter((p) => p.type === 'corner')).toHaveLength(4);
    // The first anchor's in-handle comes from the closing segment (not left on the anchor)
    expect(Math.hypot(out[0].ix - out[0].x, out[0].iy - out[0].y)).toBeGreaterThan(1);
  });

  it('the selection warps as one envelope: two shapes side by side bend as a pair', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(100, 0, 100, 100);
    const layers: Layer[] = [a, b];
    expect(envelopeBox(envelopeTargets(layers, [a.id, b.id]))).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    const out = warpLayers(layers, [a.id, b.id], opts({ style: 'arch', bend: 50 }));
    expect(out.size).toBe(2);
    // The shared edge (x = 100) is the middle of the envelope: it rises the most, on both shapes
    const topAt100 = (l: Layer) => Math.min(...docSubpaths(l).subs.flat().filter((p) => Math.abs(p.x - 100) < 1e-6).map((p) => p.y));
    expect(topAt100(out.get(a.id)!)).toBeCloseTo(topAt100(out.get(b.id)!), 6);
    expect(topAt100(out.get(a.id)!)).toBeCloseTo(-25, 6); // bend 50 % lifts the middle by half of half the height
  });

  it('shapes inside a selected group are warped; text is left alone', () => {
    const g = makeLayer({ kind: 'group', name: 'G', x: 0, y: 0, width: 100, height: 100 });
    const inner = withLayer(rect(0, 0, 100, 100), { parent: g.id });
    const text = makeLayer({ kind: 'text', name: 'T', x: 0, y: 0, width: 50, height: 20 });
    const targets = envelopeTargets([g, inner, text], [g.id, text.id]);
    expect(targets.map((l) => l.id)).toEqual([inner.id]);
  });
});
