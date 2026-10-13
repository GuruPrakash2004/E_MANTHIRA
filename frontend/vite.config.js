import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vendor chunks are split so an app-code change doesn't invalidate the (large, rarely changing) library bundles
// in the browser cache, and pages are lazy-loaded from App.jsx.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react'
          if (id.includes('@mantine')) return 'vendor-mantine'
          if (id.includes('@tanstack')) return 'vendor-query'
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'vendor-motion'
          return undefined
        },
      },
    },
  },
})
