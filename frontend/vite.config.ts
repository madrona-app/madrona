import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    // Bundle visualizer — opt-in via ANALYZE=1. Produces dist/stats.html
    // with sunburst + treemap + network views. Does nothing on normal builds.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            sourcemap: true,
          }),
        ]
      : []),
    // SPA fallback for admin, main app, and /c/* discover routes
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && !req.url.includes('.') && req.url !== '/') {
            if (req.url.startsWith('/admin')) {
              req.url = '/admin.html';
            } else if (!req.url.startsWith('/api') && !req.url.startsWith('/docs') && !req.url.startsWith('/@') && !req.url.startsWith('/node_modules') && !req.url.startsWith('/src')) {
              // Handles /c/* (Discover) and all other app routes
              req.url = '/index.html';
            }
          }
          next();
        });
      },
    },
  ],
  appType: 'mpa',
  build: {
    // Sourcemaps enabled under ANALYZE=1 so rollup-plugin-visualizer can
    // attribute bytes to source modules. Off by default — normal prod
    // builds don't ship sourcemaps.
    sourcemap: process.env.ANALYZE ? true : false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: {
    // Pin to madrona's own port so it never silently drifts when 5173 is
    // taken by another project (e.g. claybench). strictPort fails loudly
    // instead of falling back to the next free port.
    port: 5174,
    strictPort: true,
    proxy: {
      // 8000 is the backend's port (uvicorn, and what compose publishes on
      // 127.0.0.1:8000). This said 5000 — the Flask-era port — so every API
      // call from `pnpm dev` failed against a port nothing serves.
      // Proxy /api to backend
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Proxy /iiif to backend
      '/iiif': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Proxy /org to backend (LOD routes)
      '/org': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
