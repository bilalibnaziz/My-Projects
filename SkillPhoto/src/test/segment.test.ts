import { describe, expect, it } from 'vitest';
import { MaxFlow } from '../core/maxflow';
import { grabCut, selectSubject, selectObjectInBox, selectObjectAt, selectSky, strokeCut, rangeMask, BG, PR_FG, otsu } from '../core/segment';
import { boxMean, guidedFilter, matteEdges, pushPullFill, refineMask, signedDistance, decontaminate, DEFAULT_REFINE } from '../core/matte';
import type { RGBA } from '../core/matte';

/** Deterministic noise. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** w×h image: textured background, plus `inside(x,y)` pixels in an object colour. */
function scene(w: number, h: number, inside: (x: number, y: number) => boolean, fg = [220, 40, 50], bg = [40, 140, 60], amp = 30): RGBA {
  const rand = noise(3);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = inside(x, y) ? fg : bg;
      const n = (rand() - 0.5) * amp;
      data[i] = c[0] + n;
      data[i + 1] = c[1] + n;
      data[i + 2] = c[2] + n;
      data[i + 3] = 255;
    }
  return { data, w, h };
}

function iou(alpha: Float32Array, roi: { x: number; y: number; w: number; h: number }, W: number, H: number, inside: (x: number, y: number) => boolean) {
  let inter = 0, uni = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inRoi = x >= roi.x && y >= roi.y && x < roi.x + roi.w && y < roi.y + roi.h;
      const a = inRoi ? alpha[(y - roi.y) * roi.w + (x - roi.x)] >= 0.5 : false;
      const t = inside(x, y);
      if (a && t) inter++;
      if (a || t) uni++;
    }
  return inter / Math.max(1, uni);
}

describe('max-flow', () => {
  it('finds the minimum cut of a small graph', () => {
    // s→0 (3), s→1 (2); 0→1 (1); 0→t (2), 1→t (3)  ⇒ max flow 5
    const g = new MaxFlow(2, 1);
    g.addTWeights(0, 3, 2);
    g.addTWeights(1, 2, 3);
    g.addEdge(0, 1, 1, 0);
    expect(g.solve()).toBe(5);
  });

  it('cuts a 1D chain at its weakest link', () => {
    const n = 10;
    const g = new MaxFlow(n, n);
    g.addTWeights(0, 100, 0);
    g.addTWeights(n - 1, 0, 100);
    for (let i = 0; i < n - 1; i++) g.addEdge(i, i + 1, i === 6 ? 3 : 50, i === 6 ? 3 : 50);
    expect(g.solve()).toBe(3);
    for (let i = 0; i < n; i++) expect(g.isSource(i)).toBe(i <= 6);
  });

  it('matches a brute-force min cut on random grids', () => {
    const rand = noise(11);
    for (let trial = 0; trial < 20; trial++) {
      const n = 6;
      const tw: [number, number][] = [];
      const edges: [number, number, number][] = [];
      const g = new MaxFlow(n, 20);
      for (let i = 0; i < n; i++) {
        const s = Math.floor(rand() * 10), t = Math.floor(rand() * 10);
        tw.push([s, t]);
        g.addTWeights(i, s, t);
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          if (rand() < 0.5) continue;
          const c = Math.floor(rand() * 8);
          edges.push([i, j, c]);
          g.addEdge(i, j, c, c);
        }
      const flow = g.solve();
      let best = Infinity;
      for (let m = 0; m < 1 << n; m++) {
        let cost = 0;
        for (let i = 0; i < n; i++) cost += m & (1 << i) ? tw[i][1] : tw[i][0];
        for (const [i, j, c] of edges) if (!!(m & (1 << i)) !== !!(m & (1 << j))) cost += c;
        best = Math.min(best, cost);
      }
      expect(flow).toBe(best);
      // The returned labelling has exactly that cost
      let cost = 0;
      for (let i = 0; i < n; i++) cost += g.isSource(i) ? tw[i][1] : tw[i][0];
      for (const [i, j, c] of edges) if (g.isSource(i) !== g.isSource(j)) cost += c;
      expect(cost).toBe(best);
    }
  });
});

describe('graph-cut selection', () => {
  const W = 160, H = 120;
  const disc = (x: number, y: number) => (x - 80) ** 2 + (y - 60) ** 2 < 35 ** 2;

  it('GrabCut separates an object inside a box', () => {
    const img = scene(W, H, disc);
    const tri = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tri[y * W + x] = x > 35 && x < 125 && y > 15 && y < 105 ? PR_FG : BG;
    const cut = grabCut(img, tri);
    const a = Float32Array.from(cut);
    expect(iou(a, { x: 0, y: 0, w: W, h: H }, W, H, disc)).toBeGreaterThan(0.95);
  });

  it('Select Subject finds a centred subject', () => {
    const img = scene(W, H, disc);
    const r = selectSubject(img);
    expect(iou(r.alpha, r.roi, W, H, disc)).toBeGreaterThan(0.93);
  });

  it('Select Subject finds an off-centre subject with similar luminance', () => {
    const shape = (x: number, y: number) => x > 20 && x < 75 && y > 30 && y < 110;
    const img = scene(W, H, shape, [70, 90, 200], [120, 120, 110], 20);
    const r = selectSubject(img);
    expect(iou(r.alpha, r.roi, W, H, shape)).toBeGreaterThan(0.9);
  });

  it('Object Selection picks the boxed object, not its neighbour', () => {
    const a = (x: number, y: number) => (x - 45) ** 2 + (y - 60) ** 2 < 25 ** 2;
    const b = (x: number, y: number) => (x - 120) ** 2 + (y - 60) ** 2 < 25 ** 2;
    const img = scene(W, H, (x, y) => a(x, y) || b(x, y));
    const r = selectObjectInBox(img, { x: 15, y: 30, w: 62, h: 60 });
    expect(iou(r.alpha, r.roi, W, H, a)).toBeGreaterThan(0.9);
  });

  it('click selects the object under the cursor', () => {
    const a = (x: number, y: number) => (x - 45) ** 2 + (y - 60) ** 2 < 25 ** 2;
    const b = (x: number, y: number) => (x - 120) ** 2 + (y - 60) ** 2 < 25 ** 2;
    const img = scene(W, H, (x, y) => a(x, y) || b(x, y));
    const r = selectObjectAt(img, 120, 60);
    expect(iou(r.alpha, r.roi, W, H, b)).toBeGreaterThan(0.9);
  });

  it('Quick Selection stroke snaps to the object edge, and subtracting removes one part', () => {
    const img = scene(W, H, disc);
    const r = strokeCut(img, null, [{ x: 70, y: 60, r: 6 }, { x: 90, y: 60, r: 6 }], 'add')!;
    expect(iou(r.alpha, r.roi, W, H, disc)).toBeGreaterThan(0.93);

    // Two-colour object: blue left part, red right part. Select it all, then paint away the blue part.
    const blue = (x: number, y: number) => disc(x, y) && x < 70;
    const two = scene(W, H, disc);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (blue(x, y)) {
          const i = (y * W + x) * 4;
          two.data[i] = 40;
          two.data[i + 1] = 60;
          two.data[i + 2] = 220;
        }
    const cur = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cur[y * W + x] = disc(x, y) ? 255 : 0;
    const sub = strokeCut(two, cur, [{ x: 58, y: 55, r: 5 }, { x: 58, y: 65, r: 5 }], 'sub')!;
    const red = (x: number, y: number) => disc(x, y) && x >= 70;
    // The app keeps the old selection outside the stroke's region
    const merged = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) merged[i] = cur[i] / 255;
    for (let y = 0; y < sub.roi.h; y++)
      for (let x = 0; x < sub.roi.w; x++) {
        const i = (y + sub.roi.y) * W + x + sub.roi.x;
        merged[i] = Math.min(merged[i], sub.alpha[y * sub.roi.w + x]);
      }
    expect(iou(merged, { x: 0, y: 0, w: W, h: H }, W, H, red)).toBeGreaterThan(0.9);
  });

  it('Quick Selection grows over a shaded object (light falloff) from a short stroke', () => {
    const W2 = 600, H2 = 400;
    const subj = (x: number, y: number) => ((x - 330) / 130) ** 2 + ((y - 215) / 105) ** 2 < 1;
    const rand = noise(7);
    const data = new Uint8ClampedArray(W2 * H2 * 4);
    for (let y = 0; y < H2; y++)
      for (let x = 0; x < W2; x++) {
        const i = (y * W2 + x) * 4;
        const n = (rand() - 0.5) * 36;
        const shade = 0.85 + 0.3 * (x / W2);
        let c: number[];
        if (subj(x, y)) {
          const l = 1 - 0.35 * (((x - 330) / 130) ** 2 + ((y - 215) / 105) ** 2);
          c = [230 * l + n, 120 * l + n, 70 * l + n];
        } else c = [(95 + n) * shade, (130 + n) * shade, (90 + n) * shade];
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    const dabs = [];
    for (let k = 0; k <= 8; k++) dabs.push({ x: 290 + k * 10, y: 210 + k * 1.25, r: 12 });
    const r = strokeCut({ data, w: W2, h: H2 }, null, dabs, 'add')!;
    expect(iou(r.alpha, r.roi, W2, H2, subj)).toBeGreaterThan(0.9);
  });

  it('Select Sky finds a gradient sky over a textured ground, and refuses an indoor scene', () => {
    const w = 120, h = 90;
    const rand = noise(5);
    const data = new Uint8ClampedArray(w * h * 4);
    const horizon = (x: number) => 50 + Math.round(8 * Math.sin(x / 9));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (y < horizon(x)) {
          data[i] = 90 + y;
          data[i + 1] = 150 + y;
          data[i + 2] = 235;
        } else {
          const n = (rand() - 0.5) * 90;
          data[i] = 70 + n;
          data[i + 1] = 90 + n;
          data[i + 2] = 40 + n;
        }
        data[i + 3] = 255;
      }
    const r = selectSky({ data, w, h })!;
    expect(r).not.toBeNull();
    expect(iou(r.alpha, r.roi, w, h, (x, y) => y < horizon(x))).toBeGreaterThan(0.9);
    expect(selectSky(scene(w, h, () => false, [0, 0, 0], [120, 70, 40], 120))).toBeNull();
  });

  it('range masks pick skin and tones', () => {
    const img = scene(20, 10, (x) => x < 10, [224, 172, 140], [60, 120, 220], 0);
    const skin = rangeMask(img, 'skin');
    expect(skin[5]).toBeGreaterThan(0.5);
    expect(skin[15]).toBe(0);
    const dark = scene(4, 1, (x) => x < 2, [240, 240, 240], [15, 15, 15], 0);
    const hi = rangeMask(dark, 'highlights');
    const sh = rangeMask(dark, 'shadows');
    expect(hi[0]).toBe(1);
    expect(hi[3]).toBe(0);
    expect(sh[3]).toBe(1);
  });

  it('otsu splits a bimodal set', () => {
    const v = new Float32Array(200);
    for (let i = 0; i < 200; i++) v[i] = i < 100 ? 0.2 : 0.8;
    const t = otsu(v);
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThanOrEqual(0.8);
  });
});

describe('matting', () => {
  it('box mean of a constant is constant, and guided filter keeps a step edge', () => {
    const w = 30, h = 10;
    const c = new Float32Array(w * h).fill(0.4);
    expect(Math.max(...boxMean(c, w, h, 3).map((v) => Math.abs(v - 0.4)))).toBeLessThan(1e-6);
    const I = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) I[i] = i % w < 15 ? 0 : 1;
    const q = guidedFilter(I, I, w, h, 4, 1e-4);
    expect(q[5 * w + 13]).toBeLessThan(0.05);
    expect(q[5 * w + 16]).toBeGreaterThan(0.95);
  });

  it('signed distance is positive inside, negative outside', () => {
    const w = 21, h = 21;
    const m = new Float32Array(w * h);
    for (let y = 5; y < 16; y++) for (let x = 5; x < 16; x++) m[y * w + x] = 1;
    const d = signedDistance(m, w, h);
    expect(d[10 * w + 10]).toBeCloseTo(5.5, 0);
    expect(d[10 * w + 0]).toBeCloseTo(-4.5, 0);
  });

  it('push-pull fills unknown pixels from known colours', () => {
    const img = scene(8, 8, () => true, [200, 100, 50], [0, 0, 0], 0);
    const known = new Uint8Array(64);
    known[0] = 1;
    const f = pushPullFill(img, known);
    expect(f[63 * 3]).toBeCloseTo(200, 0);
  });

  it('solves fractional alpha on a blended edge and decontaminates the colour', () => {
    // Horizontal ramp from blue background to red foreground over 8 px
    const w = 60, h = 6;
    const data = new Uint8ClampedArray(w * h * 4);
    const truth = (x: number) => Math.min(1, Math.max(0, (x - 26) / 8));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const a = truth(x);
        const i = (y * w + x) * 4;
        data[i] = 230 * a + 20 * (1 - a);
        data[i + 1] = 30;
        data[i + 2] = 40 * a + 220 * (1 - a);
        data[i + 3] = 255;
      }
    const img = { data, w, h };
    const hardMask = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) hardMask[i] = i % w >= 30 ? 1 : 0;
    const r = matteEdges(img, hardMask, 8, false, null);
    let err = 0;
    for (let x = 22; x < 38; x++) err = Math.max(err, Math.abs(r.alpha[3 * w + x] - truth(x)));
    expect(err).toBeLessThan(0.12);
    const out = decontaminate(img, r, 1);
    // A half-transparent pixel keeps the foreground's red, not the blue background
    const i = (3 * w + 30) * 4;
    expect(out[i]).toBeGreaterThan(out[i + 2]);
  });

  it('refine pipeline: shift edge grows the mask, feather softens it', () => {
    const w = 40, h = 40;
    const img = scene(w, h, () => true, [128, 128, 128], [0, 0, 0], 0);
    const m = new Float32Array(w * h);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) m[y * w + x] = 1;
    const area = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
    const grown = refineMask(img, m, { ...DEFAULT_REFINE, shiftEdge: 3 }, null).alpha;
    expect(area(grown)).toBeGreaterThan(area(m) + 200);
    const soft = refineMask(img, m, { ...DEFAULT_REFINE, feather: 3 }, null).alpha;
    expect(soft[20 * w + 10]).toBeGreaterThan(0.2);
    expect(soft[20 * w + 10]).toBeLessThan(0.8);
  });
});
