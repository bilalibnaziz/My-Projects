import { describe, it, expect } from 'vitest';
import { blendChannel, isCustomBlend } from '../core/blend';
import { BLEND_MODES } from '../core/types';

describe('custom blend modes', () => {
  it('match the Photoshop formulas', () => {
    expect(blendChannel('linear-burn', 0.6, 0.7)).toBeCloseTo(0.3);
    expect(blendChannel('linear-burn', 0.2, 0.3)).toBe(0);
    expect(blendChannel('linear-light', 0.5, 0.75)).toBeCloseTo(1);
    expect(blendChannel('linear-light', 0.5, 0.5)).toBeCloseTo(0.5);
    expect(blendChannel('pin-light', 0.8, 0.2)).toBeCloseTo(0.4);
    expect(blendChannel('pin-light', 0.2, 0.8)).toBeCloseTo(0.6);
    expect(blendChannel('hard-mix', 0.6, 0.5)).toBe(1);
    expect(blendChannel('hard-mix', 0.4, 0.5)).toBe(0);
    expect(blendChannel('subtract', 0.8, 0.3)).toBeCloseTo(0.5);
    expect(blendChannel('divide', 0.4, 0.8)).toBeCloseTo(0.5);
    expect(blendChannel('vivid-light', 0.5, 0.5)).toBeCloseTo(0.5);
  });
  it('the menu lists all 27 Photoshop modes and only non-native ones use the custom path', () => {
    expect(BLEND_MODES).toHaveLength(27);
    expect(new Set(BLEND_MODES.map((b) => b.id)).size).toBe(27);
    expect(BLEND_MODES.filter((b) => isCustomBlend(b.id)).map((b) => b.id).sort()).toEqual(
      ['darker-color', 'divide', 'dissolve', 'hard-mix', 'lighter-color', 'linear-burn', 'linear-light', 'pin-light', 'subtract', 'vivid-light'].sort()
    );
  });
});
