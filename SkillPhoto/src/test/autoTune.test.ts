import { describe, expect, it } from 'vitest';
import { analyze, autoColor, autoContrast, autoTone, smartTune, wbFor, neutralize, INTENTS, scaleCurve } from '../core/autoTune';
import type { Intent } from '../core/autoTune';
import { wbMultipliers } from '../core/gl';
import { curveLut } from '../core/curves';

/** Synthetic photo: grey ramp + colour patches, with a cast and a tonal squeeze applied. */
function photo(cast: [number, number, number], lo = 40, hi = 200) {
  const w = 256, h = 64;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c: number[] = [x, x, x];
      if (y >= 48) c = x < 64 ? [200, 60, 50] : x < 128 ? [60, 160, 70] : x < 192 ? [50, 80, 190] : [230, 200, 60];
      for (let k = 0; k < 3; k++) d[i + k] = lo + (c[k] / 255) * (hi - lo) * cast[k];
      d[i + 3] = 255;
    }
  return d;
}

const apply = (c: { x: number; y: number }[], v: number) => curveLut(c)[Math.round(v)];

describe('auto tune', () => {
  it('measures clip points, median and the neutral cast', () => {
    const s = analyze(photo([1.1, 1, 0.8]));
    expect(s.lo).toBeGreaterThanOrEqual(38);
    expect(s.hi).toBeLessThanOrEqual(225);
    expect(s.neutral[0]).toBeGreaterThan(s.neutral[2] + 15);
  });

  it('white balance from a sample makes that sample neutral through the real engine maths', () => {
    // Mild casts: the sliders alone are exact
    for (const sample of [[170, 160, 145], [140, 145, 165], [150, 140, 150]] as [number, number, number][]) {
      const { temperature, tint } = wbFor(sample);
      const m = wbMultipliers(temperature, tint);
      const out = sample.map((v, k) => Math.pow(Math.pow(v / 255, 2.2) * m[k], 1 / 2.2) * 255);
      expect(Math.max(...out) - Math.min(...out)).toBeLessThan(2);
    }
    // Strong casts (tungsten, shade): sliders to their limit, curves take the rest
    for (const sample of [[200, 160, 120], [120, 140, 190], [90, 110, 80]] as [number, number, number][]) {
      const a = neutralize(sample);
      const m = wbMultipliers(a.temperature!, a.tint!);
      let out = sample.map((v, k) => Math.pow(Math.pow(v / 255, 2.2) * m[k], 1 / 2.2) * 255);
      if (a.curves) out = [apply(a.curves.r, out[0]), apply(a.curves.g, out[1]), apply(a.curves.b, out[2])];
      expect(Math.max(...out) - Math.min(...out)).toBeLessThan(3);
    }
  });

  it('Auto Contrast stretches luminance to the full range', () => {
    const s = analyze(photo([1, 1, 1]));
    const c = autoContrast(s).curves!.rgb;
    expect(apply(c, s.lo)).toBeLessThanOrEqual(2);
    expect(apply(c, s.hi)).toBeGreaterThanOrEqual(253);
  });

  it('Auto Tone stretches each channel, Auto Color also neutralises the midtones', () => {
    const s = analyze(photo([1.15, 1, 0.75]));
    const t = autoTone(s).curves!;
    expect(apply(t.b, s.chHi[2])).toBeGreaterThanOrEqual(253);
    const c = autoColor(s).curves!;
    const n = s.neutral;
    const out = [apply(c.r, n[0]), apply(c.g, n[1]), apply(c.b, n[2])];
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(6);
  });

  it('every intent gives a different, bounded recipe; strength 0 changes nothing', () => {
    const s = analyze(photo([1.05, 1, 0.9], 20, 150));
    const seen = new Set<string>();
    for (const id of Object.keys(INTENTS) as Intent[]) {
      const r = smartTune(s, id, 1);
      seen.add(JSON.stringify(r));
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') expect(Math.abs(v), k).toBeLessThanOrEqual(100);
      // squeezed tonal range → levels stretch it
      expect(r.levels!.inWhite).toBeLessThanOrEqual(200);
      const z = smartTune(s, id, 0);
      for (const [k, v] of Object.entries(z)) if (typeof v === 'number') expect(Math.abs(v), `${id}.${k}`).toBe(0);
      expect(z.levels).toEqual({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
    }
    expect(seen.size).toBe(Object.keys(INTENTS).length);
    // Food is warmer than Product on the same photo
    expect(smartTune(s, 'food').temperature!).toBeGreaterThan(smartTune(s, 'product').temperature!);
  });

  it('scaleCurve moves points toward identity', () => {
    expect(scaleCurve([{ x: 100, y: 200 }], 0.5)).toEqual([{ x: 100, y: 150 }]);
  });
});
