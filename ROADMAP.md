# Roadmap

Direction, not a commitment. This is a single-maintainer project; items land when they
land. The V1 schema was deliberately shaped so the big V2 item is additive.

## Planned

### v1.1 — performance & delivery

- [ ] Async thumbnail/preview generation (SQLite-backed queue, bounded concurrency) — today large batch uploads are processed synchronously and saturate the process.
- [ ] Intermediate "display" size (~2560px) so viewing never decodes full-res originals.
- [ ] On-the-fly streamed zip for desktop "Download all".
- [ ] Link expiry that deletes the actual files, not just the DB row.
- [ ] Edge-cacheable previews (`Cache-Control: immutable` + `ETag`).

### Beyond

- [ ] **V2 client portal.** Per-user album assignments so a client logs in and sees only
      their albums. The `users.role` column and the `album_assignments` table already
      exist in `001_init.sql`; no route wiring yet.
- [ ] **TOTP recovery codes.** Today, losing the TOTP seed means hand-editing the SQLite
      DB (see [SECURITY.md](SECURITY.md) → Known limitations). Backup codes would remove
      that failure mode.
- [ ] **Multi-admin / user management.** Create and manage additional accounts from the
      dashboard instead of the single seeded admin.
- [ ] **Optional zip download.** "Download all" currently saves photos individually
      (share sheet on mobile, sequential downloads elsewhere). A server-side zip is a
      possible alternative for large albums.
- [ ] **Automated test suite.** No tests today; the type checker is the only gate.

## Non-goals

- User-facing photo editing or filters.
- Becoming a general-purpose gallery/CMS — it's a delivery tool.
- Touching the RAW library; photodrop only ever handles exported deliverables.
