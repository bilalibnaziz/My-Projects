import { describe, expect, it } from 'vitest';
import { makeLayer } from '../core/types';
import type { Swatch } from '../core/types';
import { recolorSwatchUses, swatchLinks } from '../core/swatches';

const brand: Swatch = { id: 'sw-1', name: 'Brand', color: '#2255ee', global: true };
const shape = (fill: string, fillSwatch?: string, stroke = '#000000', strokeSwatch?: string) =>
  makeLayer({ kind: 'shape', name: 'S', x: 0, y: 0, width: 10, height: 10, shape: { shape: 'rectangle', fill, fillSwatch, fillEnabled: true, stroke, strokeSwatch, strokeWidth: 2, radius: 0 } });

describe('global swatches', () => {
  it('editing a swatch recolours every linked fill, stroke and type colour', () => {
    const text = makeLayer({ kind: 'text', name: 'T', x: 0, y: 0, width: 1, height: 1, text: { text: 'Hi', color: '#2255ee', colorSwatch: 'sw-1' } as never });
    const layers = [shape('#2255ee', 'sw-1'), shape('#ffffff', undefined, '#2255ee', 'sw-1'), text, shape('#2255ee')];
    const { layers: out, count } = recolorSwatchUses(layers, brand, '#ff8800');
    expect(count).toBe(3);
    expect(out[0].shape!.fill).toBe('#ff8800');
    expect(out[1].shape!.stroke).toBe('#ff8800');
    expect(out[1].shape!.fill).toBe('#ffffff');
    expect(out[2].text!.color).toBe('#ff8800');
    // Same colour but never linked: untouched
    expect(out[3]).toBe(layers[3]);
  });

  it('a link whose colour was changed some other way no longer follows', () => {
    const l = shape('#00ff00', 'sw-1');
    expect(swatchLinks(l, 'sw-1', brand.color).fill).toBe(false);
    expect(recolorSwatchUses([l], brand, '#ff8800').count).toBe(0);
  });

  it('links ignore case and alpha suffixes', () => {
    expect(swatchLinks(shape('#2255EE', 'sw-1'), 'sw-1', '#2255ee').fill).toBe(true);
  });
});
