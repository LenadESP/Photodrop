import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { env } from '../env.js';
import { hashSecret, verifySecret } from '../lib/hash.js';
import { issueCsrfToken } from '../lib/csrf-token.js';
import { generateTotpSecret, totpQrDataUrl, totpUri, verifyTotp } from '../lib/totp.js';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  accessCookieOpts,
  clearOpts,
  csrfCookieOpts,
  refreshCookieOpts,
} from '../lib/cookies.js';
import { LoginBody, TotpBody } from '../schemas/auth.js';
import type { UserRow } from '../db/types.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

const strict = { max: 10, timeWindow: '1 minute' };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const getUser = (id: number): UserRow | undefined =>
    app.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

  const getUserByName = (name: string): UserRow | undefined =>
    app.db.prepare('SELECT * FROM users WHERE username = ?').get(name) as UserRow | undefined;

  const publicUser = (u: UserRow) => ({ username: u.username, role: u.role });

  async function issueSession(reply: FastifyReply, user: UserRow): Promise<void> {
    const access = await reply.jwtSign(
      { sub: user.id, role: user.role, scope: 'session' },
      { expiresIn: '15m' },
    );
    const refresh = await reply.jwtSign(
      { sub: user.id, scope: 'refresh' },
      { expiresIn: '7d' },
    );
    reply.setCookie(ACCESS_COOKIE, access, accessCookieOpts);
    reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOpts);
  }

  function registerFailure(user: UserRow): void {
    const attempts = user.failed_login_attempts + 1;
    const locked = attempts >= MAX_FAILED ? Date.now() + LOCK_MS : null;
    app.db
      .prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
      .run(locked ? 0 : attempts, locked, user.id);
  }

  function clearFailures(userId: number): void {
    app.db
      .prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(userId);
  }

  // ── Step 1: username + password ───────────────────────────────────────────
  app.post(
    '/api/auth/login',
    { schema: { body: LoginBody }, config: { rateLimit: strict } },
    async (req, reply) => {
      const { username, password } = req.body as Static<typeof LoginBody>;
      const user = getUserByName(username);

      if (!user) {
        // Burn comparable time to blunt username enumeration.
        await hashSecret(password);
        return reply.code(401).send({ error: 'Invalid credentials' });
      }
      if (user.locked_until && Date.now() < user.locked_until) {
        return reply.code(423).send({ error: 'Account temporarily locked. Try again later.' });
      }
      if (!(await verifySecret(user.password_hash, password))) {
        registerFailure(user);
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      clearFailures(user.id);

      // Password is correct but this alone does NOT grant a session. Issue a
      // scoped intermediate token that only reaches the TOTP routes.
      const scope = user.totp_enabled ? 'mfa' : 'enroll';
      const token = await reply.jwtSign(
        { sub: user.id, role: user.role, scope },
        { expiresIn: '10m' },
      );
      reply.setCookie(ACCESS_COOKIE, token, accessCookieOpts);
      return { step: scope };
    },
  );

  // ── TOTP enrollment (first login) ─────────────────────────────────────────
  app.post(
    '/api/auth/totp/enroll',
    { preHandler: app.requireEnrollment, config: { rateLimit: strict } },
    async (req, reply) => {
      const user = getUser(req.user.sub);
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      if (user.totp_enabled) return reply.code(409).send({ error: 'TOTP already enabled' });

      const secret = generateTotpSecret();
      app.db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);
      const uri = totpUri(user.username, secret);
      return { secret, otpauthUri: uri, qrDataUrl: await totpQrDataUrl(uri) };
    },
  );

  app.post(
    '/api/auth/totp/activate',
    { preHandler: app.requireEnrollment, schema: { body: TotpBody }, config: { rateLimit: strict } },
    async (req, reply) => {
      const { code } = req.body as Static<typeof TotpBody>;
      const user = getUser(req.user.sub);
      if (!user || !user.totp_secret) {
        return reply.code(400).send({ error: 'No enrollment in progress' });
      }
      if (!(await verifyTotp(code, user.totp_secret))) {
        return reply.code(400).send({ error: 'Invalid code' });
      }
      app.db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
      await issueSession(reply, user);
      return { ok: true, user: publicUser(user) };
    },
  );

  // ── Step 2: TOTP verification (returning login) ───────────────────────────
  app.post(
    '/api/auth/totp/verify',
    { preHandler: app.requireMfa, schema: { body: TotpBody }, config: { rateLimit: strict } },
    async (req, reply) => {
      const { code } = req.body as Static<typeof TotpBody>;
      const user = getUser(req.user.sub);
      if (!user || !user.totp_secret) return reply.code(400).send({ error: 'Invalid state' });
      if (user.locked_until && Date.now() < user.locked_until) {
        return reply.code(423).send({ error: 'Account temporarily locked. Try again later.' });
      }
      if (!(await verifyTotp(code, user.totp_secret))) {
        registerFailure(user);
        return reply.code(400).send({ error: 'Invalid code' });
      }
      clearFailures(user.id);
      await issueSession(reply, user);
      return { ok: true, user: publicUser(user) };
    },
  );

  // ── Session maintenance ───────────────────────────────────────────────────
  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return reply.code(401).send({ error: 'Unauthorized' });

    let claims: { sub: number; scope: string };
    try {
      claims = app.jwt.verify(token) as { sub: number; scope: string };
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if (claims.scope !== 'refresh') return reply.code(401).send({ error: 'Unauthorized' });
    const user = getUser(claims.sub);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });

    const access = await reply.jwtSign(
      { sub: user.id, role: user.role, scope: 'session' },
      { expiresIn: '15m' },
    );
    reply.setCookie(ACCESS_COOKIE, access, accessCookieOpts);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(ACCESS_COOKIE, clearOpts('/'));
    reply.clearCookie(REFRESH_COOKIE, clearOpts('/api/auth'));
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      return { user: null };
    }
    if (req.user.scope !== 'session') return { user: null };
    const user = getUser(req.user.sub);
    return { user: user ? publicUser(user) : null };
  });

  // Issue a CSRF token (double-submit). Safe method → not itself CSRF-guarded.
  app.get('/api/auth/csrf', async (_req, reply) => {
    const token = issueCsrfToken();
    reply.setCookie(CSRF_COOKIE, token, csrfCookieOpts);
    return { csrfToken: token };
  });

  // Expose the configured public origin (handy for building share links).
  app.get('/api/config', async () => ({ publicOrigin: env.publicOrigin }));
}
