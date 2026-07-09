# photodrop

Self-hosted photo delivery: drag-drop your exported JPGs into an admin dashboard,
hand a client one opaque link, and they get a clean gallery they can view or save
straight to their phone. No accounts, no third-party storage, no metadata leaks.

<!--
TODO: add a screenshot or short GIF here.
Ideal: a ~10s loop showing the full happy path —
  admin drag-drops photos into an album → copies the /a/<uid> link →
  the recipient opens the gallery, taps a photo into the lightbox, and hits
  "Save to Photos".
Put the file at docs/media/demo.gif and reference it as:
  ![photodrop demo](docs/media/demo.gif)
-->

## Features

- **Opaque album links** — `/a/<uid>` with a 14-char nanoid (~83 bits). Non-enumerable;
  regenerating a link instantly revokes the old one.
- **Per-album password** — argon2id, verified server-side *before* any photo bytes are
  served. Plus a public/private toggle.
- **Gallery** — responsive thumbnail grid, full-screen lightbox with zoom + drag-to-pan,
  download-one, and "Save to Photos" via the mobile share sheet.
- **Download all** — a streamed zip on desktop; the OS share sheet on mobile ("Save N
  Images" straight to Photos).
- **EXIF stripping** — GPS and camera metadata removed losslessly at upload, on by
  default, per-album toggle.
- **Dark mode** — follows the OS preference, with a persisted manual toggle.
- **Admin dashboard** — create / rename / toggle public / set-remove password /
  regenerate link / set-clear link expiry / toggle EXIF / delete albums, plus drag-drop
  upload.
- **Link expiry** — give an album a deadline; past it the link 404s and the album is
  permanently deleted (row + files) by a background maintenance pass.
- **Hardened auth** — mandatory TOTP with replay protection, httpOnly+SameSite JWT
  cookies, CSRF double-submit, rate limiting, account lockout, and session revocation
  (token-version bump on logout).

## Quickstart (Docker)

Runs standalone on `localhost` — no reverse proxy required.

```bash
git clone https://github.com/LenadESP/Photodrop.git photodrop
cd photodrop

# 1. Configuration
cp .env.example .env

# 2. Generate the three secrets (run this three times, paste each into .env)
openssl rand -base64 48   # → JWT_SECRET
openssl rand -base64 48   # → CSRF_SECRET
openssl rand -base64 48   # → COOKIE_SECRET

# 3. For a local standalone run, set these in .env:
#      PUBLIC_ORIGIN=http://localhost:3000
#      NODE_ENV=development      # lets cookies work over plain HTTP
#    and set a strong ADMIN_PASSWORD.
chmod 600 .env

# 4. Publish the port: uncomment the `ports: ["3000:3000"]` block in compose.yaml.

# 5. Build and start (data is created in ./data automatically)
docker compose build
docker compose up -d
```

Open <http://localhost:3000>.

> **First login forces TOTP.** The `ADMIN_PASSWORD` alone can't reach the dashboard —
> on the first successful login you're required to enroll an authenticator app (scan
> the QR, confirm a code) before a session is issued. Keep that TOTP seed safe: there
> are no recovery codes in V1 (see [Status](#status)).

> **Going to production?** The base `compose.yaml` is portable and standalone-ready.
> For a TLS reverse-proxy deployment (no published ports, shared Docker network), copy
> `compose.override.example.yaml` to `compose.override.yaml` and adjust — Compose merges
> it on top of the base. Full walkthrough of both paths in
> [docs/INSTALL.md](docs/INSTALL.md).

## Configuration

Essential variables (from [`.env.example`](.env.example)):

| Variable               | Required | Default              | What it does                                                            |
| ---------------------- | -------- | -------------------- | ----------------------------------------------------------------------- |
| `JWT_SECRET`           | yes      | —                    | Signs session/refresh/album/CSRF tokens. `openssl rand -base64 48`.     |
| `CSRF_SECRET`          | yes      | —                    | Signs CSRF double-submit tokens.                                        |
| `COOKIE_SECRET`        | yes      | —                    | Cookie signing secret.                                                  |
| `ADMIN_USERNAME`       | yes      | `admin`              | Seeded on first boot only (when the users table is empty).              |
| `ADMIN_PASSWORD`       | yes      | —                    | Initial admin password. TOTP is still required on top of it.            |
| `PUBLIC_ORIGIN`        | yes      | —                    | Public URL; used for share links and Secure-cookie scoping.            |
| `TZ`                   | no       | `Europe/Madrid`      | Container timezone.                                                     |
| `MAX_FILE_BYTES`       | no       | `52428800` (50 MB)   | Per-file upload cap.                                                    |
| `MAX_FILES_PER_UPLOAD` | no       | `40`                 | Per-request file count cap (the frontend chunks larger drops).         |
| `MAX_IMAGE_PIXELS`     | no       | `50000000` (50 MP)   | Decode cap — a decompression-bomb guard.                               |
| `MIN_FREE_BYTES`       | no       | `1073741824` (1 GiB) | Refuse uploads below this free space (protects the SQLite WAL).        |
| `TRUST_PROXY_HOPS`     | no       | `1`                  | Proxy hops to trust for `X-Forwarded-For` (real client IP → rate limit). |
| `DISK_ALERT_PCT`       | no       | `85`                 | Data-volume usage % that triggers the hourly ntfy disk alert.          |
| `NTFY_URL`             | no       | —                    | ntfy topic URL for alerts. Unset ⇒ alerting off. Optional `NTFY_TOKEN`. |

The startup guard refuses to boot in production if any secret still holds a
`CHANGE_ME` placeholder.

## How it fits together

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

The single Node container serves both the API and the built SPA. State is an embedded
SQLite database plus photo files on a mounted volume — no external services. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown.

## Status

In production, single-operator (currently **v1.3.1**). Runs the author's photo delivery
at `https://photos.lenadesp.org`. It's a one-admin tool by design: one seeded account,
mandatory TOTP, no self-service user management. The V2 client-portal groundwork
(user roles, `album_assignments`) is in the schema but not yet wired to routes.

Uploads are processed asynchronously — the dashboard returns immediately and thumbnails
appear as a background worker finishes each photo (see [CHANGELOG.md](CHANGELOG.md)).

## Roadmap

- [ ] Video support (1.4.0) — uploads, poster-frame thumbnails, capped preview transcode
- [ ] V2 client portal — per-user album assignments (schema scaffolding already present)
- [ ] TOTP recovery codes · multi-admin / user management · automated test suite

Shipped changes in [CHANGELOG.md](CHANGELOG.md); full detail and rationale in
[ROADMAP.md](ROADMAP.md).

## Tech stack

- **Backend:** Fastify 5 + TypeScript (Node 22, ESM), better-sqlite3, sharp,
  argon2, exiftool-vendored, otplib, TypeBox validation.
- **Frontend:** React 19 + Vite + Tailwind CSS 4, react-router, react-dropzone.
- **Packaging:** multi-stage Docker image, single container behind a reverse proxy.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — internals, data layout, design decisions.
- [docs/INSTALL.md](docs/INSTALL.md) — full install and deployment guide.
- [SECURITY.md](SECURITY.md) — security model and vulnerability reporting.
- [CHANGELOG.md](CHANGELOG.md) — notable changes per release.
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup and conventions.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 LenadESP.
