// An object's whole look (fill, stroke, opacities, gradient, blend, layer styles, type colours) lifted
// off one layer and put on others: the Eyedropper with a selection, and ⌥-click to paint it back.
// Shapes and text share what they have in common (a text's colour is its fill).

import type { Layer, LayerFx, ShapeProps } from './types';
import { withLayer } from './types';
import { splitAlpha } from './gradientStops';

export interface Appearance {
  opacity: number;
  blend: Layer['blend'];
  fx?: LayerFx;
  fillOpacityLayer?: number;
  /** Fill colour ('#rrggbb'), or null when the source has no fill. */
  fill: string | null;
  fillOpacity: number;
  gradient?: ShapeProps['gradient'];
  strokeGradient?: ShapeProps['gradient'];
  pattern?: ShapeProps['pattern'];
  stroke: string | null;
  strokeWidth: number;
  strokeOpacity: number;
  stroke2?: Pick<ShapeProps, 'strokeCap' | 'strokeJoin' | 'strokeMiterLimit' | 'strokeDash' | 'strokeAlign' | 'widthPoints'>;
}

/** The look of a shape or text layer, or null for other kinds. */
export function appearanceOf(l: Layer): Appearance | null {
  const base = { opacity: l.opacity, blend: l.blend, fx: l.fx ? structuredClone(l.fx) : undefined, fillOpacityLayer: l.fill };
  if (l.kind === 'shape' && l.shape) {
    const s = l.shape;
    const f = splitAlpha(s.fill);
    const k = splitAlpha(s.stroke);
    return {
      ...base,
      fill: s.fillEnabled ? f.hex : null,
      fillOpacity: (s.fillOpacity ?? 1) * f.a,
      gradient: s.gradient ? structuredClone(s.gradient) : undefined,
      pattern: s.pattern && s.fillEnabled ? { ...s.pattern } : undefined,
      strokeGradient: s.strokeGradient && s.strokeWidth > 0 ? structuredClone(s.strokeGradient) : undefined,
      stroke: s.strokeWidth > 0 ? k.hex : null,
      strokeWidth: s.strokeWidth,
      strokeOpacity: (s.strokeOpacity ?? 1) * k.a,
      stroke2: { strokeCap: s.strokeCap, strokeJoin: s.strokeJoin, strokeMiterLimit: s.strokeMiterLimit, strokeDash: s.strokeDash ? [...s.strokeDash] : undefined, strokeAlign: s.strokeAlign, widthPoints: s.widthPoints ? structuredClone(s.widthPoints) : undefined },
    };
  }
  if (l.kind === 'text' && l.text) {
    const t = l.text;
    return { ...base, fill: splitAlpha(t.color).hex, fillOpacity: 1, stroke: t.stroke > 0 ? t.strokeColor : null, strokeWidth: t.stroke, strokeOpacity: 1 };
  }
  return null;
}

const opt = (v: number) => (v >= 0.999 ? undefined : v);

/** The target layer wearing the appearance (its geometry, text and name untouched). */
export function applyAppearance(l: Layer, a: Appearance): Layer {
  const common: Partial<Layer> = { opacity: a.opacity, blend: a.blend, fx: a.fx ? structuredClone(a.fx) : undefined, fill: a.fillOpacityLayer };
  if (l.kind === 'shape' && l.shape) {
    const s = l.shape;
    const isLine = s.shape === 'line' || s.shape === 'arrow' || s.shape === 'arc' || s.shape === 'spiral' || (s.shape === 'path' && !s.closed);
    const shape: ShapeProps = {
      ...s,
      ...(a.stroke2 ?? {}),
      fillEnabled: isLine ? s.fillEnabled : a.fill !== null,
      fill: a.fill ?? s.fill,
      fillOpacity: opt(a.fillOpacity),
      gradient: a.gradient ? structuredClone(a.gradient) : undefined,
      pattern: a.pattern ? { ...a.pattern } : undefined,
      strokeGradient: a.strokeGradient ? structuredClone(a.strokeGradient) : undefined,
      stroke: a.stroke ?? (isLine ? a.fill ?? s.stroke : s.stroke),
      // A line has no fill: it takes the source's stroke, or its fill colour as a stroke
      strokeWidth: a.stroke !== null ? a.strokeWidth : isLine ? s.strokeWidth : 0,
      strokeOpacity: opt(a.stroke !== null ? a.strokeOpacity : isLine ? a.fillOpacity : 1),
    };
    return withLayer(l, { ...common, shape });
  }
  if (l.kind === 'text' && l.text) {
    const t = l.text;
    return withLayer(l, {
      ...common,
      text: {
        ...t,
        color: a.fill ?? a.gradient?.stops[0]?.color.slice(0, 7) ?? t.color,
        runs: t.runs?.map(({ color: _c, ...r }) => r),
        stroke: a.stroke !== null ? a.strokeWidth : 0,
        strokeColor: a.stroke ?? t.strokeColor,
      },
    });
  }
  return l;
}
