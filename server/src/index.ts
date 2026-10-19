import Fastify from 'fastify';
import './db/db.js';
import { registerRoutes } from './routes/index.js';

const app = Fastify({ logger: { level: 'info' } });
registerRoutes(app);

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '127.0.0.1' }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
