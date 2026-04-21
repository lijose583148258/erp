import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  return {
    cacheDir: '.vite-cache',
    server: {
      port: 3000,
      // Keep dev URL stable for route and audit scripts.
      strictPort: true,
      host: '0.0.0.0',
      watch: {
        ignored: [
          '**/.vite-cache/**',
          '**/backups/**',
          '**/dist/**',
          '**/logs/**',
          '**/output/**',
          '**/runtime-db/**',
          '**/scratchdb/**',
          '**/temp*/**',
        ],
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:5001',
          changeOrigin: true,
        },
      },
    },
    optimizeDeps: {
      // Prevent audit/browser profile artifacts under output/ from being treated
      // as dev-server entry points by Vite's dependency scanner.
      entries: ['index.html'],
    },
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            icons: ['lucide-react'],
            charts: ['recharts'],
            spreadsheet: ['xlsx'],
            http: ['axios'],
            motion: ['framer-motion'],
          },
        },
      },
    },
    define: {
      // API keys must come from import.meta.env at runtime, not be baked into the bundle.
    },
    resolve: {
      preserveSymlinks: true,
      alias: {
        // Point alias to the active workspace root instead of the legacy `src/` island.
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
