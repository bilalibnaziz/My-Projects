import { describe, expect, it } from 'vitest';
import { makeLayer } from '../core/types';
import type { Layer } from '../core/types';
import { offsetPathLayer, roundAnchors } from '../core/pathOps';
import { collectColors, paletteMap, recolorLayer, shiftedMap, shuffledMap } from '../core/recolor';
import { randomized } from '../core/transformAgain';

const rect = (x: number, y: number, w: number, h: number, extra: Partial<Layer['shape']> = {}) =>
  makeLayer({ kind: 'shape', name: 'R', x, y, width: w, height: h, shape: { shape: 'rectangle', fill: '#ff0000', fillEnabled: true, stroke: '#0000ff', strokeWidth: 2, radius: 0, ...extra } });
const corner = (x: number, y: number) => ({ x, y, ix: x, iy: y, ox: x, oy: y });

describe('Offset Path', () => {
  it('grows a rectangle by the offset on every side', () => {
    const o = offsetPathLayer(rect(100, 100, 200, 100), 10)!;
    expect(o.x).toBeCloseTo(90, 4);
    expect(o.y).toBeCloseTo(90, 4);
    expect(o.width).toBeCloseTo(220, 4);
    expect(o.height).toBeCloseTo(120, 4);
    expect(o.shape!.fill).toBe('#ff0000');
  });

  it('insets with a negative offset, and gives nothing when the inset is too big', () => {
    const o = offsetPathLayer(rect(0, 0, 100, 60), -10)!;
    expect(o.width).toBeCloseTo(80, 4);
    expect(o.height).toBeCloseTo(40, 4);
    expect(offsetPathLayer(rect(0, 0, 100, 60), -40)).toBeNull();
  });
});

describe('Round Corners', () => {
  it('replaces each corner of a square with an arc pair', () => {
    const sq = [corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)];
    const r = roundAnchors(sq, true, 20);
    expect(r).toHaveLength(8);
    // First corner: points 20 px along each side, handles towards the corner
    expect([r[0].x, r[0].y]).toEqual([0, 20]);
    expect([r[1].x, r[1].y]).toEqual([20, 0]);
    expect(r[0].oy).toBeLessThan(20);
  });

  it('caps the radius at half the shorter side and keeps open path ends', () => {
    const r = roundAnchors([corner(0, 0), corner(10, 0), corner(10, 100)], false, 50);
    expect(r).toHaveLength(4);
    expect([r[0].x, r[0].y]).toEqual([0, 0]);
    expect(r[1].x).toBeCloseTo(5, 6);
    expect(r[3].y).toBe(100);
  });
});

describe('Recolor Artwork', () => {
  const l = rect(0, 0, 10, 10, { gradient: undefined });
  const t = makeLayer({ kind: 'text', name: 'T', text: { text: 'Hi', font: 'Inter', size: 12, weight: 400, italic: false, color: '#00ff0080', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000000' } });

  it('collects fills, strokes and text colours (most used first)', () => {
    const c = collectColors([l, rect(0, 0, 5, 5), t]);
    expect(c[0]).toEqual({ hex: '#ff0000', count: 2 });
    expect(c.map((x) => x.hex)).toContain('#00ff00');
    expect(c.map((x) => x.hex)).toContain('#0000ff');
  });

  it('swaps through the map and keeps alpha', () => {
    const r = recolorLayer(t, { '#00ff00': '#123456' });
    expect(r.text!.color).toBe('#12345680');
    expect(recolorLayer(l, { '#ff0000': '#00aa00' }).shape!.fill).toBe('#00aa00');
  });

  it('hue shift, palette by lightness, shuffle', () => {
    expect(shiftedMap(['#ff0000'], 120)['#ff0000']).toBe('#00ff00');
    const m = paletteMap(['#111111', '#eeeeee'], ['#ffff00', '#000080']);
    expect(m['#111111']).toBe('#000080');
    expect(m['#eeeeee']).toBe('#ffff00');
    const sh = shuffledMap(['#a00000', '#00b000'], {}, () => 0);
    expect(Object.values(sh).sort()).toEqual(['#00b000', '#a00000']);
  });
});

describe('Transform Each random', () => {
  it('scales every value by the random amount', () => {
    expect(randomized({ dx: 10, dy: 20, sx: 2, sy: 0.5, rot: 90, copy: false }, () => 0.5)).toMatchObject({ dx: 5, dy: 10, sx: 1.5, sy: 0.75, rot: 45 });
  });
});
