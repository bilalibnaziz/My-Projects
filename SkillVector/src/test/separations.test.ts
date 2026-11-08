import { describe, expect, it } from 'vitest';
import { mixInk } from '../core/separations';

/** Plates (C, M, Y, K) after stacking layers bottom → top. */
const stack = (layers: { ink: number[]; a: number; overprint: boolean }[]) => {
  const p = [0, 0, 0, 0];
  for (const l of layers) for (let c = 0; c < 4; c++) p[c] = mixInk(p[c], l.ink[c], l.a, l.overprint);
  return p;
};

describe('ink separations: knockout vs overprint', () => {
  it('100 % yellow overprinting 100 % cyan keeps both inks (green on press)', () => {
    expect(stack([{ ink: [1, 0, 0, 0], a: 1, overprint: false }, { ink: [0, 0, 1, 0], a: 1, overprint: true }])).toEqual([1, 0, 1, 0]);
  });
  it('the same yellow knocking out removes the cyan underneath', () => {
    expect(stack([{ ink: [1, 0, 0, 0], a: 1, overprint: false }, { ink: [0, 0, 1, 0], a: 1, overprint: false }])).toEqual([0, 0, 1, 0]);
  });
  it('overprint with OPM 1: an ink the object does use still replaces the one below', () => {
    expect(stack([{ ink: [0.8, 0.3, 0, 0], a: 1, overprint: false }, { ink: [0, 0.6, 0, 0], a: 1, overprint: true }])).toEqual([0.8, 0.6, 0, 0]);
  });
  it('partial coverage (anti-aliased edge, 50 %) blends by coverage when knocking out', () => {
    const p = stack([{ ink: [1, 0, 0, 0], a: 1, overprint: false }, { ink: [0, 0, 1, 0], a: 0.5, overprint: false }]);
    expect(p[0]).toBeCloseTo(0.5, 6);
    expect(p[2]).toBeCloseTo(0.5, 6);
  });
  it('black text overprinting a colour panel (the classic case) keeps the panel under the text', () => {
    expect(stack([{ ink: [0, 0.96, 0.58, 0], a: 1, overprint: false }, { ink: [0, 0, 0, 1], a: 1, overprint: true }])).toEqual([0, 0.96, 0.58, 1]);
  });
});
