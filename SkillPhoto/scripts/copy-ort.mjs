// Copies the onnxruntime-web WebAssembly runtime into public/ort so the app (and the installed build)
// loads it from its own files, offline. Runs before dev and build; the version always matches node_modules.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/onnxruntime-web/dist');
const to = join(root, 'public/ort');
mkdirSync(to, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(join(from, f), join(to, f));
