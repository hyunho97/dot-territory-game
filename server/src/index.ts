import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import './db/db.js';
import { registerRoutes } from './routes/index.js';
import { startPushLoop } from './services/pushService.js';

/**
 * 환경 변수 (모두 선택, 기본값은 로컬 개발용)
 *  PORT          서버 포트 (3001)
 *  HOST          바인딩 주소 (127.0.0.1 — 외부 공개 시 0.0.0.0)
 *  DB_PATH       SQLite 파일 경로
 *  TRUST_PROXY   1 이면 리버스 프록시(X-Forwarded-*) 뒤에서 실제 접속자 IP 를 사용
 *  SERVE_CLIENT  1 이면 빌드된 client/dist 를 같은 서버에서 함께 서빙 (npm run start:prod)
 */
const trustProxy = process.env.TRUST_PROXY === '1';
const app = Fastify({
  logger: { level: 'info' },
  trustProxy,
  bodyLimit: 100 * 1024,
});

// 기본 보안 헤더. HTTPS 프록시 뒤에서만 HSTS 를 붙인다.
app.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'same-origin');
  if (trustProxy && req.protocol === 'https')
    reply.header('Strict-Transport-Security', 'max-age=31536000');
});

app.get('/api/health', async () => ({ ok: true, time: Date.now() }));
registerRoutes(app);

if (process.env.SERVE_CLIENT === '1') {
  const dist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
  if (!existsSync(dist)) {
    app.log.error('client/dist 가 없습니다. 먼저 `npm run build -w client` 를 실행하세요.');
    process.exit(1);
  }
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'NOT_FOUND' });
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
app
  .listen({ port, host })
  .then(() => startPushLoop())
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
