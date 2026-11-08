// How a gradient blends between its stops (Illustrator's gradient Method): Classic mixes the sRGB numbers
// (what canvas and SVG do natively; saturated pairs go muddy halfway), Perceptual mixes in OKLab (even
// steps in lightness and hue, vivid middles), Linear mixes light itself (linear-light sRGB, brighter
// middles). The other methods are drawn as dense Classic stops, so canvas, SVG and PDF all show them.
// Dither breaks up 8-bit banding in smooth gradients with ±1 level of noise.

import { splitAlpha } from './gradientStops';

export type GradientMethod = 'classic' | 'perceptual' | 'linear';

export const GRADIENT_METHODS: { value: GradientMethod; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'perceptual', label: 'Perceptual' },
  { value: 'linear', label: 'Linear light' },
];

type RGB = [number, number, number];

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function linToOklab([r, g, b]: RGB): RGB {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToLin([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const parse = (color: string): { rgb: RGB; a: number } => {
  const { hex, a } = splitAlpha(color);
  const n = parseInt(hex.slice(1, 7), 16);
  return { rgb: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], a };
};

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
const format = (rgb: RGB, a: number) => `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}${a < 0.999 ? hex2(a) : ''}`;

/** The colour `t` (0..1) of the way from `c0` to `c1` with this method, as #rrggbb[aa]. */
export function mixColor(c0: string, c1: string, t: number, method: GradientMethod): string {
  const p = parse(c0);
  const q = parse(c1);
  const a = p.a + (q.a - p.a) * t;
  if (method === 'classic') return format([0, 1, 2].map((i) => p.rgb[i] + (q.rgb[i] - p.rgb[i]) * t) as RGB, a);
  const lp = p.rgb.map(toLin) as RGB;
  const lq = q.rgb.map(toLin) as RGB;
  let lin: RGB;
  if (method === 'linear') lin = [0, 1, 2].map((i) => lp[i] + (lq[i] - lp[i]) * t) as RGB;
  else {
    const op = linToOklab(lp);
    const oq = linToOklab(lq);
    lin = oklabToLin([0, 1, 2].map((i) => op[i] + (oq[i] - op[i]) * t) as RGB);
  }
  return format(lin.map((v) => toSrgb(Math.max(0, Math.min(1, v)))) as RGB, a);
}

/**
 * The stops to hand to a Classic renderer (canvas, SVG, PDF) so it shows `method`: the stops themselves,
 * plus `steps` computed ones between each pair. Classic gets its stops back unchanged.
 */
export function renderStops(stops: { offset: number; color: string }[], method: GradientMethod | undefined, steps = 16): { offset: number; color: string }[] {
  const sorted = [...stops].sort((x, y) => x.offset - y.offset);
  if (!method || method === 'classic' || sorted.length < 2) return sorted;
  const out: { offset: number; color: string }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s0 = sorted[i];
    const s1 = sorted[i + 1];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push({ offset: s0.offset + (s1.offset - s0.offset) * t, color: k === 0 ? s0.color : mixColor(s0.color, s1.color, t, method) });
    }
  }
  out.push(sorted[sorted.length - 1]);
  return out;
}

/** CSS gradient interpolation for a method (`in oklab`, `in srgb-linear`), or '' for Classic. */
export const cssInterpolation = (method: GradientMethod | undefined) => (method === 'perceptual' ? 'in oklab ' : method === 'linear' ? 'in srgb-linear ' : '');

let ditherTile: HTMLCanvasElement | null = null;

/**
 * Breaks up banding: ±1 level of noise over whatever was just filled (the caller has clipped to the
 * shape). One tile pixel per device pixel, whatever the zoom.
 */
export function ditherOver(ctx: CanvasRenderingContext2D) {
  if (!ditherTile) {
    ditherTile = document.createElement('canvas');
    ditherTile.width = ditherTile.height = 64;
    const g = ditherTile.getContext('2d')!;
    const img = g.createImageData(64, 64);
    let s = 0x2f6b5a1;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const v = s >>> 30; // 0..3: black, white, or nothing (half the pixels)
      if (v === 0) img.data[i + 3] = 2;
      else if (v === 1) {
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = 2;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const pat = ctx.createPattern(ditherTile, 'repeat');
  if (!pat) return;
  const m = ctx.getTransform();
  pat.setTransform?.(m.inverse());
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = pat;
  ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
  ctx.restore();
}
