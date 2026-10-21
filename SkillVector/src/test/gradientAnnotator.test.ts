import { describe, expect, it } from 'vitest';
import { makeLayer } from '../core/types';
import type { ShapeGradient } from '../core/types';
import { addStopAt, annotatorGeometry, annotatorHit, dragAnnotator } from '../core/gradientAnnotator';

const grad: ShapeGradient = { type: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 0.5, color: '#ff0000' }, { offset: 1, color: '#ffffff' }] };
const shape = (rotation = 0, g: ShapeGradient = grad) =>
  makeLayer({ kind: 'shape', name: 'S', x: 100, y: 100, width: 200, height: 100, rotation, shape: { shape: 'rectangle', fill: '#000', fillEnabled: true, stroke: '#000', strokeWidth: 0, radius: 0, gradient: g } });

describe('gradient annotator', () => {
  it('places the line and stops in document space, rotation included', () => {
    const geo = annotatorGeometry(shape())!;
    expect(geo.a).toEqual({ x: 100, y: 150 });
    expect(geo.b).toEqual({ x: 300, y: 150 });
    expect(geo.stops[1]).toMatchObject({ x: 200, y: 150 });
    const r = annotatorGeometry(shape(90))!;
    expect(r.a.x).toBeCloseTo(200, 6);
    expect(r.a.y).toBeCloseTo(50, 6);
    expect(r.b.y).toBeCloseTo(250, 6);
  });

  it('hits ends, stops and the line', () => {
    const l = shape();
    expect(annotatorHit(l, { x: 101, y: 150 }, 1)).toEqual({ kind: 'start' });
    expect(annotatorHit(l, { x: 299, y: 151 }, 1)).toEqual({ kind: 'end' });
    expect(annotatorHit(l, { x: 203, y: 150 }, 1)).toEqual({ kind: 'stop', index: 1 });
    const line = annotatorHit(l, { x: 250, y: 152 }, 1);
    expect(line?.kind).toBe('line');
    expect((line as { t: number }).t).toBeCloseTo(0.75, 6);
    expect(annotatorHit(l, { x: 250, y: 190 }, 1)).toBeNull();
  });

  it('drags an end (⇧ snaps to 45°) and keeps the other end', () => {
    const l = shape();
    const r = dragAnnotator(l, { kind: 'end' }, { x: 300, y: 300 }, { shift: false, zoom: 1 })!;
    expect(r.gradient).toMatchObject({ x0: 0, y0: 0.5, x1: 1, y1: 2 });
    const s = dragAnnotator(l, { kind: 'end' }, { x: 290, y: 330 }, { shift: true, zoom: 1 })!;
    // From (100,150): angle snapped to 45°
    const dx = (s.gradient.x1 - 0) * 200, dy = (s.gradient.y1 - 0.5) * 100;
    expect(Math.abs(Math.atan2(dy, dx) - Math.PI / 4)).toBeLessThan(0.01);
  });

  it('moves a stop along the line, and pulling it off deletes it', () => {
    const l = shape();
    const r = dragAnnotator(l, { kind: 'stop', index: 1 }, { x: 140, y: 160 }, { shift: false, zoom: 1 })!;
    expect(r.gradient.stops[1].offset).toBeCloseTo(0.2, 3);
    const off = dragAnnotator(l, { kind: 'stop', index: 1 }, { x: 200, y: 260 }, { shift: false, zoom: 1 })!;
    expect(off.removed).toBe(true);
    expect(off.gradient.stops).toHaveLength(2);
  });

  it('adds a stop with the colour already at that point', () => {
    const r = addStopAt(shape(), 0.25)!;
    expect(r.index).toBe(3);
    expect(r.gradient.stops[3]).toEqual({ offset: 0.25, color: '#800000' });
  });
});
