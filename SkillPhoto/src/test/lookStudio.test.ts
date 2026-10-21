import { describe, expect, it } from 'vitest';
import { composeLut, isNeutral, photoProfile, pickLooks, suggestCategories, TWEAK_SLIDERS } from '../core/lookStudio';
import { bakeLook, gradeFunction, lookById, sampleLut } from '../core/looks';

const px = (rgb: [number, number, number], n = 100) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4);
  return a;
};

describe('look studio', () => {
  it('an empty tweak over no base is the identity LUT', () => {
    const l = composeLut(null, {}, 17);
    for (const [r, g, b] of [[0, 0, 0], [0.25, 0.5, 0.75], [1, 1, 1]] as const) {
      const o = sampleLut(l, r, g, b);
      expect(o[0]).toBeCloseTo(r, 3); expect(o[1]).toBeCloseTo(g, 3); expect(o[2]).toBeCloseTo(b, 3);
    }
  });

  it('composes the tweak after the base look', () => {
    const base = bakeLook(lookById('food-golden-bakery')!.recipe, 25);
    const tweak = { temp: -0.3 };
    const out = composeLut(base, tweak, 25);
    const f = gradeFunction(tweak);
    for (const [r, g, b] of [[0.2, 0.4, 0.6], [0.8, 0.5, 0.3]] as const) {
      const want = f(...sampleLut(base, r, g, b));
      const got = sampleLut(out, r, g, b);
      // Trilinear sampling of the composed LUT vs exact composition: within a LUT step
      got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(0.02));
    }
  });

  it('sliders round-trip and zero means neutral', () => {
    let r = {};
    for (const s of TWEAK_SLIDERS) {
      const v = s.hue ? 120 : Math.round(s.max * 0.4);
      r = s.set(r, v);
      expect(s.get(r)).toBe(v);
    }
    expect(isNeutral(r)).toBe(false);
    for (const s of TWEAK_SLIDERS) if (!s.hue) r = s.set(r, 0);
    expect(isNeutral(r)).toBe(true);
    // Warmth really warms: red up, blue down on a grey
    const warm = TWEAK_SLIDERS.find((s) => s.id === 'temp')!.set({}, 80);
    const [R, , B] = gradeFunction(warm)(0.5, 0.5, 0.5);
    expect(R).toBeGreaterThan(0.52);
    expect(B).toBeLessThan(0.48);
  });

  it('suggests food looks for warm photos, landscape for green / sky, night for dark', () => {
    const food = photoProfile(new Uint8ClampedArray([...px([200, 110, 50], 80), ...px([235, 225, 210], 20)]));
    expect(suggestCategories(food)[0].category).toBe('Food');
    expect(pickLooks(food, 6).filter((p) => p.look.category === 'Food').length).toBeGreaterThanOrEqual(3);
    const land = photoProfile(new Uint8ClampedArray([...px([60, 140, 60], 50), ...px([90, 150, 220], 50)]));
    expect(suggestCategories(land)[0].category).toBe('Landscape');
    const face = photoProfile(new Uint8ClampedArray([...px([224, 172, 140], 60), ...px([40, 40, 45], 40)]));
    expect(suggestCategories(face)[0].category).toBe('Portrait');
    const night = photoProfile(px([20, 20, 35]));
    expect(suggestCategories(night)[0].category).toBe('Night');
    expect(pickLooks(night, 8)).toHaveLength(8);
  });
});
