# Security

This documents what the code actually enforces, plus known limits and how to report a
vulnerability. Implementation references point at `backend/src/`.

## Threat model

photodrop is a single-admin tool that hands unauthenticated recipients an opaque link
to a gallery. The main assets are: the admin account, the photo originals, and the
metadata inside them (GPS, camera serial). The primary adversaries are: someone
guessing or enumerating album links, someone trying to reach the dashboard, and someone
uploading a hostile file to the admin (the admin is the only uploader, but decode still
runs on untrusted image bytes).

## Authentication

- **Mandatory TOTP.** A correct password issues only a short-lived `enroll` or `mfa`
  scoped token — never a session. A session is granted only after TOTP activation
  (first login) or verification (returning login). See `routes/auth.ts`,
  `lib/totp.ts` (otplib, ±30 s / ±1-step skew tolerance, per RFC 6238 §5.2).
- **TOTP replay protection.** The matched RFC 6238 time-step of each accepted code is
  recorded per user (`users.totp_last_step`); a code whose step was already used is
  rejected, so a captured code can't be replayed inside its ±1-step window.
- **Password hashing.** argon2id with OWASP-baseline parameters
  (`memoryCost 19456 KiB, timeCost 2, parallelism 1`). See `lib/hash.ts`.
- **Argon2 verified before bytes are served.** Album passwords are checked with
  argon2id *before* any photo bytes leave the server (`routes/public.ts` `hasAccess`
  + unlock).
- **Enumeration resistance.** A missing username — and a locked account — burns an argon2
  hash and returns the same generic 401; a missing or password-less album still burns an
  argon2 verify and returns an identical response. No timing or existence oracle.
- **Rate limiting.** Global baseline 1000 req/min; auth and unlock routes clamp to
  10/min, refresh to 30/min, and the bulk-byte endpoints to 30/min (`/zip`) and 300/min
  (full originals) (`plugins/security.ts`, per-route `config.rateLimit`). The proxy-trust
  depth that makes `req.ip` the real client IP is configurable via `TRUST_PROXY_HOPS`
  (default 1 — the single Caddy hop).
- **Account lockout.** 5 failed attempts → a 5-minute lock, applied to the password step,
  the TOTP step, and `/api/auth/refresh` — a held refresh token can't mint a session while
  the account is locked (`routes/auth.ts`). The password step answers a locked account
  with the same generic 401, at the same argon2 cost, as an unknown username, so the lock
  reveals nothing about whether the account exists. The TOTP and refresh steps are already
  past a correct password or a valid token, so they return an explicit 423.

## Session & cookies

- JWTs are delivered in cookies that are `httpOnly`, `SameSite=Strict`, and `Secure`
  in production (`lib/cookies.ts`).
- One signing secret; a `scope` claim (`enroll` / `mfa` / `session` / `refresh` /
  `album`) plus short lifetimes keep the stages isolated — a token for one stage cannot
  satisfy another's guard (`plugins/auth.ts`).
- Lifetimes: session 15 min, refresh 7 days (scoped to `/api/auth`), album unlock 2 h.
  The enroll/mfa intermediate cookie expires with its 10-minute JWT.
- The refresh cookie is path-scoped to `/api/auth` so it isn't sent on every request.
- **Revocable sessions.** Session and refresh tokens carry a `token_version` checked
  against the user row on every session guard, `/api/auth/me`, and refresh. Logout bumps
  the version, invalidating every outstanding token at once (`users.token_version`,
  `routes/auth.ts`, `plugins/auth.ts`).
- **Refresh tokens are re-issued, not revoked.** Presenting a refresh token mints a
  fresh session/refresh pair, but the token you presented keeps working until it
  expires — revocation is version-based (logout), not per-token. A stolen refresh token
  therefore stays usable for up to its 7-day lifetime unless you log out, which clears
  it along with everything else. See [Known limitations](#known-limitations).

## CSRF

- Double-submit token: a JS-readable `csrf_token` cookie must equal the `X-CSRF-Token`
  header on every state-changing (`POST`/`PUT`/`PATCH`/`DELETE`) `/api/` request.
- Enforced by a global `onRequest` hook with a constant-time comparison, so no mutating
  route can forget it (`plugins/csrf.ts`). `SameSite=Strict` is the first line; this is
  the required second.

## Upload & image handling

- **Magic-byte validation.** File type is determined from the first bytes, not the
  extension or the multipart mimetype (both attacker-controlled). Only JPEG, PNG, and
  WebP pass; SVG/XML can never match (`lib/images.ts`).
- **Two-stage decode gate.** Ingest runs a cheap header check (`probeImage`: magic bytes
  + a header-only `sharp().metadata()` read), which rejects non-images, wrong types, and
  — via declared dimensions vs `limitInputPixels`/`MAX_IMAGE_PIXELS` (default 50 MP) — a
  decompression bomb, before anything is persisted. The **full sharp decode** — the
  definitive gate against corrupt/hostile pixel data — then runs in the background worker
  (`plugins/thumbnailer.ts`); a file that fails it is dropped entirely (row + files).
  Trade-off: a bad file is caught a moment after ingest rather than rejecting the request,
  but it is never served (see below) and never persists.
- **Metadata stripping.** GPS, camera serial, and all other tags are removed losslessly
  by default (`lib/exif.ts`, exiftool). The strip runs in the worker, but **photo bytes
  are not served until `thumb_status = 'ready'`** — i.e. after the strip — so an
  un-stripped original is never exposed. Thumbnails never carry metadata (sharp drops it
  by default). The per-album toggle affects future uploads only.
- **Path safety.** On-disk names are random and decoupled from user input; album paths
  are built from a validated uid and passed through `safeJoin`, which refuses anything
  escaping the album directory (`lib/paths.ts`).
- **Size limits.** `MAX_FILE_BYTES` (default 50 MB) per file and `MAX_FILES_PER_UPLOAD`
  (default 40) per request; exceeding either returns 413.

## Transport & headers

- **helmet** sets a strict Content-Security-Policy (`default-src 'self'`,
  `object-src 'none'`, `frame-ancestors 'none'`, etc.) and related headers
  (`plugins/security.ts`). COEP is disabled on purpose so the gallery can load image
  blobs/data URLs.
- TLS is terminated by the reverse proxy in front; the container speaks plain HTTP on
  the internal network only.

## Container hardening

From `compose.yaml`:

- `read_only: true` root filesystem — only the `/data` volume and a `/tmp` tmpfs are
  writable.
- `cap_drop: ALL` — the process binds a high port and needs no Linux capabilities.
- `no-new-privileges:true`.
- Runs as the unprivileged `node` user (uid 1000).
- Memory and CPU ceilings (`mem_limit`/`memswap_limit` 1500m, `cpus 1.5`).
- The startup guard refuses to boot in production if a secret still contains a
  `CHANGE_ME` placeholder (`env.ts`).

## Known limitations

Honest about what V1 does **not** do:

- **Single admin, no recovery codes.** One seeded account, no backup codes. A lost TOTP
  seed is recovered with the `reset-totp` CLI (`docker exec … node
  dist/scripts/reset-totp.js <username>`), which clears the enrolment so the next login
  re-enrols — an operator action on the box, not self-service. Real backup codes ride the
  2.0 rework.
- **No user management.** The `user` role and `album_assignments` table exist in the
  schema for the planned V2 client portal but are not wired to any route yet.
- **No per-token refresh revocation.** Refresh is re-issue-only (see
  [Session & cookies](#session--cookies)): there is no `jti` reuse detection, so an
  individual leaked refresh token cannot be killed on its own — logging out is the blunt
  instrument that clears every token at once. Reuse detection is a roadmap item.
- **No audit log** of admin actions or gallery access beyond the reverse proxy's logs.
- **No malware scanning** of uploads beyond image-decode validation — the admin is the
  only uploader, so this is a deliberate scope decision.
- **Album access is cookie-bearer.** Anyone with an unexpired `alb_<uid>` cookie (or the
  link, for a public album) has access; there's no per-recipient identity in V1.

## Reporting a vulnerability

Please report security issues privately — do **not** open a public GitHub issue.

- **Email:** danel@lenadesp.org
- Alternatively, use GitHub's private [Security Advisories](https://github.com/LenadESP/Photodrop/security/advisories)
  to open a confidential report.

Please include steps to reproduce and, if possible, a proof of concept. This is a
single-maintainer project; expect an acknowledgement within a few days. There is no
bug-bounty program.
