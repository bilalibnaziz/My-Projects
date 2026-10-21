// Runs the cutout pipeline (cutout.ts) and the classic fallbacks off the main thread, so a big photo
// never freezes the window while its edge is being snapped and matted.
import { runJob } from './cutoutJob';
import type { CutoutJob } from './cutoutJob';

self.onmessage = (e: MessageEvent<{ id: number; job: CutoutJob }>) => {
  const { id, job } = e.data;
  try {
    const r = runJob(job);
    const transfer: Transferable[] = [];
    if (r) {
      transfer.push(r.region.alpha.buffer);
      if (r.pixels) transfer.push(r.pixels.buffer);
    }
    self.postMessage({ id, result: r }, { transfer });
  } catch (err) {
    self.postMessage({ id, error: (err as Error)?.message ?? String(err) });
  }
};
