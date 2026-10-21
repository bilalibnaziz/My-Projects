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
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
