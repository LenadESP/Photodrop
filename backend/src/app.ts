import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import sqlitePlugin from './plugins/sqlite.js';
import { healthRoutes } from './routes/health.js';

// In the container: dist/app.js → ../public holds the built SPA.
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Trust exactly one proxy hop (Caddy on networking_proxy) so req.ip reflects
    // the real client from X-Forwarded-For. Load-bearing for rate-limit/lockout.
    trustProxy: 1,
    bodyLimit: 1_048_576, // 1 MB for JSON bodies; the upload route raises its own limit
    logger: {
      level: env.isProd ? 'warn' : 'info',
      redact: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
      ],
    },
  });

  await app.register(sqlitePlugin);
  await app.register(healthRoutes);

  // Serve the built SPA (present in the image; typically absent in local dev).
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, wildcard: false });

    // SPA fallback: non-/api GETs return index.html so client-side routes
    // (/a/:uid, /admin, /login) resolve on a hard refresh.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
