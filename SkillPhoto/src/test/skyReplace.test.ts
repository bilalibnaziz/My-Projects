import { describe, expect, it } from 'vitest';
import { alphaFromRegion, horizonRow, refineSkyMask } from '../core/skyReplace';

// 100 × 100: sky (1) above row 40, land (0) below
const W = 100;
const H = 100;
const sky = () => Float32Array.from({ length: W * H }, (_, i) => (Math.floor(i / W) < 40 ? 1 : 0));
const col = (a: Float32Array, x: number) => Array.from({ length: H }, (_, y) => a[y * W + x]);
const edgeRow = (a: Float32Array) => col(a, 50).findIndex((v) => v < 0.5);

describe('sky replacement mask', () => {
  it('finds the horizon as the lowest mostly-sky row', () => {
    expect(horizonRow(sky(), W, H)).toBe(40);
    expect(horizonRow(new Float32Array(W * H), W, H)).toBe(50); // no sky: middle
  });

  it('Shift Edge grows (+) or shrinks (−) the sky', () => {
    const grown = edgeRow(refineSkyMask(sky(), W, H, 6, 0));
    const shrunk = edgeRow(refineSkyMask(sky(), W, H, -6, 0));
    expect(grown).toBeGreaterThan(40);
    expect(shrunk).toBeLessThan(40);
    expect(edgeRow(refineSkyMask(sky(), W, H, 0, 0))).toBe(40);
  });

  it('Fade Edge softens the edge without moving it', () => {
    const faded = col(refineSkyMask(sky(), W, H, 0, 8), 50);
    expect(faded[30]).toBeGreaterThan(0.95);
    expect(faded[50]).toBeLessThan(0.05);
    expect(faded[39]).toBeGreaterThan(0.2);
    expect(faded[39]).toBeLessThan(0.95);
    expect(Math.abs(edgeRow(refineSkyMask(sky(), W, H, 0, 8)) - 40)).toBeLessThanOrEqual(1);
  });

  it('places a region found in a box into a full-size mask', () => {
    const a = alphaFromRegion({ roi: { x: 10, y: 5, w: 2, h: 2 }, alpha: Float32Array.from([1, 0.5, 0.25, 0]) }, 20, 10);
    expect(a[5 * 20 + 10]).toBe(1);
    expect(a[5 * 20 + 11]).toBe(0.5);
    expect(a[6 * 20 + 10]).toBe(0.25);
    expect(a.reduce((s, v) => s + v, 0)).toBe(1.75);
  });
});
