import { describe, expect, it } from 'vitest';
import { buildGraph, niceScale, parseGraphData, wedge, GRAPH_TYPES, SAMPLE_GRAPH_DATA } from '../core/graphs';
import type { GraphPrim, GraphSpec } from '../core/graphs';

const box = { x: 100, y: 50, w: 400, h: 300 };
const spec = (type: GraphSpec['type'], data = SAMPLE_GRAPH_DATA, extra: Partial<GraphSpec> = {}): GraphSpec => ({ type, data, legend: false, axis: true, ...extra });
const rects = (p: GraphPrim[]) => p.filter((q): q is Extract<GraphPrim, { kind: 'rect' }> => q.kind === 'rect' && q.role === 'data');

describe('parseGraphData', () => {
  it('reads a header row and a label column (tabs)', () => {
    const d = parseGraphData(SAMPLE_GRAPH_DATA);
    expect(d.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(d.series.map((s) => s.name)).toEqual(['Sales', 'Costs']);
    expect(d.series[0].values).toEqual([40, 75, 60, 95]);
  });

  it('reads plain numbers without header or labels', () => {
    const d = parseGraphData('1,2\n3,4\n5,6');
    expect(d.labels).toEqual(['1', '2', '3']);
    expect(d.series).toHaveLength(2);
    expect(d.series[1].values).toEqual([2, 4, 6]);
  });

  it('reads semicolons with decimal commas and empty cells', () => {
    const d = parseGraphData('Item;A\nx;1,5\ny;');
    expect(d.series[0].values).toEqual([1.5, 0]);
  });
});

describe('niceScale', () => {
  it('rounds to 1/2/2.5/5 steps covering the range', () => {
    expect(niceScale(0, 95)).toEqual({ min: 0, max: 100, step: 20 });
    const s = niceScale(-12, 37);
    expect(s.min).toBeLessThanOrEqual(-12);
    expect(s.max).toBeGreaterThanOrEqual(37);
  });
});

describe('buildGraph', () => {
  it('makes one column per value, heights proportional to the data', () => {
    const p = buildGraph(spec('column'), box);
    const r = rects(p);
    expect(r).toHaveLength(8);
    const q1 = r.find((q) => q.name === 'Sales · Q1')!;
    const q4 = r.find((q) => q.name === 'Sales · Q4')!;
    expect(q4.h / q1.h).toBeCloseTo(95 / 40, 5);
    // Same baseline, inside the box
    expect(q1.y + q1.h).toBeCloseTo(q4.y + q4.h, 6);
    for (const q of r) {
      expect(q.x).toBeGreaterThanOrEqual(box.x);
      expect(q.x + q.w).toBeLessThanOrEqual(box.x + box.w + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(box.y);
      expect(q.y + q.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
    }
  });

  it('stacks columns so each stack is the sum', () => {
    const r = rects(buildGraph(spec('stacked-column'), box));
    const a = r.find((q) => q.name === 'Sales · Q2')!;
    const b = r.find((q) => q.name === 'Costs · Q2')!;
    expect(b.y + b.h).toBeCloseTo(a.y, 6);
    expect(a.x).toBeCloseTo(b.x, 6);
  });

  it('lays bars out horizontally', () => {
    const r = rects(buildGraph(spec('bar'), box));
    const q1 = r.find((q) => q.name === 'Sales · Q1')!;
    const q4 = r.find((q) => q.name === 'Sales · Q4')!;
    expect(q4.w / q1.w).toBeCloseTo(95 / 40, 5);
    expect(q1.x).toBeCloseTo(q4.x, 6);
  });

  it('draws negative columns below the zero line', () => {
    const r = rects(buildGraph(spec('column', 'a,5\nb,-5'), box));
    expect(r[1].y).toBeCloseTo(r[0].y + r[0].h, 6);
  });

  it('makes pie wedges that cover the full circle', () => {
    const p = buildGraph(spec('pie', 'a,1\nb,1\nc,2'), box).filter((q) => q.kind === 'path' && q.role === 'data');
    expect(p).toHaveLength(3);
    const w = wedge(0, 0, 10, 0, Math.PI);
    expect(w[0]).toEqual({ x: 0, y: 0 });
    expect(w[w.length - 1].x).toBeCloseTo(-10, 6);
    expect(wedge(0, 0, 10, 0, Math.PI * 2)).toHaveLength(4);
  });

  it('builds every graph type, with a legend when asked', () => {
    for (const t of GRAPH_TYPES) {
      const p = buildGraph(spec(t.id, SAMPLE_GRAPH_DATA, { legend: true }), box);
      expect(p.some((q) => q.role === 'data')).toBe(true);
      expect(p.some((q) => q.role === 'legend')).toBe(true);
    }
  });

  it('returns nothing for empty data', () => {
    expect(buildGraph(spec('column', ''), box)).toEqual([]);
  });
});
