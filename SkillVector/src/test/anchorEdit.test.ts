import { describe, expect, it } from 'vitest';
import type { PathAnchor } from '../core/types';
import { anchorKind, smoothAnchor } from '../core/anchorEdit';

const c = (x: number, y: number): PathAnchor => ({ x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' });

describe('anchor kinds', () => {
  it('classifies corner, smooth, symmetric and broken handles', () => {
    expect(anchorKind(c(0, 0))).toBe('corner');
    expect(anchorKind({ ...c(0, 0), ix: -10, ox: 10 })).toBe('symmetric');
    expect(anchorKind({ ...c(0, 0), ix: -5, ox: 10 })).toBe('smooth');
    expect(anchorKind({ ...c(0, 0), ix: -5, oy: 10 })).toBe('cusp');
    expect(anchorKind({ ...c(0, 0), ox: 10 })).toBe('cusp');
  });
});

describe('smoothAnchor', () => {
  // A square: (0,0) (90,0) (90,90) (0,90)
  const sq = [c(0, 0), c(90, 0), c(90, 90), c(0, 90)];
  it('turns a corner into handles along prev → next, a third of each neighbour distance', () => {
    const a = smoothAnchor(sq, 1, true, false);
    // prev (0,0) → next (90,90): direction (1,1)/√2, lengths 30 each
    const k = 30 / Math.SQRT2;
    expect(a.ix).toBeCloseTo(90 - k, 6);
    expect(a.iy).toBeCloseTo(-k, 6);
    expect(a.ox).toBeCloseTo(90 + k, 6);
    expect(a.oy).toBeCloseTo(k, 6);
    expect(anchorKind(a)).toBe('symmetric');
  });

  it('keeps handle lengths when straightening broken handles; symmetric evens them', () => {
    const p = [c(0, 0), { ...c(50, 0), ix: 40, iy: -10, ox: 70, oy: 0 }, c(100, 0)];
    const sm = smoothAnchor(p, 1, false, false);
    expect(anchorKind(sm)).toBe('smooth');
    expect(Math.hypot(sm.ix - 50, sm.iy)).toBeCloseTo(Math.hypot(10, 10), 6);
    expect(Math.hypot(sm.ox - 50, sm.oy)).toBeCloseTo(20, 6);
    const sy = smoothAnchor(p, 1, false, true);
    expect(anchorKind(sy)).toBe('symmetric');
  });

  it('open path ends point along their one neighbour', () => {
    const p = [c(0, 0), c(60, 0)];
    const a = smoothAnchor(p, 0, false, false);
    expect(a.ox).toBeCloseTo(20, 6);
    expect(a.ix).toBeCloseTo(0, 6);
  });
});
