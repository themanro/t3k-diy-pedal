import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The player locates its AudioWorklet and wasm via `new URL(..., import.meta.url)`.
  // Pre-bundling would move the module to .vite/deps and break those paths in dev.
  optimizeDeps: { exclude: ['neural-amp-modeler-wasm'] },
  server: { port: 3001 },
  preview: { port: 3001 },
})
