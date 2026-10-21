import { describe, expect, it } from 'vitest';
import { makeLayer, withLayer } from '../core/types';
import type { Layer } from '../core/types';
import { applyHugs } from '../core/hug';

const text = () => makeLayer({ kind: 'text', name: 'Label', x: 124, y: 112, width: 52, height: 16, text: { text: 'Buy', size: 16 } as never });
const btn = (t: Layer) => makeLayer({ kind: 'shape', name: 'Button', x: 100, y: 100, width: 100, height: 40, hug: { target: t.id, padX: 24, padY: 12 },
  shape: { shape: 'rectangle', fill: '#0078d4', fillEnabled: true, stroke: '#000', strokeWidth: 0, radius: 8 } });
const get = (ls: Layer[], name: string) => ls.find((l) => l.name === name)!;

describe('hug (buttons)', () => {
  it('a longer label grows the button with the same padding', () => {
    const t = text(), b = btn(t);
    const prev = [b, t];
    const next = applyHugs(prev, [b, withLayer(t, { width: 92 })]);
    expect(get(next, 'Button')).toMatchObject({ x: 100, y: 100, width: 140, height: 40 });
  });

  it('moving only the shape brings the label along, at every live frame of the drag', () => {
    const t = text(), b = btn(t);
    const prev = [b, t];
    let live = applyHugs(prev, [withLayer(b, { x: 110 }), t]);
    expect(get(live, 'Label').x).toBe(134);
    live = applyHugs(prev, [withLayer(get(live, 'Button'), { x: 130, y: 120 }), get(live, 'Label')]);
    expect(get(live, 'Label')).toMatchObject({ x: 154, y: 132 });
    expect(get(live, 'Button')).toMatchObject({ x: 130, y: 120 });
  });

  it('resizing the shape re-centres the label and keeps the new padding', () => {
    const t = text(), b = btn(t);
    const next = applyHugs([b, t], [withLayer(b, { width: 200, height: 60 }), t]);
    expect(get(next, 'Label')).toMatchObject({ x: 174, y: 122 });
    expect(get(next, 'Button').hug).toMatchObject({ padX: 74, padY: 22 });
  });

  it('moving the label alone pulls the button to it; a group move changes nothing', () => {
    const t = text(), b = btn(t);
    let next = applyHugs([b, t], [b, withLayer(t, { x: 224 })]);
    expect(get(next, 'Button').x).toBe(200);
    const both = [withLayer(b, { x: 150 }), withLayer(t, { x: 174 })];
    next = applyHugs([b, t], both);
    expect(next).toBe(both);
  });

  it('leaves layers without hugs untouched (same array)', () => {
    const ls = [text()];
    expect(applyHugs(undefined, ls)).toBe(ls);
  });
});
