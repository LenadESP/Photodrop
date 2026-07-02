# photodrop — self-hosted photo delivery + admin dashboard

Admin (me) drag-drops exported JPGs into a dashboard; clients get an opaque link
→ gallery → download one or bulk-save to phone. Replaces Piwigo at
`photos.lenadesp.org`. Single Node container, embedded SQLite, storage isolated
to `/var/lib/homelab/photodrop/` — it never touches the RAW library.

- **URL:** https://photos.lenadesp.org (public via Cloudflare Tunnel, ADR-026 pattern)
- **Stack:** Fastify + TypeScript (Node 22, ESM) backend serving a React + Vite SPA
- **Data:** `/var/lib/homelab/photodrop/` only (`data/`, `albums/`, `tmp/`, `.env`)
- **Wiring:** joins `networking_proxy`, no published ports; Caddy reaches it at
  `apps-photodrop:3000` (Vaultwarden/Piwigo model)

## Layout

```
backend/    Fastify API (src/) + SQLite schema (src/db/migrations/)
frontend/   React + Vite + Tailwind SPA (built into the image, served at /)
Dockerfile  multi-stage: build SPA → build backend → slim runtime (+ perl for exiftool)
compose.yaml
.env.example
```

Runtime data tree (created on first boot, lives outside the repo):

```
/var/lib/homelab/photodrop/
├── data/photodrop.db          SQLite (+ -wal/-shm)
├── albums/<uid>/originals/    delivered JPGs (EXIF-stripped at upload by default)
├── albums/<uid>/thumbs/       generated at upload
└── tmp/                       upload staging (same fs → atomic rename on commit)
```

## Bootstrap

1. `cp .env.example .env`, then fill it: generate each secret with
   `openssl rand -base64 48`, set a strong `ADMIN_PASSWORD`. `chmod 600 .env`.
2. `mkdir -p /var/lib/homelab/photodrop/{data,albums,tmp}`
3. `docker compose build && docker compose up -d`
4. Cutover (replaces Piwigo): point `caddy/conf.d/photos.caddy` at
   `apps-photodrop:3000`, reload Caddy, then take the piwigo stack down. The
   Cloudflare Public Hostname for `photos.lenadesp.org` is unchanged.
5. First login forces TOTP enrollment before the dashboard is reachable.

## Gotchas

- **Node 22, ESM only.** nanoid v5 is ESM-only; the backend is `"type": "module"`
  and compiles with `moduleResolution: NodeNext` (relative imports carry `.js`).
- **perl is installed in the image** (not the host) for exiftool-vendored's
  lossless EXIF strip.
- **EXIF strip happens at upload**, losslessly (metadata-only, no re-encode). The
  per-album `exif_strip` toggle governs *future* uploads, not already-stored
  photos (non-retroactive).
- **Uploads are chunked** by the frontend into bounded requests; per-file and
  per-request caps live in `.env`.
- **Lost TOTP = locked out.** Single admin, no recovery codes in V1 — regaining
  access means editing `users.totp_enabled`/`totp_secret` in the SQLite DB by hand.

## Security posture

httpOnly+Secure+SameSite=Strict JWT cookies, CSRF double-submit on every
state-changing route, mandatory admin TOTP, per-route TypeBox validation,
rate-limit + account lockout, helmet headers, magic-byte upload validation with a
fail-closed sharp decode gate. `read_only` rootfs, `cap_drop: ALL`,
`no-new-privileges`, memory/CPU ceilings. CrowdSec + the Cloudflare bouncer
already cover `*.lenadesp.org` on the public path.
