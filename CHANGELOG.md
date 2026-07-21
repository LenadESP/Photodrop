# Changelog

All notable changes to photodrop. Dates are ISO‑8601.

## [1.5.2] — 2026-07-21 — accept professional-camera video (XAVC)

A fix: video from cameras that declare a vendor brand — Sony XAVC-S among them —
was refused at upload. No migration, no schema change, no change to how anything
is stored or served.

### Fixed

- **Video whose standard brand is only a *compatible* brand is now accepted.**
  The `ftyp` magic-byte check read only the container's **major** brand. Sony
  XAVC-S files set the major brand to `XAVC` (a vendor brand) and list the
  standard brands they conform to — `mp42`, `iso2` — among the **compatible**
  brands, exactly as ISO/IEC 14496-12 §4.3 provides for. The check now reads the
  whole `ftyp` box and accepts on the major *or any compatible* brand, so these
  files pass the ingest gate. This widens only the cheap pre-filter; `ffprobe`
  and the worker's full decode remain the real validators and are unchanged.
  Verified end-to-end against a real 1080p50 XAVC-S clip.
- **The upload dropzone accepts video by file extension, not only MIME type.**
  Browsers report an empty MIME type for some camera `.MP4` files, which the
  MIME-only filter dropped silently before upload. It now also matches
  `.mp4/.m4v/.mov` (and the image extensions).

### Notes

- Very large sources still transcode within the 1.5.1 preview-cost budget or are
  served download-only; this release only changes which files are *accepted*, not
  how previews are budgeted.

## [1.5.1] — 2026-07-19 — preview cost budget

Polish on 1.5.0's video support, from measuring the transcode on the real host for
the first time. No migration, no schema change, no change to how originals are
stored or served.

### Changed

- **A preview transcode that cannot finish is now refused before it starts.**
  Measured on this hardware, 6K 10-bit 60fps runs at ~0.079× realtime and about 78%
  of that is decode — which downscaling cannot avoid, since every frame is decoded at
  full resolution before the scaler sees it. A five-minute 6K clip therefore needs
  roughly 64 minutes and would exceed the old flat one-hour ffmpeg timeout anyway,
  after occupying the single transcode slot for the whole hour and leaving any photo
  uploaded meanwhile sitting `pending` — and a `pending` photo is not served at all.
  `makePreview` now estimates cost from source pixels × frame rate × duration and
  declines anything over a twenty-minute budget. The outcome for the viewer is
  unchanged — the original, at full resolution, with no in-browser preview — without
  the wasted hour. The ffmpeg timeout is now derived from that budget rather than flat.
- **The lightbox distinguishes "queued" from "no preview is coming".** `previewReady`
  is false in both cases, and the copy previously promised that every such video was
  "still being prepared for playback". With the budget in place that is the normal
  outcome for large sources, so the message now tells the viewer to download the
  original when no preview will arrive. Uses the `previewPending` flag the API already
  exposed; polling already keyed off it and was unaffected.

### Added

- **The verification harnesses now live in the repo** under `test/`, run by
  `./test/run.sh [image] [auth|upload|video]` — 91 assertions across auth hardening,
  resumable upload and the video pipeline. They previously lived in `/tmp` on the host.
  Each run is a one-shot `docker run --rm` against a built image, so nothing is left
  behind; they are not run automatically and are not a substitute for a test suite.

### Notes

- Memory was never the constraint on this hardware: peak was 596 MB against the
  container's 1500 MB ceiling. The throughput constant is calibrated on 10-bit HEVC,
  the most expensive codec to decode, so lighter sources are over-estimated and the
  guard errs toward protecting the box.

## [1.5.0] — 2026-07-18 — video

Video alongside photos, on the same pipeline. Migration `006` runs automatically;
existing rows default to `kind = 'image'` and are untouched. The image now ships ffmpeg
(~150 MB larger).

### Added

- **Video uploads (MP4/MOV).** Identified from the ISO base-media `ftyp` box and
  validated with `ffprobe` before anything is persisted — never from the extension or
  the client-supplied mimetype. Large clips ride the resumable upload added in 1.4.0,
  without which a video of any real length couldn't get past the ~100 MB request-body
  ceiling at all.
- **Poster-frame thumbnails**, written into the same `thumbs/` directory as image
  thumbnails so the gallery grid needs no special case, with a play badge and duration
  in the grid.
- **In-browser preview** — 1080p, 24fps, bitrate-capped H.264/AAC, generated once at
  upload and never on the fly. **Downloads, saves and zips still serve the untouched
  original**, exactly as with photos; the preview exists for on-screen playback only.
- **Byte-range requests** (`Accept-Ranges`, `206`, `Content-Range`, `416`). Not optional:
  Safari and iOS refuse to play a source without them, and seeking is broken everywhere
  else.

### Changed

- **Photo thumbnails are processed before video transcodes.** The thumbnail queue drains
  completely before any transcode starts, and is re-checked after each one, so a newly
  uploaded photo never waits behind a video being re-encoded. It is priority at pickup,
  not preemption — a transcode already running finishes first.
- **Metadata stripping now covers video**, not just photo EXIF. Phone video carries GPS
  in its container metadata; this is verified against a real GPS-tagged MP4 rather than
  assumed.
- ffmpeg runs `-threads 1` at `-preset veryfast`, with scratch on the data volume rather
  than the `/tmp` tmpfs — on a 2017 dual-core with a 1.5-CPU cap an unbounded transcode
  makes the live gallery sluggish, and tmpfs scratch is RAM that would OOM the container.

### Note

A video whose transcode fails keeps its original, served at full resolution, and simply
has no in-browser preview. A video whose metadata strip or poster frame fails is marked
`failed` instead: kept and visible in the dashboard, but never served — serving an
un-stripped original would defeat the metadata guarantee.

## [1.4.1] — 2026-07-18 — long uploads survive their session

### Fixed

- **A large upload no longer dies when its access token expires.** The access token
  lives 15 minutes; a 2 GiB upload over a home uplink runs 15–30. The later part
  requests of an upload therefore outlived the token that authorised the first one,
  and since the API client only retried on `403` (CSRF) and never on `401`, every
  remaining part failed — breaking exactly the large files resumable upload was built
  for. A `401` now mints a fresh token from the refresh cookie and retries once.
  Concurrent failures share a single refresh rather than stampeding the endpoint,
  which also matters because refresh rotates the token.

## [1.4.0] — 2026-07-18 — resumable uploads

Large files can now be uploaded at all. Migration `005` runs automatically; nothing
about existing albums or the batched upload path changes.

### Added

- **Resumable chunked upload.** Cloudflare caps tunnel request bodies at ~100 MB.
  Batching solved *many small files*, but it could never solve *one large file* — no
  arrangement of a single multipart request fits a 500 MB file under a 100 MB ceiling,
  so such a file simply could not be uploaded. A file at or over `MAX_FILE_BYTES` is now
  sliced client-side and sent part by part, then assembled server-side, up to
  `MAX_UPLOAD_BYTES` (default 2 GiB).
- **Interrupted uploads resume instead of restarting.** The server reports which parts it
  actually holds, so only the missing ones are re-sent, and a failed part is retried with
  a widening gap before the upload gives up. Session state lives in SQLite, so a resume
  survives a container restart. The upload UI shows per-file byte progress, since one
  file here can be minutes of upload.
- **Abandoned upload sessions are reclaimed** by the existing maintenance pass after
  `STALE_UPLOAD_MS` (default 24 h), on boot and hourly.

### Changed

- Both upload routes now share one validate-and-commit path (`lib/ingest.ts`). The
  assembled file passes exactly the same magic-byte, dimension and decode gates as a
  batched upload — a second validation path is how a gate quietly drifts out of sync with
  the one actually enforced.
- `/api/config` also reports the upload limits, so the client picks its route from the
  server's real numbers rather than a duplicated constant that can drift.

### Note

Resume currently recovers from a dropped connection *within* an upload attempt. The API
supports resuming a session across a page reload, but the UI does not yet offer it — a
re-drop starts a fresh session.

## [1.3.3] — 2026-07-18 — auth hardening

The code half of the v1.3.1 audit, following the documentation half in 1.3.2. No schema
change and no migration; existing sessions survive the upgrade.

### Fixed

- **A locked account no longer identifies itself at login.** Login answered `423` for a
  locked account but `401` for an unknown username, so the status code revealed whether
  an account existed. Both now return the same generic `401` — and the locked branch
  burns an argon2 hash it previously skipped, so it costs the same as an unknown username
  and a wrong password rather than being measurably faster to probe. Without that burn the
  fix would only have traded a status-code oracle for a timing one. `/api/auth/totp/verify`
  and `/api/auth/refresh` keep their explicit `423`: both sit behind a correct password or
  a valid refresh token, so no enumeration oracle exists there.

### Changed

- **The JWT signer and verifier now name `HS256` explicitly.** A symmetric string secret
  already selected HS256 and `none` was already rejected, so no token changes — this
  stops a later key change from silently widening the accepted algorithm set.
- **The three signing secrets must be at least 32 characters in production**, on top of
  the existing `CHANGE_ME` placeholder guard. `openssl rand -base64 48` yields 64, so
  this only catches a hand-written or truncated key. `ADMIN_PASSWORD` is deliberately
  exempt — it is a human password, not a signing key.

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
