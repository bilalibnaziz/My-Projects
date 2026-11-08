import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Cross-origin isolation lets the on-device cutout models (onnxruntime-web) use several threads.
// The installed app sends the same headers (src-tauri/tauri.conf.json → app.security.headers).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  // The AI worker imports onnxruntime-web; found only at first use, the dev server would
  // pre-bundle it then and reload the page (losing the open document)
  optimizeDeps: { include: ['onnxruntime-web/wasm'] },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
