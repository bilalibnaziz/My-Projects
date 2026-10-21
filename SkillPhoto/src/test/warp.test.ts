import { describe, it, expect } from 'vitest';
import { apply3, invert3, isConvexQuad, pointInQuad, squareToQuad, warpText, warpToQuad } from '../core/warp';

const quad = [{ x: 10, y: 20 }, { x: 110, y: 10 }, { x: 130, y: 90 }, { x: 0, y: 120 }];

describe('perspective warp', () => {
  it('maps the unit square corners onto the quad, and back', () => {
    const m = squareToQuad(quad);
    const unit = [[0, 0], [1, 0], [1, 1], [0, 1]];
    unit.forEach(([u, v], i) => {
      const p = apply3(m, u, v);
      expect(p.x).toBeCloseTo(quad[i].x, 6);
      expect(p.y).toBeCloseTo(quad[i].y, 6);
      const back = apply3(invert3(m), quad[i].x, quad[i].y);
      expect(back.x).toBeCloseTo(u, 6);
      expect(back.y).toBeCloseTo(v, 6);
    });
  });

  it('a quad equal to the source rectangle reproduces the image exactly', () => {
    const w = 6, h = 4;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) src.set([i * 10, 255 - i * 10, (i * 37) % 256, 255], i * 4);
    const r = warpToQuad(src, w, h, [{ x: 5, y: 7 }, { x: 5 + w, y: 7 }, { x: 5 + w, y: 7 + h }, { x: 5, y: 7 + h }]);
    expect([r.x, r.y, r.width, r.height]).toEqual([5, 7, w, h]);
    expect(Array.from(r.data)).toEqual(Array.from(src));
  });

  it('a trapezoid keeps the colours and shrinks the narrow edge', () => {
    const w = 40, h = 40;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) src.set([255, 0, 0, 255], i * 4);
    // Top edge 20 px wide, bottom 40 px
    const r = warpToQuad(src, w, h, [{ x: 10, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]);
    const at = (x: number, y: number) => Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));
    expect(at(20, 2)).toEqual([255, 0, 0, 255]);
    expect(at(2, 2)[3]).toBe(0); // outside the narrow top
    expect(at(2, 38)).toEqual([255, 0, 0, 255]);
  });

  it('detects convex quads and points inside', () => {
    expect(isConvexQuad(quad)).toBe(true);
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false); // bow-tie
    expect(pointInQuad(quad, 60, 60)).toBe(true);
    expect(pointInQuad(quad, 125, 15)).toBe(false);
  });
});

describe('warp text', () => {
  // A 100×20 opaque white bar
  const w = 100, h = 20;
  const bar = new Uint8ClampedArray(w * h * 4).fill(255);
  const alphaAt = (r: { data: Uint8ClampedArray; width: number }, x: number, y: number) => r.data[(y * r.width + x) * 4 + 3];

  it('none / zero bend returns the input untouched', () => {
    expect(warpText(bar, w, h, 'none', 50).data).toBe(bar);
    expect(warpText(bar, w, h, 'arc', 0).data).toBe(bar);
  });

  it('arc bends the ends down (positive) and keeps the middle in place', () => {
    const r = warpText(bar, w, h, 'arc', 60);
    expect(r.height).toBeGreaterThan(h + 10);
    // The middle of the bar stays where it was
    const cx = Math.round(w / 2 - r.dx);
    const cy = Math.round(h / 2 - r.dy);
    expect(alphaAt(r, cx, cy)).toBe(255);
    // Top corners are empty (the ends curved down)
    expect(alphaAt(r, 1, 1)).toBe(0);
    expect(alphaAt(r, r.width - 2, 1)).toBe(0);
    // Negative bend curves the other way: bottom corners empty
    const u = warpText(bar, w, h, 'arc', -60);
    expect(alphaAt(u, 1, u.height - 2)).toBe(0);
  });

  it('rise lifts the right end and drops the left', () => {
    const r = warpText(bar, w, h, 'rise', 100);
    const top = (x: number) => {
      for (let y = 0; y < r.height; y++) if (alphaAt(r, x, y) > 128) return y;
      return -1;
    };
    expect(top(95)).toBeLessThan(top(5));
  });

  it('flag and bulge keep the width and grow the height', () => {
    for (const s of ['flag', 'wave', 'bulge', 'arch'] as const) {
      const r = warpText(bar, w, h, s, 80);
      expect(r.width).toBe(w);
      expect(r.height).toBeGreaterThan(h);
    }
  });
});
