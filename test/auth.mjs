// Verification harness for photodrop 1.3.3 (auth hardening).
// Runs INSIDE the built image against dist/, driving routes via fastify inject.
//   T1  locked login answers 401, byte-identical to an unknown username
//   T2  locked login costs argon2 time (no timing oracle replacing the status one)
//   T3  lockout is still actually enforced
//   T4  /totp/verify and /api/auth/refresh keep their explicit 423
//   T5  full happy path: login -> enroll -> activate -> me -> refresh -> logout
//   T6  HS256 pinning: an HS256 token still verifies, a non-HS256 one is rejected
import { buildApp } from '/app/dist/app.js';
import { ensureDataDirs } from '/app/dist/lib/paths.js';
import { generate } from 'otplib';
import { createSigner } from 'fast-jwt';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const log = { push: (s) => console.log(s) };

ensureDataDirs();
const app = await buildApp();
await app.ready();

const USER = process.env.ADMIN_USERNAME;
const PASS = process.env.ADMIN_PASSWORD;

// ── cookie jar over inject ────────────────────────────────────────────────
let jar = new Map();
function applyCookies(res) {
  for (const c of res.cookies ?? []) {
    if (c.value === '') jar.delete(c.name);
    else jar.set(c.name, c.value);
  }
}
// The auth routes are rate-limited to 10/min per IP, which is far below what this
// harness needs — without this every measurement would be timing a 429 rejection
// instead of the handler. Account lockout is keyed on the user row, not the IP, so
// giving each request its own source address isolates the auth logic without
// weakening anything under test.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}
async function req(method, url, body) {
  const headers = {};
  const ck = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (ck) headers.cookie = ck;
  if (method !== 'GET' && jar.has('csrf_token')) headers['x-csrf-token'] = jar.get('csrf_token');
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.inject({ method, url, headers, payload: body, remoteAddress: nextIp() });
  applyCookies(res);
  return res;
}
const login = (username, password) => req('POST', '/api/auth/login', { username, password });
const unlock = () =>
  app.db
    .prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE username = ?')
    .run(USER);
const lock = () =>
  app.db
    .prepare('UPDATE users SET locked_until = ? WHERE username = ?')
    .run(Date.now() + 5 * 60 * 1000, USER);

await req('GET', '/api/auth/csrf');

// ── T1 — locked answers exactly as unknown ────────────────────────────────
unlock();
const unknownRes = await login('no-such-user-here', PASS);
lock();
const lockedRes = await login(USER, PASS);

check('T1a unknown username -> 401', unknownRes.statusCode === 401, `got ${unknownRes.statusCode}`);
check('T1b locked account -> 401 (was 423)', lockedRes.statusCode === 401, `got ${lockedRes.statusCode}`);
check(
  'T1c locked body is identical to unknown body',
  lockedRes.body === unknownRes.body,
  `${JSON.stringify(lockedRes.body)} vs ${JSON.stringify(unknownRes.body)}`,
);
check(
  'T1d no 423 anywhere in the locked login response',
  !JSON.stringify(lockedRes.headers).includes('423') && !lockedRes.body.toLowerCase().includes('lock'),
  lockedRes.body,
);

// ── T2 — locked still burns argon2 (no timing oracle) ─────────────────────
async function medianMs(fn, n = 5) {
  const t = [];
  for (let i = 0; i < n; i += 1) {
    const s = process.hrtime.bigint();
    await fn();
    t.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  return t.sort((a, b) => a - b)[Math.floor(n / 2)];
}
unlock();
const tUnknown = await medianMs(() => login('no-such-user-here', PASS));
unlock();
const tWrong = await medianMs(async () => {
  unlock();
  return login(USER, 'definitely-the-wrong-password');
});
lock();
const tLocked = await medianMs(async () => {
  lock();
  return login(USER, PASS);
});
log.push(`  ..    timings: unknown=${tUnknown.toFixed(1)}ms wrong=${tWrong.toFixed(1)}ms locked=${tLocked.toFixed(1)}ms`);
check('T2a locked path does real KDF work (>10ms)', tLocked > 10, `${tLocked.toFixed(1)}ms`);
check(
  'T2b locked is not dramatically faster than unknown (>50%)',
  tLocked > tUnknown * 0.5,
  `locked ${tLocked.toFixed(1)}ms vs unknown ${tUnknown.toFixed(1)}ms`,
);
check(
  'T2c locked is not dramatically faster than a wrong password (>50%)',
  tLocked > tWrong * 0.5,
  `locked ${tLocked.toFixed(1)}ms vs wrong ${tWrong.toFixed(1)}ms`,
);

// ── T3 — lockout still enforced ───────────────────────────────────────────
unlock();
for (let i = 0; i < 5; i += 1) await login(USER, 'wrong-password');
const afterFive = app.db.prepare('SELECT locked_until FROM users WHERE username = ?').get(USER);
check('T3a 5 failures lock the account', afterFive.locked_until !== null && afterFive.locked_until > Date.now());
const correctWhileLocked = await login(USER, PASS);
check('T3b correct password refused while locked', correctWhileLocked.statusCode === 401, `got ${correctWhileLocked.statusCode}`);
const frozen = app.db.prepare('SELECT failed_login_attempts FROM users WHERE username = ?').get(USER);
check('T3c attempts stay frozen while locked', frozen.failed_login_attempts === 0, `got ${frozen.failed_login_attempts}`);

// ── T5 (before T4, it needs an enrolled account) — full happy path ────────
unlock();
jar = new Map();
await req('GET', '/api/auth/csrf');
const step1 = await login(USER, PASS);
check('T5a password login -> enroll step', step1.statusCode === 200 && JSON.parse(step1.body).step === 'enroll', step1.body);
const enroll = await req('POST', '/api/auth/totp/enroll');
check(
  'T5b enroll returns a secret',
  enroll.statusCode === 200 && !!JSON.parse(enroll.body).secret,
  `status=${enroll.statusCode} body=${enroll.body.slice(0, 200)}`,
);
const secret = JSON.parse(enroll.body).secret;
if (!secret) {
  console.log('\n  ABORT: no TOTP secret — cannot drive the remaining flow tests.');
  console.log(`  ${pass} passed, ${fail} failed`);
  process.exit(1);
}
const activate = await req('POST', '/api/auth/totp/activate', { code: await generate({ secret }) });
check('T5c activate issues a session', activate.statusCode === 200 && jar.has('access_token'), activate.body);
const me1 = await req('GET', '/api/auth/me');
check('T5d /me returns the user', JSON.parse(me1.body).user?.username === USER, me1.body);
const refreshed = await req('POST', '/api/auth/refresh');
check('T5e refresh succeeds', refreshed.statusCode === 200, refreshed.body);
const me2 = await req('GET', '/api/auth/me');
check('T5f session valid after refresh', JSON.parse(me2.body).user?.username === USER, me2.body);
const staleRefresh = jar.get('refresh_token');
const loggedOut = await req('POST', '/api/auth/logout');
check('T5g logout ok', loggedOut.statusCode === 200);
const me3 = await req('GET', '/api/auth/me');
check('T5h session revoked after logout', JSON.parse(me3.body).user === null, me3.body);
// Go back through req() so the CSRF double-submit is satisfied — otherwise the
// request dies at the CSRF hook (403) and never reaches the revocation check we
// are actually testing.
await req('GET', '/api/auth/csrf');
jar.set('refresh_token', staleRefresh);
const replay = await req('POST', '/api/auth/refresh');
check('T5i pre-logout refresh token is dead', replay.statusCode === 401, `got ${replay.statusCode}`);
jar.delete('refresh_token');

// ── T4 — TOTP + refresh keep 423 ──────────────────────────────────────────
unlock();
jar = new Map();
await req('GET', '/api/auth/csrf');
const mfaStep = await login(USER, PASS);
check('T4a returning login -> mfa step', JSON.parse(mfaStep.body).step === 'mfa', mfaStep.body);
lock(); // lock AFTER holding an mfa cookie
const totpLocked = await req('POST', '/api/auth/totp/verify', { code: await generate({ secret }) });
check('T4b /totp/verify still answers 423 when locked', totpLocked.statusCode === 423, `got ${totpLocked.statusCode}`);

unlock();
jar = new Map();
await req('GET', '/api/auth/csrf');
await login(USER, PASS);
// Still inside the step whose code activated enrolment, so the same code comes back
// from generate(). That makes it a free check of the 1.2.0 replay guard; clear the
// recorded step afterwards so the rest of the flow has a usable code.
const replayed = await req('POST', '/api/auth/totp/verify', { code: await generate({ secret }) });
check(
  'T4c-pre a replayed TOTP code is rejected',
  replayed.statusCode === 400 && replayed.body.includes('already used'),
  `status=${replayed.statusCode} body=${replayed.body}`,
);
app.db.prepare('UPDATE users SET totp_last_step = NULL WHERE username = ?').run(USER);
const verified = await req('POST', '/api/auth/totp/verify', { code: await generate({ secret }) });
check('T4c TOTP verify issues a session', verified.statusCode === 200, verified.body);
lock();
const refreshLocked = await req('POST', '/api/auth/refresh');
check('T4d /api/auth/refresh still answers 423 when locked', refreshLocked.statusCode === 423, `got ${refreshLocked.statusCode}`);
unlock();

// ── T6 — HS256 pinning ────────────────────────────────────────────────────
const jwtSecret = process.env.JWT_SECRET;
const hs256 = createSigner({ key: jwtSecret, algorithm: 'HS256' })({ sub: 1, scope: 'session', tv: 0 });
let hs256Verified = false;
try {
  app.jwt.verify(hs256);
  hs256Verified = true;
} catch { /* fails below */ }
check('T6a an HS256 token still verifies (pre-change tokens survive)', hs256Verified);

const hs512 = createSigner({ key: jwtSecret, algorithm: 'HS512' })({ sub: 1, scope: 'session', tv: 0 });
let hs512Rejected = false;
try {
  app.jwt.verify(hs512);
} catch {
  hs512Rejected = true;
}
check('T6b a non-HS256 token is rejected (the pin actually binds)', hs512Rejected);

await app.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
