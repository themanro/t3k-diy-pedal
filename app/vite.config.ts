import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// On tone3000.com the app is served at /diy-pedal/app (the site rewrites that
// path to the GitHub Pages build, see .github/workflows/app.yml). Locally it
// runs at the root. VITE_BASE sets the public path accordingly.
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE ?? (mode === 'production' ? '/diy-pedal/app/' : '/'),
  plugins: [react()],
  // The player locates its AudioWorklet and wasm via `new URL(..., import.meta.url)`.
  // Pre-bundling would move the module to .vite/deps and break those paths in dev.
  optimizeDeps: { exclude: ['neural-amp-modeler-wasm'] },
  server: { port: 3001 },
  preview: { port: 3001 },
}))
