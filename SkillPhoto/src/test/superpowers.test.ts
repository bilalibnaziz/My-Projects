import { describe, expect, it, beforeAll } from 'vitest';
import { createCanvas, ctx2d } from '../core/canvas';
import { extractSubjectMask, removeBackground } from '../core/cutoutEngine';
import { harmonizeLayerColor } from '../core/colorHarmonizer';
import { renderMockup, MOCKUP_PRESETS } from '../core/mockupEngine';

// jsdom Canvas2D mock for pixel manipulation
beforeAll(() => {
  if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as Record<string, unknown>).ImageData = class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    };
  }

  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== '2d') return null;
    const self = this as any;
    const w = this.width || 100;
    const h = this.height || 100;
    if (!self._pixels || self._pixelsW !== w || self._pixelsH !== h) {
      self._pixels = new Uint8ClampedArray(w * h * 4);
      self._pixelsW = w;
      self._pixelsH = h;
    }
    const pixels = self._pixels;

    if (self._ctx) return self._ctx;

    const ctxObj: any = {
      canvas: this,
      fillStyle: '#000000',
      globalCompositeOperation: 'source-over',
      shadowColor: 'transparent',
      shadowBlur: 0,
      shadowOffsetY: 0,
      getImageData: (x: number, y: number, sw: number, sh: number) => {
        const out = new Uint8ClampedArray(sw * sh * 4);
        for (let row = 0; row < sh; row++) {
          for (let col = 0; col < sw; col++) {
            const srcIdx = ((y + row) * w + (x + col)) * 4;
            const dstIdx = (row * sw + col) * 4;
            for (let c = 0; c < 4; c++) out[dstIdx + c] = pixels[srcIdx + c] ?? 0;
          }
        }
        return { data: out, width: sw, height: sh };
      },
      createImageData: (cw: number, ch: number) => ({
        data: new Uint8ClampedArray(cw * ch * 4),
        width: cw,
        height: ch,
      }),
      putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => {
        for (let row = 0; row < img.height; row++) {
          for (let col = 0; col < img.width; col++) {
            const srcIdx = (row * img.width + col) * 4;
            const dstIdx = ((y + row) * w + (x + col)) * 4;
            for (let c = 0; c < 4; c++) pixels[dstIdx + c] = img.data[srcIdx + c];
          }
        }
      },
      fillRect: (x: number, y: number, fw: number, fh: number) => {
        const hex = typeof ctxObj.fillStyle === 'string' ? ctxObj.fillStyle : '#ffffff';
        let r = 0, g = 0, b = 0;
        if (hex.startsWith('#')) {
          const parsed = parseInt(hex.slice(1), 16);
          if (hex.length === 7) {
            r = (parsed >> 16) & 255;
            g = (parsed >> 8) & 255;
            b = parsed & 255;
          }
        }
        const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
        const x1 = Math.min(w, Math.round(x + fw)), y1 = Math.min(h, Math.round(y + fh));
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const idx = (py * w + px) * 4;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = 255;
          }
        }
      },
      drawImage: (srcImg: HTMLCanvasElement, sx: number, sy: number, ...rest: number[]) => {
        // Only the unscaled 3-argument form copies pixels; scaled draws are no-ops here.
        if (rest.length) return;
        const sw = w, sh = h;
        const sCtx = (srcImg as any).getContext?.('2d');
        if (sCtx) {
          const sData = sCtx.getImageData(0, 0, srcImg.width, srcImg.height);
          if (ctxObj.globalCompositeOperation === 'destination-in') {
            for (let row = 0; row < Math.min(h, sh); row++) {
              for (let col = 0; col < Math.min(w, sw); col++) {
                const srcIdx = (row * srcImg.width + col) * 4;
                const dstIdx = ((sy + row) * w + (sx + col)) * 4;
                const maskVal = (sData.data[srcIdx] / 255) * (sData.data[srcIdx + 3] / 255);
                pixels[dstIdx + 3] = Math.round(pixels[dstIdx + 3] * maskVal);
              }
            }
            return;
          }
          for (let row = 0; row < Math.min(h, sh); row++) {
            for (let col = 0; col < Math.min(w, sw); col++) {
              const srcIdx = (row * srcImg.width + col) * 4;
              const dstIdx = ((sy + row) * w + (sx + col)) * 4;
              for (let c = 0; c < 4; c++) pixels[dstIdx + c] = sData.data[srcIdx + c];
            }
          }
        }
      },
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      rect: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
      ellipse: () => {},
      roundRect: () => {},
      clip: () => {},
      fill: () => {},
      stroke: () => {},
      save: () => {},
      restore: () => {},
      setLineDash: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
    };

    self._ctx = ctxObj;
    return ctxObj;
  };
});

describe('SkillPhoto Superpowers: Cutout & Background Removal', () => {
  it('extracts subject mask and separates foreground from solid background', () => {
    const src = createCanvas(100, 100);
    const ctx = ctx2d(src);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 100, 100);

    // Red subject in center
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(30, 30, 40, 40);

    const mask = extractSubjectMask(src, { tolerance: 30 });
    expect(mask.width).toBe(100);
    expect(mask.height).toBe(100);

    const mCtx = ctx2d(mask);
    const centerPix = mCtx.getImageData(50, 50, 1, 1).data;
    const cornerPix = mCtx.getImageData(5, 5, 1, 1).data;

    expect(centerPix[0]).toBeGreaterThan(150);
    expect(cornerPix[0]).toBeLessThan(100);
  });

  it('removes background leaving subject with transparency', () => {
    const src = createCanvas(100, 100);
    const ctx = ctx2d(src);

    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 100, 100);

    // Blue subject in center
    ctx.fillStyle = '#0066ff';
    ctx.fillRect(25, 25, 50, 50);

    const cutout = removeBackground(src, { tolerance: 30, defringe: true });
    expect(cutout.width).toBe(100);
    expect(cutout.height).toBe(100);

    const outCtx = ctx2d(cutout);
    const centerPix = outCtx.getImageData(50, 50, 1, 1).data;
    const cornerPix = outCtx.getImageData(5, 5, 1, 1).data;

    expect(centerPix[3]).toBeGreaterThan(150);
    expect(cornerPix[3]).toBe(0);
  });
});

describe('SkillPhoto Superpowers: Reinhard Color Harmonizer', () => {
  it('harmonizes subject colors toward background ambient tone', () => {
    const subject = createCanvas(50, 50);
    const sCtx = ctx2d(subject);
    sCtx.fillStyle = '#ffffff';
    sCtx.fillRect(0, 0, 50, 50);

    const bg = createCanvas(100, 100);
    const bCtx = ctx2d(bg);
    bCtx.fillStyle = '#ff8800';
    bCtx.fillRect(0, 0, 100, 100);

    const harmonized = harmonizeLayerColor(subject, bg, 0.9);
    expect(harmonized.width).toBe(50);
    expect(harmonized.height).toBe(50);

    const hCtx = ctx2d(harmonized);
    const pix = hCtx.getImageData(25, 25, 1, 1).data;

    expect(pix[0]).toBeGreaterThan(pix[2]);
  });
});

describe('SkillPhoto Superpowers: Mockup Engine', () => {
  it('renders all presets without crashing', () => {
    const artwork = createCanvas(200, 200);
    const aCtx = ctx2d(artwork);
    aCtx.fillStyle = '#7c3aed';
    aCtx.fillRect(0, 0, 200, 200);

    for (const preset of MOCKUP_PRESETS) {
      const mockup = renderMockup(artwork, preset.id);
      expect(mockup.width).toBe(preset.width);
      expect(mockup.height).toBe(preset.height);
    }
  });
});
