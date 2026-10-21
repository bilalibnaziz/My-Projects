// Blend modes the Canvas 2D API lacks (Photoshop's Dissolve, Linear Burn, Darker / Lighter Color,
// Vivid / Linear / Pin Light, Hard Mix, Subtract, Divide), composited per pixel with the W3C
// separable-blend formula: Cs' = (1 − αb)·Cs + αb·B(Cb, Cs).

import type { BlendMode } from './types';
import { ctx2d } from './canvas';

export const NATIVE_BLENDS = new Set<BlendMode>([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'lighter',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

export const isCustomBlend = (m: BlendMode) => !NATIVE_BLENDS.has(m);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const burn = (b: number, s: number) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const dodge = (b: number, s: number) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const vivid = (b: number, s: number) => (s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1));

/** Separable blend function B(Cb, Cs) on 0..1 channels. */
export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'linear-burn':
      return Math.max(0, b + s - 1);
    case 'vivid-light':
      return vivid(b, s);
    case 'linear-light':
      return clamp01(b + 2 * s - 1);
    case 'pin-light':
      return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 'hard-mix':
      return b + s >= 1 ? 1 : 0;
    case 'subtract':
      return Math.max(0, b - s);
    case 'divide':
      return s <= 0 ? (b > 0 ? 1 : 0) : Math.min(1, b / s);
    default:
      return s;
  }
}

/** Deterministic per-pixel noise in [0, 1) for Dissolve. */
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Composites `src` (placed at dx, dy) onto `target` with a custom blend mode.
 * `atop` keeps the target's alpha (used inside clipping groups and for adjustment layers).
 */
export function compositeCustom(target: HTMLCanvasElement, src: HTMLCanvasElement, dx: number, dy: number, alpha: number, mode: BlendMode, atop = false) {
  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(target.width, Math.floor(dx) + src.width);
  const y1 = Math.min(target.height, Math.floor(dy) + src.height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0 || alpha <= 0) return;
  const tctx = ctx2d(target);
  const dst = tctx.getImageData(x0, y0, w, h);
  const s = ctx2d(src).getImageData(x0 - Math.floor(dx), y0 - Math.floor(dy), w, h).data;
  const d = dst.data;
  const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let as = (s[i + 3] / 255) * alpha;
      if (as <= 0) continue;
      const ab = d[i + 3] / 255;
      if (mode === 'dissolve') {
        // Each pixel is either fully shown or not at all, with probability = its opacity
        if (hash(x + x0, y + y0) >= as) continue;
        as = 1;
      }
      const sr = s[i] / 255, sg = s[i + 1] / 255, sb = s[i + 2] / 255;
      const br = d[i] / 255, bg = d[i + 1] / 255, bb = d[i + 2] / 255;
      let mr: number, mg: number, mb: number;
      if (mode === 'dissolve') {
        mr = sr; mg = sg; mb = sb;
      } else if (mode === 'darker-color' || mode === 'lighter-color') {
        const pickSrc = mode === 'darker-color' ? lum(sr, sg, sb) < lum(br, bg, bb) : lum(sr, sg, sb) > lum(br, bg, bb);
        mr = pickSrc ? sr : br; mg = pickSrc ? sg : bg; mb = pickSrc ? sb : bb;
      } else {
        mr = blendChannel(mode, br, sr); mg = blendChannel(mode, bg, sg); mb = blendChannel(mode, bb, sb);
      }
      // Cs' = (1 − αb)·Cs + αb·B
      const cr = (1 - ab) * sr + ab * mr;
      const cg = (1 - ab) * sg + ab * mg;
      const cb = (1 - ab) * sb + ab * mb;
      if (atop) {
        // Source-atop: the backdrop keeps its alpha; colour = αs·Cs' + (1 − αs)·Cb
        if (ab <= 0) continue;
        d[i] = (as * cr + (1 - as) * br) * 255;
        d[i + 1] = (as * cg + (1 - as) * bg) * 255;
        d[i + 2] = (as * cb + (1 - as) * bb) * 255;
      } else {
        // Source-over: αo = αs + αb(1 − αs), colour un-premultiplied by αo
        const ao = as + ab * (1 - as);
        const k = ab * (1 - as);
        d[i] = ((as * cr + k * br) / ao) * 255;
        d[i + 1] = ((as * cg + k * bg) / ao) * 255;
        d[i + 2] = ((as * cb + k * bb) / ao) * 255;
        d[i + 3] = ao * 255;
      }
    }
  }
  tctx.putImageData(dst, x0, y0);
}
