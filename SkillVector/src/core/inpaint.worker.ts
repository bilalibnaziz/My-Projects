import { inpaint } from './inpaint';

self.onmessage = (e: MessageEvent<{ data: Uint8ClampedArray; w: number; h: number; mask: Uint8Array }>) => {
  const { data, w, h, mask } = e.data;
  const result = inpaint(data, w, h, mask, (f) => self.postMessage({ progress: f }));
  self.postMessage({ result }, { transfer: [result.buffer] });
};
