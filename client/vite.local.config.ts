import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * 혼자 하는 웹판 빌드: 서버 코드를 브라우저 안에서 실행한다 (서버/로그인 없음, 저장은 브라우저 IndexedDB).
 *  - node:sqlite → sql.js(WASM), node:fs → 빌드에 묶은 data/*.json, node:crypto/url/path → 작은 대역
 *  - 푸시 알림 서비스는 비움
 *  - base './' 라서 GitHub Pages 같은 하위 경로에 올려도 동작
 * 개발: npm run dev:local   빌드: npm run build:local (client/dist-local)
 */
const p = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  publicDir: '../assets',
  define: { 'process.env.DB_PATH': 'undefined' },
  resolve: {
    alias: [
      { find: 'node:sqlite', replacement: p('./src/local/shims/sqlite.ts') },
      { find: 'node:crypto', replacement: p('./src/local/shims/crypto.ts') },
      { find: 'node:fs', replacement: p('./src/local/shims/fs.ts') },
      { find: 'node:url', replacement: p('./src/local/shims/url.ts') },
      { find: 'node:path', replacement: p('./src/local/shims/path.ts') },
      { find: /^.*\/services\/pushService\.js$/, replacement: p('./src/local/shims/pushStub.ts') },
      { find: 'virtual:local-boot', replacement: p('./src/local/boot.ts') },
    ],
  },
  server: { port: 5174, fs: { allow: ['..'] } },
  build: { outDir: 'dist-local', chunkSizeWarningLimit: 3000 },
});
