import { describe, expect, it } from 'vitest';
import { importSvg, parseColor, parsePathData, parseTransform } from '../core/formats/svgImport';

const wrap = (body: string, attrs = 'width="200" height="100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
// A layer's anchors in document space
const docPts = (l: { x: number; y: number; width: number; height: number; shape?: { points?: { x: number; y: number }[] } }) =>
  (l.shape?.points ?? []).map((p) => ({ x: l.x + p.x * l.width, y: l.y + p.y * l.height }));

describe('svg import', () => {
  it('parses colours', () => {
    expect(parseColor('#abc')).toBe('#aabbcc');
    expect(parseColor('red')).toBe('#ff0000');
    expect(parseColor('rgb(255, 0, 10)')).toBe('#ff000a');
    expect(parseColor('#000000', 0.5)).toBe('#00000080');
    expect(parseColor('none')).toBeNull();
  });

  it('parses transforms in order', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(m).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform('rotate(90)');
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[1]).toBeCloseTo(1, 9);
  });

  it('parses every path command, relative and absolute', () => {
    const subs = parsePathData('M10 10 h20 v20 H10 Z m40 0 c0 -10 20 -10 20 0 s20 10 20 0 q10 10 20 0 t20 0 a10 10 0 0 1 20 0');
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[0].pts.map((p) => [p.x, p.y])).toEqual([[10, 10], [30, 10], [30, 30], [10, 30]]);
    const last = subs[1].pts[subs[1].pts.length - 1];
    expect(last.x).toBeCloseTo(150, 6);
    expect(last.y).toBeCloseTo(10, 6);
  });

  it('turns a half-circle arc into curves through the right top point', () => {
    const [sub] = parsePathData('M0 0 A10 10 0 0 1 20 0');
    const xs = sub.pts.map((p) => p.x);
    const ys = sub.pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(-10, 6);
    expect(xs[xs.length - 1]).toBeCloseTo(20, 6);
  });

  it('keeps rect and circle live, with fill, stroke and size', () => {
    const r = importSvg(wrap('<rect x="10" y="20" width="50" height="30" fill="#ff0000" stroke="blue" stroke-width="4"/><circle cx="100" cy="50" r="20" fill="green"/>'));
    expect(r.width).toBe(200);
    const [rect, circ] = r.layers;
    expect(rect.shape).toMatchObject({ shape: 'rectangle', fill: '#ff0000', fillEnabled: true, stroke: '#0000ff', strokeWidth: 4 });
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([10, 20, 50, 30]);
    expect(circ.shape!.shape).toBe('ellipse');
    expect([circ.x, circ.y, circ.width, circ.height]).toEqual([80, 30, 40, 40]);
  });

  it('applies the viewBox and group transforms to path points', () => {
    const r = importSvg(wrap('<g transform="translate(5 5)"><path d="M0 0 L10 0 L10 10 Z" fill="#000"/></g>', 'width="200" height="200" viewBox="0 0 100 100"'));
    const group = r.layers.find((l) => l.kind === 'group')!;
    const path = r.layers.find((l) => l.kind === 'shape')!;
    expect(path.parent).toBe(group.id);
    // Group comes after its contents (contents sit below it)
    expect(r.layers.indexOf(group)).toBeGreaterThan(r.layers.indexOf(path));
    expect(docPts(path).map((p) => [p.x, p.y])).toEqual([[10, 10], [30, 10], [30, 30]]);
  });

  it('reads <style> class rules, style="" and inheritance', () => {
    const r = importSvg(wrap('<style>.st0{fill:#123456;stroke:#ffffff;stroke-width:2}</style><g fill="red"><rect class="st0" width="10" height="10"/><rect x="20" width="10" height="10" style="fill:#00ff00"/><rect x="40" width="10" height="10"/></g>'));
    const shapes = r.layers.filter((l) => l.kind === 'shape');
    expect(shapes.map((l) => l.shape!.fill)).toEqual(['#123456', '#00ff00', '#ff0000']);
    expect(shapes[0].shape!.strokeWidth).toBe(2);
  });

  it('expands <use>, skips defs and hidden elements, reads gradients', () => {
    const r = importSvg(wrap(`
      <defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
      <path id="tri" d="M0 0 L10 0 L5 10 Z"/></defs>
      <use href="#tri" x="50" y="0" fill="url(#g)"/>
      <rect width="5" height="5" display="none"/>
      <polygon points="0,0 10,0 10,10" fill="none" stroke="#000"/>`));
    const shapes = r.layers.filter((l) => l.kind === 'shape');
    expect(shapes).toHaveLength(2);
    expect(shapes[0].x).toBeCloseTo(50, 6);
    expect(shapes[0].shape!.gradient?.stops.map((s) => s.color)).toEqual(['#ff0000', '#0000ff']);
    expect(shapes[1].shape!.fillEnabled).toBe(false);
  });

  it('imports text with its size, colour and baseline', () => {
    const r = importSvg(wrap('<text x="10" y="50" font-size="20" fill="#333333" font-family="Georgia, serif">Hello world</text>'));
    const t = r.layers[0];
    expect(t.kind).toBe('text');
    expect(t.text).toMatchObject({ text: 'Hello world', size: 20, color: '#333333', font: 'Georgia' });
    expect(t.y).toBeCloseTo(50 - 18, 6);
  });

  it('rejects invalid markup', () => {
    expect(() => importSvg('<svg><g></svg')).toThrow();
  });

  it('reads fill-opacity / stroke-opacity into the shape opacities', () => {
    const r = importSvg(wrap('<rect x="10" y="10" width="50" height="30" fill="#2255ee" fill-opacity="0.5" stroke="#000" stroke-width="2" stroke-opacity="0.25"/>'));
    const s = r.layers.find((l) => l.kind === 'shape')!.shape!;
    expect(s.fill).toBe('#2255ee');
    expect(s.fillOpacity).toBeCloseTo(0.5, 2);
    expect(s.stroke).toBe('#000000');
    expect(s.strokeOpacity).toBeCloseTo(0.25, 2);
  });
});
