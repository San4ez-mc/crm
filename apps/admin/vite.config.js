import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4700', changeOrigin: true },
      '/auth': { target: 'http://localhost:4700', changeOrigin: true },
      '/me': { target: 'http://localhost:4700', changeOrigin: true },
      // Локально завантажені фото товару (§9.3) — без цього /uploads/* 404-ив би в dev
      // (у продакшні той самий Express-процес роздає і /uploads, і admin-статику).
      '/uploads': { target: 'http://localhost:4700', changeOrigin: true },
    },
  },
  build: {
    outDir: '../../public/admin',
    emptyOutDir: true,
  },
});
