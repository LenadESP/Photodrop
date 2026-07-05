import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { env } from './env.js';
import { closeExif } from './lib/exif.js';
import securityPlugin from './plugins/security.js';
import sqlitePlugin from './plugins/sqlite.js';
import authPlugin from './plugins/auth.js';
import csrfPlugin from './plugins/csrf.js';
import thumbnailerPlugin from './plugins/thumbnailer.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { adminAlbumRoutes } from './routes/admin.albums.js';
import { adminUploadRoutes } from './routes/admin.upload.js';
import { publicRoutes } from './routes/public.js';

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

  // Order matters: headers + rate-limit, then DB, then auth (cookie/jwt), then
  // the global CSRF guard, then routes (so the guard applies to all of them).
  await app.register(securityPlugin);
  await app.register(sqlitePlugin);
  await app.register(authPlugin);
  await app.register(csrfPlugin);
  await app.register(thumbnailerPlugin);
  await app.register(fastifyMultipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1_000_000,
      fields: 10,
      fileSize: env.maxFileBytes,
      files: env.maxFilesPerUpload,
      headerPairs: 200,
    },
  });

  // exiftool spawns a long-lived helper process; shut it down cleanly.
  app.addHook('onClose', async () => {
    await closeExif();
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminAlbumRoutes);
  await app.register(adminUploadRoutes);
  await app.register(publicRoutes);

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
