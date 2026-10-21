// Runs the bundled on-device models (public/models) with onnxruntime-web's WebAssembly backend, off the
// main thread. Messages: { id, model, input, dims } → { id, out, dims } | { id, error }.
import * as ort from 'onnxruntime-web/wasm';

const base = new URL(import.meta.env.BASE_URL, self.location.href).href;
ort.env.wasm.wasmPaths = base + 'ort/';
// Threads need a cross-origin isolated page (COOP/COEP headers); otherwise one thread, still off the UI
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;

const sessions = new Map<string, Promise<ort.InferenceSession>>();

function session(model: string) {
  let s = sessions.get(model);
  if (!s) {
    s = ort.InferenceSession.create(base + 'models/' + model + '.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    s.catch(() => sessions.delete(model));
    sessions.set(model, s);
  }
  return s;
}

self.onmessage = async (e: MessageEvent<{ id: number; model: string; input?: Float32Array; dims?: number[] }>) => {
  const { id, model, input, dims } = e.data;
  try {
    const s = await session(model);
    if (!input || !dims) return void self.postMessage({ id, warm: true });
    const res = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, dims) });
    const t = res[s.outputNames[0]];
    const out = Float32Array.from(t.data as Float32Array);
    self.postMessage({ id, out, dims: t.dims }, { transfer: [out.buffer] });
  } catch (err) {
    self.postMessage({ id, error: (err as Error)?.message ?? String(err) });
  }
};
