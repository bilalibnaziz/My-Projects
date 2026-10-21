import { describe, expect, it } from 'vitest';
import { DEFAULT_DOC_GRID, GRID_PRESETS, autoGrid, autoGridSpecs, carouselSlides, goldenSpiral, gridGeometry, gridLevels, gridSnapLines, snapStep, tracks } from '../core/grids';
import type { GridSpec } from '../core/grids';
import { snapMove, snapPoint, snapTargets } from '../core/snap';

const spec = (s: Partial<GridSpec>): GridSpec => ({ id: 't', kind: 'columns', visible: true, color: '#f00', ...s });

describe('layout grid geometry', () => {
  it('splits columns exactly: margins + tracks + gutters fill the width', () => {
    const t = tracks(1440, 12, 24, 80);
    expect(t.starts).toHaveLength(12);
    expect(t.starts[0]).toBe(80);
    const end = t.starts[11] + t.size;
    expect(end).toBeCloseTo(1440 - 80, 6);
    expect(t.starts[1] - t.starts[0] - t.size).toBeCloseTo(24, 6);
  });

  it('centres fixed-size columns', () => {
    const t = tracks(1920, 12, 24, 0, 'center', 88);
    const total = 12 * 88 + 11 * 24;
    expect(t.starts[0]).toBeCloseTo((1920 - total) / 2, 6);
  });

  it('columns snap on both edges of every track', () => {
    const g = gridGeometry(spec({ count: 4, gutter: 16, margin: 16 }), 375, 800);
    expect(g.snapX).toHaveLength(8);
    expect(g.bands).toHaveLength(4);
  });

  it('thirds and golden lines', () => {
    expect(gridGeometry(spec({ kind: 'thirds' }), 900, 600).snapX).toEqual([300, 600]);
    const gold = gridGeometry(spec({ kind: 'golden' }), 1000, 1000).snapX;
    expect(gold[0]).toBeCloseTo(381.966, 2);
    expect(gold[1]).toBeCloseTo(618.034, 2);
  });

  it('safe insets and bleed outsets', () => {
    const s = gridGeometry(spec({ kind: 'safe', inset: [10, 20, 30, 40] }), 500, 400).rects[0];
    expect(s).toMatchObject({ x: 40, y: 10, w: 440, h: 360 });
    const b = gridGeometry(spec({ kind: 'bleed', inset: [36, 36, 36, 36] }), 500, 400).rects[0];
    expect(b).toMatchObject({ x: -36, y: -36, w: 572, h: 472 });
  });

  it('aspect crop is centred, the right ratio, and shades the rest', () => {
    const g = gridGeometry(spec({ kind: 'aspect', ratio: 9 / 16 }), 1920, 1080);
    const r = g.rects[0];
    expect(r.w / r.h).toBeCloseTo(9 / 16, 6);
    expect(r.h).toBe(1080);
    expect(r.x).toBeCloseTo((1920 - r.w) / 2, 6);
    expect(g.shade).toHaveLength(2);
  });

  it('diagonal reciprocals meet the far edges at right angles to the diagonal', () => {
    const g = gridGeometry(spec({ kind: 'diagonals' }), 1600, 900);
    expect(g.lines).toHaveLength(6);
    const [x1, y1, x2, y2] = g.lines[2]; // from (0,0), perpendicular to the (w,0)–(0,h) diagonal
    const dot = (x2 - x1) * -1600 + (y2 - y1) * 900;
    expect(Math.abs(dot)).toBeLessThan(1e-6);
    expect(x2 <= 1600 + 1e-9 && y2 <= 900 + 1e-9).toBe(true);
  });

  it('golden spiral stays inside the frame and ends near its eye', () => {
    const pts = goldenSpiral(1618, 1000);
    for (let i = 0; i < pts.length; i += 2) {
      expect(pts[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(pts[i]).toBeLessThanOrEqual(1618 + 1e-6);
      expect(pts[i + 1]).toBeLessThanOrEqual(1000 + 1e-6);
    }
    const ex = pts[pts.length - 2];
    const ey = pts[pts.length - 1];
    // The eye of a golden spiral in a φ×1 frame sits near (0.7236 φ', 0.7236) — inside the inner golden section
    expect(ex / 1618).toBeGreaterThan(0.55);
    expect(ex / 1618).toBeLessThan(0.8);
    expect(ey / 1000).toBeGreaterThan(0.55);
    expect(ey / 1000).toBeLessThan(0.8);
  });

  it('panels label every panel between folds', () => {
    const g = gridGeometry(spec({ kind: 'panels', positions: [300, 600], names: ['A', 'B', 'C'] }), 900, 300);
    expect(g.labels.map((l) => [l.text, l.x])).toEqual([['A', 150], ['B', 450], ['C', 750]]);
  });

  it('turning snap off removes snap lines', () => {
    expect(gridGeometry(spec({ kind: 'thirds', snap: false }), 900, 600).snapX).toEqual([]);
  });

  it('snap lines are placed in document space on the artboard', () => {
    const l = gridSnapLines([spec({ kind: 'center' })], { x: 1000, y: 200, w: 400, h: 300 });
    expect(l.xs).toEqual([1200]);
    expect(l.ys).toEqual([350]);
  });
});

describe('presets and Auto Grid', () => {
  it('every preset builds valid grids on common sizes', () => {
    for (const [w, h] of [[1080, 1080], [1080, 1920], [1920, 1080], [2480, 3508], [3240, 1350]]) {
      for (const p of GRID_PRESETS) {
        const specs = p.build({ w, h, dpi: 300 });
        expect(specs.length, p.id).toBeGreaterThan(0);
        for (const s of specs) {
          const g = gridGeometry({ ...s, id: 'x', visible: true }, w, h);
          const nums = [...g.snapX, ...g.snapY, ...g.lines.flat(), ...g.bands.flatMap((b) => [b.x, b.y, b.w, b.h])];
          expect(nums.every(Number.isFinite), `${p.id} on ${w}×${h}`).toBe(true);
        }
      }
    }
  });

  it('preset ids are unique', () => {
    expect(new Set(GRID_PRESETS.map((p) => p.id)).size).toBe(GRID_PRESETS.length);
  });

  it('reads the artboard', () => {
    expect(autoGrid(1080, 1920).presets).toEqual(['social-reel']);
    expect(autoGrid(1080, 1350).presets).toEqual(['social-portrait']);
    expect(autoGrid(1080, 1080).presets).toEqual(['social-square']);
    expect(autoGrid(1920, 1080).presets).toContain('video-broadcast');
    expect(autoGrid(1280, 720).presets).toEqual(['social-thumb']);
    expect(autoGrid(3240, 1080).presets).toEqual(['social-carousel']);
    expect(autoGrid(2480, 3508, 300).presets).toContain('print-bleed');
    expect(autoGrid(375, 812).presets).toEqual(['web-mobile']);
    expect(carouselSlides(4320, 1350)).toBe(4);
  });

  it('carousel panels cut the strip into equal slides', () => {
    const { specs } = autoGridSpecs(3240, 1080);
    const panels = specs.find((s) => s.kind === 'panels')!;
    expect(panels.positions).toEqual([1080, 2160]);
  });

  it('print bleed is 3 mm at the page dpi', () => {
    const b = GRID_PRESETS.find((p) => p.id === 'print-bleed')!.build({ w: 2480, h: 3508, dpi: 300 })[0];
    expect(b.inset![0]).toBeCloseTo((3 / 25.4) * 300, 6);
  });
});

describe('super zoom document grid', () => {
  it('always shows lines 6–80 px apart, at any zoom', () => {
    for (const zoom of [0.02, 0.1, 0.5, 1, 3, 10, 64, 640]) {
      const lv = gridLevels(DEFAULT_DOC_GRID, zoom);
      expect(lv.length).toBeGreaterThan(0);
      const px = lv[0].step * zoom;
      expect(px, `zoom ${zoom}`).toBeGreaterThanOrEqual(6);
      expect(px, `zoom ${zoom}`).toBeLessThan(6 * DEFAULT_DOC_GRID.subdivisions + 1e-9);
    }
  });

  it('snaps finer as you zoom in', () => {
    expect(snapStep(DEFAULT_DOC_GRID, 1)).toBeGreaterThan(snapStep(DEFAULT_DOC_GRID, 64));
    expect(snapStep(DEFAULT_DOC_GRID, 640)).toBeLessThan(1);
  });

  it('fixed grid keeps its own spacing', () => {
    const lv = gridLevels({ ...DEFAULT_DOC_GRID, adaptive: false }, 1);
    expect(lv.map((l) => l.step)).toEqual([25, 100]);
  });
});

describe('grid snapping', () => {
  it('snaps a moved box to a repeating grid step', () => {
    const t = snapTargets(10000, 10000, [], { xs: [], ys: [], steps: [{ x: { step: 25, origin: 0 }, y: { step: 25, origin: 0 } }] });
    // Far from the canvas edges: only the grid can catch it
    const s = snapMove({ x: 4000, y: 4000, width: 40, height: 40 }, 23, 51, t, 6);
    expect(s.dx).toBe(25);
    expect(s.dy).toBe(50);
  });

  it('snaps to layout lines', () => {
    const t = snapTargets(1000, 1000, [], { xs: [333.3], ys: [] });
    const s = snapMove({ x: 100, y: 100, width: 50, height: 50 }, 230, 0, t, 6);
    expect(s.guideX).toBeCloseTo(333.3);
  });

  it('snaps single points with sub-pixel grids (super zoom)', () => {
    const t = snapTargets(1000, 1000, [], { xs: [], ys: [], steps: [{ x: { step: 0.25, origin: 0 }, y: { step: 0.25, origin: 0 } }] });
    const p = snapPoint(10.13, 20.61, t, 0.2);
    expect(p.x).toBeCloseTo(10.25, 9);
    expect(p.y).toBeCloseTo(20.5, 9);
  });
});
