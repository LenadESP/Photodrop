# Changelog

All notable changes to photodrop. Dates are ISO‑8601.

## [1.3.2] — 2026-07-18 — documentation accuracy

A documentation release from a full docs-vs-code audit. No behaviour changes: the only
source edit is a corrected comment.

### Fixed

- **The README promised a bulk-download flow that no longer exists.** The Features list
  still described "a streamed zip on desktop; the OS share sheet on mobile" — the
  pre-1.3.1 behaviour. Since 1.3.1 the gallery offers both **Download all** (each
  full-resolution original as its own direct download) and **Download ZIP** (the same
  originals as one streamed archive), on every device.
- **The security docs overstated refresh-token rotation.** SECURITY.md described refresh
  as rotating the token on use, and the code comment claimed a used or stolen refresh
  token "can't be replayed". Neither matches the code: refresh issues a fresh pair but
  reuses the current `token_version` rather than bumping it, so the token presented stays
  valid for its full 7-day lifetime — only logout actually revokes. Both now describe
  what is enforced, and the residual risk is recorded under Known limitations.

## [1.3.1] — 2026-07-09 — phone "download all"

Bulk "download all" on a phone now saves the full-resolution originals straight to the
device instead of routing them through the share sheet.

### Fixed

- **Gallery "download all" no longer hangs on a real album.** The mobile "Save to Photos"
  button fetched *every* full-resolution original into memory before invoking the share
  sheet, which stalled on a large album (≈33 photos / ~120 MB). It is replaced by
  **Download all**, which triggers a direct browser download of each full-resolution
  original in sequence — every `<a download>` click streams straight to disk, so nothing
  is buffered in JS. On Android the files land in Downloads and surface in the gallery;
  on iOS they land in Files. Full resolution only, always — never the display derivative
  or a re-encode.

### Changed

- **Both "Download all" and "Download ZIP" now appear on every device.** The gallery
  header offers the per-file direct download and the streamed archive side by side, on
  phone and desktop alike. The direct download fires the first file, then paces the rest
  (a longer initial gap lets the browser's one-time "allow multiple downloads" grant land
  so no photo is dropped), and a progress indicator counts them as they start.
- The single-photo lightbox **Save** is unchanged — it still shares the full-resolution
  original to Photos on mobile.

## [1.3.0] — 2026-07-09 — download UX

The download/save flow, made reliable — and always full resolution.

### Fixed

- **Lightbox “Save” now reliably reaches Photos on mobile.** It previously fetched the
  multi-MB original before invoking the share sheet, which often overran the browser's
  ~5-second user-activation window, so the share silently failed and fell back to a Files
  download. The current photo's **full-resolution original** is now prefetched while it's
  on screen (debounced, cancelled on navigation), so Save fires the share sheet
  synchronously; if it isn't ready in time it fetches on demand, and the fallback is
  still the original — never a re-encoded copy.

### Added

- **Explicit download picker on the gallery** — **Save to Photos** (shares the
  full-resolution originals through the OS share sheet) vs **Download ZIP** (streams the
  same originals to Files). Both deliver originals; the display derivative is only ever
  used for on-screen viewing.
- **Neighbouring lightbox images are preloaded**, so swiping between photos paints
  instantly instead of loading each one on demand.

> Versions 1.1.3 through 1.2.0 were developed as separate milestones but shipped
> together in the single **1.2.0** deploy on 2026-07-09; only `v1.2.0` is tagged.

## [1.2.0] — 2026-07-09 — hardening

Defence-in-depth from the v1.1.1 audit. Migrations `003`–`004` run automatically on
upgrade; every new column defaults so existing albums — and the live admin session —
are unaffected.

### Added

- **TOTP replay protection.** A one-time code can no longer be reused within its
  validity window: the matched RFC‑6238 step is recorded per user, and a code whose step
  was already accepted is rejected (`users.totp_last_step`, migration `004`).
- **Session revocation.** Session and refresh tokens carry a `token_version`
  (`users.token_version`, migration `004`) checked on every session guard, `/api/auth/me`,
  and refresh. Logout bumps the version — immediately invalidating every outstanding
  token — and refresh now rotates the refresh token on use.
- **Configurable proxy-trust depth.** `TRUST_PROXY_HOPS` (default `1`) sets how many
  proxy hops to trust for `X-Forwarded-For` so the real client IP drives the per-IP rate
  limit. The default preserves the previous hard-coded single-hop behaviour.
- **Per-route rate caps on the bulk-byte endpoints.** Whole-album `/zip` at 30/min and
  full originals (`/photo`, `/download`) at 300/min, on top of the global baseline;
  thumbnails and display derivatives stay on the global cap so a gallery grid is never
  throttled.

## [1.1.5] — 2026-07-09 — reliability & lifecycle

### Added

- **Album link expiry.** An album can be given an expiry (`albums.expires_at`, migration
  `003`; nullable, `NULL` = never). Past expiry the link 404s immediately, and an hourly
  maintenance pass permanently deletes the album — DB row plus on-disk files. Set or
  clear it from the dashboard.
- **Boot-time orphan sweep.** On start-up the app clears the upload staging dir and
  reconciles DB rows against on-disk files (drops rows whose original is missing, deletes
  files no row references), cleaning up after an interrupted upload or crash.
- **Proactive disk alert.** The data volume is checked hourly; crossing `DISK_ALERT_PCT`
  (default 85%) pushes one throttled ntfy alert (`NTFY_URL`; alerting is off when unset).
- **TOTP-reset recovery CLI.** `dist/scripts/reset-totp.js <username>` clears a user's
  TOTP enrolment and lifts any lockout so their next login re-enrols — recovery without
  hand-editing the database.

## [1.1.4] — 2026-07-09 — mobile & gallery

### Fixed

- **Lightbox “previous” button on touch.** It now sits above the image (z-index), so it
  is reliably tappable on mobile.

### Added

- **Swipe to navigate the lightbox.** When not zoomed, a horizontal swipe moves between
  photos without fighting the zoom-pan gesture (vertical gestures stay with the browser).

## [1.1.3] — 2026-07-09 — polish

Correctness and efficiency from the 2026-07-07 audit; nothing user-visible.

### Changed

- Content-hashed SPA assets under `assets/` are served `public, max-age=1y, immutable`,
  while `index.html` stays `no-cache` so a deploy is always picked up.

### Fixed

- **Album-list N+1.** The dashboard resolves every album's photo count in one grouped
  query instead of a `COUNT` per album.
- **Intermediate-token cookie lifetime.** The enroll/mfa cookie now expires with its
  10‑minute JWT instead of lingering to 15.
- **Refresh honours lockout.** `/api/auth/refresh` refuses to mint a session for a
  locked-out account, so a held refresh token can't sidestep the lockout.

## [1.1.2] — 2026-07-07 — audit cleanups

The two hygiene items from the v1.1.1 security audit. No API or schema changes.

### Fixed

- **Display fallback is no longer cached as `immutable`.** For photos that predate
  display derivatives, `/api/a/:uid/display/:id` falls back to the full-res original
  but used to send it with the derivative's `Cache-Control` — on public albums
  `public, max-age=1y, immutable`, so a browser that cached the fallback kept the
  full-size image even after `backfill-display` generated the real webp. The fallback
  now sends `private, no-cache`; ETag revalidation keeps repeat views cheap, and
  `immutable` is reserved for real derivatives.
- **Deleting a photo now removes its display derivative.** The per-photo DELETE
  removed the original and thumbnail but left the `display/` file behind (a disk
  leak — no exposure, the row was already gone).

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

[1.3.0]: https://github.com/LenadESP/Photodrop/releases/tag/v1.3.0
[1.2.0]: https://github.com/LenadESP/Photodrop/releases/tag/v1.2.0
[1.1.2]: https://github.com/LenadESP/Photodrop/releases/tag/v1.1.2
[1.1.1]: https://github.com/LenadESP/Photodrop/releases/tag/v1.1.1
[1.1.0]: https://github.com/LenadESP/Photodrop/releases/tag/v1.1.0
