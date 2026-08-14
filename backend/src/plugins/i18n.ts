import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DEFAULT_LOCALE, negotiateLocale, t, type Locale } from '../i18n/index.js';
import type { MessageKey } from '../i18n/locales/en.js';

declare module 'fastify' {
  interface FastifyRequest {
    locale: Locale;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  }
  interface FastifyReply {
    fail: (
      status: number,
      key: MessageKey,
      opts?: {
        params?: Record<string, string | number>;
        extra?: Record<string, unknown>;
      },
    ) => FastifyReply;
  }
}

// Locale negotiation for error text. The SPA renders whatever string the API
// puts in `error`, so the server — not the client — owns the translation.
//
// Registered FIRST in app.ts: the CSRF guard and the rate limiter both reply
// with errors from their own onRequest hooks, and hooks run in registration
// order, so req.locale has to be set before either of them runs.
export default fp(async function i18nPlugin(app: FastifyInstance): Promise<void> {
  // Decorate with a placeholder so the property exists on the prototype (Fastify
  // requires this for a fast request object); the hook fills in the real value.
  app.decorateRequest('locale', DEFAULT_LOCALE);
  app.decorateRequest('t', function (this: FastifyRequest, key, params) {
    return t(this.locale, key, params);
  });

  app.addHook('onRequest', async (req, reply) => {
    req.locale = negotiateLocale(req.headers['accept-language']);

    // The same URL now yields different bytes per Accept-Language. Anything
    // caching between us and the browser (the reverse proxy, a CDN later) has to
    // key on it or one language's error text gets served to the other.
    if (req.url.startsWith('/api/')) reply.header('Vary', 'Accept-Language');
  });

  // Single choke point for error replies: translates, and attaches the stable
  // machine-readable `code` so a client can branch on identity rather than on
  // text that changes with the locale.
  app.decorateReply(
    'fail',
    function (this: FastifyReply, status, key, opts): FastifyReply {
      return this.code(status).send({
        error: t(this.request.locale, key, opts?.params),
        code: key,
        ...opts?.extra,
      });
    },
  );
});
