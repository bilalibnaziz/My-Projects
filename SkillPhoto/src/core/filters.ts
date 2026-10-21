import { blurChannel, blurImageData } from './canvas';

export interface FilterParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  unit?: string;
}

export interface FilterDef {
  id: string;
  name: string;
  group: 'Blur' | 'Sharpen' | 'Stylize' | 'Noise' | 'Creative';
  params: FilterParam[];
  apply: (img: ImageData, p: Record<string, number>) => void;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function luminanceBlurred(img: ImageData, radius: number): Float32Array {
  const { width, height, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  blurChannel(out, width, height, radius);
  return out;
}

export const FILTERS: FilterDef[] = [
  {
    id: 'gaussian-blur',
    name: 'Gaussian Blur',
    group: 'Blur',
    params: [{ key: 'radius', label: 'Radius', min: 0.5, max: 150, step: 0.5, default: 6, unit: 'px' }],
    apply: (img, p) => blurImageData(img, p.radius),
  },
  {
    id: 'motion-blur',
    name: 'Motion Blur',
    group: 'Blur',
    params: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, default: 0, unit: '°' },
      { key: 'distance', label: 'Distance', min: 1, max: 200, default: 24, unit: 'px' },
    ],
    apply: (img, p) => {
      const { width: w, height: h, data } = img;
      const src = new Uint8ClampedArray(data);
      const a = (p.angle * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const taps = Math.max(2, Math.min(64, Math.round(p.distance)));
      const stepLen = p.distance / taps;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, al = 0;
          for (let t = 0; t < taps; t++) {
            const o = (t - taps / 2) * stepLen;
            const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx * o)));
            const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy * o)));
            const i = (sy * w + sx) * 4;
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            al += src[i + 3];
          }
          const i = (y * w + x) * 4;
          data[i] = r / taps;
          data[i + 1] = g / taps;
          data[i + 2] = b / taps;
          data[i + 3] = al / taps;
        }
    },
  },
  {
    id: 'unsharp',
    name: 'Unsharp Mask',
    group: 'Sharpen',
    params: [
      { key: 'amount', label: 'Amount', min: 1, max: 500, default: 120, unit: '%' },
      { key: 'radius', label: 'Radius', min: 0.3, max: 50, step: 0.1, default: 1.5, unit: 'px' },
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, default: 2, unit: 'lv' },
    ],
    apply: (img, p) => {
      const blurred = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      blurImageData(blurred, p.radius);
      const d = img.data;
      const b = blurred.data;
      const k = p.amount / 100;
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const diff = d[i + c] - b[i + c];
          if (Math.abs(diff) >= p.threshold) d[i + c] = d[i + c] + diff * k;
        }
      }
    },
  },
  {
    id: 'high-pass',
    name: 'High Pass',
    group: 'Sharpen',
    params: [{ key: 'radius', label: 'Radius', min: 0.5, max: 100, step: 0.5, default: 4, unit: 'px' }],
    apply: (img, p) => {
      const blurred = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      blurImageData(blurred, p.radius);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4)
        for (let c = 0; c < 3; c++) d[i + c] = 128 + d[i + c] - blurred.data[i + c];
    },
  },
  {
    id: 'add-noise',
    name: 'Add Noise',
    group: 'Noise',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 100, default: 12, unit: '%' },
      { key: 'mono', label: 'Monochromatic', min: 0, max: 1, step: 1, default: 1 },
    ],
    apply: (img, p) => {
      const d = img.data;
      const amt = (p.amount / 100) * 255;
      for (let i = 0; i < d.length; i += 4) {
        if (p.mono) {
          const n = (Math.random() - 0.5) * amt;
          d[i] += n;
          d[i + 1] += n;
          d[i + 2] += n;
        } else {
          d[i] += (Math.random() - 0.5) * amt;
          d[i + 1] += (Math.random() - 0.5) * amt;
          d[i + 2] += (Math.random() - 0.5) * amt;
        }
      }
    },
  },
  {
    id: 'reduce-noise',
    name: 'Reduce Noise',
    group: 'Noise',
    params: [
      { key: 'strength', label: 'Strength', min: 0, max: 100, default: 50, unit: '%' },
      { key: 'detail', label: 'Preserve Details', min: 0, max: 100, default: 40, unit: '%' },
    ],
    apply: (img, p) => {
      // Edge-aware smoothing: blend toward a blur only where local detail is low.
      const blurred = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      blurImageData(blurred, 2.5);
      const L = luminanceBlurred(img, 0);
      const Lb = luminanceBlurred(blurred, 0);
      const d = img.data;
      const tol = 4 + (p.detail / 100) * 40;
      const s = p.strength / 100;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const edge = Math.abs(L[j] - Lb[j]);
        const k = s * Math.max(0, 1 - edge / tol);
        for (let c = 0; c < 3; c++) d[i + c] += (blurred.data[i + c] - d[i + c]) * k;
      }
    },
  },
  {
    id: 'pixelate',
    name: 'Pixelate',
    group: 'Stylize',
    params: [{ key: 'size', label: 'Cell Size', min: 2, max: 200, default: 16, unit: 'px' }],
    apply: (img, p) => {
      const { width: w, height: h, data } = img;
      const s = Math.round(p.size);
      for (let by = 0; by < h; by += s)
        for (let bx = 0; bx < w; bx += s) {
          let r = 0, g = 0, b = 0, a = 0, n = 0;
          for (let y = by; y < Math.min(h, by + s); y++)
            for (let x = bx; x < Math.min(w, bx + s); x++) {
              const i = (y * w + x) * 4;
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              a += data[i + 3];
              n++;
            }
          for (let y = by; y < Math.min(h, by + s); y++)
            for (let x = bx; x < Math.min(w, bx + s); x++) {
              const i = (y * w + x) * 4;
              data[i] = r / n;
              data[i + 1] = g / n;
              data[i + 2] = b / n;
              data[i + 3] = a / n;
            }
        }
    },
  },
  {
    id: 'emboss',
    name: 'Emboss',
    group: 'Stylize',
    params: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, default: 135, unit: '°' },
      { key: 'amount', label: 'Amount', min: 1, max: 500, default: 100, unit: '%' },
    ],
    apply: (img, p) => {
      const { width: w, height: h, data } = img;
      const L = luminanceBlurred(img, 0);
      const a = (p.angle * Math.PI) / 180;
      const ox = Math.round(Math.cos(a));
      const oy = Math.round(Math.sin(a));
      const k = p.amount / 100;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const x1 = Math.min(w - 1, Math.max(0, x + ox));
          const y1 = Math.min(h - 1, Math.max(0, y + oy));
          const x2 = Math.min(w - 1, Math.max(0, x - ox));
          const y2 = Math.min(h - 1, Math.max(0, y - oy));
          const v = 128 + (L[y1 * w + x1] - L[y2 * w + x2]) * k;
          const i = (y * w + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
        }
    },
  },
  {
    id: 'find-edges',
    name: 'Find Edges',
    group: 'Stylize',
    params: [{ key: 'strength', label: 'Strength', min: 10, max: 400, default: 100, unit: '%' }],
    apply: (img, p) => {
      const { width: w, height: h, data } = img;
      const L = luminanceBlurred(img, 0);
      const at = (x: number, y: number) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
      const k = p.strength / 100;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
          const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
          const v = 255 - Math.min(255, Math.hypot(gx, gy) * k * 0.5);
          const i = (y * w + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
        }
    },
  },
  {
    id: 'glow',
    name: 'Dreamy Glow (Orton)',
    group: 'Creative',
    params: [
      { key: 'radius', label: 'Radius', min: 2, max: 120, default: 24, unit: 'px' },
      { key: 'strength', label: 'Strength', min: 0, max: 100, default: 45, unit: '%' },
    ],
    apply: (img, p) => {
      const blurred = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      blurImageData(blurred, p.radius);
      const d = img.data;
      const s = p.strength / 100;
      for (let i = 0; i < d.length; i += 4)
        for (let c = 0; c < 3; c++) {
          const a = d[i + c] / 255;
          const b = blurred.data[i + c] / 255;
          const screen = 1 - (1 - a) * (1 - b);
          d[i + c] = (a + (screen - a) * s) * 255;
        }
    },
  },
  {
    id: 'chromatic',
    name: 'Chromatic Aberration',
    group: 'Creative',
    params: [{ key: 'shift', label: 'Shift', min: 1, max: 60, default: 6, unit: 'px' }],
    apply: (img, p) => {
      const { width: w, height: h, data } = img;
      const src = new Uint8ClampedArray(data);
      const s = Math.round(p.shift);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const xr = Math.min(w - 1, x + s);
          const xb = Math.max(0, x - s);
          data[i] = src[(y * w + xr) * 4];
          data[i + 2] = src[(y * w + xb) * 4 + 2];
        }
    },
  },
  {
    id: 'halftone',
    name: 'Halftone Dots',
    group: 'Creative',
    params: [{ key: 'size', label: 'Dot Size', min: 3, max: 60, default: 10, unit: 'px' }],
    apply: (img, p) => {
      const { width: w, height: h, data } = img;
      const s = Math.round(p.size);
      const L = luminanceBlurred(img, s / 2);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const cx = Math.floor(x / s) * s + s / 2;
          const cy = Math.floor(y / s) * s + s / 2;
          const l = L[Math.min(h - 1, Math.floor(cy)) * w + Math.min(w - 1, Math.floor(cx))] / 255;
          const r = (1 - l) * s * 0.72;
          const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r;
          const i = (y * w + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = inside ? 20 : 245;
        }
    },
  },
];

export const filterById = (id: string) => FILTERS.find((f) => f.id === id);

export function defaultParams(f: FilterDef): Record<string, number> {
  return Object.fromEntries(f.params.map((p) => [p.key, p.default]));
}
