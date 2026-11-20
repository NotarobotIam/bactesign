// Static build of Bactesign for GitHub Pages (public demo). See scripts/build-demo.mjs.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./demo', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  base: '/',
  plugins: [react()],
  css: { postcss: { plugins: [] } },
  build: { outDir: fileURLToPath(new URL('./dist-demo', import.meta.url)), emptyOutDir: true },
});
