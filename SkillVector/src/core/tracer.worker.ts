import { tracePixels } from './tracer';
import type { PixelBuffer, TraceOptions } from './tracer';

self.onmessage = (e: MessageEvent<{ id: number; buf: PixelBuffer; opts: TraceOptions }>) => {
  const { id, buf, opts } = e.data;
  try {
    self.postMessage({ id, res: tracePixels(buf, opts) });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
