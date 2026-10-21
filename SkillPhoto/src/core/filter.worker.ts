import { filterById } from './filters';

self.onmessage = (e: MessageEvent<{ job: number; id: string; data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number; params: Record<string, number> }>) => {
  const { job, id, data, w, h, params } = e.data;
  try {
    const img = new ImageData(data, w, h);
    filterById(id)!.apply(img, params);
    self.postMessage({ job, data: img.data }, { transfer: [img.data.buffer] });
  } catch (err) {
    self.postMessage({ job, error: (err as Error).message });
  }
};
