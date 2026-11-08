// Runs filters in a background worker so a big layer never freezes the window. Falls back to this
// thread where workers aren't available (tests, very old browsers).
import { filterById } from './filters';
import { contentAwareScale } from './seamCarve';
import type { CarveOptions } from './seamCarve';

let worker: Worker | null = null;
let nextJob = 1;
type Result = { data: Uint8ClampedArray; w?: number; h?: number };
const pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./filter.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ job: number; data?: Uint8ClampedArray; w?: number; h?: number; error?: string }>) => {
    const p = pending.get(e.data.job);
    if (!p) return;
    pending.delete(e.data.job);
    if (e.data.data) p.resolve({ data: e.data.data, w: e.data.w, h: e.data.h });
    else p.reject(new Error(e.data.error ?? 'Filter failed'));
  };
  worker.onerror = (e) => {
    // A broken worker fails everything queued on it; the next filter starts a fresh one
    for (const p of pending.values()) p.reject(new Error(e.message || 'Filter worker failed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

// ------------------------------------------------------------ strips in parallel

/**
 * Filters whose output row depends only on input rows within a margin can run as overlapping horizontal
 * strips on several workers at once, with the same result (Gaussian Blur: three box passes of radius
 * r reach 3r rows). Margin in rows for the params.
 */
const STRIP_MARGIN: Record<string, (p: Record<string, number>) => number> = {
  'gaussian-blur': (p) => 3 * Math.max(1, Math.round((p.radius ?? 6) / 1.7)) + 2,
};
const MIN_PARALLEL_PIXELS = 4_000_000;

let pool: Worker[] | null = null;
function getPool(): Worker[] {
  if (pool) return pool;
  const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));
  pool = [];
  if (typeof Worker === 'undefined' || n < 2) return pool;
  try {
    for (let i = 0; i < n; i++) pool.push(new Worker(new URL('./filter.worker.ts', import.meta.url), { type: 'module' }));
  } catch {
    pool = [];
  }
  return pool;
}

function runOn(w: Worker, msg: { id: string; data: Uint8ClampedArray; w: number; h: number; params: Record<string, number> }): Promise<Uint8ClampedArray> {
  const job = nextJob++;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<{ job: number; data?: Uint8ClampedArray; error?: string }>) => {
      if (e.data.job !== job) return;
      w.removeEventListener('message', onMsg);
      if (e.data.data) resolve(e.data.data);
      else reject(new Error(e.data.error ?? 'Filter failed'));
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ job, ...msg }, [msg.data.buffer]);
  });
}

/** The filter as overlapping strips on the worker pool, written back into `img`; false if not suitable. */
async function applyInStrips(filterId: string, img: ImageData, params: Record<string, number>): Promise<boolean> {
  const marginOf = STRIP_MARGIN[filterId];
  if (!marginOf || img.width * img.height < MIN_PARALLEL_PIXELS) return false;
  const workers = getPool();
  if (workers.length < 2) return false;
  const { width: W, height: H, data } = img;
  const m = marginOf(params);
  const n = Math.min(workers.length, Math.max(1, Math.floor(H / (4 * m + 64))));
  if (n < 2) return false;
  const row = W * 4;
  await Promise.all(
    workers.slice(0, n).map(async (w, k) => {
      const y0 = Math.floor((k * H) / n);
      const y1 = Math.floor(((k + 1) * H) / n);
      const a = Math.max(0, y0 - m);
      const b = Math.min(H, y1 + m);
      const out = await runOn(w, { id: filterId, data: data.slice(a * row, b * row), w: W, h: b - a, params });
      // Only the strip's own rows: its margins were there for the neighbours' sake
      data.set(out.subarray((y0 - a) * row, (y1 - a) * row), y0 * row);
    })
  );
  return true;
}

/** Applies a filter to `img` (in place) off the main thread. */
export async function applyFilterOffThread(filterId: string, img: ImageData, params: Record<string, number>): Promise<ImageData> {
  if (await applyInStrips(filterId, img, params).catch(() => false)) return img;
  const w = getWorker();
  if (!w) {
    filterById(filterId)?.apply(img, params);
    return img;
  }
  const job = nextJob++;
  const space = img.colorSpace;
  const { data } = await new Promise<Result>((resolve, reject) => {
    pending.set(job, { resolve, reject });
    w.postMessage({ job, id: filterId, data: img.data, w: img.width, h: img.height, params }, [img.data.buffer]);
  });
  return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), img.width, img.height, { colorSpace: space });
}

/** Content-Aware Scale off the main thread (seam carving takes seconds on a large photo). */
export async function contentAwareScaleOffThread(img: ImageData, tw: number, th: number, opts: CarveOptions): Promise<ImageData> {
  const w = getWorker();
  if (!w) {
    const out = contentAwareScale({ data: img.data, width: img.width, height: img.height }, tw, th, opts);
    return new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height, { colorSpace: img.colorSpace });
  }
  const job = nextJob++;
  const carveSpace = img.colorSpace;
  const r = await new Promise<Result>((resolve, reject) => {
    pending.set(job, { resolve, reject });
    const transfer: Transferable[] = [img.data.buffer];
    if (opts.protect) transfer.push(opts.protect.buffer as ArrayBuffer);
    w.postMessage({ job, kind: 'carve', data: img.data, w: img.width, h: img.height, tw, th, opts }, transfer);
  });
  return new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer), r.w!, r.h!, { colorSpace: carveSpace });
}
