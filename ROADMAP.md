# Roadmap

Direction, not a commitment. This is a single-maintainer project; items land when they
land. The V1 schema was deliberately shaped so the big V2 item is additive.

## v1.1 — hardening & delivery

### Reliability (highest priority — these can take prod down)

- [ ] **Async thumbnail/preview generation.** Uploads currently generate thumbnails
      synchronously in the request process; a large batch (e.g. 400 images) starves the
      event loop and blows memory on a small box. Move generation to a background worker
      backed by a `jobs` table in SQLite (no external queue), with hard-capped
      concurrency. Uploads return immediately; the gallery shows a placeholder until each
      thumb is ready. Worker state lives in the DB so it survives a dirty restart.
- [ ] **Disk-full guard.** No free-space check before accepting an upload today; a full
      data volume means SQLite can't write its WAL and the DB can corrupt. Refuse uploads
      below a free-space floor and alert (ntfy) at ~85% disk.
- [ ] **Boot-time cleanup / reconciliation.** After an interrupted upload (power loss),
      sweep leftover files in `tmp/` and reconcile DB rows against on-disk files (rows
      with no files, files with no rows).
- [ ] **Health check touches DB + filesystem**, not just a port ping — a live port with a
      corrupt DB should report unhealthy.

### Delivery & performance

- [ ] **Intermediate "display" size (~2560px).** Viewing currently serves full-res
      originals, forcing clients to decode 24 MP to paint a ~1080p screen. Generate a
      third derivative; lightbox and gallery serve it, originals are only touched on
      download.
- [ ] **Streamed zip for "Download all" (desktop).** Currently saves photos individually
      (sequential downloads on desktop). Add an on-the-fly streamed zip (never buffered in
      RAM/disk) as the desktop path.
- [ ] **Fix mobile "Download all".** Photos currently land in Downloads instead of the
      camera roll on some mobile flows; route them through the share sheet properly.
- [ ] **Edge-cacheable previews.** Serve thumbnails/previews with `Cache-Control: immutable`
      + ETag so Cloudflare caches them and repeat views never hit the origin.

### Lifecycle & correctness

- [ ] **Link expiry that actually deletes.** Expiring an album must delete the files on
      disk (`rm -rf albums/<uid>/`) and the DB row, not just mark it inaccessible.
- [ ] **Rate-limit the per-album password check.** Admin login has lockout; confirm the
      per-album unlock is rate-limited too, so a password-gated album isn't brute-forceable.

### Backup

- [ ] **Online SQLite backup.** When the external backup lands, dump `photodrop.db` with
      `sqlite3 .backup` / `VACUUM INTO`, never a raw copy of a live WAL database.

## Planned (V2 and beyond)

- [ ] **V2 client portal.** Per-user album assignments so a client logs in and sees only
      their albums. `users.role` and `album_assignments` already exist in `001_init.sql`;
      no route wiring yet.
- [ ] **TOTP recovery codes.** Losing the TOTP seed currently means hand-editing SQLite.
      Backup codes would remove that failure mode. Deferred in V1: single-operator, and
      the operator can already edit the DB.
- [ ] **Multi-admin / user management.** Create and manage additional accounts from the
      dashboard instead of the single seeded admin.
- [ ] **Automated test suite.** No tests today; the type checker is the only gate.

## Non-goals

- User-facing photo editing or filters.
- Becoming a general-purpose gallery/CMS — it's a delivery tool.
- Touching the RAW library; photodrop only ever handles exported deliverables.
- Offsite/cloud backup — deliberately self-hosted only; redundancy is local (two disks).