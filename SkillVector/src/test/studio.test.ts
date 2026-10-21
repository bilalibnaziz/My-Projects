import { describe, expect, it } from 'vitest';
import { makeLayer } from '../core/types';
import type { Doc, Layer } from '../core/types';
import { inkCoverage, mmToPx, nUpLayout, DEFAULT_PRINT, slugMm } from '../core/studio/print';
import { arrangeRects, autoCols } from '../core/studio/moodKit';
import { carouselSlides, profileGridTiles } from '../core/studio/socialKit';
import { cssFor, passingColor } from '../core/studio/webKit';
import { suggestPreset } from '../core/studio/trace';
import { boardFileNames } from '../core/studio/export';
import { contrastRatio } from '../core/color';

const rect = (name: string, x: number, y: number, w: number, h: number, extra: Partial<Layer> = {}) =>
  makeLayer({ kind: 'shape', name, x, y, width: w, height: h, shape: { shape: 'rectangle', fill: '#336699', stroke: '#000000', strokeWidth: 0, fillEnabled: true, radius: 0 }, ...extra });
const docWith = (layers: Layer[], w = 1050, h = 600): Doc =>
  ({ id: 'd', title: 'T', width: w, height: h, layers, activeId: layers[0]?.id, artboards: [{ id: 'ab', name: 'Card', x: 0, y: 0, width: w, height: h }], activeArtboardId: 'ab' }) as unknown as Doc;

describe('print', () => {
  it('converts mm at the print resolution', () => {
    expect(mmToPx(25.4, 300)).toBeCloseTo(300);
    expect(mmToPx(3, 300)).toBeCloseTo(35.43, 1);
    expect(slugMm({ ...DEFAULT_PRINT, cropMarks: false, registration: false, colorBars: false, pageInfo: false })).toBe(3);
  });

  it('fits business cards on A4 and turns them when more fit', () => {
    // 85 × 55 mm cards, 6 mm gaps, 10 mm margin on A4: 2 × 4 upright, 3 × 3 turned
    expect(nUpLayout(85, 55, 210, 297, 6, 10)).toEqual({ cols: 3, rows: 3, count: 9, rotated: true });
    expect(nUpLayout(55, 85, 210, 297, 6, 10)).toEqual({ cols: 3, rows: 3, count: 9, rotated: false });
    // A long label fits more when turned
    const turned = nUpLayout(200, 40, 210, 297, 4, 5);
    expect(turned.count).toBeGreaterThan(nUpLayout(40, 200, 210, 297, 4, 5).count - 1);
    expect(nUpLayout(400, 400, 210, 297, 6, 10).count).toBe(0);
  });

  it('reads ink coverage', () => {
    expect(inkCoverage('#ffffff').total).toBe(0);
    const black = inkCoverage('#000000');
    expect(black.k).toBeGreaterThan(80);
    expect(black.total).toBeGreaterThan(black.k);
  });

});

describe('social', () => {
  it('splits a carousel and a profile grid in posting order', () => {
    const ab = { id: 'c', name: 'Carousel · 3 × Instagram Post 4:5', x: 0, y: 0, width: 3240, height: 1350 };
    const s = carouselSlides(ab);
    expect(s.map((x) => x.rect.x)).toEqual([0, 1080, 2160]);
    const tiles = profileGridTiles({ ...ab, width: 3000, height: 3000 }, 3, 3);
    expect(tiles).toHaveLength(9);
    // First post is the bottom-right tile, last is top-left
    expect(tiles[0].rect).toMatchObject({ x: 2000, y: 2000 });
    expect(tiles[8].rect).toMatchObject({ x: 0, y: 0 });
  });

});

describe('web & UI', () => {
  it('writes CSS with per-corner radii', () => {
    const l = rect('Tab', 10, 20, 100, 40);
    l.shape!.radii = [12, 12, 0, 0];
    const css = cssFor(l, docWith([l]));
    expect(css).toContain('border-radius: 12px 12px 0px 0px;');
    expect(css).toContain('left: 10px;');
    expect(css).toContain('background: #336699;');
  });

  it('finds the closest colour that passes contrast', () => {
    const fixed = passingColor('#9ca3af', '#ffffff', 4.5);
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(passingColor('#000000', '#ffffff')).toBe('#000000');
    const onDark = passingColor('#4b5563', '#111111', 4.5);
    expect(contrastRatio(onDark, '#111111')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('mood board', () => {
  it('masonry keeps aspect ratios and fills the shortest column', () => {
    const box = { x: 0, y: 0, width: 620, height: 1000 };
    const r = arrangeRects([{ w: 100, h: 100 }, { w: 100, h: 200 }, { w: 100, h: 50 }], box, 2, 20, 'masonry');
    expect(r[0]).toMatchObject({ x: 0, y: 0, width: 300, height: 300 });
    expect(r[1]).toMatchObject({ x: 320, y: 0, width: 300, height: 600 });
    // Third goes under the first (shorter column)
    expect(r[2]).toMatchObject({ x: 0, y: 320, width: 300, height: 150 });
    expect(autoCols(9, { x: 0, y: 0, width: 1000, height: 1000 })).toBe(3);
  });

  it('grid contains each item in a square cell', () => {
    const r = arrangeRects([{ w: 200, h: 100 }, { w: 100, h: 200 }], { x: 0, y: 0, width: 410, height: 400 }, 2, 10, 'grid');
    expect(r[0]).toMatchObject({ x: 0, width: 200, height: 100 });
    expect(r[1]).toMatchObject({ y: 0, width: 100, height: 200 });
  });
});

describe('trace + export helpers', () => {
  const img = (w: number, h: number, f: (x: number, y: number) => number[]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...f(x, y), 255], (y * w + x) * 4);
    return { width: w, height: h, data };
  };
  it('suggests a preset from the picture', () => {
    expect(suggestPreset(img(64, 64, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [255, 0, 0] : [0, 0, 255]))).toBe('pixel-art');
    expect(suggestPreset(img(400, 300, (x) => (x < 200 ? [0, 0, 0] : [255, 255, 255])))).toBe('logo');
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) % 256);
    expect(suggestPreset(img(400, 300, () => [rnd(), rnd(), rnd()]))).toBe('photo-low');
  });

  it('makes unique, safe file names', () => {
    expect(boardFileNames([{ name: 'Post' }, { name: 'Post' }, { name: 'A/B' }], 'png')).toEqual(['Post.png', 'Post 2.png', 'A-B.png']);
  });
});
