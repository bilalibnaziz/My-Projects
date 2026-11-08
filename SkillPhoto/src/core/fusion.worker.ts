import { fuse, type FusionInput } from './fusion';

self.onmessage = (e: MessageEvent<FusionInput>) => {
  try {
    const r = fuse(e.data, (f) => self.postMessage({ progress: f }));
    self.postMessage({ result: r }, { transfer: [r.data.buffer] });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
