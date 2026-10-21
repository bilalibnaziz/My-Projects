// Text → vector outlines (Type ▸ Create Outlines, and real vector text in PDF export). The browser
// gives no glyph outlines for system / Google / added fonts, so the text is rendered alone at a high
// resolution (glyphs ≈ 220 px tall) and traced with its own exact colours: the 50 % alpha edge the
// tracer follows is the glyph edge, so outlines land within a small fraction of a document pixel.

import type { Doc, Layer } from './types';
import { makeLayer } from './types';
import { DocRenderer, layerSurface } from './render';
import { placeTrace, tracePixels } from './tracer';
import { ctx2d } from './canvas';
import { parseColor } from './formats/vectorPdf';

const hex = (c: string) => {
  const [r, g, b] = parseColor(c);
  return '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
};

/** Every colour a text layer paints with: fill, per-run colours, stroke and caption box. */
function textColors(l: Layer): string[] {
  const t = l.text!;
  const out = new Set<string>([hex(t.color)]);
  for (const r of t.runs ?? []) if (r.color) out.add(hex(r.color));
  if (t.stroke > 0) out.add(hex(t.strokeColor));
  if (t.box) out.add(hex(t.boxColor ?? '#000000'));
  return [...out];
}

/**
 * Vector outlines of a text layer, as compound-path shape layers (one per colour) in document
 * space, or null if it draws nothing. Accuracy is a small fraction of a document pixel.
 */
export function textToOutlines(doc: Doc, l: Layer): Layer[] | null {
  if (l.kind !== 'text' || !l.text) return null;
  const surf = layerSurface(l);
  if (!surf) return null;
  // Box of what the text draws (rotation and warp included), in document units
  const bx = surf.x;
  const by = surf.y;
  const bw = surf.canvas.width;
  const bh = surf.canvas.height;
  // Glyphs ≈ 360 px tall; a stroke also needs to be ≥ 24 px wide so its edges trace smooth
  const t = l.text;
  let s = Math.max(2, Math.min(24, Math.max(360 / Math.max(4, t.size), t.stroke > 0 ? 24 / t.stroke : 0)));
  while (bw * s * bh * s > 24e6 && s > 1) s *= 0.8;
  const view = { s, ox: bx * s, oy: by * s, w: Math.max(1, Math.ceil(bw * s)), h: Math.max(1, Math.ceil(bh * s)) };
  const solo: Doc = { ...doc, layers: [{ ...l, parent: undefined, opacity: 1, blend: 'normal', clip: false }] };
  const out = new DocRenderer().render(solo, undefined, view);
  const img = ctx2d(out).getImageData(0, 0, out.width, out.height);
  const res = tracePixels(img, { mode: 'color', palette: textColors(l), ignoreWhite: false, minArea: Math.round(s * s * 0.15), simplification: Math.max(0.6, s * 0.06), cornerThreshold: 60 });
  if (!res.layers.length) return null;
  const placed = placeTrace(res, bx, by, 1 / s);
  return placed.layers.map((p, i) =>
    makeLayer({
      ...p,
      kind: 'shape',
      name: res.layers.length > 1 ? `${l.name} · ${res.colors[i]}` : l.name,
      parent: l.parent,
      opacity: l.opacity,
      blend: l.blend,
      visible: l.visible,
      locked: false,
      shape: { ...p.shape!, strokeWidth: 0 },
    }),
  );
}
