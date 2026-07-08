import type { CookieSerializeOptions } from '@fastify/cookie';
import { env } from '../env.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

// Album unlock grants get a per-album cookie so a client can hold several.
export const albumCookie = (uid: string): string => `alb_${uid}`;

const base: CookieSerializeOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'strict',
  path: '/',
};

// Session access token. 15 min — matches its JWT lifetime.
export const accessCookieOpts: CookieSerializeOptions = { ...base, maxAge: 60 * 15 };

// Intermediate enroll/mfa token: same access_token cookie name, but a scoped,
// short-lived JWT (10 min). Give the cookie the same maxAge so the two expire
// together — a cookie that outlives its JWT is dead weight the browser keeps
// resending until it 401s.
export const intermediateCookieOpts: CookieSerializeOptions = { ...base, maxAge: 60 * 10 };

// Refresh token, scoped so it is only sent to the auth endpoints. 7 days.
export const refreshCookieOpts: CookieSerializeOptions = {
  ...base,
  path: '/api/auth',
  maxAge: 60 * 60 * 24 * 7,
};

// Album unlock grant. 2 hours.
export const albumCookieOpts: CookieSerializeOptions = { ...base, maxAge: 60 * 60 * 2 };

// CSRF token — readable by JS (double-submit), so NOT httpOnly. 8 hours.
export const csrfCookieOpts: CookieSerializeOptions = {
  ...base,
  httpOnly: false,
  maxAge: 60 * 60 * 8,
};

// Options used to clear a cookie (must match path).
export const clearOpts = (path = '/'): CookieSerializeOptions => ({ ...base, path, maxAge: 0 });
