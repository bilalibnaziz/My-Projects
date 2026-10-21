import { describe, it, expect } from 'vitest';
import { curveLut, levelsLut, toneLut } from '../core/curves';
import { defaultAdjust, makeLayer, withLayer } from '../core/types';
import { floodMask, rectFromPoints } from '../core/selection';
import { blurChannel, intersectRect, unionRect } from '../core/canvas';
import { tipAlpha, Stabilizer } from '../core/brush';
import { inpaint } from '../core/inpaint';
import { isIdentityAdjust } from '../core/gl';
import { FILTERS, defaultParams } from '../core/filters';
import { snapMove, snapTargets } from '../core/snap';


// jsdom has no ImageData; a minimal stand-in is enough for the pure filter math
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as Record<string, unknown>).ImageData = class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  };
}

describe('curves & levels', () => {
  it('identity curve is identity', () => {
    const lut = curveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });
  it('curve passes through control points and stays monotone', () => {
    const lut = curveLut([{ x: 0, y: 0 }, { x: 64, y: 100 }, { x: 255, y: 255 }]);
    expect(lut[64]).toBe(100);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });
  it('levels clip black and white points', () => {
    const lut = levelsLut({ inBlack: 20, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 });
    expect(lut[10]).toBe(0);
    expect(lut[20]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[250]).toBe(255);
  });
  it('tone LUT combines channels', () => {
    const a = defaultAdjust();
    a.curves.r = [{ x: 0, y: 255 }, { x: 255, y: 0 }]; // invert red
    const lut = toneLut(a);
    expect(lut[0]).toBe(255);
    expect(lut[1]).toBe(0); // green untouched at 0
    expect(lut[255 * 4]).toBe(0);
  });
});

describe('adjust identity', () => {
  it('default adjust is identity, any change is not', () => {
    expect(isIdentityAdjust(defaultAdjust())).toBe(true);
    expect(isIdentityAdjust({ ...defaultAdjust(), exposure: 0.5 })).toBe(false);
  });
});

describe('layer records', () => {
  it('withLayer never mutates and bumps the version', () => {
    const l = makeLayer({ kind: 'raster', name: 'A' });
    const n = withLayer(l, { opacity: 0.5 });
    expect(l.opacity).toBe(1);
    expect(n.opacity).toBe(0.5);
    expect(n.v).toBeGreaterThan(l.v);
    expect(n.id).toBe(l.id);
  });
});

describe('selection flood fill', () => {
  const W = 6, H = 4;
  // Left half black, right half white
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = x < 3 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  it('contiguous fill selects one region', () => {
    const m = floodMask(data, W, H, 0, 0, 10, true);
    const count = m.reduce((s, v) => s + (v ? 1 : 0), 0);
    expect(count).toBe(12);
    expect(m[5]).toBe(0);
  });
  it('global fill matches across the image', () => {
    const d2 = new Uint8ClampedArray(data);
    // An isolated black pixel on the right
    d2[(0 * W + 5) * 4] = d2[(0 * W + 5) * 4 + 1] = d2[(0 * W + 5) * 4 + 2] = 0;
    expect(floodMask(d2, W, H, 0, 0, 10, true)[5]).toBe(0);
    expect(floodMask(d2, W, H, 0, 0, 10, false)[5]).toBe(255);
  });
  it('out-of-bounds seed selects nothing', () => {
    expect(floodMask(data, W, H, -1, 0, 10, true).some((v) => v)).toBe(false);
  });
  it('rectFromPoints normalizes and constrains', () => {
    expect(rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 4 })).toEqual({ x: 0, y: 4, width: 10, height: 6 });
    const sq = rectFromPoints({ x: 0, y: 0 }, { x: 10, y: 4 }, true);
    expect(sq.width).toBe(sq.height);
  });
});

describe('geometry & blur', () => {
  it('rect ops', () => {
    expect(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(intersectRect({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 5, width: 1, height: 1 })).toBeNull();
    expect(unionRect(null, { x: 1, y: 1, width: 1, height: 1 })).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });
  it('blur preserves mean and spreads an impulse', () => {
    const w = 21, h = 21;
    const buf = new Float32Array(w * h);
    buf[10 * w + 10] = 441;
    blurChannel(buf, w, h, 4);
    const sum = buf.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(441, 0);
    expect(buf[10 * w + 10]).toBeLessThan(441);
    expect(buf[10 * w + 12]).toBeGreaterThan(0);
  });
});

describe('brush tip', () => {
  it('falls off from 1 at the hard core to 0 at the edge', () => {
    expect(tipAlpha(0, 0.5)).toBe(1);
    expect(tipAlpha(0.5, 0.5)).toBe(1);
    expect(tipAlpha(1, 0.5)).toBe(0);
    const a = tipAlpha(0.6, 0.5), b = tipAlpha(0.9, 0.5);
    expect(a).toBeGreaterThan(b);
  });
});

describe('content-aware fill (PatchMatch inpainting)', () => {
  it('fills a hole in a flat image with the surrounding color', () => {
    const w = 48, h = 48;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 40; rgba[i * 4 + 1] = 120; rgba[i * 4 + 2] = 200; rgba[i * 4 + 3] = 255;
    }
    for (let y = 18; y < 30; y++)
      for (let x = 18; x < 30; x++) {
        mask[y * w + x] = 1;
        rgba[(y * w + x) * 4] = 255; rgba[(y * w + x) * 4 + 1] = 0; rgba[(y * w + x) * 4 + 2] = 0;
      }
    const out = inpaint(rgba, w, h, mask);
    const c = (24 * w + 24) * 4;
    expect(Math.abs(out[c] - 40)).toBeLessThan(4);
    expect(Math.abs(out[c + 1] - 120)).toBeLessThan(4);
    expect(Math.abs(out[c + 2] - 200)).toBeLessThan(4);
    expect(out[0]).toBe(40); // untouched outside the hole
  });
  it('continues a stripe pattern through the hole', () => {
    const w = 64, h = 64;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = Math.floor(x / 4) % 2 ? 230 : 20; // vertical stripes
        const i = (y * w + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
        rgba[i + 3] = 255;
        if (x >= 24 && x < 40 && y >= 24 && y < 40) mask[y * w + x] = 1;
      }
    const expected = new Uint8ClampedArray(rgba);
    const out = inpaint(rgba, w, h, mask);
    let err = 0, n = 0;
    for (let i = 0; i < w * h; i++) if (mask[i]) { err += Math.abs(out[i * 4] - expected[i * 4]); n++; }
    expect(err / n).toBeLessThan(40); // mean error far below the 210 stripe contrast
  });
});

describe('filters', () => {
  it('every filter runs on a small image without throwing and keeps alpha', () => {
    for (const f of FILTERS) {
      const img = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256)), colorSpace: 'srgb' } as ImageData;
      expect(() => f.apply(img, defaultParams(f))).not.toThrow();
      if (f.id !== 'motion-blur' && f.id !== 'pixelate' && f.id !== 'gaussian-blur') expect(img.data[3]).toBe(255);
    }
  });
});

describe('smart guide snapping', () => {
  const targets = snapTargets(1000, 800, [{ x: 600, y: 100, width: 200, height: 100 }]);

  it('snaps the nearest edge or centre within tolerance', () => {
    // Box 100 wide at x=0: right edge 100 + dx 397 = 497 → centre line 500 is 3px away
    const s = snapMove({ x: 0, y: 0, width: 100, height: 50 }, 397, 20, targets, 6);
    expect(s.dx).toBe(400);
    expect(s.guideX).toBe(500);
  });

  it('snaps to another layer edge', () => {
    // Left edge 0 + dx 596 = 596 → other layer's left at 600
    const s = snapMove({ x: 0, y: 300, width: 50, height: 50 }, 596, 0, targets, 6);
    expect(s.dx).toBe(600);
    expect(s.guideX).toBe(600);
  });

  it('leaves moves alone outside the tolerance', () => {
    const s = snapMove({ x: 0, y: 300, width: 50, height: 50 }, 250, 3, targets, 6);
    expect(s).toEqual({ dx: 250, dy: 3, guideX: null, guideY: null });
  });
});

describe('brush stabilizer', () => {
  it('always finishes the stroke at the release point', () => {
    const p = new Stabilizer(40);
    for (let x = 0; x <= 200; x += 7) p.push(x, 50);
    p.push(200, 50);
    expect(p.anchor!.x).toBeLessThan(200 - 30); // trailing on the string
    expect(p.release()).toBe(true);
    expect(p.anchor).toEqual({ x: 200, y: 50 });
  });

  it('paint point does not move until the string is pulled taut', () => {
    const p = new Stabilizer(10);
    p.push(0, 0);
    expect(p.push(6, 0)).toBe(false);
    expect(p.anchor).toEqual({ x: 0, y: 0 });
    p.push(20, 0);
    expect(p.anchor!.x).toBeCloseTo(10);
  });

  it('with radius 0 paints exactly under the pointer', () => {
    const p = new Stabilizer(0);
    p.push(3, 4);
    p.push(10.5, 7.25);
    expect(p.anchor).toEqual({ x: 10.5, y: 7.25 });
  });
});
