// On-device "what is the subject" models for the cutout tools (see cutout.ts for what happens next):
//  - U²-Net small (u2netp, 320²): salient object of any kind — products, food, objects, people, pets.
//  - MODNet (512 px): portrait matting, much finer hair; used when the picture is of a person.
// Both are bundled in public/models and run in ai.worker.ts; nothing leaves the machine. When the models
// can't run (no workers, tests), callers fall back to the classic saliency pipelines in segment.ts.

import { crop, downsample } from './segment';
import type { Box } from './segment';
import type { RGBA } from './matte';
import { resizeMask } from './matte';
import type { Prior } from './cutout';

type Reply = { id: number; out?: Float32Array; dims?: number[]; warm?: boolean; error?: string };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (broken || typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'AI worker failed'));
    pending.clear();
    worker?.terminate();
    worker = null;
    broken = true;
  };
  return worker;
}

function call(model: string, input?: Float32Array, dims?: number[]): Promise<Reply> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('AI models are not available here'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, model, input, dims }, input ? { transfer: [input.buffer] } : undefined);
  });
}

/** True when the models can be tried in this environment (a failure later still falls back). */
export function aiAvailable() {
  return !broken && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

/** Loads both models in the background so the first cutout is quicker. */
export function warmUp() {
  if (!aiAvailable()) return;
  void call('u2netp').catch(() => {});
  void call('modnet').catch(() => {});
}

/** Image → normalised CHW float tensor of exactly tw×th (alpha composited over white). */
export function toTensor(img: RGBA, tw: number, th: number, mean: number[], std: number[]): Float32Array {
  // Area-average to about the target first, then bilinear to the exact size
  const { img: s } = downsample(img, { x: 0, y: 0, w: img.w, h: img.h }, Math.max(tw, th));
  const plane = tw * th;
  const out = new Float32Array(plane * 3);
  const fx = s.w / tw, fy = s.h / th;
  const d = s.data;
  for (let y = 0; y < th; y++) {
    const sy = Math.min(s.h - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(s.h - 1, y0 + 1), ty = sy - y0;
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(s.w - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(s.w - 1, x0 + 1), tx = sx - x0;
      const o = y * tw + x;
      for (let c = 0; c < 3; c++) {
        const px = (xx: number, yy: number) => {
          const i = (yy * s.w + xx) * 4;
          const a = d[i + 3] / 255;
          return d[i + c] * a + 255 * (1 - a);
        };
        const v = (px(x0, y0) * (1 - tx) + px(x1, y0) * tx) * (1 - ty) + (px(x0, y1) * (1 - tx) + px(x1, y1) * tx) * ty;
        out[c * plane + o] = (v / 255 - mean[c]) / std[c];
      }
    }
  }
  return out;
}

async function u2net(img: RGBA): Promise<Prior> {
  const S = 320;
  const r = await call('u2netp', toTensor(img, S, S, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]), [1, 3, S, S]);
  return { p: r.out!.subarray(0, S * S), w: S, h: S };
}

async function modnet(img: RGBA): Promise<Prior> {
  // Aspect kept, sides multiples of 32, long side 512
  const k = 512 / Math.max(img.w, img.h);
  const w = Math.max(32, Math.round((img.w * k) / 32) * 32);
  const h = Math.max(32, Math.round((img.h * k) / 32) * 32);
  const r = await call('modnet', toTensor(img, w, h, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), [1, 3, h, w]);
  const [, , oh, ow] = r.dims ?? [1, 1, h, w];
  return { p: r.out!.subarray(0, ow * oh), w: ow, h: oh };
}

/**
 * Decides whether the picture is a portrait: MODNet only ever finds people, so when its mask is sizable
 * and agrees with the general model, the person is the subject and MODNet's hair detail is worth using.
 */
export function combinePriors(general: Prior, portrait: Prior | null): { prior: Prior; portrait: boolean } {
  if (!portrait) return { prior: general, portrait: false };
  const G = 128;
  const a = resizeMask(general.p, general.w, general.h, G, G);
  const b = resizeMask(portrait.p, portrait.w, portrait.h, G, G);
  let inter = 0, union = 0, area = 0;
  for (let i = 0; i < G * G; i++) {
    const x = a[i] >= 0.5, y = b[i] >= 0.5;
    if (y) area++;
    if (x && y) inter++;
    if (x || y) union++;
  }
  const iou = union ? inter / union : 0;
  if (area < G * G * 0.03 || iou < 0.55) return { prior: general, portrait: false };
  // Union at MODNet's resolution: keeps what the person holds and their hair
  const g = resizeMask(general.p, general.w, general.h, portrait.w, portrait.h);
  const p = new Float32Array(g.length);
  for (let i = 0; i < p.length; i++) p[i] = Math.max(g[i] * (iou > 0.8 ? 1 : 0.85), portrait.p[i]);
  return { prior: { p, w: portrait.w, h: portrait.h }, portrait: true };
}

// A couple of recent results, so Select Subject → Remove Background on the same picture is instant
const cache: { key: string; value: { prior: Prior; portrait: boolean } }[] = [];

function keyOf(img: RGBA, roi: Box, portraits: boolean) {
  let h = 2166136261;
  const step = Math.max(1, Math.floor((roi.w * roi.h) / 4096));
  for (let i = 0; i < roi.w * roi.h; i += step) {
    const x = roi.x + (i % roi.w), y = roi.y + Math.floor(i / roi.w);
    const q = (y * img.w + x) * 4;
    h = Math.imul(h ^ (img.data[q] | (img.data[q + 1] << 8) | (img.data[q + 2] << 16) | (img.data[q + 3] << 24)), 16777619);
  }
  return `${img.w}x${img.h}:${roi.x},${roi.y},${roi.w},${roi.h}:${portraits ? 1 : 0}:${h >>> 0}`;
}

/**
 * Subject probability over `roi` from the models, or null when they can't run.
 * `portraits` also runs MODNet (whole-picture subject / background removal).
 */
export async function subjectPrior(img: RGBA, roi: Box, portraits = true): Promise<{ prior: Prior; portrait: boolean } | null> {
  if (!aiAvailable()) return null;
  const key = keyOf(img, roi, portraits);
  const hit = cache.find((c) => c.key === key);
  if (hit) return hit.value;
  try {
    const region = roi.x === 0 && roi.y === 0 && roi.w === img.w && roi.h === img.h ? img : crop(img, roi);
    const general = await u2net(region);
    const person = portraits ? await modnet(region).catch(() => null) : null;
    const value = combinePriors(general, person);
    cache.unshift({ key, value });
    cache.length = Math.min(cache.length, 3);
    return value;
  } catch (err) {
    console.warn('AI cutout unavailable, using the classic engine:', err);
    return null;
  }
}
