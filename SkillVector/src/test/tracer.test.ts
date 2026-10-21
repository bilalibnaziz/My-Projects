import { describe, expect, it } from 'vitest';
import { deltaE, despeckle, dropBackground, islands, kmeansPalette, placeTrace, regionRings, smoothLabels, tracePixels, TRACE_PRESETS } from '../core/tracer';
import type { PathAnchor } from '../core/types';

type Pt = { x: number; y: number };

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number] | null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) ?? [255, 255, 255];
      data.set([...c, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

/** Rings of a traced layer back in image pixels, flattened to dense polygons. */
function ringsPx(l: { x: number; y: number; width: number; height: number; shape?: { points?: PathAnchor[]; compoundPoints?: PathAnchor[][] } }): Pt[][] {
  const rings = l.shape!.compoundPoints ?? [l.shape!.points!];
  return rings.map((ring) => {
    const P = (x: number, y: number) => ({ x: l.x + x * l.width, y: l.y + y * l.height });
    const out: Pt[] = [];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const p0 = P(a.x, a.y), p1 = P(a.ox, a.oy), p2 = P(b.ix, b.iy), p3 = P(b.x, b.y);
      for (let k = 0; k < 24; k++) {
        const t = k / 24, u = 1 - t;
        out.push({
          x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
    });
    return out;
  });
}
const area = (pts: Pt[]) => pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p.x * q.y - q.x * p.y;
}, 0) / 2;
/** Even-odd filled area of a set of rings (outer and holes wind opposite ways). */
const fillArea = (rings: Pt[][]) => Math.abs(rings.reduce((s, r) => s + area(r), 0));

describe('Image Trace', () => {
  it('traces a square to exactly its four pixel corners', () => {
    const img = image(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? [0, 0, 0] : null));
    const res = tracePixels(img, { mode: 'pixel-exact' });
    expect(res.layers).toHaveLength(1);
    const l = res.layers[0];
    expect([l.x, l.y, l.width, l.height]).toEqual([10, 10, 20, 20]);
    expect(l.shape!.points).toHaveLength(4);
    expect(fillArea(ringsPx(l))).toBeCloseTo(400, 3);
  });

  it('keeps the hole of a ring (letter O) as a compound path', () => {
    const img = image(60, 60, (x, y) => {
      const d = Math.hypot(x + 0.5 - 30, y + 0.5 - 30);
      return d < 24 && d >= 12 ? [0, 0, 0] : null;
    });
    const res = tracePixels(img, { mode: 'bw' });
    expect(res.layers).toHaveLength(1);
    const l = res.layers[0];
    expect(l.shape!.compoundPoints).toHaveLength(2);
    expect(res.contours.filter((c) => c.isHole)).toHaveLength(1);
    let px = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0) px++;
    const ratio = fillArea(ringsPx(l)) / px;
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  });

  it('fits a circle with few smooth anchors, within 3% of its area', () => {
    const r = 40;
    const img = image(100, 100, (x, y) => (Math.hypot(x + 0.5 - 50, y + 0.5 - 50) < r ? [20, 20, 20] : null));
    const l = tracePixels(img, { mode: 'bw', simplification: 1 }).layers[0];
    expect(l.shape!.points!.length).toBeLessThan(16);
    expect(l.shape!.points!.every((a) => a.type === 'smooth')).toBe(true);
    expect(Math.abs(fillArea(ringsPx(l)) / (Math.PI * r * r) - 1)).toBeLessThan(0.03);
  });

  it('keeps sharp corners on a smoothed trace of a rectangle', () => {
    const img = image(80, 60, (x, y) => (x >= 10 && x < 70 && y >= 10 && y < 50 ? [0, 0, 0] : null));
    const l = tracePixels(img, { mode: 'bw', simplification: 1 }).layers[0];
    const corners = l.shape!.points!.filter((a) => a.type === 'corner').map((a) => [Math.round(l.x + a.x * l.width), Math.round(l.y + a.y * l.height)]);
    expect(corners).toHaveLength(4);
    expect(corners).toEqual(expect.arrayContaining([[10, 10], [70, 10], [70, 50], [10, 50]]));
    expect(fillArea(ringsPx(l))).toBeCloseTo(60 * 40, -1);
  });

  it('gives every pixel a colour: two flat patches → two exact colours, no gaps', () => {
    const img = image(50, 50, (x) => (x < 25 ? [255, 0, 0] : [0, 0, 255]));
    const res = tracePixels(img, { mode: 'color', colors: 4, ignoreWhite: true });
    expect([...res.colors].sort()).toEqual(['#0000ff', '#ff0000']);
    const total = res.layers.reduce((s, l) => s + fillArea(ringsPx(l)), 0);
    expect(total).toBeCloseTo(2500, -1);
  });

  it('leaves white out and traces with a brand palette when given', () => {
    const img = image(40, 40, (x) => (x < 20 ? [200, 30, 40] : null));
    const res = tracePixels(img, { mode: 'color', palette: ['#e11d48', '#ffffff'] });
    expect(res.colors).toEqual(['#e11d48']);
  });

  it('separates diagonal pixels and despeckles noise', () => {
    // Two pixels touching only at a corner are two regions
    expect(regionRings(new Uint16Array([0, 1, 1, 0]), 2, 2, 0)).toHaveLength(2);
    // A lone pixel inside a big area merges into it
    const big = new Uint16Array(25).fill(3);
    big[12] = 7;
    despeckle(big, 5, 5, 4);
    expect(big.every((v) => v === 3)).toBe(true);
  });

  it('pixel art traces exact colours on the pixel grid', () => {
    const img = image(4, 4, (x, y) => ((x + y) % 2 ? [255, 0, 0] : [0, 128, 0]));
    const res = tracePixels(img, { mode: 'pixel-exact', minArea: 1 });
    expect([...res.colors].sort()).toEqual(['#008000', '#ff0000']);
    expect(res.contours).toHaveLength(16);
    for (const l of res.layers) for (const r of l.shape!.compoundPoints ?? [l.shape!.points!]) for (const a of r) {
      expect(Math.abs((l.x + a.x * l.width) - Math.round(l.x + a.x * l.width))).toBeLessThan(1e-9);
    }
  });

  it('places the result over the image layer', () => {
    const img = image(20, 20, (x, y) => (x < 10 && y < 10 ? [0, 0, 0] : null));
    const l = placeTrace(tracePixels(img, { mode: 'pixel-exact' }), 100, 50, 2).layers[0];
    expect([l.x, l.y, l.width, l.height]).toEqual([100, 50, 20, 20]);
  });

  it('every preset produces a trace', () => {
    const img = image(48, 48, (x, y) => (Math.hypot(x - 24, y - 24) < 16 ? [30, 90, 200] : (x + y) % 9 === 0 ? [240, 180, 20] : null));
    for (const p of TRACE_PRESETS) {
      const res = tracePixels(img, p.opts);
      expect(res.layers.length, p.id).toBeGreaterThan(0);
      for (const l of res.layers) expect(Number.isFinite(l.x) && Number.isFinite(l.width), p.id).toBe(true);
    }
  });

  it('keeps a small but distinct colour (Lab k-means over every pixel)', () => {
    // A big field of near-greys (noise) and a tiny red dot: red must get its own colour
    const img = image(120, 120, (x, y) => {
      if (x >= 60 && x < 64 && y >= 60 && y < 64) return [220, 20, 30];
      const v = 120 + ((x * 7 + y * 13) % 9) - 4;
      return x < 60 ? [v, v, v] : [v + 60, v + 60, v + 60];
    });
    const pal = kmeansPalette(img.data, 120 * 120, 3);
    expect(pal.some((c) => deltaE(c, [220, 20, 30]) < 10)).toBe(true);
  });

  it('auto colours: finds how many colours flat art has, ignoring anti-aliasing', () => {
    const cols: [number, number, number][] = [[230, 60, 40], [30, 120, 200], [250, 200, 40], [20, 20, 20]];
    const img = image(160, 160, (x, y) => {
      const d = Math.hypot(x - 80, y - 80);
      // Soft edges: a one-pixel blend between rings
      const ring = Math.min(3, Math.floor(d / 22));
      const f = d / 22 - Math.floor(d / 22);
      const a = cols[ring], b = cols[Math.min(3, ring + 1)];
      return f > 0.96 ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2].map(Math.round) as [number, number, number] : a;
    });
    const res = tracePixels(img, { mode: 'color', colors: 24, autoColors: true, ignoreWhite: false, minArea: 8 });
    expect(res.colors).toHaveLength(4);
    for (const c of cols) expect(res.colors.some((h) => deltaE([parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)], c) < 3), String(c)).toBe(true);
  });

  it('true colours: each path is the average of the pixels it covers', () => {
    // Noisy blue around (40, 90, 200): the traced colour lands on the mean, not a cluster guess
    const img = image(80, 80, (x, y) => [40 + ((x * 3 + y) % 11) - 5, 90 + ((x + y * 5) % 9) - 4, 200 + ((x * y) % 7) - 3]);
    const res = tracePixels(img, { mode: 'color', colors: 8, autoColors: true, ignoreWhite: false, minArea: 200 });
    expect(res.colors).toHaveLength(1);
    expect(deltaE([parseInt(res.colors[0].slice(1, 3), 16), parseInt(res.colors[0].slice(3, 5), 16), parseInt(res.colors[0].slice(5, 7), 16)], [40, 90, 200])).toBeLessThan(1.5);
  });

  it('drops a coloured background but keeps the same colour inside the artwork', () => {
    // Blue background, a yellow square, and a blue square inside the yellow one
    const img = image(60, 60, (x, y) => (x >= 20 && x < 30 && y >= 20 && y < 30 ? [20, 60, 200] : x >= 10 && x < 40 && y >= 10 && y < 40 ? [250, 210, 30] : [20, 60, 200]));
    const res = tracePixels(img, { mode: 'color', colors: 4, removeBackground: true, ignoreWhite: false });
    expect(res.colors).toHaveLength(2);
    const blue = res.layers.find((l) => l.shape!.fill === '#143cc8')!;
    expect([blue.x, blue.y, blue.width, blue.height]).toEqual([20, 20, 10, 10]);
    const labels = new Uint16Array(9).fill(1);
    labels[4] = 2;
    expect(dropBackground(labels, 3, 3)).toBe(1);
    expect(labels[4]).toBe(2);
  });

  it('overlap stacking: lower colours run under the upper ones (no holes, no seams)', () => {
    const img = image(60, 60, (x, y) => (x >= 20 && x < 40 && y >= 20 && y < 40 ? [255, 0, 0] : [0, 0, 255]));
    const abut = tracePixels(img, { mode: 'color', colors: 2, ignoreWhite: false });
    const over = tracePixels(img, { mode: 'color', colors: 2, ignoreWhite: false, method: 'overlap' });
    const bottomA = abut.layers[0], bottomO = over.layers[0];
    expect(bottomA.shape!.compoundPoints).toHaveLength(2); // blue frame with a hole
    expect(bottomO.shape!.compoundPoints).toBeUndefined(); // one solid square under the red
    expect(fillArea(ringsPx(bottomO))).toBeCloseTo(3600, -1);
    expect(over.layers[0].shape!.strokeWidth).toBe(0);
  });

  it('split: one path per separate shape, holes stay with their shape', () => {
    const img = image(80, 40, (x, y) => {
      if (x >= 5 && x < 35 && y >= 5 && y < 35) return x >= 15 && x < 25 && y >= 15 && y < 25 ? null : [0, 0, 0];
      return x >= 45 && x < 75 && y >= 5 && y < 35 ? [0, 0, 0] : null;
    });
    const res = tracePixels(img, { mode: 'pixel-exact', split: true });
    expect(res.layers).toHaveLength(2);
    const holed = res.layers.find((l) => l.x === 5)!;
    expect(holed.shape!.compoundPoints).toHaveLength(2);
    expect(fillArea(ringsPx(holed))).toBeCloseTo(900 - 100, 3);
    expect(islands(regionRings(new Uint16Array([0, 1, 0]), 3, 1, 0))).toHaveLength(2);
  });

  it('centerline: a thick line becomes one open stroke of its width; a ring one closed stroke', () => {
    const img = image(120, 40, (x, y) => (x >= 10 && x < 110 && y >= 17 && y < 23 ? [0, 0, 0] : null));
    const res = tracePixels(img, { mode: 'centerline', minArea: 4 });
    expect(res.layers).toHaveLength(1);
    const s = res.layers[0].shape!;
    expect(s.closed).toBe(false);
    expect(s.fillEnabled).toBe(false);
    expect(s.strokeWidth).toBeGreaterThanOrEqual(5);
    expect(s.strokeWidth).toBeLessThanOrEqual(7);
    expect(res.layers[0].width).toBeGreaterThan(85);
    expect(Math.abs(res.layers[0].y + res.layers[0].height / 2 - 20)).toBeLessThan(1.5);
    const ring = image(80, 80, (x, y) => (Math.abs(Math.hypot(x + 0.5 - 40, y + 0.5 - 40) - 25) < 3 ? [0, 0, 0] : null));
    const r = tracePixels(ring, { mode: 'centerline', minArea: 4 });
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].shape!.closed).toBe(true);
    const xs = r.layers[0].shape!.points!.map((a) => r.layers[0].x + a.x * r.layers[0].width);
    expect(Math.abs(Math.max(...xs) - Math.min(...xs) - 50)).toBeLessThan(3);
  });

  it('edge clean-up irons out a ragged pixel', () => {
    const L = new Uint16Array(25).fill(0);
    for (let i = 0; i < 25; i++) if (i % 5 >= 3) L[i] = 1;
    L[12] = 1; // a notch poking into the 0 side
    smoothLabels(L, 5, 5, 1);
    expect(L[12]).toBe(0);
  });

  it('sub-pixel edges: an anti-aliased circle traces round, with few anchors', () => {
    const R = 110, W = 260, C = 130;
    const bg = [30, 64, 175], fg = [250, 204, 21];
    const img = image(W, W, (x, y) => {
      let cov = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (Math.hypot(x + (sx + 0.5) / 4 - C, y + (sy + 0.5) / 4 - C) < R) cov++;
      return [0, 1, 2].map((k) => Math.round(bg[k] * (1 - cov / 16) + fg[k] * (cov / 16))) as [number, number, number];
    });
    const dev = (subpixel: boolean) => {
      const res = tracePixels(img, { mode: 'color', colors: 4, removeBackground: true, ignoreWhite: false, simplification: 0.7, subpixel });
      const l = res.layers[0];
      const pts = ringsPx(l)[0];
      return { n: l.shape!.points!.length, max: Math.max(...pts.map((p) => Math.abs(Math.hypot(p.x - C, p.y - C) - R))) };
    };
    const on = dev(true), off = dev(false);
    expect(on.max).toBeLessThan(0.45);
    expect(on.max).toBeLessThan(off.max);
    expect(on.n).toBeLessThanOrEqual(8);
  });
});
