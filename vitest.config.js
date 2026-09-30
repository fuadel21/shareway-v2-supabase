import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'node:fs';

// Tests aislados (ver test-quarantine.json). RUN_QUARANTINED=1 los vuelve a incluir.
const quarantine = JSON.parse(readFileSync(new URL('./test-quarantine.json', import.meta.url), 'utf8'));
const quarantinedFiles = process.env.RUN_QUARANTINED
  ? []
  : Object.values(quarantine.categories).flatMap((c) => c.files);

export default defineConfig({
  plugins: [react()],
  // Varios tests unitarios contienen JSX dentro de ficheros .js.
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    // Sin credenciales reales: los tests unitarios no deben tocar Supabase.
    // (El bloque `test` de vite.config.js lo ignora Vitest cuando existe este fichero.)
    env: {
      VITE_SUPABASE_URL: 'https://shareway-test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key-for-local-vitest-only',
    },
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: [...configDefaults.exclude, ...quarantinedFiles],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
