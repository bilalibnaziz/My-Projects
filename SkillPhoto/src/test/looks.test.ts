import { describe, expect, it } from 'vitest';
import { LOOKS, LOOK_CATEGORIES, bakeLook, colorStats, gradeFunction, matchLookLut, monotoneCurve, sampleLut, applyLutToPixels } from '../core/looks';
import { BUILTIN_LUTS, getBuiltinLutData, decodeLut, writeCube, parseCube } from '../core/lut';

describe('Looks library', () => {
  it('has 60+ looks with unique ids, in every category', () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
    for (const c of LOOK_CATEGORIES) expect(LOOKS.filter((l) => l.category === c).length).toBeGreaterThanOrEqual(3);
  });

  it('every look bakes to a valid LUT that keeps mid grey usable', () => {
    for (const look of LOOKS) {
      const lut = bakeLook(look.recipe, 9);
      // One assertion per look (a separate expect per entry is ~200k calls and times out)
      const bad = Array.from(lut.data).filter((v) => !(Number.isFinite(v) && v >= 0 && v <= 1));
      expect(bad, look.id).toEqual([]);
      const [r, g, b] = sampleLut(lut, 0.5, 0.5, 0.5);
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(y, look.id).toBeGreaterThan(0.25);
      expect(y, look.id).toBeLessThan(0.8);
    }
  });

  it('no two looks are near-duplicates', () => {
    const probes: [number, number, number][] = [];
    for (const r of [0.1, 0.5, 0.9]) for (const g of [0.1, 0.5, 0.9]) for (const b of [0.1, 0.5, 0.9]) probes.push([r, g, b]);
    const sig = LOOKS.map((l) => probes.flatMap(([r, g, b]) => gradeFunction(l.recipe)(r, g, b)));
    for (let i = 0; i < sig.length; i++) {
      for (let j = i + 1; j < sig.length; j++) {
        const d = sig[i].reduce((a, v, k) => a + Math.abs(v - sig[j][k]), 0) / sig[i].length;
        expect(d, `${LOOKS[i].id} vs ${LOOKS[j].id}`).toBeGreaterThan(0.008);
      }
    }
  });

  it('an empty recipe is the identity', () => {
    const f = gradeFunction({});
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.6, 0.9], [0.8, 0.3, 0.1]] as const) {
      const out = f(c[0], c[1], c[2]);
      out.forEach((v, i) => expect(v).toBeCloseTo(c[i], 3));
    }
  });

  it('black & white looks give neutral greys (except toned prints)', () => {
    for (const look of LOOKS.filter((l) => l.recipe.mono && !l.recipe.mono.tone)) {
      const [r, g, b] = gradeFunction(look.recipe)(0.8, 0.3, 0.2);
      expect(Math.abs(r - g) + Math.abs(g - b), look.id).toBeLessThan(1e-6);
    }
    const sepia = LOOKS.find((l) => l.id === 'bw-sepia')!;
    const [r, , b] = gradeFunction(sepia.recipe)(0.5, 0.5, 0.5);
    expect(r).toBeGreaterThan(b);
  });

  it('warm looks warm and cool looks cool a neutral grey', () => {
    const grey = (id: string) => gradeFunction(LOOKS.find((l) => l.id === id)!.recipe)(0.5, 0.5, 0.5);
    const warm = grey('food-golden-bakery');
    const cool = grey('night-midnight-blue');
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });

  it('monotone curves never overshoot their points', () => {
    const f = monotoneCurve([[0, 0], [0.2, 0.1], [0.5, 0.5], [0.8, 0.95], [1, 1]]);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.01) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
  });

  it('the Color Lookup presets come from the library and round-trip through .cube', () => {
    expect(BUILTIN_LUTS.length).toBe(LOOKS.length);
    const data = getBuiltinLutData('cine-teal-orange')!;
    expect(data.size).toBe(33);
    const lut = { size: data.size, data: decodeLut(data.data, data.size) };
    const back = parseCube(writeCube(lut, 'Teal & Orange'));
    expect(back.size).toBe(33);
    expect(Math.abs(back.data[1000] - lut.data[1000])).toBeLessThan(1e-3);
  });
});

describe('Match Look', () => {
  const image = (r: number, g: number, b: number, n = 64) => {
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      // A little spread so the statistics have a variance
      const k = (i % 8) * 6 - 21;
      px.set([r + k, g + k, b + k, 255], i * 4);
    }
    return px;
  };

  it('moves the average colour toward the reference', () => {
    const src = image(90, 120, 170);
    const ref = image(200, 140, 80);
    const lut = matchLookLut(colorStats(src), colorStats(ref), 1, 17);
    const out = src.slice();
    applyLutToPixels(out, lut);
    const mean = (px: Uint8ClampedArray, c: number) => { let s = 0; for (let i = c; i < px.length; i += 4) s += px[i]; return s / (px.length / 4); };
    expect(mean(out, 0)).toBeGreaterThan(mean(src, 0) + 50);
    expect(mean(out, 2)).toBeLessThan(mean(src, 2) - 50);
    expect(Math.abs(mean(out, 0) - mean(ref, 0))).toBeLessThan(25);
  });

  it('strength 0 leaves colours alone', () => {
    const lut = matchLookLut(colorStats(image(90, 120, 170)), colorStats(image(200, 140, 80)), 0, 9);
    const [r, g, b] = sampleLut(lut, 0.3, 0.5, 0.7);
    expect(r).toBeCloseTo(0.3, 2);
    expect(g).toBeCloseTo(0.5, 2);
    expect(b).toBeCloseTo(0.7, 2);
  });
});
