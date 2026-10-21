import { describe, expect, it } from 'vitest';
import { carouselSlides, legibility, profileGridTiles, slideCount } from '../core/socialStudio';
import { makeLayer } from '../core/types';

describe('social studio', () => {
  it('cuts a carousel into equal slides that cover the canvas exactly', () => {
    const doc = { width: 5400, height: 1350, title: 'Carousel · 5 × Instagram Post 4:5' };
    expect(slideCount(doc)).toBe(5);
    const s = carouselSlides(doc);
    expect(s).toHaveLength(5);
    expect(s[0].rect).toEqual({ x: 0, y: 0, width: 1080, height: 1350 });
    expect(s.reduce((a, r) => a + r.rect.width, 0)).toBe(5400);
    expect(s[4].rect.x + s[4].rect.width).toBe(5400);
  });

  it('guesses the slide count of an untitled wide canvas from 4:5 slides', () => {
    expect(slideCount({ width: 3240, height: 1350, title: 'Untitled' })).toBe(3);
  });

  it('numbers profile-grid tiles in posting order, bottom-right first, with no gaps', () => {
    const t = profileGridTiles({ width: 1000, height: 1000 }, 3, 3);
    expect(t).toHaveLength(9);
    expect(t[0].name).toMatch(/^Post 01 \(row 3, col 3\)/);
    expect(t[0].rect).toEqual({ x: 667, y: 667, width: 333, height: 333 });
    expect(t[8].rect).toEqual({ x: 0, y: 0, width: 333, height: 333 });
    const area = t.reduce((a, r) => a + r.rect.width * r.rect.height, 0);
    expect(area).toBe(1000 * 1000);
  });

  it('flags text that is too small for a phone', () => {
    const big = makeLayer({ kind: 'text', name: 'Headline', text: { text: 'Hi', font: 'Inter', size: 80, weight: 700, color: '#000', align: 'left', italic: false, underline: false, tracking: 0, leading: 1.2, stroke: 0, strokeColor: '#000' } as never });
    const tiny = makeLayer({ kind: 'text', name: 'Fine print', text: { text: 'tiny', font: 'Inter', size: 12, weight: 400, color: '#000', align: 'left', italic: false, underline: false, tracking: 0, leading: 1.2, stroke: 0, strokeColor: '#000' } as never });
    const r = legibility({ width: 1080, height: 1350, layers: [big, tiny] });
    expect(r.map((x) => x.layer.name)).toEqual(['Fine print']);
    expect(r[0].min).toBe(24);
  });
});
