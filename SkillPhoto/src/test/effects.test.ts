import { describe, it, expect } from 'vitest';
import { computeFx, edt, fxPad, hexRgb } from '../core/effects';
import { defaultFx, fullFx, hasFx, makeLayer } from '../core/types';
import type { LayerFx } from '../core/types';
import { STYLE_PRESETS, presetFx } from '../core/layerStyle';

/** A w×h RGBA image with an opaque red square at [x0, x1) × [y0, y1). */
function square(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      d[i] = 255;
      d[i + 3] = 255;
    }
  return d;
}

function fxWith(patch: Partial<{ [K in keyof LayerFx]: Partial<LayerFx[K]> }>): LayerFx {
  const fx = defaultFx() as unknown as Record<string, object>;
  for (const [k, v] of Object.entries(patch)) fx[k] = { ...fx[k], ...v };
  return fx as unknown as LayerFx;
}

const px = (buf: Uint8ClampedArray, W: number, x: number, y: number) => Array.from(buf.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

describe('distance transform', () => {
  it('is exact Euclidean distance to the nearest target pixel', () => {
    const w = 9;
    const h = 7;
    const t = new Uint8Array(w * h);
    t[3 * w + 4] = 1;
    const d = edt(t, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(d[y * w + x]).toBeCloseTo(Math.hypot(x - 4, y - 3), 5);
  });
});

describe('layer styles', () => {
  it('no effects: the front is the layer itself and nothing is behind', () => {
    const src = square(10, 10, 2, 2, 8, 8);
    const r = computeFx(src, 10, 10, defaultFx());
    const p = r.pad;
    expect(px(r.front, r.width, 5 + p, 5 + p)).toEqual([255, 0, 0, 255]);
    expect(px(r.front, r.width, 0, 0)[3]).toBe(0);
    expect(r.behind.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });

  it('outside stroke covers exactly `size` pixels around the shape and nothing inside', () => {
    const src = square(20, 20, 6, 6, 14, 14);
    const r = computeFx(src, 20, 20, fxWith({ stroke: { enabled: true, size: 3, color: '#00ff00', position: 'outside' } }));
    const p = r.pad;
    // 1..3 px left of the edge: solid green; 5 px away: nothing
    for (const dx of [1, 2, 3]) expect(px(r.front, r.width, 6 + p - dx, 10 + p)).toEqual([0, 255, 0, 255]);
    expect(px(r.front, r.width, 6 + p - 5, 10 + p)[3]).toBe(0);
    // Inside stays red
    expect(px(r.front, r.width, 10 + p, 10 + p)).toEqual([255, 0, 0, 255]);
  });

  it('inside stroke stays within the shape', () => {
    const src = square(20, 20, 4, 4, 16, 16);
    const r = computeFx(src, 20, 20, fxWith({ stroke: { enabled: true, size: 2, color: '#0000ff', position: 'inside' } }));
    const p = r.pad;
    expect(px(r.front, r.width, 4 + p, 10 + p)).toEqual([0, 0, 255, 255]);
    expect(px(r.front, r.width, 5 + p, 10 + p)).toEqual([0, 0, 255, 255]);
    expect(px(r.front, r.width, 8 + p, 10 + p)).toEqual([255, 0, 0, 255]);
    expect(px(r.front, r.width, 3 + p, 10 + p)[3]).toBe(0);
  });

  it('drop shadow falls away from the light and is knocked out under the layer', () => {
    const src = square(30, 30, 10, 10, 20, 20);
    // Light from the left (180°) → shadow shifts right
    const r = computeFx(src, 30, 30, fxWith({ dropShadow: { enabled: true, opacity: 100, angle: 180, distance: 6, size: 0, color: '#000000' } }));
    const p = r.pad;
    expect(px(r.behind, r.width, 24 + p, 15 + p)).toEqual([0, 0, 0, 255]);
    expect(px(r.behind, r.width, 8 + p, 15 + p)[3]).toBe(0);
    expect(px(r.behind, r.width, 15 + p, 15 + p)[3]).toBe(0); // knocked out under the layer
    expect(r.pad).toBeGreaterThanOrEqual(6);
  });

  it('fill opacity fades the pixels but not the effects', () => {
    const src = square(20, 20, 5, 5, 15, 15);
    const r = computeFx(src, 20, 20, fxWith({ stroke: { enabled: true, size: 2, color: '#ffffff' } }), 0);
    const p = r.pad;
    expect(px(r.front, r.width, 10 + p, 10 + p)[3]).toBe(0);
    expect(px(r.front, r.width, 4 + p, 10 + p)).toEqual([255, 255, 255, 255]);
  });

  it('color overlay recolors the shape at full strength', () => {
    const src = square(10, 10, 2, 2, 8, 8);
    const r = computeFx(src, 10, 10, fxWith({ colorOverlay: { enabled: true, color: '#00ffff', opacity: 100 } }));
    expect(px(r.front, r.width, 5 + r.pad, 5 + r.pad)).toEqual([0, 255, 255, 255]);
  });

  it('gradient overlay runs from the start color at the bottom to the end color at the top (90°)', () => {
    const src = square(10, 40, 0, 0, 10, 40);
    const r = computeFx(src, 10, 40, fxWith({ gradientOverlay: { enabled: true, from: '#000000', to: '#ffffff', angle: 90, opacity: 100 } }));
    const top = px(r.front, r.width, 5 + r.pad, r.pad)[0];
    const bottom = px(r.front, r.width, 5 + r.pad, 39 + r.pad)[0];
    expect(top).toBeGreaterThan(240);
    expect(bottom).toBeLessThan(15);
  });

  it('bevel lights the edge facing the light and shades the opposite one', () => {
    const src = square(40, 40, 8, 8, 32, 32);
    const r = computeFx(src, 40, 40, fxWith({ bevel: { enabled: true, size: 6, angle: 120, altitude: 30, opacity: 100 } }));
    const p = r.pad;
    const topLeft = px(r.front, r.width, 10 + p, 10 + p);
    const bottomRight = px(r.front, r.width, 29 + p, 29 + p);
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    expect(lum(topLeft)).toBeGreaterThan(lum(bottomRight));
  });

  it('padding covers outward effects only', () => {
    expect(fxPad(defaultFx())).toBe(2);
    expect(fxPad(fxWith({ outerGlow: { enabled: true, size: 20 } }))).toBeGreaterThanOrEqual(26);
    expect(fxPad(fxWith({ stroke: { enabled: true, size: 10, position: 'inside' } }))).toBe(2);
  });

  it('hasFx / fullFx handle missing and partial styles', () => {
    expect(hasFx(makeLayer({ kind: 'raster', name: 'a' }))).toBe(false);
    expect(hasFx(makeLayer({ kind: 'raster', name: 'a', fx: fxWith({ stroke: { enabled: true } }) }))).toBe(true);
    const f = fullFx({ stroke: { enabled: true } } as unknown as LayerFx);
    expect(f.stroke.size).toBe(defaultFx().stroke.size);
    expect(f.dropShadow.enabled).toBe(false);
  });

  it('every preset enables at least one effect and computes', () => {
    const src = square(16, 16, 4, 4, 12, 12);
    for (const p of STYLE_PRESETS) {
      const fx = presetFx(p);
      expect(Object.values(fx).some((e) => e.enabled)).toBe(true);
      expect(() => computeFx(src, 16, 16, fx, p.fill ?? 1)).not.toThrow();
    }
  });

  it('parses hex colors', () => {
    expect(hexRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexRgb('#0f0')).toEqual([0, 255, 0]);
  });
});
