import { describe, expect, it } from 'vitest';
import { makeLayer } from '../core/types';
import type { ShapeProps } from '../core/types';
import { appearanceOf, applyAppearance } from '../core/appearanceCopy';

const shape = (s: Partial<ShapeProps>, extra = {}) =>
  makeLayer({ kind: 'shape', name: 'S', x: 0, y: 0, width: 100, height: 40, ...extra, shape: { shape: 'rectangle', fill: '#000000', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 12, ...s } });

describe('appearance copy (Eyedropper)', () => {
  it('copies fill, stroke, opacities and blend between shapes, keeping geometry', () => {
    const src = shape({ fill: '#2255ee', fillOpacity: 0.5, stroke: '#ff000080', strokeWidth: 3, strokeDash: [4, 2] }, { opacity: 0.8, blend: 'multiply' });
    const dst = shape({ shape: 'ellipse', fill: '#00ff00', radius: 0 }, { x: 300, width: 50 });
    const out = applyAppearance(dst, appearanceOf(src)!);
    expect(out.shape).toMatchObject({ shape: 'ellipse', fill: '#2255ee', fillOpacity: 0.5, stroke: '#ff0000', strokeWidth: 3, strokeDash: [4, 2] });
    expect(out.shape!.strokeOpacity).toBeCloseTo(128 / 255, 6);
    expect(out).toMatchObject({ x: 300, width: 50, opacity: 0.8, blend: 'multiply' });
  });

  it('a source without stroke removes the target stroke; no fill turns the fill off', () => {
    const out = applyAppearance(shape({ strokeWidth: 5 }), appearanceOf(shape({ fillEnabled: false, stroke: '#123456', strokeWidth: 0 }))!);
    expect(out.shape!.strokeWidth).toBe(0);
    expect(out.shape!.fillEnabled).toBe(false);
  });

  it('shape → text uses the fill as the type colour, and text → shape back', () => {
    const text = makeLayer({ kind: 'text', name: 'T', x: 0, y: 0, width: 10, height: 10, text: { text: 'Buy', font: 'Inter', size: 16, weight: 600, color: '#ffffff', align: 'left', stroke: 0, strokeColor: '#000000' } as never });
    const t2 = applyAppearance(text, appearanceOf(shape({ fill: '#ff8800' }))!);
    expect(t2.text!.color).toBe('#ff8800');
    expect(t2.text!.text).toBe('Buy');
    const s2 = applyAppearance(shape({}), appearanceOf(t2)!);
    expect(s2.shape!.fill).toBe('#ff8800');
  });

  it('a line takes the fill colour as its stroke', () => {
    const line = shape({ shape: 'line', stroke: '#000000', strokeWidth: 2 });
    const out = applyAppearance(line, appearanceOf(shape({ fill: '#ff0000' }))!);
    expect(out.shape!.stroke).toBe('#ff0000');
    expect(out.shape!.strokeWidth).toBe(2);
  });
});
