// Runs filters in a background worker so a big layer never freezes the window. Falls back to this
// thread where workers aren't available (tests, very old browsers).
import { filterById } from './filters';

let worker: Worker | null = null;
let nextJob = 1;
const pending = new Map<number, { resolve: (d: Uint8ClampedArray) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./filter.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ job: number; data?: Uint8ClampedArray; error?: string }>) => {
    const p = pending.get(e.data.job);
    if (!p) return;
    pending.delete(e.data.job);
    if (e.data.data) p.resolve(e.data.data);
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

/** Applies a filter to `img` (in place) off the main thread. */
export async function applyFilterOffThread(filterId: string, img: ImageData, params: Record<string, number>): Promise<ImageData> {
  const w = getWorker();
  if (!w) {
    filterById(filterId)?.apply(img, params);
    return img;
  }
  const job = nextJob++;
  const data = await new Promise<Uint8ClampedArray>((resolve, reject) => {
    pending.set(job, { resolve, reject });
    w.postMessage({ job, id: filterId, data: img.data, w: img.width, h: img.height, params }, [img.data.buffer]);
  });
  return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), img.width, img.height);
}
