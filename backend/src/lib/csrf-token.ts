import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// Signed double-submit token: `<nonce>.<hmac>`. The HMAC (keyed by CSRF_SECRET)
// means an attacker who can plant a cookie still cannot forge a token that
// verifies, on top of the header-equals-cookie check.
function sign(nonce: string): string {
  return createHmac('sha256', env.csrfSecret).update(nonce).digest('base64url');
}

export function issueCsrfToken(): string {
  const nonce = randomBytes(18).toString('base64url');
  return `${nonce}.${sign(nonce)}`;
}

export function verifyCsrfToken(token: string): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const nonce = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(nonce));
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
