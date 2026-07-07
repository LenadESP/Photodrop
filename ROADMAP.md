# Roadmap

Direction, not a commitment. This is a single-maintainer project; items land when they
land. The V1 schema was deliberately shaped so the big V2 item is additive.

Shipped items live in [CHANGELOG.md](CHANGELOG.md). v1.1's reliability tranche
(async thumbnails, disk-full guard, DB/FS health check) shipped in **1.1.0**.

## v1.1.3 — polish (next)

Small correctness/efficiency items from the 2026-07-07 full audit. None is a
vulnerability; none is user-visible today.

- [ ] **Album list fires one COUNT per album (N+1).** `admin.albums.ts` `summary()` runs
      `SELECT COUNT(*)` per row when listing albums; fold the counts into the list query
      with a `LEFT JOIN photos … GROUP BY`. Irrelevant at single-admin scale, cheap to fix.
- [ ] **Long-cache the hashed SPA assets.** Vite emits content-hashed `assets/*` files but
      `@fastify/static` serves them with no `Cache-Control`, so repeat visits refetch the
      bundle. Serve `assets/` with `public, max-age=1y, immutable`; `index.html` keeps
      revalidating (it's the pointer to the hashes).
- [ ] **Intermediate-token cookie outlives its JWT.** The `enroll`/`mfa` cookies reuse
      `accessCookieOpts` (15 min) while the tokens inside expire at 10 min. The JWT expiry
      governs, so this is hygiene only — add a 10-min cookie variant so the cookie and
      token lifetimes match.
- [ ] **`/api/auth/refresh` ignores account lockout.** A valid refresh token mints a new
      session even while the account is locked (`locked_until`). Check the lock before
      issuing. (Full server-side invalidation is the separate session-revocation item.)

Infra reminder (outside this repo): the Cloudflare cache rule for `/api/a/*/thumb/*` —
the edge half of the 1.1.0 edge-cacheable thumbnails — is still not configured in the
CF dashboard.

## v1.1 — hardening & delivery

### Reliability (remaining)

- [ ] **Boot-time orphan sweep.** The thumbnail queue already self-reconciles on boot
      (the worker reprocesses any `pending` rows). Still to do: sweep leftover files in
      `tmp/` and reconcile DB rows against on-disk files (rows with no files, files with
      no rows) after an interrupted upload.
- [ ] **Disk alert.** The free-space *floor* guard shipped (uploads 507 below
      `MIN_FREE_BYTES`); still want a proactive alert (ntfy) at ~85% disk.

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

## v1.2.0 — hardening (from the v1.1.1 audit)

Defence-in-depth items; none is a live exposure on the proxied production deploy.

- [ ] **Configurable proxy-trust depth.** `trustProxy` is hard-coded to `1`. In the shipped
      standalone mode (published `3000:3000`, no proxy) a client can spoof `X-Forwarded-For`
      and evade the per-IP rate limit (per-user lockout is unaffected — it's keyed on the DB
      row). Make the trust depth an env var, and verify the Caddy→app XFF hop count behind the
      Cloudflare Tunnel on the live deploy.
- [ ] **Rate-limit the bulk byte endpoints.** `/api/a/:uid/zip` (and the per-photo byte
      routes) fall back to the global 1000/min only; a public link can be pulled repeatedly.
      Add a modest per-route cap.
- [ ] **TOTP replay protection.** A code stays replayable across its ±1-step (~90 s) window;
      track the last-used step per user so a code can't be reused within its validity.

## v2.0.0

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