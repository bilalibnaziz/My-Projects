import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Tauri expects a fixed port; 5178 keeps Jiro clear of the other Skill apps (5173…)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  clearScreen: false,
  server: { port: 5178, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
  // Pre-bundle everything up front: a dep discovered at runtime makes Vite reload the page (breaks e2e mid-run)
  optimizeDeps: {
    include: [
      'react', 'react-dom/client', 'zustand', 'zustand/react/shallow', 'lucide-react', 'radix-ui', 'cmdk', 'sonner', 'clsx', 'tailwind-merge',
      'class-variance-authority', '@tauri-apps/api/core', '@tauri-apps/api/window', '@tauri-apps/plugin-dialog',
    ],
  },
  test: { environment: 'jsdom', globals: true },
})
