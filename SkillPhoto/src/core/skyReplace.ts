// Sky Replacement: finds the sky (or uses the selection), paints a new one (generated, or a picture you
// pick) and relights the land toward it. The result is a pass-through group above the photo: the new sky
// with the old sky as its layer mask (edge shifted / faded), and a soft-light Foreground Lighting layer graded from
// the sky's colour at the horizon to neutral grey lower down (soft light with mid-grey changes nothing, so
// the relighting fades out by itself). The photo itself is untouched; every part stays editable.

import { blurChannel, createCanvas, ctx2d } from './canvas';
import type { RGBA } from './matte';

export interface SkyPreset {
  id: string;
  label: string;
  zenith: string;
  horizon: string;
  clouds: number; // 0 … 1
  cloudColor: string;
  sun?: string; // glow colour, low over the horizon
  stars?: boolean;
}

export const SKY_PRESETS: SkyPreset[] = [
  { id: 'blue', label: 'Clear Blue', zenith: '#2a6fd6', horizon: '#bfe0ff', clouds: 0.35, cloudColor: '#ffffff' },
  { id: 'golden', label: 'Golden Hour', zenith: '#3f6fb5', horizon: '#ffcf7a', clouds: 0.3, cloudColor: '#fff1d6', sun: '#fff3c4' },
  { id: 'sunset', label: 'Sunset', zenith: '#2b2d6e', horizon: '#ff8a3d', clouds: 0.45, cloudColor: '#ff9e8a', sun: '#ffd27a' },
  { id: 'dusk', label: 'Dusk', zenith: '#1b1f4a', horizon: '#c36fa8', clouds: 0.25, cloudColor: '#a77fc4' },
  { id: 'overcast', label: 'Overcast', zenith: '#8d97a3', horizon: '#d9dde2', clouds: 0.8, cloudColor: '#eef0f2' },
  { id: 'night', label: 'Starry Night', zenith: '#05081a', horizon: '#1b2a55', clouds: 0, cloudColor: '#ffffff', stars: true },
];

export interface SkyOptions {
  source: { kind: 'preset'; id: string } | { kind: 'image'; canvas: HTMLCanvasElement };
  shiftEdge: number; // px at full size, −50 … 50: + grows the new sky into the land
  fadeEdge: number; // px at full size, 0 … 100
  brightness: number; // −100 … 100
  temperature: number; // −100 … 100 (cooler … warmer)
  lighting: number; // 0 … 100: how much the land takes on the sky's colour
  seed: number; // which clouds / stars
}

export const DEFAULT_SKY: SkyOptions = { source: { kind: 'preset', id: 'sunset' }, shiftEdge: 0, fadeEdge: 4, brightness: 0, temperature: 0, lighting: 40, seed: 1 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Shift Edge grows (+) or shrinks (−) the sky by blurring and re-thresholding; Fade Edge feathers it.
 * Distances are in pixels of `alpha` (scale them for a preview).
 */
export function refineSkyMask(alpha: Float32Array, w: number, h: number, shift: number, fade: number): Float32Array {
  const a = alpha.slice();
  if (Math.abs(shift) >= 0.5) {
    blurChannel(a, w, h, Math.abs(shift) * 1.2);
    for (let i = 0; i < a.length; i++) a[i] = shift > 0 ? smooth(0.02, 0.5, a[i]) : smooth(0.5, 0.98, a[i]);
  }
  if (fade >= 0.5) blurChannel(a, w, h, fade);
  return a;
}

/** The lowest row that is still mostly sky (where the new sky meets the land). */
export function horizonRow(alpha: Float32Array, w: number, h: number): number {
  let last = -1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += alpha[y * w + x];
    if (s / w > 0.2) last = y;
  }
  return last < 0 ? Math.round(h * 0.5) : last + 1;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fractal value noise on a small grid (clouds are soft: it is drawn scaled up)
function cloudCanvas(w: number, h: number, seed: number, amount: number, color: string): HTMLCanvasElement {
  const cw = Math.max(8, Math.round(w / 6));
  const ch = Math.max(8, Math.round(h / 6));
  const c = createCanvas(cw, ch);
  if (amount <= 0) return c;
  const rand = rng(seed * 7919 + 17);
  const G = 64;
  const lattice = new Float32Array(G * G).map(() => rand());
  const at = (x: number, y: number) => lattice[(((y % G) + G) % G) * G + (((x % G) + G) % G)];
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return top + (bot - top) * sy;
  };
  const g = ctx2d(c);
  const img = g.createImageData(cw, ch);
  const m = /^#([0-9a-f]{6})/i.exec(color);
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  const cover = 0.85 - amount * 0.5; // more clouds: lower threshold
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      // Wider than tall, like real cloud banks
      let v = 0;
      let amp = 0.5;
      let f = 4 / cw;
      for (let o = 0; o < 5; o++) {
        v += amp * noise(x * f * 0.5 * cw / 8, y * f * 1.6 * cw / 8);
        amp *= 0.5;
        f *= 2;
      }
      const i = (y * cw + x) * 4;
      img.data[i] = (n >> 16) & 255;
      img.data[i + 1] = (n >> 8) & 255;
      img.data[i + 2] = n & 255;
      img.data[i + 3] = Math.round(smooth(cover, cover + 0.3, v) * 255 * Math.min(1, amount * 1.4));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A generated sky the size of the picture, running from the zenith (top) to the horizon row. */
export function paintPresetSky(p: SkyPreset, w: number, h: number, horizon: number, seed: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  const hz = Math.max(4, Math.min(h, horizon));
  const grad = g.createLinearGradient(0, 0, 0, hz);
  grad.addColorStop(0, p.zenith);
  grad.addColorStop(1, p.horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, hz);
  g.fillStyle = p.horizon;
  g.fillRect(0, hz, w, h - hz);
  if (p.sun) {
    const sx = w * 0.68;
    const sy = hz * 0.86;
    const r = Math.max(w, hz) * 0.35;
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    sun.addColorStop(0, p.sun);
    sun.addColorStop(0.15, `${p.sun}cc`);
    sun.addColorStop(1, `${p.sun}00`);
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
  }
  if (p.stars) {
    const rand = rng(seed * 31 + 7);
    const count = Math.round((w * hz) / 1800);
    for (let i = 0; i < count; i++) {
      const b = rand();
      g.fillStyle = `rgba(255,255,255,${0.35 + b * 0.65})`;
      const s = b > 0.97 ? 2 : 1;
      g.fillRect(rand() * w, rand() * hz * 0.95, s, s);
    }
  }
  if (p.clouds > 0) {
    g.imageSmoothingQuality = 'high';
    // Clouds thin out toward the horizon (perspective)
    const cl = cloudCanvas(w, hz, seed, p.clouds, p.cloudColor);
    const tmp = createCanvas(w, hz);
    const t = ctx2d(tmp);
    t.imageSmoothingQuality = 'high';
    t.drawImage(cl, 0, 0, w, hz);
    t.globalCompositeOperation = 'destination-in';
    const fade = t.createLinearGradient(0, 0, 0, hz);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.75, 'rgba(0,0,0,0.75)');
    fade.addColorStop(1, 'rgba(0,0,0,0.15)');
    t.fillStyle = fade;
    t.fillRect(0, 0, w, hz);
    g.drawImage(tmp, 0, 0);
  }
  return c;
}

/** A picture sky: covers the width and the sky down to the horizon, bottom-aligned at the horizon. */
export function paintImageSky(src: HTMLCanvasElement, w: number, h: number, horizon: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  const hz = Math.max(4, Math.min(h, horizon));
  const k = Math.max(w / src.width, hz / src.height);
  const dw = src.width * k;
  const dh = src.height * k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (w - dw) / 2, hz - dh, dw, dh);
  // Below the horizon (where Shift Edge may reach) the picture's bottom row carries on
  g.drawImage(src, 0, src.height - 1, src.width, 1, 0, hz, w, h - hz);
  return c;
}

/** Brightness and warmth of the new sky. */
export function adjustSky(c: HTMLCanvasElement, brightness: number, temperature: number) {
  if (!brightness && !temperature) return;
  const g = ctx2d(c);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const k = 1 + brightness / 100;
  const warm = temperature / 100;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * k * (1 + 0.18 * warm);
    d[i + 1] = d[i + 1] * k * (1 + 0.03 * warm);
    d[i + 2] = d[i + 2] * k * (1 - 0.18 * warm);
  }
  g.putImageData(img, 0, 0);
}

/** Average colour of the sky just above the horizon (what the land would be lit by). */
export function horizonColor(sky: HTMLCanvasElement, horizon: number): [number, number, number] {
  const band = Math.max(2, Math.round(horizon * 0.3));
  const s = createCanvas(16, 4);
  const g = ctx2d(s);
  g.drawImage(sky, 0, Math.max(0, horizon - band), sky.width, band, 0, 0, 16, 4);
  const d = g.getImageData(0, 0, 16, 4).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
  return sum.map((v) => v / 64) as [number, number, number];
}

/** Soft-light tint: the horizon colour at the horizon, easing to mid-grey (no change) toward the bottom. */
export function lightingCanvas(w: number, h: number, horizon: number, color: [number, number, number], skyAlpha: Float32Array): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  const [r, gg, b] = color.map(Math.round);
  const grad = g.createLinearGradient(0, Math.max(0, horizon - h * 0.05), 0, h);
  grad.addColorStop(0, `rgb(${r},${gg},${b})`);
  grad.addColorStop(1, 'rgb(128,128,128)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // Only the land: where the new sky shows, nothing is relit
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < skyAlpha.length; i++) img.data[i * 4 + 3] = Math.round((1 - Math.min(1, Math.max(0, skyAlpha[i]))) * 255);
  g.putImageData(img, 0, 0);
  return c;
}

/** The mask as a white canvas with that alpha (how layer masks are stored). */
export function maskCanvas(alpha: Float32Array, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  const img = g.createImageData(w, h);
  for (let i = 0; i < alpha.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alpha[i])) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

export interface SkyParts {
  sky: HTMLCanvasElement; // full picture size, unmasked
  mask: Float32Array; // refined sky mask
  light: HTMLCanvasElement; // soft-light layer, land only
  horizon: number;
}

/**
 * Everything the result is made of, for a picture `w` × `h` whose sky mask is `alpha`. `scale` shrinks the
 * pixel distances for a preview (1 = full size).
 */
export function buildSky(alpha: Float32Array, w: number, h: number, o: SkyOptions, scale = 1): SkyParts {
  const mask = refineSkyMask(alpha, w, h, o.shiftEdge * scale, o.fadeEdge * scale);
  const horizon = horizonRow(mask, w, h);
  const preset = o.source.kind === 'preset' ? SKY_PRESETS.find((p) => p.id === (o.source as { id: string }).id) ?? SKY_PRESETS[0] : null;
  const sky = preset ? paintPresetSky(preset, w, h, horizon, o.seed) : paintImageSky((o.source as { canvas: HTMLCanvasElement }).canvas, w, h, horizon);
  adjustSky(sky, o.brightness, o.temperature);
  const light = lightingCanvas(w, h, horizon, horizonColor(sky, horizon), mask);
  return { sky, mask, light, horizon };
}

/** Preview: the photo with the parts composited as the layers would be. */
export function composeSky(photo: CanvasImageSource, parts: SkyParts, lighting: number, w: number, h: number): HTMLCanvasElement {
  const out = createCanvas(w, h);
  const g = ctx2d(out);
  g.drawImage(photo, 0, 0, w, h);
  const sky = createCanvas(w, h);
  const s = ctx2d(sky);
  s.drawImage(parts.sky, 0, 0);
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(maskCanvas(parts.mask, w, h), 0, 0);
  g.drawImage(sky, 0, 0);
  if (lighting > 0) {
    g.globalAlpha = lighting / 100;
    g.globalCompositeOperation = 'soft-light';
    g.drawImage(parts.light, 0, 0);
  }
  return out;
}

/** The sky mask of a picture: the selection when there is one, else the found sky. */
export function alphaFromRegion(r: { roi: { x: number; y: number; w: number; h: number }; alpha: Float32Array }, w: number, h: number): Float32Array {
  const a = new Float32Array(w * h);
  for (let y = 0; y < r.roi.h; y++) for (let x = 0; x < r.roi.w; x++) {
    const dx = r.roi.x + x;
    const dy = r.roi.y + y;
    if (dx >= 0 && dy >= 0 && dx < w && dy < h) a[dy * w + dx] = r.alpha[y * r.roi.w + x];
  }
  return a;
}

export type { RGBA };
