# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
Everything through **1.2.0** is shipped: reliability & delivery (1.1.0), the polish /
mobile / lifecycle line (1.1.3–1.1.5), and the security-hardening tranche (1.2.0 —
configurable proxy-trust, bulk-endpoint rate caps, TOTP replay protection, session
revocation).

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## 1.3.0 — download UX (next)
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
