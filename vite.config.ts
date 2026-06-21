import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client lives in src/client but the project root stays here so that
// tailwind/postcss config is picked up automatically. The Express server
// (port 8080) serves the built client and the /api + /docs routes; in dev,
// Vite (5173) proxies those through to it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
      '/openapi.json': 'http://localhost:8080',
    },
  },
});
