import { describe, it, expect, beforeAll } from 'vitest';
import { blendNonSeparable, colorMatch } from '../core/brush';
import { anchorsBounds, measure, quickDab, redness, rgbToCmyk, rgbToHsb, rgbToLab, straightenAngle } from '../core/proTools';
import { distributeDeltas } from '../core/align';

describe('color replacement blend math (W3C non-separable modes)', () => {
  const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

  it('Color keeps the pixel luminosity exactly', () => {
    const px: [number, number, number] = [120, 90, 60];
    const out = blendNonSeparable(px, [0, 0, 255], 'color');
    expect(lum(out)).toBeCloseTo(lum(px), 6);
    expect(out[2]).toBeGreaterThan(out[0]); // now blue-ish
  });
  it('Luminosity keeps the pixel color, takes the source brightness', () => {
    const out = blendNonSeparable([200, 40, 40], [128, 128, 128], 'luminosity');
    expect(lum(out)).toBeCloseTo(128, 6);
    expect(out[0]).toBeGreaterThan(out[1]);
  });
  it('gray stays gray under Hue (no saturation to carry a hue)', () => {
    const out = blendNonSeparable([100, 100, 100], [255, 0, 0], 'hue');
    expect(out.map(Math.round)).toEqual([100, 100, 100]);
  });
  it('results stay in gamut', () => {
    for (const mode of ['color', 'hue', 'saturation', 'luminosity'] as const) {
      const out = blendNonSeparable([250, 250, 10], [0, 255, 255], mode);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(255 + 1e-9);
      }
    }
  });
});

describe('color tolerance', () => {
  it('matches fully inside tolerance and not at all well outside', () => {
    expect(colorMatch(110, 100, 100, [100, 100, 100], 10)).toBe(1);
    expect(colorMatch(150, 100, 100, [100, 100, 100], 10)).toBe(0);
    const edge = colorMatch(111, 100, 100, [100, 100, 100], 10);
    expect(edge).toBeGreaterThanOrEqual(0);
    expect(edge).toBeLessThan(1);
  });
});

describe('Info panel color models', () => {
  it('HSB', () => {
    expect(rgbToHsb([255, 0, 0])).toEqual([0, 100, 100]);
    expect(rgbToHsb([0, 128, 255])).toEqual([210, 100, 100]);
    expect(rgbToHsb([128, 128, 128])).toEqual([0, 0, 50]);
  });
  it('Lab (D65) matches reference values', () => {
    expect(rgbToLab([255, 255, 255])).toEqual([100, 0, 0]);
    expect(rgbToLab([0, 0, 0])).toEqual([0, 0, 0]);
    expect(rgbToLab([255, 0, 0])).toEqual([53, 80, 67]);
    expect(rgbToLab([0, 0, 255])).toEqual([32, 79, -108]);
  });
  it('CMYK', () => {
    expect(rgbToCmyk([0, 0, 0])).toEqual([0, 0, 0, 100]);
    expect(rgbToCmyk([255, 0, 0])).toEqual([0, 100, 100, 0]);
    expect(rgbToCmyk([255, 255, 255])).toEqual([0, 0, 0, 0]);
  });
});

describe('ruler', () => {
  it('measures length and counter-clockwise angle like Photoshop', () => {
    const m = measure({ x: 0, y: 0 }, { x: 30, y: -40 });
    expect(m.length).toBe(50);
    expect(m.angle).toBeCloseTo(53.13, 2);
    expect(measure({ x: 0, y: 0 }, { x: -10, y: 0 }).angle).toBeCloseTo(180, 6);
  });
  it('straighten rotates the line to exactly level or plumb', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 5 }; // tilted 2.86° down
    const rot = straightenAngle(a, b);
    const theta = Math.atan2(5, 100) + rot;
    expect(theta).toBeCloseTo(0, 12);
    // Mostly vertical lines go plumb instead
    const v = straightenAngle({ x: 0, y: 0 }, { x: 3, y: 100 });
    expect(Math.atan2(100, 3) + v).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('distribute', () => {
  const boxes = [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 13, y: 0, width: 30, height: 10 },
    { x: 100, y: 0, width: 20, height: 10 },
  ];
  it('equal gaps between neighbours (spacing)', () => {
    const d = distributeDeltas(boxes, 'hspace');
    const moved = boxes.map((b, i) => ({ ...b, x: b.x + d[i].dx }));
    const gap1 = moved[1].x - (moved[0].x + moved[0].width);
    const gap2 = moved[2].x - (moved[1].x + moved[1].width);
    expect(Math.abs(gap1 - gap2)).toBeLessThanOrEqual(1);
    expect(d[0].dx).toBe(0);
    expect(d[2].dx).toBe(0); // outermost stay put
  });
  it('equal centre spacing, whole pixels, regardless of input order', () => {
    const shuffled = [boxes[2], boxes[0], boxes[1]];
    const d = distributeDeltas(shuffled, 'hcenter');
    const centers = shuffled.map((b, i) => b.x + d[i].dx + b.width / 2).sort((a, b) => a - b);
    // Whole-pixel positions: spacing can differ by at most one pixel
    expect(Math.abs(centers[1] - centers[0] - (centers[2] - centers[1]))).toBeLessThanOrEqual(1);
    for (const x of d) expect(Number.isInteger(x.dx)).toBe(true);
  });
  it('needs three or more', () => {
    expect(distributeDeltas(boxes.slice(0, 2), 'hcenter').every((x) => x.dx === 0 && x.dy === 0)).toBe(true);
  });
});

describe('pen paths', () => {
  it('bounds include handles so the curve always fits', () => {
    const b = anchorsBounds([
      { x: 10, y: 10, ix: 10, iy: 10, ox: 40, oy: -20 },
      { x: 60, y: 10, ix: 50, iy: 40, ox: 60, oy: 10 },
    ]);
    expect(b).toEqual({ x: 10, y: -20, width: 50, height: 60 });
  });
});

describe('red eye', () => {
  it('scores red pupils high and skin / neutrals low', () => {
    expect(redness(200, 30, 30)).toBeGreaterThan(0.8);
    expect(redness(220, 170, 150)).toBeLessThan(0.25);
    expect(redness(90, 90, 90)).toBe(0);
    expect(redness(30, 0, 0)).toBe(0); // too dark to judge
  });
});

describe('quick selection', () => {
  // 20×10 image: left half red, right half blue
  const w = 20, h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data.set(x < 10 ? [220, 20, 20, 255] : [20, 20, 220, 255], i);
    }
  it('grows through similar connected color and stops at the edge', () => {
    const q = { data, w, h, mask: new Uint8Array(w * h), palette: [] as [number, number, number][] };
    quickDab(q, 3, 5, 1.5, 32);
    let left = 0, right = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (q.mask[y * w + x]) (x < 10 ? left++ : right++);
    expect(left).toBe(100);
    expect(right).toBe(0);
  });
  it('a second dab on the other color adds that region too', () => {
    const q = { data, w, h, mask: new Uint8Array(w * h), palette: [] as [number, number, number][] };
    quickDab(q, 3, 5, 1.5, 32);
    quickDab(q, 15, 5, 1.5, 32);
    expect(q.mask.every((v) => v === 255)).toBe(true);
  });
});

describe('smart layer targeting and auto-generation on edit (SkillVector)', () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = function (this: any, type: string) {
      if (type !== '2d') return null;
      const self = this as any;
      const w = this.width || 100;
      const h = this.height || 100;
      if (!self._pixels || self._pixelsW !== w || self._pixelsH !== h) {
        self._pixels = new Uint8ClampedArray(w * h * 4);
        self._pixelsW = w;
        self._pixelsH = h;
      }
      if (self._ctx) return self._ctx;
      self._ctx = {
        canvas: this,
        fillStyle: '#000000',
        globalCompositeOperation: 'source-over',
        getImageData: (x: number, y: number, sw: number, sh: number) => ({
          data: new Uint8ClampedArray(sw * sh * 4),
          width: sw,
          height: sh,
        }),
        putImageData: () => {},
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => {},
        save: () => {},
        restore: () => {},
        setTransform: () => {},
        beginPath: () => {},
        rect: () => {},
        fill: () => {},
        stroke: () => {},
      };
      return self._ctx;
    } as any;
  });

  it('edits an active unlocked raster layer directly', async () => {
    const { store } = await import('../core/store');
    const { createCanvas } = await import('../core/canvas');
    const { makeLayer } = await import('../core/types');
    const canvas = createCanvas(100, 100);
    const raster = makeLayer({ kind: 'raster', name: 'Texture', canvas, x: 0, y: 0, width: 100, height: 100 });
    store.addDoc({ title: 'Vector Doc', width: 800, height: 600, layers: [raster] });
    expect(store.activeLayer?.id).toBe(raster.id);

    const edit = store.beginPixelEdit();
    expect(edit).not.toBeNull();
    expect(edit?.layer.id).toBe(raster.id);
  });

  it('auto-generates a new pixel layer when active layer is a shape layer and user edits pixels', async () => {
    const { store } = await import('../core/store');
    const { makeLayer } = await import('../core/types');
    const shape = makeLayer({
      kind: 'shape',
      name: 'Rectangle',
      shape: { shape: 'rectangle', fill: '#ff0000', fillEnabled: true, stroke: '#000', strokeWidth: 1, radius: 0, sides: 4 },
      x: 50, y: 50, width: 200, height: 150,
    });
    store.addDoc({ title: 'Vector Doc', width: 800, height: 600, layers: [shape] });
    expect(store.activeLayer?.kind).toBe('shape');

    const edit = store.beginPixelEdit();
    expect(edit).not.toBeNull();
    expect(edit?.layer.kind).toBe('raster');
    expect(edit?.layer.id).not.toBe(shape.id);
    expect(store.doc?.layers.length).toBe(2);
    expect(store.activeLayer?.id).toBe(edit?.layer.id);
  });

  it('allows vector objects to be positioned anywhere on the large pasteboard canvas outside the artboard', async () => {
    const { store } = await import('../core/store');
    const { makeLayer } = await import('../core/types');
    const { selectionFrame } = await import('../core/objectTransform');
    // Artboard is 800x600, place shapes far outside on the pasteboard
    const pasteboardShape = makeLayer({
      kind: 'shape',
      name: 'Draft Icon',
      shape: { shape: 'ellipse', fill: '#00ff00', fillEnabled: true, stroke: '#000', strokeWidth: 2, radius: 0, sides: 0 },
      x: -500, y: -300, width: 120, height: 120,
    });
    const farRightShape = makeLayer({
      kind: 'shape',
      name: 'Secondary Board',
      shape: { shape: 'rectangle', fill: '#0000ff', fillEnabled: true, stroke: '#000', strokeWidth: 1, radius: 0, sides: 4 },
      x: 2500, y: 1200, width: 400, height: 300,
    });
    store.addDoc({ title: 'Vector Workspace', width: 800, height: 600, layers: [pasteboardShape, farRightShape] });

    // Verify both layers are registered and selectable on the workable canvas
    store.selectLayer(pasteboardShape.id);
    expect(store.activeLayer?.id).toBe(pasteboardShape.id);
    expect(store.activeLayer?.x).toBe(-500);

    const frame = selectionFrame([pasteboardShape]);
    expect(frame).not.toBeNull();
    expect(frame?.cx).toBe(-500 + 60);
    expect(frame?.cy).toBe(-300 + 60);
  });
});
