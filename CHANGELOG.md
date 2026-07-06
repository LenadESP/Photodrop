# Changelog

All notable changes to photodrop. Dates are ISO‑8601.

## [0.2.0] — 2026-07-06 — v1.1 (reliability)

Reliability and hardening pass. No breaking API changes; migration `002` runs
automatically on upgrade (adds `photos.thumb_status`, defaulting existing rows to
`ready` so they remain servable).

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

### Fixed

- **Fresh‑deploy first upload.** `albums/` and `tmp/` are now created on boot
  (`ensureDataDirs`); previously `tmp/` was never created, so the first upload on a
  brand‑new deployment failed with `ENOENT`.

### Security

- Audited the backend against OWASP ASVS / Top 10 — no injection, IDOR, path‑traversal,
  or XSS issues found; core controls verified sound. See `SECURITY.md`.
- Confirmed TOTP verification tolerates ±1 step (~±30 s) per RFC 6238 §5.2, and the
  per‑album unlock is rate‑limited (10/min) — both verified, no change required.

[0.2.0]: https://github.com/LenadESP/Photodrop/releases/tag/v0.2.0
