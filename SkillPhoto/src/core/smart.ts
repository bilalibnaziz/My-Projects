// Smart Objects: a layer that keeps its original pixels and re-renders them through its transform
// and its Smart Filters. Scaling down and back up, rotating or filtering never loses quality,
// because every render starts again from the untouched source.
//
// The layer's `canvas` / `x` / `y` hold the current render, so the compositor, hit testing and
// export treat a smart object like any pixel layer. The transform is stored relative to the
// layer position, so moving the layer (which only changes x / y) keeps it consistent.

import type { Layer, SmartData, SmartFilter } from './types';
import { withLayer } from './types';
import { alphaBounds, createCanvas, ctx2d } from './canvas';
import { renderTransformed } from './transform';
import type { TransformGeometry } from './transform';
import { filterById } from './filters';

/** Transform box for the smart object's source, in document space. */
export function smartGeometry(s: SmartData, layerX: number, layerY: number): TransformGeometry {
  const cx = layerX + s.ax;
  const cy = layerY + s.ay;
  return {
    source: s.source,
    sx: cx - s.source.width / 2,
    sy: cy - s.source.height / 2,
    tx: 0,
    ty: 0,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    angle: s.angle,
    quad: s.quad?.map((p) => ({ x: p.x + layerX, y: p.y + layerY })),
    mesh: s.mesh?.map((p) => ({ x: p.x + layerX, y: p.y + layerY })),
  };
}

/** Room around the render so blurs and glows aren't cut off at its edge. */
function filterPad(filters: SmartFilter[]): number {
  let pad = 0;
  for (const f of filters) {
    if (!f.enabled) continue;
    const p = f.params;
    pad = Math.max(pad, (p.radius ?? 0) * 3, p.distance ?? 0, p.shift ?? 0, 2);
  }
  return Math.ceil(pad);
}

/** Renders source → transform → Smart Filters. Returns pixels and their document position. */
export function renderSmart(s: SmartData, layerX: number, layerY: number, filters = s.filters): { canvas: HTMLCanvasElement; x: number; y: number } {
  const out = renderTransformed(smartGeometry(s, layerX, layerY));
  const active = filters.filter((f) => f.enabled && filterById(f.id));
  if (!active.length) return out;
  const pad = filterPad(active);
  const c = createCanvas(out.canvas.width + pad * 2, out.canvas.height + pad * 2);
  const ctx = ctx2d(c);
  ctx.drawImage(out.canvas, pad, pad);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (const f of active) filterById(f.id)!.apply(img, f.params);
  ctx.putImageData(img, 0, 0);
  return { canvas: c, x: out.x - pad, y: out.y - pad };
}

/** Re-renders a smart layer after its transform or filters changed, keeping the anchor in place. */
export function rerenderSmart(layer: Layer, smart: SmartData = layer.smart!): Layer {
  const r = renderSmart(smart, layer.x, layer.y);
  // Re-express the transform relative to the new render position
  const dx = layer.x - r.x;
  const dy = layer.y - r.y;
  const shift = (pts?: { x: number; y: number }[]) => pts?.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  const next: SmartData = { ...smart, ax: smart.ax + dx, ay: smart.ay + dy, quad: shift(smart.quad), mesh: shift(smart.mesh) };
  return withLayer(layer, { canvas: r.canvas, x: r.x, y: r.y, width: r.canvas.width, height: r.canvas.height, smart: next });
}

/** Turns pixels (doc-positioned) into a smart object layer patch, cropped to their content. */
export function smartFromPixels(canvas: HTMLCanvasElement, x: number, y: number): Pick<Layer, 'canvas' | 'x' | 'y' | 'width' | 'height' | 'smart'> | null {
  const b = alphaBounds(canvas);
  if (!b) return null;
  const source = createCanvas(b.width, b.height);
  ctx2d(source).drawImage(canvas, -b.x, -b.y);
  const view = createCanvas(b.width, b.height);
  ctx2d(view).drawImage(source, 0, 0);
  return {
    canvas: view,
    x: x + b.x,
    y: y + b.y,
    width: b.width,
    height: b.height,
    smart: { source, scaleX: 1, scaleY: 1, angle: 0, ax: b.width / 2, ay: b.height / 2, filters: [] },
  };
}

/** New contents for a smart object: scaled to cover the old source box, same transform. */
export function replaceSmartSource(layer: Layer, img: HTMLCanvasElement): Layer {
  const s = layer.smart!;
  const { width: w, height: h } = s.source;
  const k = Math.max(w / img.width, h / img.height);
  const source = createCanvas(w, h);
  const ctx = ctx2d(source);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
  return rerenderSmart(layer, { ...s, source });
}
