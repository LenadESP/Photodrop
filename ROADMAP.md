# Roadmap

Direction, not a commitment. This is a single-maintainer project; items land when they
land. The V1 schema was deliberately shaped so the big V2 item is additive.

Shipped items live in [CHANGELOG.md](CHANGELOG.md). v1.1's reliability tranche
(async thumbnails, disk-full guard, DB/FS health check) shipped in **0.2.0**.

## v1.1 — hardening & delivery

### Reliability (remaining)

- [ ] **Boot-time orphan sweep.** The thumbnail queue already self-reconciles on boot
      (the worker reprocesses any `pending` rows). Still to do: sweep leftover files in
      `tmp/` and reconcile DB rows against on-disk files (rows with no files, files with
      no rows) after an interrupted upload.
- [ ] **Disk alert.** The free-space *floor* guard shipped (uploads 507 below
      `MIN_FREE_BYTES`); still want a proactive alert (ntfy) at ~85% disk.

### Delivery & performance

- [ ] **Streamed zip for "Download all" (desktop).** Currently saves photos individually
      (sequential downloads on desktop). Add an on-the-fly streamed zip (never buffered in
      RAM/disk) as the desktop path.
- [ ] **Fix mobile "Download all".** Photos currently land in Downloads instead of the
      camera roll on some mobile flows; route them through the share sheet properly.

### Lifecycle & correctness

- [ ] **Link expiry that actually deletes.** Expiring an album must delete the files on
      disk (`rm -rf albums/<uid>/`) and the DB row, not just mark it inaccessible.

### Security follow-ups (from the v1.1 audit)

- [ ] **Session revocation.** Refresh tokens aren't rotated on use and logout only clears
      cookies client-side, so a captured token stays valid until expiry. Rotate the
      refresh token on every `/refresh` and add a `token_version` (bumped on logout /
      password change) so sessions can be invalidated server-side.

### Backup

- [ ] **Online SQLite backup.** When the external backup lands, dump `photodrop.db` with
      `sqlite3 .backup` / `VACUUM INTO`, never a raw copy of a live WAL database.
      (A manual pre-upgrade `.db` copy is already taken by the deploy process.)

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