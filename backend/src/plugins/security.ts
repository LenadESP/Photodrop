import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

// Global security headers + a baseline rate limit. Auth/unlock routes tighten
// this further via per-route `config.rateLimit`. req.ip is the real client IP
// because the app trusts one proxy hop (Caddy) — see buildApp().
export default fp(async function securityPlugin(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // A gallery loads image blobs/data URLs; COEP would needlessly break that.
    crossOriginEmbedderPolicy: false,
  });

  // Gallery-friendly baseline (a grid fires many thumbnail GETs at once); the
  // auth/unlock routes clamp down hard via per-route config.
  await app.register(rateLimit, {
    global: true,
    max: 1000,
    timeWindow: '1 minute',
  });
});
