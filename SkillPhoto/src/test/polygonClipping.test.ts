import { describe, it, expect, beforeEach } from 'vitest';
import { clipPolygons, divideRings, pointInRings, subtractRings, uniteRings, type PolygonRing } from '../core/polygonClipping';
import { store } from '../core/store';
import { makeLayer } from '../core/types';
import * as vectorOps from '../core/vectorOps';

const rect = (x: number, y: number, w: number, h: number): PolygonRing => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const circle = (cx: number, cy: number, r: number, n = 128): PolygonRing =>
  Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * Math.PI * 2), y: cy + r * Math.sin((i / n) * Math.PI * 2) }));

/** Filled area under the even-odd rule, by sampling pixel centres (what the canvas actually paints). */
function filledArea(rings: PolygonRing[], x0 = -10, y0 = -10, x1 = 260, y1 = 260): number {
  let n = 0;
  for (let y = y0 + 0.5; y < y1; y++) for (let x = x0 + 0.5; x < x1; x++) if (pointInRings({ x, y }, rings)) n++;
  return n;
}

describe('polygonClipping - two shapes', () => {
  const A = rect(0, 0, 100, 100);
  const B = rect(50, 50, 100, 100);

  it('unite has no hole where the shapes overlap', () => {
    const r = clipPolygons(A, B, 'unite');
    expect(filledArea(r)).toBe(17500);
    expect(pointInRings({ x: 75, y: 75 }, r)).toBe(true);
  });

  it('intersect, minus front and exclude give their exact areas', () => {
    expect(filledArea(clipPolygons(A, B, 'intersect'))).toBe(2500);
    expect(filledArea(clipPolygons(A, B, 'minus-front'))).toBe(7500);
    expect(filledArea(clipPolygons(A, B, 'exclude'))).toBe(15000);
  });

  it('handles shapes that share an edge or a corner', () => {
    expect(filledArea(clipPolygons(rect(0, 0, 100, 100), rect(100, 0, 100, 100), 'unite'))).toBe(20000);
    expect(filledArea(clipPolygons(rect(0, 0, 100, 100), rect(0, 0, 100, 50), 'minus-front'))).toBe(5000);
    expect(filledArea(clipPolygons(rect(0, 0, 100, 100), rect(100, 100, 50, 50), 'intersect'))).toBe(0);
    expect(filledArea(clipPolygons(rect(0, 0, 100, 100), rect(0, 0, 100, 100), 'unite'))).toBe(10000);
  });

  it('a shape inside another becomes a hole when subtracted', () => {
    const r = clipPolygons(rect(0, 0, 100, 100), rect(25, 25, 50, 50), 'minus-front');
    expect(filledArea(r)).toBe(7500);
    expect(pointInRings({ x: 50, y: 50 }, r)).toBe(false);
  });

  it('crosses curved outlines with many crossings per edge', () => {
    const r = clipPolygons(circle(100, 100, 60), rect(40, 90, 120, 20), 'minus-front');
    const whole = filledArea([circle(100, 100, 60)]);
    const band = filledArea(clipPolygons(circle(100, 100, 60), rect(40, 90, 120, 20), 'intersect'));
    expect(filledArea(r)).toBe(whole - band);
    expect(r.length).toBe(2); // top and bottom halves
  });
});

describe('polygonClipping - many shapes', () => {
  it('unites a bridge between two separate shapes into one outline', () => {
    const r = uniteRings([rect(0, 0, 50, 50), rect(100, 0, 50, 50), rect(25, 10, 100, 20)]);
    expect(r.length).toBe(1);
    expect(filledArea(r)).toBe(2500 + 2500 + 50 * 20);
  });

  it('keeps the hole a ring of shapes encloses, and fills it when a shape covers it', () => {
    const frame = [rect(0, 0, 150, 30), rect(0, 120, 150, 30), rect(0, 0, 30, 150), rect(120, 0, 30, 150)];
    const ring = uniteRings(frame);
    expect(filledArea(ring)).toBe(150 * 150 - 90 * 90);
    expect(filledArea(uniteRings([...frame, rect(60, 60, 30, 30)]))).toBe(150 * 150 - 90 * 90 + 900);
  });

  it('subtracts every front shape from the back one', () => {
    const r = subtractRings(rect(0, 0, 200, 100), [rect(20, 20, 40, 40), rect(100, -10, 50, 50), rect(30, 30, 40, 40)]);
    // Holes: two overlapping 40×40 squares (sharing 30×30) and a 50×40 notch at the top edge
    expect(filledArea(r)).toBe(20000 - (1600 + 1600 - 900) - 2000);
  });
});

describe('vectorOps - Pathfinder area', () => {
  beforeEach(() => {
    store.state.docs = [];
    store.state.activeDocId = null;
  });

  const square = (name: string, x: number, y: number) =>
    makeLayer({
      kind: 'shape',
      name,
      x,
      y,
      width: 50,
      height: 50,
      shape: { shape: 'rectangle', fill: '#f00', stroke: '#000', strokeWidth: 1, fillEnabled: true, radius: 0 },
    });

  /** The result layer's rings in document space. */
  const resultRings = (): PolygonRing[] => {
    const l = store.doc!.layers[0];
    const subs = l.shape!.compoundPoints ?? [l.shape!.points!];
    return subs.map((s) => s.map((p) => ({ x: l.x + p.x * l.width, y: l.y + p.y * l.height })));
  };

  it('unite of three squares where only the last touches both stays solid', () => {
    const layers = [square('A', 0, 0), square('B', 100, 0), square('C', 40, 10)];
    layers[2].width = 70;
    store.addDoc({ title: 'Unite 3', width: 300, height: 300, layers });
    store.setSelectedLayers(layers.map((l) => l.id));
    expect(vectorOps.applyPathfinder('unite').applied).toBe(true);
    expect(store.doc!.layers.length).toBe(1);
    // A + B + C (70×50) minus C's two 10×40 overlaps with A and B
    expect(filledArea(resultRings())).toBe(2500 + 2500 + 3500 - 800);
  });
});

describe('vectorOps - Outline Stroke', () => {
  beforeEach(() => {
    store.state.docs = [];
    store.state.activeDocId = null;
  });

  const ringsOf = (l: ReturnType<typeof makeLayer>): PolygonRing[] =>
    (l.shape!.compoundPoints ?? [l.shape!.points!]).map((s) => s.map((p) => ({ x: l.x + p.x * l.width, y: l.y + p.y * l.height })));

  it('a stroked rectangle becomes a band of exactly the stroke width, also when not square', () => {
    const r = makeLayer({
      kind: 'shape',
      name: 'Box',
      x: 20,
      y: 20,
      width: 160,
      height: 60,
      shape: { shape: 'rectangle', fill: '#fff', stroke: '#000', strokeWidth: 10, fillEnabled: false, radius: 0 },
    });
    const out = vectorOps.outlineStroke(r);
    // Outer 170×70 minus the 150×50 hole
    expect(filledArea(ringsOf(out))).toBe(170 * 70 - 150 * 50);
    expect(out.shape!.fill).toBe('#000');
    expect(out.shape!.strokeWidth).toBe(0);
  });

  it('an open line gets butt ends', () => {
    const line = makeLayer({
      kind: 'shape',
      name: 'Line',
      x: 20,
      y: 100,
      width: 200,
      height: 1,
      shape: {
        shape: 'path',
        points: [
          { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
          { x: 1, y: 0, ix: 1, iy: 0, ox: 1, oy: 0 },
        ],
        closed: false,
        fill: '',
        fillEnabled: false,
        stroke: '#f00',
        strokeWidth: 8,
        radius: 0,
      },
    });
    expect(filledArea(ringsOf(vectorOps.outlineStroke(line)))).toBe(200 * 8);
  });

  it('Outline Stroke keeps a filled shape’s fill as its own layer', () => {
    const box = makeLayer({
      kind: 'shape',
      name: 'Box',
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      shape: { shape: 'rectangle', fill: '#0af', stroke: '#000', strokeWidth: 4, fillEnabled: true, radius: 0 },
    });
    store.addDoc({ title: 'Outline', width: 300, height: 300, layers: [box] });
    store.selectLayer(box.id);
    expect(vectorOps.outlineActiveStroke().applied).toBe(true);
    const [fill, outline] = store.doc!.layers;
    expect(fill.shape!.strokeWidth).toBe(0);
    expect(fill.shape!.fill).toBe('#0af');
    expect(outline.name).toBe('Box Outlined');
    expect(store.doc!.activeId).toBe(outline.id);
  });
});

describe('polygonClipping - divide', () => {
  it('splits two overlapping squares into three regions with their owners', () => {
    const regions = divideRings([rect(0, 0, 100, 100), rect(50, 50, 100, 100)]);
    const summary = regions.map((r) => ({ area: filledArea(r.rings), owners: r.owners })).sort((a, b) => a.owners.join().localeCompare(b.owners.join()));
    expect(summary).toEqual([
      { area: 7500, owners: [0] },
      { area: 2500, owners: [0, 1] },
      { area: 7500, owners: [1] },
    ]);
  });

  it('a shape inside another gives a ring with a hole and the inner piece', () => {
    const regions = divideRings([rect(0, 0, 100, 100), rect(25, 25, 50, 50)]);
    expect(regions.map((r) => filledArea(r.rings)).sort((a, b) => a - b)).toEqual([2500, 7500]);
    const ring = regions.find((r) => r.rings.length === 2)!;
    expect(pointInRings({ x: 50, y: 50 }, ring.rings)).toBe(false);
  });

  it('every region has a point inside it, and regions never overlap', () => {
    const shapes = [circle(80, 80, 50), rect(60, 40, 90, 60), circle(120, 110, 40)];
    const regions = divideRings(shapes);
    expect(regions.length).toBeGreaterThanOrEqual(7);
    for (const r of regions) expect(pointInRings(r.inside, r.rings)).toBe(true);
    // The regions tile the union exactly
    const total = regions.reduce((sum, r) => sum + filledArea(r.rings), 0);
    expect(Math.abs(total - filledArea(uniteRings(shapes)))).toBeLessThanOrEqual(regions.length * 2);
  });
});

describe('vectorOps - Shape Builder and Divide', () => {
  beforeEach(() => {
    store.state.docs = [];
    store.state.activeDocId = null;
  });

  const sq = (name: string, x: number, y: number, fill: string) =>
    makeLayer({ kind: 'shape', name, x, y, width: 100, height: 100, shape: { shape: 'rectangle', fill, stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });

  const setup = () => {
    const a = sq('A', 0, 0, '#f00');
    const b = sq('B', 50, 50, '#00f');
    store.addDoc({ title: 'Builder', width: 300, height: 300, layers: [a, b] });
    store.setSelectedLayers([a.id, b.id]);
    return vectorOps.shapeBuilderRegions()!;
  };

  const ringsOfLayer = (l: ReturnType<typeof makeLayer>): PolygonRing[] =>
    (l.shape!.compoundPoints ?? [l.shape!.points!]).map((s) => s.map((p) => ({ x: l.x + p.x * l.width, y: l.y + p.y * l.height })));

  it('Divide makes one shape per region, coloured by the topmost shape covering it', () => {
    setup();
    expect(vectorOps.pathfinderDivide().applied).toBe(true);
    const layers = store.doc!.layers;
    expect(layers.length).toBe(3);
    const overlap = layers.find((l) => filledArea(ringsOfLayer(l)) === 2500)!;
    expect(overlap.shape!.fill).toBe('#00f');
  });

  it('merging two regions joins them and keeps the third separate', () => {
    const b = setup();
    const left = vectorOps.regionAt(b.regions, 20, 20);
    const mid = vectorOps.regionAt(b.regions, 75, 75);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(vectorOps.applyShapeBuilder([left, mid], false)).toBe(true);
    const areas = store.doc!.layers.map((l) => filledArea(ringsOfLayer(l))).sort((x, y) => x - y);
    expect(areas).toEqual([7500, 10000]);
  });

  it('⌥ deletes the picked region', () => {
    const b = setup();
    expect(vectorOps.applyShapeBuilder([vectorOps.regionAt(b.regions, 75, 75)], true)).toBe(true);
    const layers = store.doc!.layers;
    expect(layers.length).toBe(2);
    expect(layers.every((l) => !pointInRings({ x: 75, y: 75 }, ringsOfLayer(l)))).toBe(true);
  });
});

describe('vectorOps - curves survive Pathfinder', () => {
  beforeEach(() => {
    store.state.docs = [];
    store.state.activeDocId = null;
  });

  const shape = (kind: 'ellipse' | 'rectangle', x: number, y: number) =>
    makeLayer({ kind: 'shape', name: kind, x, y, width: 100, height: 100, shape: { shape: kind, fill: '#f00', stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });

  it('uniting two circles gives smooth anchors with just two corners where they cross', () => {
    const a = shape('ellipse', 0, 0);
    const b = shape('ellipse', 60, 0);
    store.addDoc({ title: 'Curves', width: 300, height: 300, layers: [a, b] });
    store.setSelectedLayers([a.id, b.id]);
    expect(vectorOps.applyPathfinder('unite').applied).toBe(true);
    const pts = store.doc!.layers[0].shape!.points!;
    const corners = pts.filter((p) => p.type === 'corner').length;
    expect(corners).toBe(2);
    expect(pts.filter((p) => p.type === 'smooth').length).toBeGreaterThan(8);
  });

  it('straight shapes keep sharp corners', () => {
    const a = shape('rectangle', 0, 0);
    const b = shape('rectangle', 50, 50);
    store.addDoc({ title: 'Rects', width: 300, height: 300, layers: [a, b] });
    store.setSelectedLayers([a.id, b.id]);
    vectorOps.applyPathfinder('unite');
    const pts = store.doc!.layers[0].shape!.points!;
    expect(pts.length).toBe(8);
    expect(pts.every((p) => p.type === 'corner')).toBe(true);
  });
});

describe('vectorOps - Simplify Path', () => {
  beforeEach(() => {
    store.state.docs = [];
    store.state.activeDocId = null;
  });

  it('a dense hand-drawn circle shrinks to a few smooth anchors that stay on the outline', () => {
    const n = 120;
    const points = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      const x = 0.5 + 0.5 * Math.cos(t);
      const y = 0.5 + 0.5 * Math.sin(t);
      return { x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' as const };
    });
    const l = makeLayer({ kind: 'shape', name: 'Scribble', x: 0, y: 0, width: 200, height: 200, shape: { shape: 'path', points, closed: true, fill: '#f00', stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
    store.addDoc({ title: 'Simplify', width: 300, height: 300, layers: [l] });
    store.selectLayer(l.id);
    const r = vectorOps.simplifyActivePath();
    expect(r.applied).toBe(true);
    expect(r.after).toBeLessThan(40);
    const out = store.doc!.layers[0];
    const pts = out.shape!.points!;
    expect(pts.every((p) => p.type === 'smooth')).toBe(true);
    // Every kept anchor is still on the circle (radius 100 around 100,100), within 1 px
    for (const p of pts) expect(Math.abs(Math.hypot(out.x + p.x * out.width - 100, out.y + p.y * out.height - 100) - 100)).toBeLessThan(1);
  });
});
