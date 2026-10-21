import { describe, expect, it } from 'vitest';
import { bandRefine, cutout, liftUncertainHoles, normalizePrior, snapRegion, softEdges } from '../core/cutout';
import { combinePriors, toTensor } from '../core/aiModels';
import { runJob } from '../core/cutoutJob';
import type { RGBA } from '../core/matte';

function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function scene(w: number, h: number, inside: (x: number, y: number) => boolean, fg: number[], bg: number[], amp = 20, edge?: (x: number, y: number) => boolean): RGBA {
  const rand = noise(5);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = edge?.(x, y) ? [205, 205, 205] : inside(x, y) ? fg : bg;
      const n = (rand() - 0.5) * amp;
      data[i] = c[0] + n;
      data[i + 1] = c[1] + n;
      data[i + 2] = c[2] + n;
      data[i + 3] = 255;
    }
  return { data, w, h };
}

const iou = (alpha: Float32Array, w: number, h: number, inside: (x: number, y: number) => boolean) => {
  let inter = 0, uni = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x] >= 0.5, t = inside(x, y);
      if (a && t) inter++;
      if (a || t) uni++;
    }
  return inter / Math.max(1, uni);
};

/** A blurry, shy "model output" for a shape, on a small grid. */
function fakePrior(W: number, H: number, inside: (x: number, y: number) => boolean, size: number, face = 0.9) {
  const p = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const X = ((x + 0.5) / size) * W, Y = ((y + 0.5) / size) * H;
      p[y * size + x] = inside(X, Y) ? face : 0.01;
    }
  return { p, w: size, h: size };
}

describe('cutout pipeline', () => {
  it('normalizePrior stretches a shy model and blanks a flat one', () => {
    const p = normalizePrior(Float32Array.from([0.1, 0.3, 0.5]));
    expect(p[0]).toBeCloseTo(0);
    expect(p[2]).toBeCloseTo(0.8);
    expect(normalizePrior(Float32Array.from([0.2, 0.21])).every((v) => v === 0)).toBe(true);
  });

  it('liftUncertainHoles keeps a grey box face connected to its bright rim, not a confident hole', () => {
    const w = 40, h = 40;
    const p = new Float32Array(w * h);
    for (let y = 5; y < 35; y++)
      for (let x = 5; x < 35; x++) {
        const rim = x < 8 || x > 31 || y < 8 || y > 31;
        p[y * w + x] = rim ? 0.95 : 0.3;
      }
    // A real hole (near 0) in the middle
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) p[y * w + x] = 0.01;
    const out = liftUncertainHoles(p, w, h);
    expect(out[12 * w + 12]).toBeGreaterThanOrEqual(0.5);
    expect(out[0]).toBeLessThan(0.1);
    // The hole is only 16 px of a ~900 px object: tiny holes are filled, so make a bigger one
    const p2 = Float32Array.from(p);
    for (let y = 14; y < 26; y++) for (let x = 14; x < 26; x++) p2[y * w + x] = 0.01;
    expect(liftUncertainHoles(p2, w, h)[20 * w + 20]).toBeLessThan(0.5);
  });

  it('white box on a white table: the model knows the object, the cut keeps it whole', () => {
    const W = 360, H = 240;
    const box = (x: number, y: number) => x >= 80 && x < 280 && y >= 50 && y < 190;
    // Faint grey outline only — colour alone can't separate the face from the table
    const outline = (x: number, y: number) => box(x, y) && (x < 82 || x >= 278 || y < 52 || y >= 188);
    const img = scene(W, H, box, [246, 246, 246], [250, 250, 250], 6, outline);
    // Shy model: bright rim, grey face
    const prior = fakePrior(W, H, box, 64, 0.35);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const X = ((x + 0.5) / 64) * W, Y = ((y + 0.5) / 64) * H;
        if (box(X, Y) && !box(X - 12, Y - 12)) prior.p[y * 64 + x] = 0.95;
        if (box(X, Y) && !box(X + 12, Y + 12)) prior.p[y * 64 + x] = 0.95;
      }
    const r = cutout(img, { x: 0, y: 0, w: W, h: H }, prior, { proxy: 180 });
    expect(r).not.toBeNull();
    expect(iou(r!.region.alpha, W, H, box)).toBeGreaterThan(0.95);
  });

  it('snaps a coarse low-res outline to the real full-res edge', () => {
    const W = 400, H = 300;
    const disc = (x: number, y: number) => (x - 200) ** 2 + (y - 150) ** 2 < 95 ** 2;
    const img = scene(W, H, disc, [220, 60, 40], [40, 120, 200]);
    // A 40×30 mask of a slightly bigger, blocky disc
    const sw = 40, sh = 30;
    const small = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) small[y * sw + x] = ((x + 0.5) * 10 - 200) ** 2 + ((y + 0.5) * 10 - 150) ** 2 < 100 ** 2 ? 1 : 0;
    const hard = bandRefine(img, small, sw, sh, 12);
    expect(iou(hard, W, H, disc)).toBeGreaterThan(0.985);
  });

  it('soft edges anti-alias a hard mask and write halo-free pixels', () => {
    const W = 300, H = 200;
    const sq = (x: number, y: number) => x >= 60 && x < 240 && y >= 40 && y < 160;
    const img = scene(W, H, sq, [240, 200, 30], [20, 20, 200], 4);
    const hard = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hard[y * W + x] = sq(x, y) ? 1 : 0;
    const px = new Uint8ClampedArray(W * H * 4);
    const a = softEdges(img, hard, 'crisp', px);
    expect(iou(a, W, H, sq)).toBeGreaterThan(0.98);
    // Inside stays opaque, far outside stays clear, and opaque pixels keep the object colour
    expect(a[100 * W + 150]).toBeGreaterThan(0.99);
    expect(a[5 * W + 5]).toBeLessThan(0.01);
    expect(px[(100 * W + 150) * 4 + 3]).toBe(255);
    expect(px[(5 * W + 5) * 4 + 3]).toBe(0);
  });

  it('a seed keeps only the object under the click', () => {
    const W = 320, H = 200;
    const a = (x: number, y: number) => (x - 80) ** 2 + (y - 100) ** 2 < 50 ** 2;
    const b = (x: number, y: number) => (x - 240) ** 2 + (y - 100) ** 2 < 50 ** 2;
    const img = scene(W, H, (x, y) => a(x, y) || b(x, y), [200, 50, 50], [50, 160, 70]);
    const prior = fakePrior(W, H, (x, y) => a(x, y) || b(x, y), 64);
    const r = cutout(img, { x: 0, y: 0, w: W, h: H }, prior, { seed: { x: 240, y: 100 }, proxy: 160 });
    expect(iou(r!.region.alpha, W, H, b)).toBeGreaterThan(0.93);
  });

  it('works on a sub-region (Object Selection box) and returns roi-sized alpha', () => {
    const W = 300, H = 200;
    const obj = (x: number, y: number) => (x - 200) ** 2 + (y - 90) ** 2 < 40 ** 2;
    const img = scene(W, H, obj, [230, 230, 40], [60, 60, 60]);
    const roi = { x: 140, y: 30, w: 120, h: 120 };
    const prior = fakePrior(120, 120, (x, y) => obj(x + 140, y + 30), 40);
    const r = cutout(img, roi, prior, { proxy: 120 })!;
    expect(r.region.alpha.length).toBe(120 * 120);
    expect(iou(r.region.alpha, 120, 120, (x, y) => obj(x + 140, y + 30))).toBeGreaterThan(0.93);
  });

  it('snapRegion and the classic job tighten a classic selection', () => {
    const W = 300, H = 200;
    const disc = (x: number, y: number) => (x - 150) ** 2 + (y - 100) ** 2 < 60 ** 2;
    const img = scene(W, H, disc, [230, 60, 40], [40, 130, 60]);
    const loose = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) loose[y * W + x] = (x - 150) ** 2 + (y - 100) ** 2 < 64 ** 2 ? 1 : 0;
    const r = snapRegion(img, { roi: { x: 0, y: 0, w: W, h: H }, alpha: loose }, 'crisp', 4);
    expect(iou(r.region.alpha, W, H, disc)).toBeGreaterThan(0.97);
    const job = runJob({ kind: 'classic', img, pixels: true });
    expect(job).not.toBeNull();
    expect(job!.pixels!.length).toBe(W * H * 4);
    expect(iou(job!.region.alpha, W, H, disc)).toBeGreaterThan(0.9);
  });
});

describe('model glue', () => {
  it('toTensor normalises CHW and composites transparency over white', () => {
    const img: RGBA = { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]), w: 2, h: 2 };
    const t = toTensor(img, 2, 2, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(t.length).toBe(12);
    expect(t[0]).toBeCloseTo(1); // red channel of the red pixel
    expect(t[4 + 0]).toBeCloseTo(-1); // green channel of the red pixel
    expect(t[1]).toBeCloseTo(1); // transparent → white
  });

  it('combinePriors only trusts the portrait model when it agrees with the general one', () => {
    const G = 32;
    const person = (x: number, y: number) => (x - 16) ** 2 + (y - 18) ** 2 < 10 ** 2;
    const mk = (f: (x: number, y: number) => boolean) => {
      const p = new Float32Array(G * G);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) p[y * G + x] = f(x, y) ? 1 : 0;
      return { p, w: G, h: G };
    };
    expect(combinePriors(mk(person), mk(person)).portrait).toBe(true);
    // A product photo: MODNet finds nothing → general model wins
    expect(combinePriors(mk(person), mk(() => false)).portrait).toBe(false);
    // Disagreement → general model wins
    expect(combinePriors(mk((x) => x < 10), mk(person)).portrait).toBe(false);
  });
});
