import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4700', changeOrigin: true },
      '/auth': { target: 'http://localhost:4700', changeOrigin: true },
      '/me': { target: 'http://localhost:4700', changeOrigin: true },
    },
  },
  build: {
    outDir: '../../public/admin',
    emptyOutDir: true,
  },
});
