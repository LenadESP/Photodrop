import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { env } from '../env.js';
import { ACCESS_COOKIE } from '../lib/cookies.js';

export type Role = 'admin' | 'user';
export type AccessScope = 'enroll' | 'mfa' | 'session';

export interface AccessClaims {
  sub: number;
  role: Role;
  scope: AccessScope;
  // Present on session tokens; must match the user's current token_version.
  // Absent (⇒ treated as 0) on enroll/mfa tokens and on tokens minted before
  // 1.2.0, which stay valid against the default version 0.
  tv?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireEnrollment: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMfa: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// One signing secret for every token; the `scope` claim + short lifetimes keep
// the stages separate (a refresh/album/enroll token can never satisfy a
// session check, and vice-versa).
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload:
      | AccessClaims
      | { sub: number; scope: 'refresh'; tv?: number }
      | { scope: 'album'; uid: string };
    user: AccessClaims;
  }
}

export default fp(async function authPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie, { secret: env.cookieSecret });

  await app.register(fastifyJwt, {
    secret: env.jwtSecret,
    // Pin the algorithm on both sides. HS256 is already what a symmetric string
    // secret selects, and fast-jwt rejects `none` outright, so this changes no
    // token today — it's defence in depth, and it stops a future key change from
    // silently widening the set of algorithms the verifier will accept.
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
    cookie: { cookieName: ACCESS_COOKIE, signed: false },
  });

  async function verifyScope(
    req: FastifyRequest,
    reply: FastifyReply,
    scope: AccessScope,
  ): Promise<boolean> {
    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      await reply.code(401).send({ error: 'Unauthorized' });
      return false;
    }
    if (req.user.scope !== scope) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return false;
    }
    // Session tokens are revocable: their version must still match the user's
    // current token_version (bumped on logout). enroll/mfa tokens are transient
    // and carry no version, so this only gates full sessions.
    if (scope === 'session') {
      const row = app.db.prepare('SELECT token_version FROM users WHERE id = ?').get(req.user.sub) as
        | { token_version: number }
        | undefined;
      if (!row || (req.user.tv ?? 0) !== row.token_version) {
        await reply.code(401).send({ error: 'Unauthorized' });
        return false;
      }
    }
    return true;
  }

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    await verifyScope(req, reply, 'session');
  });

  app.decorate('requireEnrollment', async (req: FastifyRequest, reply: FastifyReply) => {
    await verifyScope(req, reply, 'enroll');
  });

  app.decorate('requireMfa', async (req: FastifyRequest, reply: FastifyReply) => {
    await verifyScope(req, reply, 'mfa');
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyScope(req, reply, 'session'))) return;
    if (req.user.role !== 'admin') {
      await reply.code(403).send({ error: 'Forbidden' });
    }
  });
});
