import { timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { CSRF_COOKIE } from '../lib/cookies.js';
import { verifyCsrfToken } from '../lib/csrf-token.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameToken(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Double-submit CSRF: a JS-readable csrf_token cookie must equal the
// X-CSRF-Token header on every state-changing API request. SameSite=Strict is
// the first line; this is the required second. Applied globally so no mutating
// route can forget it.
export default fp(async function csrfPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    if (!UNSAFE.has(req.method)) return;
    if (!req.url.startsWith('/api/')) return;

    const cookie = req.cookies[CSRF_COOKIE];
    const header = req.headers['x-csrf-token'];
    const headerValue = Array.isArray(header) ? header[0] : header;

    if (!cookie || !headerValue || !sameToken(cookie, headerValue) || !verifyCsrfToken(cookie)) {
      await reply.code(403).send({ error: 'CSRF token missing or invalid' });
    }
  });
});
