import { describe, expect, it } from 'vitest';
import type { Layer, ShapeProps } from '../core/types';
import { makeLayer } from '../core/types';
import { dragWidget, nextCornerStyle, shapeWidgets, widgetAt } from '../core/shapeWidgets';

const shape = (s: Partial<ShapeProps>, box: Partial<Layer> = {}): Layer =>
  makeLayer({
    kind: 'shape',
    name: 'S',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    ...box,
    shape: { shape: 'rectangle', fill: '#000', fillEnabled: true, stroke: '#000', strokeWidth: 0, radius: 0, ...s },
  });

describe('rectangle corner widgets', () => {
  it('sit inside each corner, at the inset when the corners are sharp', () => {
    const ws = shapeWidgets(shape({}), 1);
    expect(ws.map((w) => w.kind)).toEqual(['corner', 'corner', 'corner', 'corner']);
    expect(ws[0]).toMatchObject({ x: 116, y: 116 });
    expect(ws[2]).toMatchObject({ x: 284, y: 184 });
  });

  it('mark the arc centre once the radius passes the inset, and turn red at the maximum', () => {
    const ws = shapeWidgets(shape({ radius: 30 }), 1);
    expect(ws[1]).toMatchObject({ x: 270, y: 130, atMax: false });
    expect(shapeWidgets(shape({ radius: 50 }), 1)[0].atMax).toBe(true);
  });

  it('follow the live rotation', () => {
    const l = shape({}, { rotation: 90 });
    const w = shapeWidgets(l, 1)[0];
    // Top-left local (-100+16, -50+16) turned 90° clockwise about the centre (200, 150)
    expect(w.x).toBeCloseTo(200 + 34, 6);
    expect(w.y).toBeCloseTo(150 - 84, 6);
    expect(widgetAt(l, { x: 235, y: 67 }, 1)?.index).toBe(0);
  });

  it('hide on shapes too small on screen', () => {
    expect(shapeWidgets(shape({}), 0.1)).toEqual([]);
  });

  it('drag toward the centre rounds all corners, clamped to half the short side', () => {
    const l = shape({});
    const w = shapeWidgets(l, 1)[0];
    expect(dragWidget(l, w, w, { x: w.x + 20, y: w.y + 20 }, { alt: false, shift: false })!.patch).toEqual({ radius: 20, radii: undefined });
    expect(dragWidget(l, w, w, { x: w.x + 400, y: w.y + 400 }, { alt: false, shift: false })!.patch.radius).toBe(50);
    expect(dragWidget(l, w, w, { x: w.x - 40, y: w.y - 40 }, { alt: false, shift: false })!.patch.radius).toBe(0);
    // Shift snaps to 5 px
    expect(dragWidget(l, w, w, { x: w.x + 12, y: w.y + 12 }, { alt: false, shift: true })!.patch.radius).toBe(10);
  });

  it('works from any corner, and from a rotated shape', () => {
    const l = shape({ radius: 10 }, { rotation: 37 });
    const w = shapeWidgets(l, 1)[2];
    // Move 15 px toward the centre along the corner's own diagonal (in document space)
    const a = (37 * Math.PI) / 180;
    const dl = { x: -15, y: -15 };
    const p = { x: w.x + dl.x * Math.cos(a) - dl.y * Math.sin(a), y: w.y + dl.x * Math.sin(a) + dl.y * Math.cos(a) };
    expect(dragWidget(l, w, w, p, { alt: false, shift: false })!.patch.radius).toBeCloseTo(25, 6);
  });

  it('⌥ drag rounds one corner only; corners that differ move together', () => {
    const l = shape({ radius: 10 });
    const w = shapeWidgets(l, 1)[1];
    expect(dragWidget(l, w, w, { x: w.x - 20, y: w.y + 20 }, { alt: true, shift: false })!.patch).toEqual({ radii: [10, 30, 10, 10] });
    const u = shape({ radii: [0, 10, 20, 30] });
    const wu = shapeWidgets(u, 1)[0];
    expect(dragWidget(u, wu, wu, { x: wu.x + 5, y: wu.y + 5 }, { alt: false, shift: false })!.patch).toEqual({ radii: [5, 15, 25, 35] });
  });

  it('⌥ click cycles the corner style and gives a sharp box a visible radius', () => {
    expect(nextCornerStyle({ shape: 'rectangle', radius: 0 } as ShapeProps)).toEqual({ cornerStyle: 'smooth', radius: 12 });
    expect(nextCornerStyle({ shape: 'rectangle', radius: 8, cornerStyle: 'notch' } as ShapeProps)).toEqual({ cornerStyle: 'round' });
  });
});

describe('polygon, star and ellipse widgets', () => {
  it('sides diamond: up adds sides, down removes them, never below 3', () => {
    const l = shape({ shape: 'polygon', sides: 6 }, { width: 200, height: 200 });
    const w = shapeWidgets(l, 1).find((x) => x.kind === 'sides')!;
    expect(w).toMatchObject({ x: 316, y: 200 });
    expect(dragWidget(l, w, w, { x: w.x, y: w.y - 25 }, { alt: false, shift: false })!.patch.sides).toBe(8);
    expect(dragWidget(l, w, w, { x: w.x, y: w.y + 500 }, { alt: false, shift: false })!.patch.sides).toBe(3);
  });

  it('point rounding: inward drag rounds every point', () => {
    const l = shape({ shape: 'polygon', sides: 5 }, { width: 200, height: 200 });
    const w = shapeWidgets(l, 1).find((x) => x.kind === 'point-round')!;
    expect(dragWidget(l, w, w, { x: w.x, y: w.y + 18 }, { alt: false, shift: false })!.patch.pointRadius).toBeCloseTo(18, 6);
    expect(dragWidget(l, w, w, { x: w.x, y: w.y - 18 }, { alt: false, shift: false })!.patch.pointRadius).toBe(0);
  });

  it('every outer point has a rounding dot, and each one rounds all points', () => {
    const l = shape({ shape: 'star', sides: 5 }, { width: 200, height: 200 });
    const dots = shapeWidgets(l, 1).filter((x) => x.kind === 'point-round');
    expect(dots.map((d) => d.index)).toEqual([0, 2, 4, 6, 8]);
    // Bottom-right point (index 4): move 12 px toward the centre along its bisector
    const d = dots[2];
    const ux = (200 - d.x) / Math.hypot(200 - d.x, 200 - d.y);
    const uy = (200 - d.y) / Math.hypot(200 - d.x, 200 - d.y);
    expect(dragWidget(l, d, d, { x: d.x + ux * 12, y: d.y + uy * 12 }, { alt: false, shift: false })!.patch.pointRadius).toBe(12);
    // Dense starbursts keep one dot so the shape stays readable
    expect(shapeWidgets(shape({ shape: 'star', sides: 24 }, { width: 200, height: 200 }), 1).filter((x) => x.kind === 'point-round')).toHaveLength(1);
  });

  it('star inner handle sits on the first inner point and sets the ratio where it is dropped', () => {
    const l = shape({ shape: 'star', sides: 5, innerRatio: 0.5 }, { width: 200, height: 200 });
    const w = shapeWidgets(l, 1).find((x) => x.kind === 'star-inner')!;
    const a = (2 * Math.PI) / 10 - Math.PI / 2;
    expect(w.x).toBeCloseTo(200 + 50 * Math.cos(a), 6);
    expect(w.y).toBeCloseTo(200 + 50 * Math.sin(a), 6);
    expect(dragWidget(l, w, w, { x: 200 + 70, y: 200 }, { alt: false, shift: false })!.patch.innerRatio).toBeCloseTo(0.7, 6);
  });

  it('ellipse: the rim handle opens a pie, the hole handle makes a donut', () => {
    const l = shape({ shape: 'ellipse' }, { width: 200, height: 200 });
    const ws = shapeWidgets(l, 1);
    const pie = ws.find((x) => x.kind === 'pie-start')!;
    expect(pie).toMatchObject({ x: 300, y: 200 });
    expect(ws.some((x) => x.kind === 'pie-end')).toBe(false);
    // Drag down to 6 o'clock: the pie runs from 90° round to 360°
    expect(dragWidget(l, pie, pie, { x: 200, y: 300 }, { alt: false, shift: false })!.patch).toEqual({ pieStart: 90, pieEnd: 360 });
    const hole = ws.find((x) => x.kind === 'hole')!;
    expect(dragWidget(l, hole, hole, { x: 140, y: 200 }, { alt: false, shift: false })!.patch.hole).toBeCloseTo(0.6, 6);
    expect(dragWidget(l, hole, hole, { x: 200, y: 200 }, { alt: false, shift: false })!.patch).toEqual({ hole: undefined });
  });

  it('paths and locked shapes have no widgets', () => {
    expect(shapeWidgets(shape({ shape: 'path', points: [] }), 1)).toEqual([]);
    expect(shapeWidgets(shape({}, { locked: true }), 1)).toEqual([]);
  });
});
