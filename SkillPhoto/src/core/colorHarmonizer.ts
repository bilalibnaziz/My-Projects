/**
 * Reinhard Color & Ambient Lighting Harmonizer.
 *
 * Implements statistical color transfer in perceptual CIELAB (L*a*b*) space
 * to realistically match the lighting, ambient tint, and tonal contrast
 * of a foreground subject cutout to its background plate.
 */

import { createCanvas, ctx2d } from './canvas';

/** Converts sRGB [0..255] to CIELAB [L: 0..100, a: -128..127, b: -128..127]. */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  // 1. Linearize sRGB
  let lr = r / 255;
  let lg = g / 255;
  let lb = b / 255;

  lr = lr > 0.04045 ? Math.pow((lr + 0.055) / 1.055, 2.4) : lr / 12.92;
  lg = lg > 0.04045 ? Math.pow((lg + 0.055) / 1.055, 2.4) : lg / 12.92;
  lb = lb > 0.04045 ? Math.pow((lb + 0.055) / 1.055, 2.4) : lb / 12.92;

  // 2. Linear sRGB to XYZ (D65 illuminant)
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) / 1.0;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;

  // 3. XYZ to Lab
  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  const L = Math.max(0, 116 * fy - 16);
  const A = 500 * (fx - fy);
  const B = 200 * (fy - fz);

  return [L, A, B];
}

/** Converts CIELAB back to sRGB [0..255]. */
function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const x = (Math.pow(fx, 3) > 0.008856 ? Math.pow(fx, 3) : (fx - 16 / 116) / 7.787) * 0.95047;
  const y = (Math.pow(fy, 3) > 0.008856 ? Math.pow(fy, 3) : (fy - 16 / 116) / 7.787) * 1.0;
  const z = (Math.pow(fz, 3) > 0.008856 ? Math.pow(fz, 3) : (fz - 16 / 116) / 7.787) * 1.08883;

  // XYZ to linear RGB
  let lr = x * 3.2406 + y * -1.5372 + z * -0.4986;
  let lg = x * -0.9689 + y * 1.8758 + z * 0.0415;
  let lb = x * 0.0557 + y * -0.204 + z * 1.057;

  // Compand to sRGB
  lr = lr > 0.0031308 ? 1.055 * Math.pow(lr, 1 / 2.4) - 0.055 : 12.92 * lr;
  lg = lg > 0.0031308 ? 1.055 * Math.pow(lg, 1 / 2.4) - 0.055 : 12.92 * lg;
  lb = lb > 0.0031308 ? 1.055 * Math.pow(lb, 1 / 2.4) - 0.055 : 12.92 * lb;

  return [
    Math.max(0, Math.min(255, Math.round(lr * 255))),
    Math.max(0, Math.min(255, Math.round(lg * 255))),
    Math.max(0, Math.min(255, Math.round(lb * 255))),
  ];
}

interface ChannelStats {
  meanL: number;
  meanA: number;
  meanB: number;
  stdL: number;
  stdA: number;
  stdB: number;
}

function computeLabStats(ctx: CanvasRenderingContext2D, width: number, height: number, maskAlpha = true): ChannelStats {
  const data = ctx.getImageData(0, 0, width, height).data;
  const Ls: number[] = [];
  const As: number[] = [];
  const Bs: number[] = [];

  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (maskAlpha && alpha < 32) continue;

      const [l, a, b] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
      Ls.push(l);
      As.push(a);
      Bs.push(b);
    }
  }

  const n = Math.max(1, Ls.length);
  const meanL = Ls.reduce((sum, v) => sum + v, 0) / n;
  const meanA = As.reduce((sum, v) => sum + v, 0) / n;
  const meanB = Bs.reduce((sum, v) => sum + v, 0) / n;

  const stdL = Math.sqrt(Ls.reduce((sum, v) => sum + (v - meanL) ** 2, 0) / n) || 1;
  const stdA = Math.sqrt(As.reduce((sum, v) => sum + (v - meanA) ** 2, 0) / n) || 1;
  const stdB = Math.sqrt(Bs.reduce((sum, v) => sum + (v - meanB) ** 2, 0) / n) || 1;

  return { meanL, meanA, meanB, stdL, stdA, stdB };
}

/** Harmonizes target subject pixels to match the color temperature, exposure and saturation of background. */
export function harmonizeLayerColor(
  subjectCanvas: HTMLCanvasElement,
  backgroundCanvas: HTMLCanvasElement,
  strength = 0.85
): HTMLCanvasElement {
  const w = subjectCanvas.width;
  const h = subjectCanvas.height;
  const out = createCanvas(w, h);
  if (w < 1 || h < 1) return out;

  const subCtx = ctx2d(subjectCanvas);
  const bgCtx = ctx2d(backgroundCanvas);
  const outCtx = ctx2d(out);

  const fgStats = computeLabStats(subCtx, w, h, true);
  const bgStats = computeLabStats(bgCtx, backgroundCanvas.width, backgroundCanvas.height, false);

  const imgData = subCtx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Scale ratios
  const scaleL = Math.max(0.2, Math.min(3.0, bgStats.stdL / fgStats.stdL));
  const scaleA = Math.max(0.2, Math.min(3.0, bgStats.stdA / fgStats.stdA));
  const scaleB = Math.max(0.2, Math.min(3.0, bgStats.stdB / fgStats.stdB));

  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3];
    if (alpha === 0) continue;

    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];

    const [L, A, B] = rgbToLab(r, g, b);

    // Shift and scale
    const newL = (L - fgStats.meanL) * scaleL + bgStats.meanL;
    const newA = (A - fgStats.meanA) * scaleA + bgStats.meanA;
    const newB = (B - fgStats.meanB) * scaleB + bgStats.meanB;

    const [targetR, targetG, targetB] = labToRgb(newL, newA, newB);

    // Blend by strength
    d[i] = Math.round(r + (targetR - r) * strength);
    d[i + 1] = Math.round(g + (targetG - g) * strength);
    d[i + 2] = Math.round(b + (targetB - b) * strength);
  }

  outCtx.putImageData(imgData, 0, 0);
  return out;
}
