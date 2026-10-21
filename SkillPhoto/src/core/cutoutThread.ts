// Main-thread side of cutout.worker.ts. Falls back to this thread where workers aren't available (tests).
import type { CutoutResult } from './cutout';
import { runJob } from './cutoutJob';
import type { CutoutJob } from './cutoutJob';

export type { CutoutJob };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: CutoutResult | null) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (broken || typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; result?: CutoutResult | null; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result ?? null);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Cutout worker failed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Runs a cutout job in the background worker (or here, when there is none). */
export function runCutout(job: CutoutJob): Promise<CutoutResult | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(runJob(job));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, job });
  });
}
