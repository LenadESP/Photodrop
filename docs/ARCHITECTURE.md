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
                                                                 albums/<uid>/display
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
      migrations/*.sql     001 init, 002 thumb_status, 003 album expiry, 004 auth
                           hardening, 005 upload sessions, 006 video
      types.ts             row types
    lib/
      cookies.ts           cookie names + serialize options per token type
      csrf-token.ts        issue/verify CSRF double-submit tokens
      hash.ts              argon2id hash/verify
      totp.ts              otplib enroll/verify + QR data URL
      ids.ts               nanoid album uids, random stored filenames
      paths.ts             album path builders + safeJoin traversal guard
      images.ts            magic-byte sniff + sharp decode/thumbnail gate
      video.ts             ftyp sniff (major+compatible brands) + ffprobe gate, poster
                           frame, preview transcode + cost budget
      exif.ts              exiftool-vendored lossless metadata strip
      mime.ts              ext→mime, Content-Disposition sanitizer
      disk.ts              free-space probe + usage% for the disk guard / alert
      notify.ts            best-effort ntfy push (disk alert)
      ingest.ts            shared validate + commit path for BOTH upload routes
    plugins/
      security.ts          helmet + global rate limit
      sqlite.ts            db decorator, runs migrations + admin seed
      auth.ts              @fastify/cookie + @fastify/jwt, scope + token_version guards
      csrf.ts              global double-submit CSRF hook
      maintenance.ts       boot orphan sweep + hourly expiry deletion + disk alert
      thumbnailer.ts       background worker: images, video posters, video transcodes
    routes/
      health.ts            GET /api/health
      auth.ts              login, TOTP enroll/verify, refresh, logout, csrf, config
      admin.albums.ts      album CRUD, password, expiry, regenerate-uid
      admin.upload.ts      batched multipart photo upload + delete
      admin.uploads.ts     resumable chunked upload (session / parts / complete)
      public.ts            album view, unlock, thumb/photo/download bytes (rate-capped)
    schemas/               TypeBox request schemas (auth, albums, common)
    scripts/
      backfill-display.ts  (re)generate display derivatives (run via docker exec)
      reset-totp.ts        clear a user's TOTP enrolment for recovery (run via docker exec)
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
├── albums/<uid>/originals/    delivered images (EXIF-stripped by the worker)
├── albums/<uid>/thumbs/       WebP thumbnails (~480px), generated by the worker
├── albums/<uid>/display/      WebP display derivatives (~1920px), for the lightbox
├── albums/<uid>/preview/      MP4 video previews (1080p/24fps), named <photo id>.mp4
└── tmp/                       upload staging (same fs → atomic rename on commit)
```

`env.ts` resolves every path from the in-container `DATA_DIR` (default `/data`):
`dbPath = data/photodrop.db`, `albumsDir = albums/`, `tmpDir = tmp/`. No data path
is hardcoded — relocating the volume never touches code.

## Data model

SQLite, WAL mode, migrations applied at startup (`migrate.ts` tracks applied files in
a `_migrations` table). Schema in `migrations/001_init.sql`:

- **users** — `id`, `username` (unique), `password_hash` (argon2id), `role`
  (`admin`|`user`), `totp_secret`, `totp_enabled`, `totp_last_step` (replay guard, mig
  `004`), `failed_login_attempts`, `locked_until`, `token_version` (session revocation,
  mig `004`), `created_at`.
- **albums** — `uid` (PK, nanoid-14), `owner_id` → users, `title`, `is_public`,
  `password_hash` (nullable argon2id), `exif_strip` (default 1), `expires_at` (nullable —
  link expiry, migration `003`), `created_at`.
- **photos** — `id`, `album_uid` → albums (`ON UPDATE CASCADE ON DELETE CASCADE`),
  `stored_filename` (random), `original_name`, `thumb_path`, `width`, `height`,
  `bytes`, `thumb_status` (`pending`|`ready`|`failed`, migration `002`), `kind`
  (`image`|`video`, migration `006`), `duration_ms`, `preview_status`
  (`pending`|`ready`|`failed`, NULL for images, migration `006`), `created_at`.
  Bytes are served only when `thumb_status = 'ready'`; the column also acts as the
  durable thumbnail work queue.
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
5. **maintenance** — boot-time storage reconciliation (clears `tmp/`, drops rows whose
   original is gone, deletes files no row references) and an expiry sweep, then an hourly
   timer for expired-album deletion and the disk-usage alert. Registered before the
   thumbnailer so reconciliation completes before the drain starts.
6. **thumbnailer** — the background thumbnail worker; decorates `app.kickThumbnailer`
   and drains any `pending` photos on `onReady` (boot reconciliation).
7. **multipart** — field/file limits for uploads.
8. **routes** — registered last so the CSRF guard covers all of them.
9. **static SPA** — if `../public` exists (it does in the image), serves it with a
   non-`/api` GET fallback to `index.html` for client-side routing. Hashed `assets/*` are
   served `immutable`; `index.html` stays `no-cache`.

`trustProxy` (default 1, override with `TRUST_PROXY_HOPS`) — the app trusts N proxy hops
so `req.ip` reflects the real client from `X-Forwarded-For`. This is load-bearing for the
per-IP rate limit; the default assumes exactly one trusted proxy in front (Caddy). The
JSON `bodyLimit` is 1 MB; the upload route raises its own file-size limit via multipart
config.

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

Session and refresh tokens additionally carry a `token_version` (`tv`) claim, matched
against `users.token_version` on every session guard, `/api/auth/me`, and refresh.
Logout increments the row's version, so every previously issued token — access and
refresh — is invalidated at once. Tokens issued before 1.2.0 carry no `tv` (read as 0)
and stay valid until the first bump, so the upgrade doesn't drop the live session.

### Login flow

1. `POST /api/auth/login` — username + password. On success, issues an `enroll` token
   (if TOTP not yet enabled) or an `mfa` token. Password alone never yields a session.
2. First login: `POST /api/auth/totp/enroll` returns a secret + QR data URL;
   `POST /api/auth/totp/activate` verifies a code, sets `totp_enabled`, issues a session.
3. Returning login: `POST /api/auth/totp/verify` checks the code — rejecting a replayed
   step (`totp_last_step`) — and issues a session.
4. `POST /api/auth/refresh` verifies the refresh token and its `token_version`, rotates
   it, and issues a fresh session token; a locked-out account is refused here too.

## Upload pipeline

`POST /api/admin/albums/:uid/photos` (admin session required). Ingest is synchronous
and validating; the expensive work (full decode, thumbnail, EXIF strip) is deferred to
a background worker so a large drop doesn't tie up the request.

1. **Disk-full guard** — if free space on the data volume is below `MIN_FREE_BYTES`
   (default 1 GiB), reject with 507 before writing anything (protects the SQLite WAL).
2. **Stream to disk** — `saveRequestFiles` writes every part to `tmpDir` on the data
   volume (never tmpfs), enforcing `MAX_FILE_BYTES` and `MAX_FILES_PER_UPLOAD`.
   Exceeding either → 413, nothing saved.
3. **Phase A — validate (cheap)** — for each file, `probeImage` checks magic bytes
   (JPEG / PNG / WebP only; extension and multipart mimetype are ignored as
   attacker-controlled) and does a header-only `sharp().metadata()` read. This rejects
   non-images, wrong types, and — via declared dimensions vs `MAX_IMAGE_PIXELS` — a
   decompression bomb, without a full decode. Any failure rejects the **entire** upload
   (415); nothing is persisted.
4. **Phase B — commit** — atomic same-fs `rename` of the originals into place, then one
   DB transaction inserting the photo rows as `thumb_status = 'pending'`. Any failure
   rolls back the moves. The route returns `202` immediately and calls
   `app.kickThumbnailer()`.
5. **Worker** (`plugins/thumbnailer.ts`) — one photo at a time (`sharp.concurrency(1)`;
   the `await` between photos keeps the event loop responsive): a **full sharp decode +
   resize** (the definitive corrupt/hostile-image gate) writes the thumbnail and the
   ~1920px display derivative, then exiftool strips the original if `album.exif_strip`,
   then the row flips to `ready`. A
   file that fails the decode is dropped entirely (row + files). Because the photos row
   is the queue, a crash mid-batch just leaves rows `pending` for the next boot to
   reprocess.

**Bytes are served only when `thumb_status = 'ready'`** (see below), so an original that
hasn't been EXIF-stripped yet is never exposed — the metadata guarantee is preserved
even though the strip moved off the request path. The gallery shows a placeholder for
`pending` photos and polls until they are ready.

The frontend (`UploadZone.tsx`) batches drops by total size (~90 MB) and count (30) so
each request stays under Cloudflare's ~100 MB tunnel body limit and the backend's
per-request cap.

### Resumable uploads

Batching solves *many small files*; it cannot solve *one large file*, which no
arrangement of a single multipart request can squeeze under a ~100 MB body ceiling. So a
file at or over `MAX_FILE_BYTES` takes a second route (`admin.uploads.ts`) that sends it
in parts:

1. `POST /api/admin/albums/:uid/uploads` — declare name + size, get back a session id,
   the part size, and how many parts to send.
2. `PUT /api/admin/uploads/:id/parts/:n` — one part, raw `application/octet-stream`,
   streamed straight to disk. Written to `.partial` and renamed into place, so a part
   file that exists is always complete and re-sending one is idempotent.
3. `GET /api/admin/uploads/:id` — which parts the server actually holds, so an
   interrupted upload sends only what is missing.
4. `POST /api/admin/uploads/:id/complete` — assemble in order, then hand off to the
   **same** `ingestFiles` validate-and-commit path the batched route uses.

Session state lives in SQLite (`upload_sessions`, `upload_parts`, migration `005`) rather
than on the filesystem alone, so a resume survives a container restart: the part files are
the payload, the rows are the record of what was accepted.

**Parts stage in `uploads/`, not `tmp/`** — the boot orphan sweep clears `tmp/` wholesale,
which would destroy an upload in flight across a restart, and surviving exactly that is
the point. Abandoned sessions are instead reclaimed by age (`STALE_UPLOAD_MS`, default
24 h) in the hourly maintenance pass.

Guards: every session lookup is scoped by `owner_id` (an unscoped session id would be an
IDOR into another admin's upload); part numbers are bounds-checked against the session;
each part's `Content-Length` must match exactly what that part should be, checked before
a byte is read; the assembled size must match what was declared; and the disk guard
accounts for the assembled copy briefly doubling the file on disk.

## Video

Video rides the same pipeline as photos rather than a parallel one. Ingest sniffs the
ISO base-media `ftyp` box (never the extension or the client mimetype) and runs `ffprobe`
as the cheap header gate — the analogue of `probeImage`. MP4 and MOV are accepted.

A file is accepted on the strength of its **major brand or any of its compatible
brands** (ISO/IEC 14496-12 §4.3): a professional camera declares a vendor major brand —
Sony XAVC-S writes `XAVC` — while listing the standard brand it conforms to (`mp42`,
`iso2`, …) among the compatible brands. Reading only the major brand rejected those
files even though they announce standard compatibility one field over. The sniff reads
the whole `ftyp` box, bounded to 512 bytes so a hostile declared size cannot make it
over-read. This is only a cheap pre-filter; `ffprobe` and the worker's full decode are
the real validators, so widening the accepted brands never lets a non-video through.

The worker handles a video in **two stages, with different consequences**:

1. **Metadata strip + poster frame — both must succeed.** These are what make the file
   safe to serve: bytes are only served once `thumb_status = 'ready'`, and the strip is
   what the no-metadata-leaks guarantee rests on. The poster is a WebP written into the
   same `thumbs/` directory images use, so the gallery grid needs no special case. If
   either fails the row is marked `failed`: kept and visible in the dashboard, never
   served, deletable by hand. Unlike a corrupt image it is *not* deleted — a video ffmpeg
   dislikes may still be a recording the owner cares about.
2. **Preview transcode — best-effort.** 1080p, 24fps, bitrate-capped H.264 + AAC in MP4
   with `+faststart`, written atomically (temp + rename). If it fails, `preview_status`
   goes to `failed` and the original is still delivered at full resolution — it just
   can't be played in the browser.

   **Cost budget.** Decode dominates and downscaling cannot avoid it — every frame is
   decoded at full resolution before the scaler runs — so the transcode cost tracks
   *source* pixels × frame rate × duration, not the 1080p output size. Measured on this
   hardware (a 2017 dual-core), 6K 10-bit 60fps runs at ~0.08× realtime, so a five-minute
   clip would need about an hour. `makePreview` estimates the cost up front from the
   probed dimensions and frame rate and, if it exceeds a budget (20 minutes of wall
   clock), declines before starting: `preview_status='failed'`, original served at full
   resolution, no core occupied for an hour and no photo left queued behind it. The
   ffmpeg timeout is derived from that budget as a backstop. Memory is not the
   constraint — a 6K transcode peaks around 600 MB against the 1500m ceiling.

**Queue priority.** `thumb_status='pending'` (photo thumbnails and video posters) is
drained completely before any `preview_status='pending'` transcode, and re-checked after
every transcode, so a newly-uploaded photo never waits behind a video being re-encoded.
It is priority at pickup, not preemption: a transcode already running finishes first,
because ffmpeg can't be cheaply interrupted and resumed.

**Resource limits are deliberate.** ffmpeg runs with `-threads 1` and `-preset veryfast`:
this is a 2017 dual-core with a 1.5-CPU container cap, and an unbounded transcode
saturates both cores and makes the live gallery sluggish while it runs. ffmpeg's scratch
is pointed at the data volume via `TMPDIR` — `/tmp` in this container is a tmpfs, i.e.
RAM counted against the 1500m ceiling, and a few hundred MB of transcode scratch there
would OOM-kill the process.

**Full-resolution delivery is unchanged.** The preview exists for on-screen playback and
nothing else. `/download`, `/photo` and `/zip` all serve the original, exactly as with
photos.

## Byte ranges

`sendImage` advertises `Accept-Ranges: bytes` and honours a single `Range` header
(`bytes=a-b`, `bytes=a-`, `bytes=-n`) with a `206` and a correct `Content-Range`; an
unsatisfiable range gets a `416`. This is not optional for video: Safari and iOS refuse
to play a source that doesn't support ranges, and seeking is broken everywhere without
it. Multi-range requests are legal HTTP but nothing needs them for media playback, so
they fall through to serving the whole file rather than being answered wrongly.

## Serving photos

`public.ts` gates every byte through `hasAccess`, and only serves photos whose
`thumb_status = 'ready'` (a `pending`/`failed` photo's thumb, original, and download all
404 — so an un-stripped original never leaves the server):

- Public album → open.
- Owning admin with a valid session → always allowed (this is how the dashboard
  previews private albums through the same endpoints).
- Password-gated album → requires a valid per-album unlock cookie (`alb_<uid>`),
  obtained via `POST /api/a/:uid/unlock` (argon2id verify → 2h album token).
- Private-without-password → denied (a V2 case).

Endpoints: `/thumb/:id` (grid, and the poster frame for video), `/display/:id` (lightbox
— the ~1920px derivative, or the original as a fallback for photos that predate it;
404 for video, which must never fall back to streaming a multi-GB original),
`/preview/:id` (video playback derivative), `/photo/:id` (full original, inline),
`/download/:id` (full original, attachment), `/zip` (whole album, streamed).
The lightbox uses `/display` so a viewer paints the screen from a ~1920px image instead
of a full 24 MP original; the original is only fetched on download. The bulk-byte
endpoints carry per-route rate caps (`/zip` 30/min, full originals 300/min) on top of
the global baseline; thumbnails/display stay on the global cap.

An album past its `expires_at` is treated as absent — every public endpoint 404s
immediately, even before the hourly maintenance pass deletes the row and files.

The unlock route burns a comparable argon2 verify even when the album is missing or has
no password, and returns an identical response, so it's not an existence oracle.
File paths are always built from a validated uid and a random stored filename, then run
through `safeJoin` as defence-in-depth against traversal.

**Caching.** Stored filenames are random and their bytes are never rewritten, so content
is immutable. Thumbnails of **public** albums are sent `Cache-Control: public, max-age=1y,
immutable` + an `ETag` (`If-None-Match` → 304), so the browser and a CDN edge can cache
them and repeat views skip the origin. Private/password-album thumbnails and all
full-size originals stay `private` — never shared-cached, or the URL alone would bypass
the access gate. (Edge caching of public thumbnails is completed by a Cloudflare cache
rule for `/api/a/*/thumb/*`, configured in the dashboard — infra outside this repo; the
app's part is the headers.)

## Design decisions & gotchas

- **Node 22, ESM only.** The backend is `"type": "module"` with
  `moduleResolution: NodeNext`, so relative imports carry a `.js` extension even in
  `.ts` source. nanoid v5 is ESM-only — this is part of why.
- **perl in the image, not on the host.** `exiftool-vendored` ships the exiftool Perl
  script but needs a perl interpreter; the runtime stage `apt-get install`s perl. One
  long-lived exiftool child process is shut down on `app.close()`.
- **EXIF strip is at upload and non-retroactive.** The per-album `exif_strip` toggle
  governs *future* uploads; already-stored originals are not re-processed when you flip it.
  The strip runs in the thumbnail worker, but bytes aren't served until `ready`, so it
  still happens before an original is ever exposed.
- **sharp is the decode gate, not just a resizer.** The worker's full decode is the
  definitive corrupt/hostile-image check; `sharp.concurrency(1)` and `sharp.cache(false)`
  keep memory bounded on a small CPU with a hard container ceiling. Ingest does only a
  cheap header read, so a hostile *header* is caught synchronously and hostile *pixels*
  are caught by the worker (which drops the photo).
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
