import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'chrome120',
    sourcemap: false,
    // pdf-lib and compromise make the panel bundle ~1 MB; it loads from disk, not the network.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
