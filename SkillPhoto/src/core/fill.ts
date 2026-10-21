import { alphaBounds, blurChannel, createCanvas, ctx2d } from './canvas';
import { inpaint } from './inpaint';

const MAX_WORK_PIXELS = 1_100_000;

function runInWorker(data: Uint8ClampedArray, w: number, h: number, mask: Uint8Array): Promise<Uint8ClampedArray> {
  if (typeof Worker === 'undefined') return Promise.resolve(inpaint(data, w, h, mask));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(inpaint(data, w, h, mask));
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.result) {
        worker.terminate();
        resolve(e.data.result as Uint8ClampedArray);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker failed'));
    };
    worker.postMessage({ data, w, h, mask }, [data.buffer, mask.buffer]);
  });
}

/**
 * Content-aware fill. `hole` is a canvas the same size as `src` whose alpha marks the
 * region to synthesize. Returns a new canvas; `src` is not modified.
 */
export async function contentAwareFill(src: HTMLCanvasElement, hole: HTMLCanvasElement, dilatePx = 2): Promise<HTMLCanvasElement> {
  const hb = alphaBounds(hole, 8);
  const out = createCanvas(src.width, src.height);
  const octx = ctx2d(out);
  octx.drawImage(src, 0, 0);
  if (!hb) return out;

  // Work on a region around the hole (enough context to borrow texture from)
  const margin = Math.max(48, Math.round(Math.max(hb.width, hb.height) * 1.25));
  const x0 = Math.max(0, hb.x - margin);
  const y0 = Math.max(0, hb.y - margin);
  const x1 = Math.min(src.width, hb.x + hb.width + margin);
  const y1 = Math.min(src.height, hb.y + hb.height + margin);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const scale = Math.min(1, Math.sqrt(MAX_WORK_PIXELS / (cw * ch)));
  const w = Math.max(8, Math.round(cw * scale));
  const h = Math.max(8, Math.round(ch * scale));

  const work = createCanvas(w, h);
  const wctx = ctx2d(work);
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(src, x0, y0, cw, ch, 0, 0, w, h);
  const data = wctx.getImageData(0, 0, w, h).data;

  const mcan = createCanvas(w, h);
  const mctx = ctx2d(mcan);
  mctx.drawImage(hole, x0, y0, cw, ch, 0, 0, w, h);
  const md = mctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  const grow = Math.max(1, Math.round(dilatePx * scale));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (md[(y * w + x) * 4 + 3] <= 8) continue;
      for (let dy = -grow; dy <= grow; dy++)
        for (let dx = -grow; dx <= grow; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) mask[ny * w + nx] = 1;
        }
    }

  // The worker takes ownership of what it's sent, so send copies: `mask` is still needed below
  const result = await runInWorker(new Uint8ClampedArray(data), w, h, new Uint8Array(mask));
  const rcan = createCanvas(w, h);
  ctx2d(rcan).putImageData(new ImageData(new Uint8ClampedArray(result), w, h), 0, 0);

  // Soft-edged blend mask so the patch melts into its surroundings
  const soft = new Float32Array(w * h);
  for (let i = 0; i < soft.length; i++) soft[i] = mask[i] * 255;
  blurChannel(soft, w, h, Math.max(1, grow));
  for (let i = 0; i < soft.length; i++) if (mask[i] && md[i * 4 + 3] > 8) soft[i] = 255;
  const blend = createCanvas(w, h);
  const bctx = ctx2d(blend);
  const bimg = bctx.createImageData(w, h);
  for (let i = 0; i < soft.length; i++) {
    bimg.data[i * 4 + 3] = soft[i];
  }
  bctx.putImageData(bimg, 0, 0);
  bctx.globalCompositeOperation = 'source-in';
  bctx.drawImage(rcan, 0, 0);

  octx.imageSmoothingQuality = 'high';
  octx.drawImage(blend, 0, 0, w, h, x0, y0, cw, ch);
  return out;
}
