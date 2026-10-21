// Gradient stop colours with alpha: stops store '#rrggbb' or '#rrggbbaa', which canvas, SVG export
// (stop-opacity) and PDF export (raster fallback for translucent stops) all read.

import type { ShapeGradient } from './types';

type Stop = ShapeGradient['stops'][number];

/** '#rrggbb' + alpha (0..1) from any '#rgb', '#rrggbb' or '#rrggbbaa' colour. */
export function splitAlpha(c: string): { hex: string; a: number } {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
  if (!m) return { hex: '#000000', a: 1 };
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return { hex: `#${h.toLowerCase()}`, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
export const joinAlpha = (hex: string, a: number) => (a >= 0.999 ? hex : `${hex}${Math.round(Math.max(0, a) * 255).toString(16).padStart(2, '0')}`);

/** The colour of a gradient at an offset (for a new stop), alpha included. */
export function colorAt(stops: Stop[], t: number): string {
  const st = [...stops].sort((a, b) => a.offset - b.offset);
  if (t <= st[0].offset) return st[0].color;
  for (let i = 1; i < st.length; i++) {
    if (t <= st[i].offset) {
      const a = splitAlpha(st[i - 1].color), b = splitAlpha(st[i].color);
      const k = (t - st[i - 1].offset) / (st[i].offset - st[i - 1].offset || 1);
      const ch = (s: string, j: number) => parseInt(s.slice(1 + j * 2, 3 + j * 2), 16);
      const mix = [0, 1, 2].map((j) => Math.round(ch(a.hex, j) + (ch(b.hex, j) - ch(a.hex, j)) * k).toString(16).padStart(2, '0')).join('');
      return joinAlpha(`#${mix}`, a.a + (b.a - a.a) * k);
    }
  }
  return st[st.length - 1].color;
}

