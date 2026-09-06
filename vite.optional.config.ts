import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localCartridges } from './scripts/local-roms.ts';

export default defineConfig({
  define: { __LOCAL_DEVELOPMENT__: true },
  plugins: [localCartridges(), react()],
  server: {
    port: 27047,
    strictPort: true,
    host: '127.0.0.1',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: { target: 'es2022' },
});
