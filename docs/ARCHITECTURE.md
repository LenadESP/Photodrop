# Architecture

Reference for whoever maintains the code. For a newcomer overview, start with the
[README](../README.md); for security specifics, see [SECURITY.md](../SECURITY.md).

## Overview

A single Node 22 container runs a Fastify server that both exposes the JSON API
(`/api/*`) and serves the built React SPA (everything else). All state lives in an
embedded SQLite database and a directory of photo files on a mounted volume. There are
no external services, queues, or object stores.

```
                    HTTPS
  client browser  ───────▶  reverse proxy (TLS)  ───────▶  photodrop:3000
   (gallery / admin SPA)     Caddy + Cloudflare Tunnel      Fastify + React SPA
                                                                  │
                                                    ┌─────────────┴─────────────┐
                                                    ▼                           ▼
                                             SQLite (WAL)              filesystem
                                          data/photodrop.db      albums/<uid>/originals
                                                                 albums/<uid>/thumbs
```

## Repository layout

```
backend/
  src/
    server.ts              entrypoint (starts buildApp())
    app.ts                 Fastify assembly: plugin + route registration order
    env.ts                 typed env loader; refuses CHANGE_ME placeholders in prod
    db/
      index.ts             opens better-sqlite3 (WAL)
      migrate.ts           file-based migration runner (_migrations table)
      bootstrap.ts         seeds the single admin on first boot
      migrations/001_init.sql
      types.ts             row types
    lib/
      cookies.ts           cookie names + serialize options per token type
      csrf-token.ts        issue/verify CSRF double-submit tokens
      hash.ts              argon2id hash/verify
      totp.ts              otplib enroll/verify + QR data URL
      ids.ts               nanoid album uids, random stored filenames
      paths.ts             album path builders + safeJoin traversal guard
      images.ts            magic-byte sniff + sharp decode/thumbnail gate
      exif.ts              exiftool-vendored lossless metadata strip
      mime.ts              ext→mime, Content-Disposition sanitizer
    plugins/
      security.ts          helmet + global rate limit
      sqlite.ts            db decorator, runs migrations + admin seed
      auth.ts              @fastify/cookie + @fastify/jwt, scope guards
      csrf.ts              global double-submit CSRF hook
    routes/
      health.ts            GET /api/health
      auth.ts              login, TOTP enroll/verify, refresh, logout, csrf, config
      admin.albums.ts      album CRUD, password, regenerate-uid
      admin.upload.ts      photo upload + delete
      public.ts            album view, unlock, thumb/photo/download bytes
    schemas/               TypeBox request schemas (auth, albums, common)
frontend/
  src/
    pages/                 Home, Login, Gallery, Admin
    components/            Lightbox, UploadZone, TopBar, Modal, Toast, ThemeToggle, …
    context/auth.tsx       session state
    lib/api.ts             fetch wrapper (credentials + CSRF header)
    lib/share.ts           Web Share API "Save to Photos" + download fallbacks
Dockerfile                 multi-stage: build SPA → build backend → slim runtime
compose.yaml               portable base: single service, hardened, standalone-ready
compose.override.example.yaml  reverse-proxy overlay template (external net, host path)
.env.example
```

## Runtime data tree

Created on first boot, lives outside the repo. The container always writes under
`/data`; that path is a bind mount whose host source is configurable (`DATA_DIR`,
default `./data` next to `compose.yaml`; the author's deploy points it at
`/var/lib/homelab/photodrop`):

```
$DATA_DIR/  →  /data (in container)
├── data/photodrop.db          SQLite (+ -wal/-shm)
├── albums/<uid>/originals/    delivered images (EXIF-stripped at upload by default)
├── albums/<uid>/thumbs/       WebP thumbnails, generated at upload
└── tmp/                       upload staging (same fs → atomic rename on commit)
```

`env.ts` resolves every path from the in-container `DATA_DIR` (default `/data`):
`dbPath = data/photodrop.db`, `albumsDir = albums/`, `tmpDir = tmp/`. No data path
is hardcoded — relocating the volume never touches code.

## Data model

SQLite, WAL mode, migrations applied at startup (`migrate.ts` tracks applied files in
a `_migrations` table). Schema in `migrations/001_init.sql`:

- **users** — `id`, `username` (unique), `password_hash` (argon2id), `role`
  (`admin`|`user`), `totp_secret`, `totp_enabled`, `failed_login_attempts`,
  `locked_until`, `created_at`.
- **albums** — `uid` (PK, nanoid-14), `owner_id` → users, `title`, `is_public`,
  `password_hash` (nullable argon2id), `exif_strip` (default 1), `created_at`.
- **photos** — `id`, `album_uid` → albums (`ON UPDATE CASCADE ON DELETE CASCADE`),
  `stored_filename` (random), `original_name`, `thumb_path`, `width`, `height`,
  `bytes`, `created_at`.
- **album_assignments** — `(user_id, album_uid)`. Created in V1, used in V2 (client
  portal). Unused by current routes.

The `ON UPDATE CASCADE` on `photos.album_uid` is what makes link regeneration a single
`UPDATE albums SET uid = ?` — photo rows follow automatically.

## Request pipeline

Plugin registration order in `app.ts` is load-bearing:

1. **security** — helmet (CSP, etc.) + global rate limit (1000/min baseline).
2. **sqlite** — opens the DB, runs migrations, seeds the admin, decorates `app.db`.
3. **auth** — registers `@fastify/cookie` and `@fastify/jwt` (reads the JWT from the
   `access_token` cookie), decorates the scope guards.
4. **csrf** — global `onRequest` hook enforcing double-submit on unsafe methods.
5. **multipart** — field/file limits for uploads.
6. **routes** — registered last so the CSRF guard covers all of them.
7. **static SPA** — if `../public` exists (it does in the image), serves it with a
   non-`/api` GET fallback to `index.html` for client-side routing.

`trustProxy: 1` — the app trusts exactly one proxy hop so `req.ip` reflects the real
client from `X-Forwarded-For`. This is load-bearing for rate limiting and lockout;
it assumes exactly one trusted proxy in front (Caddy). The JSON `bodyLimit` is 1 MB;
the upload route raises its own file-size limit via multipart config.

### Auth token scopes

One JWT signing secret; a `scope` claim plus short lifetimes keep stages separate — a
token minted for one stage can never satisfy another's guard.

| Scope     | Cookie                  | Lifetime | Meaning                                        |
| --------- | ----------------------- | -------- | ---------------------------------------------- |
| `enroll`  | `access_token`          | 10 min   | Password OK, first login — must enroll TOTP    |
| `mfa`     | `access_token`          | 10 min   | Password OK, returning login — must verify TOTP|
| `session` | `access_token`          | 15 min   | Full session                                   |
| `refresh` | `refresh_token`         | 7 days   | Mints new session tokens; scoped to `/api/auth`|
| `album`   | `alb_<uid>`             | 2 hours  | Unlocked a password-gated album                |

Cookies are `httpOnly` + `SameSite=Strict` + `Secure` (in production). The CSRF cookie
is the exception — it's deliberately readable by JS (double-submit) and lives 8 hours.

### Login flow

1. `POST /api/auth/login` — username + password. On success, issues an `enroll` token
   (if TOTP not yet enabled) or an `mfa` token. Password alone never yields a session.
2. First login: `POST /api/auth/totp/enroll` returns a secret + QR data URL;
   `POST /api/auth/totp/activate` verifies a code, sets `totp_enabled`, issues a session.
3. Returning login: `POST /api/auth/totp/verify` checks the code and issues a session.
4. `POST /api/auth/refresh` swaps a valid refresh token for a fresh session token.

## Upload pipeline

`POST /api/admin/albums/:uid/photos` (admin session required). Three phases, all-or-nothing:

1. **Stream to disk** — `saveRequestFiles` writes every part to `tmpDir` on the data
   volume (never tmpfs), enforcing `MAX_FILE_BYTES` and `MAX_FILES_PER_UPLOAD`.
   Exceeding either → 413, nothing saved.
2. **Phase A — validate** — for each file: `sniffImageKind` checks magic bytes
   (JPEG / PNG / WebP only; extension and multipart mimetype are ignored as
   attacker-controlled), then `makeThumbnail` forces a full sharp decode with
   `limitInputPixels`. A corrupt, hostile, or oversized image throws here and the
   **entire** upload is rejected. sharp drops metadata from thumbnail output by default,
   so thumbnails never carry GPS.
3. **Phase B — strip** — if `album.exif_strip`, exiftool losslessly deletes all tags
   from each original (metadata-only, no re-encode).
4. **Phase C — commit** — atomic same-fs `rename` of originals and thumbs into place,
   then a single DB transaction inserting the photo rows. Any failure rolls back the
   moves; a `finally` cleans up leftover temp thumbnails.

The frontend (`UploadZone.tsx`) chunks large drops by total size (~90 MB) and count
(30) so each request stays under Cloudflare's ~100 MB tunnel body limit and the
backend's per-request cap.

## Serving photos

`public.ts` gates every byte through `hasAccess`:

- Public album → open.
- Owning admin with a valid session → always allowed (this is how the dashboard
  previews private albums through the same endpoints).
- Password-gated album → requires a valid per-album unlock cookie (`alb_<uid>`),
  obtained via `POST /api/a/:uid/unlock` (argon2id verify → 2h album token).
- Private-without-password → denied (a V2 case).

The unlock route burns a comparable argon2 verify even when the album is missing or has
no password, and returns an identical response, so it's not an existence oracle.
File paths are always built from a validated uid and a random stored filename, then run
through `safeJoin` as defence-in-depth against traversal.

## Design decisions & gotchas

- **Node 22, ESM only.** The backend is `"type": "module"` with
  `moduleResolution: NodeNext`, so relative imports carry a `.js` extension even in
  `.ts` source. nanoid v5 is ESM-only — this is part of why.
- **perl in the image, not on the host.** `exiftool-vendored` ships the exiftool Perl
  script but needs a perl interpreter; the runtime stage `apt-get install`s perl. One
  long-lived exiftool child process is shut down on `app.close()`.
- **EXIF strip is at upload and non-retroactive.** The per-album `exif_strip` toggle
  governs *future* uploads; already-stored originals are not re-processed when you flip it.
- **sharp is the decode gate, not just a resizer.** `sharp.concurrency(1)` and
  `sharp.cache(false)` keep memory bounded on a small CPU with a hard container ceiling.
- **Album link regeneration** renames the on-disk album dir and issues a new uid;
  photos cascade via `ON UPDATE CASCADE`. The rename is rolled back if the DB update throws.
- **Native modules.** better-sqlite3, sharp, and argon2 use native prebuilds installed
  during the backend build stage and carried into the runtime image.

## Container & network wiring

Two-file model: a portable **base** (`compose.yaml`) that runs anywhere, plus an
optional **override** (`compose.override.yaml`, gitignored) that layers on
infra-specific bits. Compose auto-merges the override on top of the base.

`compose.yaml` (base) runs one hardened service:

- `read_only: true` rootfs; only the `/data` volume and a `/tmp` tmpfs are writable.
- `cap_drop: ALL` (binds :3000, needs no capabilities), `no-new-privileges:true`.
- `mem_limit`/`memswap_limit` 1500m, `cpus: "1.5"`.
- Runs as `USER node` (uid 1000).
- Data volume `${DATA_DIR:-./data}:/data` — bind mount, host source configurable.
- Standalone-ready: a commented `ports: ["3000:3000"]` block is the only edit needed
  to reach it on localhost with no proxy.
- Healthcheck hits `/api/health` with Node's `fetch`.

`compose.override.yaml` (not shipped) carries the reverse-proxy specifics: it swaps
the data volume for an absolute host path and joins an external Docker network the
proxy also sits on, so the proxy reaches the app at `apps-photodrop:3000` and
terminates TLS. See `compose.override.example.yaml` for the template. The author's
deploy pins the volume to `/var/lib/homelab/photodrop`, joins `networking_proxy`
(Caddy), and fronts the public path with a Cloudflare Tunnel plus CrowdSec + the
Cloudflare bouncer (infrastructure outside this repo).
