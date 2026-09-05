import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { localCartridges } from './scripts/local-roms.ts';

export default defineConfig(({ command, isPreview }) => ({
  define: { __LOCAL_DEVELOPMENT__: command === 'serve' && !isPreview },
  plugins: [localCartridges(), react(), cloudflare()],
  server: {
    port: 7047,
    strictPort: true,
    allowedHosts: ['pokemon.dev.hexly.ai'],
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: { port: 17047, strictPort: true, allowedHosts: ['pokemon.dev.hexly.ai'] },
  build: { target: 'es2022' },
}));
