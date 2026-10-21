import { describe, expect, it } from 'vitest';
import { dragMapping, frameHit, layerFrame, mappedLayer } from '../core/objectTransform';
import type { ObjectDrag } from '../core/objectTransform';
import { makeLayer } from '../core/types';
import type { Layer } from '../core/types';
import { bakeRotation, convertToEditablePath, flipShapeLayer } from '../core/vectorOps';

const rect = (extra: Partial<Layer> = {}) =>
  makeLayer({ kind: 'shape', name: 'R', x: 100, y: 100, width: 200, height: 100, shape: { shape: 'rectangle', fill: '#f00', stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 }, ...extra });

const drag = (l: Layer, handle: ObjectDrag['handle'], start: { x: number; y: number }): ObjectDrag => ({
  handle, start, frame: layerFrame(l)!, layers: [l], aspect: 2, moved: true,
});

const free = { ratio: false, center: false, snap: false };

describe('object transform', () => {
  it('resizes from a corner, keeping the opposite corner fixed', () => {
    const l = rect();
    const d = drag(l, 'se', { x: 300, y: 200 });
    const out = mappedLayer(l, dragMapping(d, { x: 350, y: 260 }, free), true).layer;
    expect(out.x).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(100);
    expect(out.width).toBeCloseTo(250);
    expect(out.height).toBeCloseTo(160);
    expect(out.kind).toBe('shape');
  });

  it('keeps proportions when asked, and scales about the centre with Alt', () => {
    const l = rect();
    const d = drag(l, 'se', { x: 300, y: 200 });
    const prop = mappedLayer(l, dragMapping(d, { x: 400, y: 210 }, { ...free, ratio: true }), true).layer;
    expect(prop.width / prop.height).toBeCloseTo(2);
    expect(prop.width).toBeCloseTo(300);
    const centred = mappedLayer(l, dragMapping(d, { x: 320, y: 200 }, { ...free, center: true }), true).layer;
    expect(centred.x + centred.width / 2).toBeCloseTo(200);
    expect(centred.width).toBeCloseTo(240);
  });

  it('never turns a box inside out', () => {
    const l = rect();
    const d = drag(l, 'e', { x: 300, y: 150 });
    const out = mappedLayer(l, dragMapping(d, { x: -500, y: 150 }, free), true).layer;
    expect(out.width).toBeGreaterThan(0);
    expect(out.x).toBeCloseTo(100);
  });

  it('rotates about the centre, snapping to 15° with Shift', () => {
    const l = rect();
    // Start right of the centre (200, 150) and sweep a little past a quarter turn
    const d = drag(l, 'rotate', { x: 300, y: 150 });
    const a = Math.PI / 2 + 0.05;
    const out = mappedLayer(l, dragMapping(d, { x: 200 + 100 * Math.cos(a), y: 150 + 100 * Math.sin(a) }, { ...free, snap: true }), true).layer;
    expect(out.rotation).toBe(90);
    expect(out.x + out.width / 2).toBeCloseTo(200);
    expect(out.y + out.height / 2).toBeCloseTo(150);
    expect(out.width).toBeCloseTo(200);
  });

  it('resizes a rotated shape along its own axes', () => {
    const l = rect({ rotation: 90 });
    const f = layerFrame(l)!;
    expect(f.angle).toBeCloseTo(Math.PI / 2);
    // Its local +x points down the page: the "e" handle sits below the centre
    const d = drag(l, 'e', { x: 200, y: 250 });
    const out = mappedLayer(l, dragMapping(d, { x: 200, y: 300 }, free), true).layer;
    expect(out.width).toBeCloseTo(250);
    expect(out.height).toBeCloseTo(100);
    expect(out.rotation).toBe(90);
  });

  it('finds handles, the rotate zone and the inside', () => {
    const f = layerFrame(rect())!;
    expect(frameHit(f, { x: 300, y: 200 }, 1)).toBe('se');
    expect(frameHit(f, { x: 200, y: 100 }, 1)).toBe('n');
    expect(frameHit(f, { x: 200, y: 150 }, 1)).toBe('move');
    expect(frameHit(f, { x: 312, y: 88 }, 1)).toBe('rotate');
    expect(frameHit(f, { x: 600, y: 600 }, 1)).toBe(null);
  });

  it('bakes a rotation into path points without moving the shape', () => {
    const l = rect({ rotation: 90 });
    const baked = bakeRotation(convertToEditablePath(l, false));
    expect(baked.rotation).toBeUndefined();
    // A 200×100 box turned 90° about (200, 150) covers 150..250 × 50..250
    expect(baked.x).toBeCloseTo(150);
    expect(baked.y).toBeCloseTo(50);
    expect(baked.width).toBeCloseTo(100);
    expect(baked.height).toBeCloseTo(200);
  });

  it('flips a shape as vector points', () => {
    const tri = makeLayer({ kind: 'shape', name: 'T', x: 0, y: 0, width: 100, height: 100, shape: { shape: 'triangle', fill: '#f00', stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
    const f = flipShapeLayer(tri, 'v');
    expect(f.shape?.shape).toBe('path');
    // The apex (0.5, 0) ends up at the bottom
    expect(f.shape?.points?.[0].y).toBeCloseTo(1);
  });
});
