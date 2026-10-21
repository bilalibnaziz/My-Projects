import { describe, expect, it } from 'vitest';
import { colorAt, joinAlpha, splitAlpha } from '../core/gradientStops';

describe('gradient stop colours', () => {
  it('splits and joins alpha', () => {
    expect(splitAlpha('#FF8000')).toEqual({ hex: '#ff8000', a: 1 });
    expect(splitAlpha('#f80')).toEqual({ hex: '#ff8800', a: 1 });
    expect(splitAlpha('#ff800080').a).toBeCloseTo(128 / 255, 6);
    expect(joinAlpha('#ff8000', 1)).toBe('#ff8000');
    expect(joinAlpha('#ff8000', 0.5)).toBe('#ff800080');
    expect(joinAlpha('#ff8000', 0)).toBe('#ff800000');
  });

  it('interpolates colour and alpha between stops', () => {
    const stops = [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff00' }];
    expect(colorAt(stops, 0.5)).toBe('#80808080');
    expect(colorAt(stops, -1)).toBe('#000000');
    expect(colorAt([{ offset: 1, color: '#ff0000' }, { offset: 0, color: '#0000ff' }], 0.25)).toBe('#4000bf');
  });
});
