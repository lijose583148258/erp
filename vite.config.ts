import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageNameFromModuleId = (moduleId: string) => {
  const normalized = moduleId.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return null;
  const parts = normalized.slice(index + marker.length).split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
};

const frontendBundleInventoryPlugin = (): Plugin => ({
  name: 'ailaoda-frontend-bundle-inventory',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle)
      .filter((entry): entry is Extract<typeof entry, { type: 'chunk' }> => entry.type === 'chunk')
      .map((chunk) => ({
        fileName: chunk.fileName,
        isEntry: chunk.isEntry,
        dynamicImports: chunk.dynamicImports,
        packages: Array.from(new Set(
          Object.keys(chunk.modules)
            .map(packageNameFromModuleId)
            .filter((name): name is string => Boolean(name)),
        )).sort(),
      }));
    const packages = Array.from(new Set(chunks.flatMap((chunk) => chunk.packages))).sort();
    this.emitFile({
      type: 'asset',
      fileName: 'frontend-bundle-inventory.json',
      source: `${JSON.stringify({ schemaVersion: 1, generated: true, packages, chunks }, null, 2)}\n`,
    });
  },
});

const bomGridLabFixturePlugin = (): Plugin => ({
  name: 'ailaoda-bom-grid-lab-fixtures',
  apply: 'build',
  generateBundle() {
    const fixtureDir = path.resolve(__dirname, 'tests', 'fixtures', 'bom-grid');
    for (const fileName of [
      'acrylic-emulsion-100-rows.json',
      'acrylic-emulsion-1000-rows.json',
      'paste-300-rows.tsv',
      'expected-save-payload.json',
    ]) {
      this.emitFile({
        type: 'asset',
        fileName: `bom-grid-lab-fixtures/${fileName}`,
        source: fs.readFileSync(path.join(fixtureDir, fileName)),
      });
    }
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const bomGridLabEnabled = env.VITE_BOM_GRID_LAB_ENABLED === 'true';
  return {
    cacheDir: '.vite-cache',
    server: {
      port: 3000,
      // Keep dev URL stable for route and audit scripts.
      strictPort: true,
      host: '0.0.0.0',
      watch: {
        // Chokidar can miss atomic writes under non-ASCII Windows paths.
        // Polling only affects the local development server.
        usePolling: process.platform === 'win32',
        interval: 300,
        ignored: [
          '**/.vite-cache/**',
          '**/backups/**',
          '**/dist/**',
          '**/logs/**',
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
        '/ws': {
          target: 'ws://127.0.0.1:5001',
          ws: true,
          changeOrigin: true,
        },
      },
    },
    optimizeDeps: {
      // Prevent audit/browser profile artifacts under output/ from being treated
      // as dev-server entry points by Vite's dependency scanner.
      entries: ['index.html'],
    },
    plugins: [
      react(),
      frontendBundleInventoryPlugin(),
      ...(bomGridLabEnabled ? [bomGridLabFixturePlugin()] : []),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      minify: 'esbuild' as const,
      rollupOptions: {
        output: {
          manualChunks: {
            icons: ['lucide-react'],
            charts: ['recharts'],
            spreadsheet: ['exceljs'],
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
