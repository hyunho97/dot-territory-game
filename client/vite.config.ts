import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // assets/ 폴더(스프라이트, manifest.json)를 루트 경로로 그대로 서빙
  publicDir: '../assets',
  resolve: {
    // 온라인 빌드에는 혼자 하는 판 부팅 코드를 넣지 않는다
    alias: {
      'virtual:local-boot': fileURLToPath(new URL('./src/local/bootStub.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    fs: { allow: ['..'] },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
