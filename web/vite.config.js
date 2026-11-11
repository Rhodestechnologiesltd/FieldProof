import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the web app runs on :5173 and forwards /api to the API server on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
