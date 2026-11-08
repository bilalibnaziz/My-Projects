import { describe, expect, it } from 'vitest';
import { cssInterpolation, mixColor, renderStops } from '../core/gradientMethod';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// OKLab lightness of an sRGB colour (reference formula)
const lightness = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
};

describe('gradient blend methods', () => {
  it('Classic mixes the sRGB numbers (red → green goes through a dark olive)', () => {
    expect(mixColor('#ff0000', '#00ff00', 0.5, 'classic')).toBe('#808000');
  });

  it('Linear light mixes light itself (a brighter middle)', () => {
    expect(mixColor('#ff0000', '#00ff00', 0.5, 'linear')).toBe('#bcbc00');
  });

  it('Perceptual steps evenly in lightness and keeps a vivid middle', () => {
    const mid = mixColor('#ff0000', '#00ff00', 0.5, 'perceptual');
    expect(lightness(mid)).toBeCloseTo((lightness('#ff0000') + lightness('#00ff00')) / 2, 2);
    const sum = (h: string) => rgb(h).reduce((a, v) => a + v, 0);
    expect(sum(mid)).toBeGreaterThan(sum('#808000') + 60);
  });

  it('every method keeps a colour as it is, ends on the end colours, and blends alpha straight', () => {
    for (const m of ['classic', 'perceptual', 'linear'] as const) {
      expect(mixColor('#3366cc', '#3366cc', 0.37, m)).toBe('#3366cc');
      expect(mixColor('#123456', '#fedcba', 0, m)).toBe('#123456');
      expect(mixColor('#123456', '#fedcba', 1, m)).toBe('#fedcba');
    }
    expect(mixColor('#00000000', '#000000ff', 0.5, 'perceptual')).toBe('#00000080');
  });

  it('renders as dense Classic stops (unchanged for Classic)', () => {
    const stops = [
      { offset: 1, color: '#00ff00' },
      { offset: 0, color: '#ff0000' },
    ];
    expect(renderStops(stops, 'classic').map((s) => s.offset)).toEqual([0, 1]);
    const dense = renderStops(stops, 'perceptual', 16);
    expect(dense).toHaveLength(17);
    expect(dense[0].color).toBe('#ff0000');
    expect(dense[16].color).toBe('#00ff00');
    expect(dense.every((s, i) => i === 0 || s.offset > dense[i - 1].offset)).toBe(true);
    expect(dense[8].color).toBe(mixColor('#ff0000', '#00ff00', 0.5, 'perceptual'));
  });

  it('CSS uses the matching interpolation space', () => {
    expect(cssInterpolation('perceptual')).toBe('in oklab ');
    expect(cssInterpolation('linear')).toBe('in srgb-linear ');
    expect(cssInterpolation(undefined)).toBe('');
  });
});
