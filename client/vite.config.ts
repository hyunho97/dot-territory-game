import { defineConfig } from 'vite';

export default defineConfig({
  // assets/ 폴더(스프라이트, manifest.json)를 루트 경로로 그대로 서빙
  publicDir: '../assets',
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    fs: { allow: ['..'] },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
