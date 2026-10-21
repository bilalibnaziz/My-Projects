import { describe, expect, it } from 'vitest';
import { PATTERN_PRESETS, defaultPattern, patternPrims, patternSvg } from '../core/patterns';

const n = (v: number) => String(Math.round(v * 100) / 100);

describe('pattern fills', () => {
  it('every preset has a motif inside its tile (or wrapping across its edges)', () => {
    for (const { id } of PATTERN_PRESETS) {
      const prims = patternPrims({ preset: id, size: 20, weight: 0.5 });
      expect(prims.length, id).toBeGreaterThan(0);
    }
  });

  it('weight scales the motif', () => {
    const small = patternPrims({ preset: 'dots', size: 20, weight: 0.2 })[0] as { r: number };
    const big = patternPrims({ preset: 'dots', size: 20, weight: 0.8 })[0] as { r: number };
    expect(big.r).toBeCloseTo(small.r * 4, 6);
    const stripe = patternPrims({ preset: 'stripes', size: 20, weight: 1 })[0] as { h: number };
    expect(stripe.h).toBe(10);
  });

  it('exports an SVG pattern in document units, offset to the box and rotated', () => {
    const svg = patternSvg('pat1', { ...defaultPattern('#ff0000', '#ffffff'), angle: 45 }, 100, 50, n);
    expect(svg).toContain('<pattern id="pat1" patternUnits="userSpaceOnUse" width="24" height="24" patternTransform="translate(100 50) rotate(45)">');
    expect(svg).toContain('<rect width="24" height="24" fill="#ffffff"/>');
    expect(svg).toContain('<g fill="#ff0000">');
    // 9 copies (the tile and its 8 neighbours) so motifs crossing an edge tile seamlessly
    expect(svg.match(/<circle/g)).toHaveLength(9);
  });
});
