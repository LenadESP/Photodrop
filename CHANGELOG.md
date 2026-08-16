# Changelog

All notable changes to photodrop. Dates are ISO‑8601.

## [Unreleased]

### Documentation

- **`SECURITY.md` now states the client-IP requirement the rate limiter depends on.**
  `TRUST_PROXY_HOPS` was documented as the knob that makes `req.ip` the real client, which
  is only half true: it picks *which* entry of `X-Forwarded-For` is read, but if the proxy
  in front appends to a client-supplied chain instead of overwriting it, hop 1 is the
  proxy's own address and every public visitor shares one rate-limit bucket. Measured on a
  Cloudflare Tunnel deployment: two distinct clients decremented a single counter.
  Raising the hop count to compensate would make the client-controlled entry load-bearing
  and allow spoofing, so the fix belongs in the proxy — `header_up X-Forwarded-For
  {client_ip}` on Caddy — with `TRUST_PROXY_HOPS` left at 1. No code change; the default
  was already the safe half of the trade.

## [1.6.1] — 2026-08-14 — layouts that survive a longer language

Frontend-only, layout only: no server, schema, or validation change, and no
string changed. 1.6.0 shipped Spanish into layouts that had only ever held
English, and Spanish runs materially longer — "Panel de administración" is
~180px against "Admin dashboard"'s ~115px.

### Fixed

- **The top bar no longer rams the wordmark on a phone.** Logged in as admin in
  Spanish, the nav needs ~378px next to a ~95px wordmark inside a 375px
  viewport, and a flex item won't shrink below its content — so the nav simply
  overlapped the logo. The header and the nav now wrap, and the wordmark is
  `shrink-0`. Every control stays reachable at any width, in any language.
- **The theme and language toggles no longer squash.** `h-8 w-8` still shrinks
  under flex pressure; both are now `shrink-0`.
- **The failed-photo actions fit a phone.** The row was `shrink-0` around three
  buttons that run ~320px in Spanish ("Subir de todos modos" alone is ~145px) —
  wider than the card containing them. It wraps now.
- **A long album title no longer pushes the gallery controls off-screen** (the
  header's title block lacked `min-w-0`, so it refused to shrink) **or past the
  card border on the password screen** (no `break-words`). Album titles are user
  data and can be arbitrarily long.
- **Smaller squashes from the same cause:** the "Public (…)" checkbox being
  crushed by its own label, and the sidebar's photo count shrinking instead of
  the title that is already set up to truncate. Both `shrink-0` now.
- **The gallery's download/toggle row wraps** instead of overflowing once
  "Descargar todo" and "Descargar ZIP" sit next to both toggles.
- **The empty-state panel got padding**, so its text isn't flush against the
  dashed border on a narrow screen.

### Notes

Also added `overflow-wrap: break-word` on `body` as a backstop, so an unbroken
filename or album title breaks instead of forcing the whole page to scroll
sideways. Deliberately **not** `overflow-x: hidden`, which hides this class of
bug rather than fixing it.

Found by auditing all 38 horizontal flex containers rather than by spotting
them one at a time — they are all one root cause (a flex item does not shrink
below its content unless told to), and English labels were short enough that
nothing ever reached the limit.

## [1.6.0] — 2026-08-14 — English and Spanish

The whole app is localised, admin chrome and recipient-facing gallery alike. It
opens in the device language and can be switched from a toggle beside the theme
toggle. No schema change, no change to how anything is stored, served, or
validated; album titles and filenames are user data and are never translated.

### Added

- **Language support: English and Spanish.** On a first visit the language comes
  from `navigator.languages`, taking the first entry the app supports — a device
  set to `[ca, es, en]` opens in Spanish, not English. Region subtags are
  ignored (`es-419` and `es-ES` are both `es`). An explicit choice is persisted
  in `localStorage` and wins from then on. The resolution runs in `main.tsx`
  before React mounts, alongside the existing theme block, so the first paint is
  already in the right language and `<html lang>` always matches what is on
  screen — no inline script, which the CSP would block anyway.
- **A language toggle** (`LangToggle`), mirroring `ThemeToggle`. It shows the
  current language and cycles to the next. Mounted in `TopBar` and — separately,
  because the gallery has no TopBar — in the gallery header, which is where a
  recipient who doesn't read English actually needs it.
- **Server-side locale negotiation.** The SPA renders whatever string the API
  puts in `error`, so translating only the frontend would have left every
  failure in English. The backend now negotiates `Accept-Language` (q-values,
  primary-subtag match) and returns already-localised text. All 72 error call
  sites go through a single `reply.fail(status, key)` helper, and the rate
  limiter, TypeBox validation rejections and unhandled throws are normalised
  onto the same envelope instead of each emitting their own English shape.
- **A stable `code` on every error response**, alongside the localised `error`
  text — machine-readable identity that doesn't move when the locale does. The
  admin photo listing gains `errorCode` for the same reason. Both are additive;
  nothing that read `error` before has changed shape.

### Changed

- **`Accept-Language` is set explicitly on every API request** rather than left
  to the browser. It has to follow the *chosen* language: someone on an English
  device who switches the app to Spanish must not get English errors inside a
  Spanish UI. (Image `src` and direct browser downloads can't carry it and use
  the browser's own header — they return bytes, not text, so it doesn't matter.)
- **API responses under `/api/` now send `Vary: Accept-Language`,** so the
  reverse proxy can't serve one language's error text to a request that asked
  for the other.
- **`ingestFiles` returns a message key and params instead of rendered text.**
  It runs below the HTTP layer and has no locale; the route translates it.

### Notes

Both catalogues are typed against the English source, so a missing key or a
plural flattened to a plain string is a compile error rather than a blank
string at runtime. Plural forms are keyed by CLDR category and selected with
`Intl.PluralRules` — English and Spanish only use `one`/`other`, but a language
with richer plural rules is a catalogue file, not a refactor. Adding a language
is two lines: a catalogue, and one entry in the registry.

## [1.5.5] — 2026-08-11 — every upload is resumable

Frontend-only: the SPA now sends **all** files through the resumable chunked
route, not just large ones. No server, schema, or validation change — the
resumable route already existed and is unchanged.

### Changed

- **Small files no longer go up as one batched multipart request.** The batch
  was a single connection for the whole drop, so a dropped connection lost every
  file in it and one rejected file failed the rest. Each file now uploads through
  the resumable route independently: a blip costs one auto-retried part, a resume
  picks up where it stopped, and one bad file doesn't abandon the others (its
  error is reported and the drop continues).
- **Byte-level progress within each part.** Resumable parts upload via
  `XMLHttpRequest` (`apiUpload`, generalized in 1.5.4 to take a raw `Blob`), so
  progress is smooth even for a single-part file — not a 0→100 jump per file.

The batched multipart endpoint (`POST /api/admin/albums/:uid/photos`) remains
server-side and valid; the SPA simply no longer calls it.

## [1.5.4] — 2026-08-11 — upload progress that actually moves

A UX fix, frontend-only: no schema change, no change to how anything is stored,
served, or validated.

### Fixed

- **The upload indicator now shows real byte progress.** Small files are sent as
  one batched multipart request, and `fetch` reports no upload progress (a
  streaming request body isn't available on iOS Safari), so the counter sat at
  `0/N` for the entire upload and only jumped to success at the very end — on a
  slow uplink that looked exactly like a stuck upload, though bytes were flowing
  the whole time. The batch now uploads via `XMLHttpRequest`, whose
  `upload.onprogress` drives an always-moving percentage across the whole drop
  (`lib/api.ts` `apiUpload`; CSRF-rotation and token-refresh retry-once logic
  mirror `api()`). The resumable large-file path already had byte progress and is
  unchanged.

## [1.5.3] — 2026-08-11 — recoverable media-processing failures

Large videos could fail the upload-time metadata strip and become permanently
unservable — invisibly. Stripping metadata from an MP4/MOV rewrites the whole
file, and the exiftool task timeout was a fixed 20s, so any video over ~600 MB
timed out, was marked `failed`, and then neither played nor downloaded (every
byte endpoint gates on `thumb_status='ready'`) while spinning forever in the
gallery. This release fixes the timeout and makes any such failure visible and
recoverable from the admin panel.

### Fixed

- **The metadata-strip timeout now scales with the upload ceiling.** exiftool's
  per-task timeout was 20s regardless of file size; a strip runs at ~20–32 MB/s,
  so large videos timed out (a 2 GiB file needs ~100s, measured). The timeout is
  now derived from `MAX_UPLOAD_BYTES` at a conservative 20 MB/s with 1.5×
  headroom (≈154s at the 2 GiB default), floored at 30s.
- **A strip failure no longer strands a valid file.** The worker now separates a
  decode/format failure (corrupt or hostile — still dropped) from a recoverable
  metadata-strip failure (kept, marked `failed` with a reason), for both images
  and video.

### Added

- **Persistent, actionable failures in the admin panel.** Migration `007` adds
  `error_code` (why the last attempt failed; cleared when resolved) and
  `skip_strip` (the "upload anyway" override) to `photos`. A failed item shows
  `Error uploading: <reason>` and three actions: **Try again** (reprocess),
  **Upload anyway** (reprocess without stripping — keeps the file's metadata),
  and **Cancel** (delete). The state survives reloads and restarts.
- **Admin photo listing** (`GET /api/admin/albums/:uid/photos`) carrying
  processing status and the failure reason; the public gallery endpoint exposes
  only a `failed` flag (no internal detail) and hides failed items so a recipient
  never sees an endless spinner.

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
