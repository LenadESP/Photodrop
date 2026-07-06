# Changelog

All notable changes to photodrop. Dates are ISO‑8601.

## [1.1.1] — 2026-07-06

### Changed

- **Display derivative is now ~1920px** (longest edge), down from 2560, so the lightbox
  paints from a ~1080p-class image instead of something near the original.

### Fixed

- **Backfilled display derivatives** for photos uploaded before 1.1.0, which were still
  being served as full-size originals via the fallback path. Added a reusable
  `dist/scripts/backfill-display.js` maintenance script (writes atomically; `--force`
  re-renders existing derivatives, e.g. after a size change).

## [1.1.0] — 2026-07-06 — reliability, delivery & performance

The v1.1 release. No breaking API changes; migration `002` runs automatically on
upgrade (adds `photos.thumb_status`, defaulting existing rows to `ready` so they remain
servable).

### Added

- **Async thumbnail pipeline.** Uploads now validate cheaply at ingest (magic bytes +
  a header-only dimension read that also guards against decompression bombs), persist
  photos as `pending`, and return `202` immediately. A background worker
  (`plugins/thumbnailer.ts`) does the full decode + resize + EXIF strip one photo at a
  time, then flips the row to `ready`; a file that fails the full decode is dropped. The
  gallery and dashboard show a placeholder for `pending` photos and poll until ready.
  Photo bytes are served **only** once a row is `ready`, so an un‑stripped original is
  never exposed — the EXIF‑before‑serve guarantee is preserved. The `thumb_status`
  column doubles as a durable work queue, so a crash mid‑batch is reconciled on boot.
- **Disk‑full guard.** Uploads are refused with `507` when free space on the data volume
  is below `MIN_FREE_BYTES` (default 1 GiB), so a full disk can't corrupt the SQLite WAL.
- **Health check probes DB + filesystem.** `/api/health` now runs a trivial query and a
  writability check on the data volume, returning `503` (unhealthy) if either fails —
  a live port with a corrupt DB or unwritable volume no longer reports healthy.
- **Intermediate display derivative (~2560px).** The worker also generates a ~2560px
  WebP alongside the thumbnail, and the lightbox serves it (`/api/a/:uid/display/:id`)
  instead of the full-res original — so viewing paints from a small image and the
  original is only fetched on download. Photos uploaded before this fall back to the
  original.
- **Edge-cacheable public thumbnails.** Public-album thumbnails are served
  `Cache-Control: public, max-age=1y, immutable` with an `ETag` (and honour
  `If-None-Match` → 304), so the browser and a CDN edge can cache them. Private and
  password-album thumbnails, and all full-size originals, remain `private` — never
  shared-cached. (Edge caching at Cloudflare also needs a cache rule for the thumb path.)
- **Streamed zip for "Download all" (desktop).** A new `/api/a/:uid/zip` endpoint
  streams all of an album's originals as an on-the-fly zip (store mode — the images are
  already compressed), never buffering the whole archive; access-gated like the
  per-photo endpoints.

### Changed

- **"Download all" / save flows.** Mobile keeps the OS share sheet (one action → "Save N
  Images" into Photos), falling back to the streamed zip instead of loose sequential
  downloads. In the lightbox, the single-photo action is now one **Save** button that
  routes through the share sheet on mobile (→ Photos) and downloads on desktop.

### Fixed

- **Fresh‑deploy first upload.** `albums/` and `tmp/` are now created on boot
  (`ensureDataDirs`); previously `tmp/` was never created, so the first upload on a
  brand‑new deployment failed with `ENOENT`.

### Security

- Audited the backend against OWASP ASVS / Top 10 — no injection, IDOR, path‑traversal,
  or XSS issues found; core controls verified sound. See `SECURITY.md`.
- Confirmed TOTP verification tolerates ±1 step (~±30 s) per RFC 6238 §5.2, and the
  per‑album unlock is rate‑limited (10/min) — both verified, no change required.

[1.1.1]: https://github.com/LenadESP/Photodrop/releases/tag/v1.1.1
[1.1.0]: https://github.com/LenadESP/Photodrop/releases/tag/v1.1.0
