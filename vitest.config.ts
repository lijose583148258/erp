import path from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'pages/**/*.{test,spec}.{ts,tsx}',
      'services/**/*.{test,spec}.{ts,tsx}',
      'stores/**/*.{test,spec}.{ts,tsx}',
      'utils/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      'backend/**',
      'dist/**',
      'node_modules/**',
      'output/**',
      '**/*.unit.test.{ts,tsx,js,jsx}',
      'utils/customerName.test.ts',
      'utils/quarantine/**',
    ],
  },
});
