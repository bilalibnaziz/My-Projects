import { describe, expect, it } from 'vitest';
import { fuse, mtbShift } from '../core/fusion';

const W = 128;
const H = 96;

/** Value noise: random levels on a 3 px grid, bilinear between them (detail with no repeating period). */
const hash = (ix: number, iy: number) => {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
function noise(x: number, y: number): number {
  const fx = x / 3, fy = y / 3;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * tx;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * tx;
  return a + (b - a) * ty;
}

/** A textured scene: smooth gradient + shapes + fine noise detail (values 0..1). */
function scene(x: number, y: number): number {
  const base = 0.15 + 0.6 * (x / W) * (0.6 + 0.4 * (y / H));
  const disc = Math.hypot(x - 40, y - 40) < 18 ? 0.25 : 0;
  const bar = x > 80 && x < 100 && y > 20 && y < 80 ? -0.1 : 0;
  return Math.max(0, Math.min(1, base + disc + bar + (noise(x, y) - 0.5) * 0.25));
}

function image(f: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = Math.round(Math.max(0, Math.min(1, f(x, y))) * 255);
      const i = (y * W + x) * 4;
      d[i] = v;
      d[i + 1] = Math.round(v * 0.9);
      d[i + 2] = Math.round(v * 0.8);
      d[i + 3] = 255;
    }
  return d;
}

const gray = (d: Uint8ClampedArray) => {
  const g = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = d[i * 4 + 1];
  return g;
};

/** Mean absolute 4-neighbour Laplacian over a region: high = sharp detail. */
function detail(d: Uint8ClampedArray, x0: number, x1: number): number {
  let s = 0;
  let n = 0;
  for (let y = 2; y < H - 2; y++)
    for (let x = Math.max(2, x0); x < Math.min(W - 2, x1); x++) {
      const v = (xx: number, yy: number) => d[(yy * W + xx) * 4 + 1];
      s += Math.abs(v(x - 1, y) + v(x + 1, y) + v(x, y - 1) + v(x, y + 1) - 4 * v(x, y));
      n++;
    }
  return s / n;
}

/** 5×5 box blur of the scene (an out-of-focus version). */
const blurred = (x: number, y: number) => {
  let s = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += scene(Math.max(0, Math.min(W - 1, x + dx)), Math.max(0, Math.min(H - 1, y + dy)));
  return s / 25;
};

describe('MTB alignment', () => {
  it('finds a handheld shift between two shots, even when one is two stops darker', () => {
    const ref = gray(image(scene));
    const moved = gray(image((x, y) => scene(x - 5, y + 3) * 0.25));
    // moved(x + dx, y + dy) = ref(x, y) → dx = 5, dy = −3
    expect(mtbShift(ref, moved, W, H)).toEqual([5, -3]);
  });
});

describe('focus stacking', () => {
  it('keeps the sharp half of each shot', () => {
    const left = image((x, y) => (x < W / 2 ? scene(x, y) : blurred(x, y)));
    const right = image((x, y) => (x >= W / 2 ? scene(x, y) : blurred(x, y)));
    const { data } = fuse({ images: [left, right], w: W, h: H, mode: 'focus', align: false });
    const sharp = image(scene);
    // Both halves come out about as detailed as the all-sharp scene (well above the blurred halves)
    for (const [a, b] of [[8, W / 2 - 8], [W / 2 + 8, W - 8]]) {
      const got = detail(data, a, b);
      expect(got).toBeGreaterThan(detail(sharp, a, b) * 0.8);
      expect(got).toBeGreaterThan(detail(left, W / 2 + 8, W - 8) * 2);
    }
  });
});

describe('exposure fusion', () => {
  it('blends an under- and over-exposed pair into one with fewer clipped pixels and real detail', () => {
    const under = image((x, y) => scene(x, y) * 0.45);
    const over = image((x, y) => scene(x, y) * 2.2);
    const { data, shifts } = fuse({ images: [under, over], w: W, h: H, mode: 'exposure', align: true });
    expect(shifts[1]).toEqual([0, 0]); // already aligned (reference = index 1)
    const clipped = (d: Uint8ClampedArray) => {
      let c = 0;
      for (let i = 0; i < W * H; i++) if (d[i * 4] >= 250 || d[i * 4] <= 5) c++; // red: the brightest channel here
      return c;
    };
    expect(clipped(data)).toBeLessThan(clipped(over) * 0.5);
    // Brighter than the dark shot on average, and keeps the checker detail across the frame
    const mean = (d: Uint8ClampedArray) => d.reduce((a, v, i) => (i % 4 === 1 ? a + v : a), 0) / (W * H);
    expect(mean(data)).toBeGreaterThan(mean(under) + 10);
    expect(detail(data, 4, W - 4)).toBeGreaterThan(detail(under, 4, W - 4));
    // Opaque everywhere
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it('identical shots fuse back to the same picture', () => {
    const a = image(scene);
    const { data } = fuse({ images: [a, a.slice()], w: W, h: H, mode: 'exposure', align: false });
    let worst = 0;
    for (let i = 0; i < data.length; i++) worst = Math.max(worst, Math.abs(data[i] - a[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('aligns before blending, so a shifted pair does not ghost', () => {
    const a = image(scene);
    const b = image((x, y) => scene(x + 4, y - 2));
    const { data, shifts } = fuse({ images: [a, b], w: W, h: H, mode: 'exposure', align: true });
    // reference = index 1 (b): a(x + 4, y − 2) = b(x, y)
    expect(shifts[0]).toEqual([4, -2]);
    // Inside the frame the result matches b (the reference), not a blur of both
    let worst = 0;
    for (let y = 8; y < H - 8; y++) for (let x = 8; x < W - 8; x++) worst = Math.max(worst, Math.abs(data[(y * W + x) * 4 + 1] - b[(y * W + x) * 4 + 1]));
    expect(worst).toBeLessThanOrEqual(2);
  });
});
