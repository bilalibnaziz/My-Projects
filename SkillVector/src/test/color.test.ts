import { describe, it, expect } from 'vitest';
import { cmykToRgb, contrastGrade, contrastRatio, deltaE, harmony, hexToRgb, hsbToRgb, labToRgb, outOfGamut, proofRgb, rgbToCmyk, rgbToHex, rgbToHsb, rgbToLab } from '../core/color';
import type { RGB } from '../core/color';

const close = (a: number[], b: number[], tol = 1) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(tol));

describe('color conversions', () => {
  const samples: RGB[] = [[255, 0, 0], [12, 200, 90], [128, 128, 128], [250, 240, 10], [3, 7, 200]];
  it('round-trip HSB, Lab and CMYK', () => {
    for (const c of samples) {
      close(hsbToRgb(...rgbToHsb(c)), c);
      close(labToRgb(rgbToLab(c)), c);
      close(cmykToRgb(...rgbToCmyk(c)), c);
      expect(rgbToHex(hexToRgb(rgbToHex(c)))).toBe(rgbToHex(c));
    }
  });
  it('Lab of white and black', () => {
    close(rgbToLab([255, 255, 255]), [100, 0, 0], 0.5);
    close(rgbToLab([0, 0, 0]), [0, 0, 0], 0.5);
  });
});

describe('print simulation', () => {
  it('paper white stays white; neutrals barely move', () => {
    close(proofRgb([255, 255, 255]), [255, 255, 255]);
    expect(deltaE([128, 128, 128], proofRgb([128, 128, 128]))).toBeLessThan(12);
    expect(outOfGamut([128, 128, 128])).toBe(false);
  });
  it('screen-only colours (pure RGB green / blue) are flagged and come out duller', () => {
    expect(outOfGamut([0, 255, 0])).toBe(true);
    expect(outOfGamut([0, 0, 255])).toBe(true);
    const p = proofRgb([0, 255, 0]);
    expect(p[1]).toBeLessThan(200);
  });
});

describe('harmonies and contrast', () => {
  it('builds five-colour palettes starting from the base colour', () => {
    for (const k of ['complementary', 'analogous', 'triadic', 'split', 'tetradic'] as const) {
      const pal = harmony('#3366ff', k);
      expect(pal).toHaveLength(5);
      expect(pal[0]).toBe('#3366ff');
    }
    // Complement of blue-ish is orange-ish
    const comp = hexToRgb(harmony('#3366ff', 'complementary')[2]);
    expect(comp[0]).toBeGreaterThan(comp[2]);
  });
  it('WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastGrade(contrastRatio('#777777', '#ffffff'))).toBe('AA Large');
    expect(contrastGrade(contrastRatio('#ffffff', '#ffffff'))).toBe('Fail');
  });
});

describe('colour-managed proofing', () => {
  it('in-gamut colours proof as themselves; the snapped colour is printable', () => {
    for (const c of [[200, 120, 90], [90, 120, 150], [128, 128, 128], [230, 200, 160]] as RGB[]) expect(deltaE(c, proofRgb(c))).toBeLessThan(3);
    const snapped = proofRgb([0, 255, 0]);
    expect(outOfGamut(snapped)).toBe(false);
    expect(deltaE(snapped, proofRgb(snapped))).toBeLessThan(3);
  });
});
