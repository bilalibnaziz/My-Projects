import { describe, expect, it } from 'vitest';
import { dielineLayers, mmToPx, tuckBoxDieline } from '../core/dieline';

type Pt = { x: number; y: number };

const area = (pts: Pt[]) => pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p.x * q.y - q.x * p.y;
}, 0) / 2;

// Proper crossing of segments ab and cd (shared endpoints don't count)
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

describe('tuck box dieline', () => {
  const spec = { length: 60, width: 30, depth: 120, glue: 15, tuck: 15 };
  const d = tuckBoxDieline(spec);
  const k = (mm: number) => mmToPx(mm);

  it('lays the panels out at the right size', () => {
    expect(d.width).toBeCloseTo(k(15 + 60 + 30 + 60 + 30), 6);
    expect(d.height).toBeCloseTo(k(120 + 2 * (30 + 15)), 6);
    for (const p of d.cut) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(d.width + 1e-6);
      expect(p.y).toBeLessThanOrEqual(d.height + 1e-6);
    }
  });

  it('has a simple (non-self-intersecting) cut outline', () => {
    const n = d.cut.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        expect(crosses(d.cut[i], d.cut[(i + 1) % n], d.cut[j], d.cut[(j + 1) % n])).toBe(false);
      }
    }
  });

  it('encloses the body panels plus flaps', () => {
    const body = k(60 + 30 + 60 + 30) * k(120);
    const closures = 2 * k(60) * k(30);
    // Body + two closures, plus glue, tucks and dust flaps (less than their bounding boxes)
    const a = Math.abs(area(d.cut));
    expect(a).toBeGreaterThan(body + closures);
    expect(a).toBeLessThan(d.width * d.height);
  });

  it('puts every fold inside the outline', () => {
    const inside = (p: Pt) => {
      let c = false;
      const pts = d.cut;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    for (const [a, b] of d.folds) expect(inside({ x: (a.x + b.x) / 2 + 0.01, y: (a.y + b.y) / 2 + 0.01 })).toBe(true);
  });

  it('becomes a cut path and dashed fold lines', () => {
    const layers = dielineLayers(d, 100, 50);
    expect(layers[0].shape?.shape).toBe('path');
    expect(layers[0].shape?.closed).toBe(true);
    expect(layers[0].x).toBe(100);
    expect(layers.slice(1).every((l) => l.shape?.shape === 'line' && (l.shape.strokeDash?.length ?? 0) > 0)).toBe(true);
    expect(layers.length).toBe(1 + d.folds.length);
  });
});

describe('packaging studio 2.0 box types', () => {
  const boxTypes = ['straight-tuck', 'snap-lock', 'auto-lock', 'mailer-box', 'pillow-box', 'sleeve'] as const;
  for (const type of boxTypes) {
    it(`generates valid dieline for ${type}`, async () => {
      const { generateDieline } = await import('../core/dieline');
      const res = generateDieline({ type, length: 70, width: 35, depth: 100, ppi: 150 });
      expect(res.width).toBeGreaterThan(0);
      expect(res.height).toBeGreaterThan(0);
      expect(res.cut.length).toBeGreaterThan(4);
      expect(res.folds.length).toBeGreaterThan(0);
      expect(res.annotations?.length).toBeGreaterThan(0);
    });
  }

  it('supports custom dotted and dashed fold styles', async () => {
    const { generateDieline, dielineLayers } = await import('../core/dieline');
    const d = generateDieline({ type: 'straight-tuck', length: 50, width: 30, depth: 80 });
    const dotted = dielineLayers(d, 0, 0, 2, { length: 50, width: 30, depth: 80, foldStyle: 'dotted' });
    const dashed = dielineLayers(d, 0, 0, 2, { length: 50, width: 30, depth: 80, foldStyle: 'dashed' });
    expect(dotted[1].shape?.strokeDash).toEqual([3, 6]);
    expect(dashed[1].shape?.strokeDash).toEqual([12, 8]);
  });
});

