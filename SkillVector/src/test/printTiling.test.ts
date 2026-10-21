import { describe, expect, it } from 'vitest';
import { pageSize, printTiles, tilingArea } from '../core/printTiling';
import { buildPdfPages } from '../core/formats/pdf';

const letter = { paper: 'letter' as const, landscape: false, overlap: 0 };

describe('print tiling', () => {
  it('covers the artboard with whole pages from the origin', () => {
    const area = { x: 0, y: 0, w: 1000, h: 1000 };
    const t = printTiles(area, letter, { x: 0, y: 0 });
    // 612 × 792 pt pages: 2 columns × 2 rows
    expect(t).toHaveLength(4);
    expect(t.map((q) => q.n)).toEqual([1, 2, 3, 4]);
    expect(t[1]).toMatchObject({ x: 612, y: 0, w: 612, h: 792 });
  });

  it('one page when the artboard fits', () => {
    expect(printTiles({ x: 10, y: 10, w: 500, h: 700 }, letter, { x: 10, y: 10 })).toHaveLength(1);
  });

  it('moving the origin adds pages on the left/top', () => {
    const area = { x: 0, y: 0, w: 500, h: 700 };
    const t = printTiles(area, letter, { x: 100, y: 0 });
    expect(t).toHaveLength(2);
    expect(t[0].x).toBe(100 - 612);
  });

  it('landscape swaps the page and overlap shrinks the step', () => {
    expect(pageSize({ ...letter, landscape: true })).toEqual({ w: 792, h: 612 });
    const t = printTiles({ x: 0, y: 0, w: 1200, h: 700 }, { ...letter, overlap: 36 }, { x: 0, y: 0 });
    expect(t[1].x).toBe(612 - 36);
  });

  it('tiles the active artboard, else the document', () => {
    expect(tilingArea({ width: 800, height: 600, artboards: undefined, activeArtboardId: undefined })).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    const ab = { id: 'a', name: 'A', x: 50, y: 60, width: 300, height: 200 };
    expect(tilingArea({ width: 800, height: 600, artboards: [ab], activeArtboardId: 'a' })).toEqual({ x: 50, y: 60, w: 300, h: 200 });
  });

  it('writes a multi-page PDF with valid offsets', () => {
    const img = { width: 2, height: 2, data: new Uint8Array([1, 2]), filter: 'DCTDecode' as const };
    const pdf = buildPdfPages([{ img, width: 612, height: 792 }, { img, width: 612, height: 792 }, { img, width: 612, height: 792 }], 'Tiles');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('/Count 3');
    expect(text.match(/\/Type \/Page /g)).toHaveLength(3);
    const xref = +text.match(/startxref\n(\d+)/)![1];
    const offs = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => +m[1]);
    offs.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
