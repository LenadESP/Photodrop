# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
The 1.1.0 reliability tranche (async thumbnail worker, disk-full guard, DB/FS health
check) is shipped.

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## 1.1.3 — polish (next)
Correctness/efficiency from the 2026-07-07 audit. None user-visible.
- Fold per-album photo COUNT into the album-list query (kill the N+1).
- Long-cache hashed SPA assets (`assets/*` immutable; `index.html` keeps revalidating).
- Match the intermediate-token cookie lifetime to its 10-min JWT.
- `/api/auth/refresh` must honour account lockout before issuing a session.

## 1.1.4 — mobile & gallery fixes
- Fix the lightbox prev button on touch (dead on mobile today).
- Swipe left/right to navigate the lightbox on mobile (must not fight the zoom-pan handlers).

## 1.1.5 — reliability & lifecycle
- Boot-time orphan sweep: clear `tmp/` and reconcile DB rows ↔ on-disk files after an interrupted upload.
- Link expiry actually deletes: `rm -rf albums/<uid>/` + DB row, not just mark inaccessible.
- Proactive disk alert (ntfy) at ~85%.
- TOTP-reset CLI: one command clears a user's enrolment so next login re-enrols (no schema change; real recovery codes ride the 2.0 rework).

## 1.2.0 — hardening
Defence-in-depth from the v1.1.1 audit; none is a live exposure on the proxied deploy.
- Configurable proxy-trust depth (env var); verify the Caddy→app XFF hop behind the tunnel.
- Per-route rate cap on the bulk byte endpoints (`/api/a/:uid/zip` + per-photo).
- TOTP replay protection: track the last-used step per user.
- Session revocation: rotate the refresh token on use + `token_version` (bumped on logout / password change).

## 1.3.0 — download UX
The download flow, finally sane.
- Explicit picker: **Zip file** (on-the-fly streamed, never buffered in RAM/disk) vs **Direct download**.
- Mobile-correct: direct routes through the share sheet → Photos; zip lands in Files.

## 1.4.0 — video support
- Accept video uploads; poster-frame thumbnails.
- Bitrate-capped preview transcode on the existing async job worker — one-time at upload, never on-the-fly on this CPU. Direct-play small/compatible files.

## Parked
- **2.0.0 — multi-tenant rework**: three-role auth model, register/onboarding flow, ownership checks. Scoped separately, deliberately out of this roadmap until the above ships.

## Backlog / blocked
- Online SQLite backup (`.backup` / `VACUUM INTO`) — blocked on the external backup landing. Manual pre-upgrade `.db` copy already taken by the deploy.
- Infra (outside repo): Cloudflare cache rule for `/api/a/*/thumb/*` still unset in the CF dashboard.
