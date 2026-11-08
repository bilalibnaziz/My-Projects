import { describe, it, expect } from 'vitest';
import { layoutCells, patternSvg, defaultPattern } from '../core/patterns';

describe('pattern tile types', () => {
  it('grid, brick and hex cells', () => {
    expect(layoutCells(undefined, undefined, 20, 10)).toEqual({ W: 20, H: 10, cells: [[0, 0]] });
    expect(layoutCells('brick-row', undefined, 20, 10)).toEqual({ W: 20, H: 20, cells: [[0, 0], [10, 10]] });
    expect(layoutCells('brick-row', 0.25, 20, 10).cells[1]).toEqual([5, 10]);
    expect(layoutCells('brick-col', 0.5, 20, 10)).toEqual({ W: 40, H: 10, cells: [[0, 0], [20, 5]] });
    const hex = layoutCells('hex', undefined, 20, 20);
    expect(hex.W).toBe(20);
    expect(hex.H).toBeCloseTo(34.641, 3);
    expect(hex.cells[1][0]).toBe(10);
    expect(hex.cells[1][1]).toBeCloseTo(17.32, 2);
  });

  it('SVG export uses the layout cell and places the shifted copy', () => {
    const n = (v: number) => String(Math.round(v * 100) / 100);
    const p = { ...defaultPattern('#000'), size: 20, layout: 'brick-row' as const };
    const svg = patternSvg('p1', p, 0, 0, n);
    expect(svg).toContain('width="20" height="40"');
    // A dot centred at (10, 10) in the first row and shifted by half (20, 30) in the second
    expect(svg).toMatch(/cx="10" cy="10"/);
    expect(svg).toMatch(/cx="20" cy="30"/);
    expect(patternSvg('p2', { ...p, layout: 'grid' }, 0, 0, n)).toContain('width="20" height="20"');
  });
});
