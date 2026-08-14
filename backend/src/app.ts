import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { env } from './env.js';
import { closeExif } from './lib/exif.js';
import i18nPlugin from './plugins/i18n.js';
import type { MessageKey } from './i18n/locales/en.js';
import securityPlugin from './plugins/security.js';
import sqlitePlugin from './plugins/sqlite.js';
import authPlugin from './plugins/auth.js';
import csrfPlugin from './plugins/csrf.js';
import maintenancePlugin from './plugins/maintenance.js';
import thumbnailerPlugin from './plugins/thumbnailer.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { adminAlbumRoutes } from './routes/admin.albums.js';
import { adminUploadRoutes } from './routes/admin.upload.js';
import { adminUploadSessionRoutes } from './routes/admin.uploads.js';
import { publicRoutes } from './routes/public.js';

// In the container: dist/app.js → ../public holds the built SPA.
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Trust N proxy hops (default 1 = Caddy on networking_proxy) so req.ip
    // reflects the real client from X-Forwarded-For. Load-bearing for the
    // per-IP rate limit; configurable via TRUST_PROXY_HOPS.
    trustProxy: env.trustProxyHops,
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

  // Order matters: locale first (the rate limiter and CSRF guard both reply with
  // translated errors from their own hooks), then headers + rate-limit, then DB,
  // then auth (cookie/jwt), then the global CSRF guard, then routes (so the
  // guard applies to all of them).
  await app.register(i18nPlugin);
  await app.register(securityPlugin);
  await app.register(sqlitePlugin);
  await app.register(authPlugin);
  await app.register(csrfPlugin);
  await app.register(maintenancePlugin);
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

  // Anything that reaches the handler unclaimed — a TypeBox validation
  // rejection, a multipart size limit, an unexpected throw — is emitted by the
  // framework in English and in its own shape. Normalise it onto the same
  // { error, code } envelope every route uses, translated, without changing any
  // status code. Route errors never land here: they go out via reply.fail().
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled request error');

    const key: MessageKey =
      status === 413
        ? 'upload.fileTooLarge'
        : status >= 500
          ? 'error.serverError'
          : 'error.badRequest';

    return reply.code(status).send({ error: req.t(key), code: key });
  });

  // exiftool spawns a long-lived helper process; shut it down cleanly.
  app.addHook('onClose', async () => {
    await closeExif();
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminAlbumRoutes);
  await app.register(adminUploadRoutes);
  await app.register(adminUploadSessionRoutes);
  await app.register(publicRoutes);

  // Serve the built SPA (present in the image; typically absent in local dev).
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      wildcard: false,
      // Set Cache-Control per file (below) rather than one blanket value; ETag
      // + Last-Modified stay on, so revalidating files still get a cheap 304.
      cacheControl: false,
      setHeaders: (res, filePath) => {
        // Vite emits content-hashed files under assets/ (e.g. index-a1b2c3.js):
        // the bytes for a given name never change, so cache them hard. Everything
        // else — index.html, favicon — must revalidate or a deploy goes unseen.
        res.setHeader(
          'Cache-Control',
          filePath.includes(`${sep}assets${sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });

    // SPA fallback: non-/api GETs return index.html so client-side routes
    // (/a/:uid, /admin, /login) resolve on a hard refresh.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.fail(404, 'error.notFound');
    });
  }

  return app;
}
