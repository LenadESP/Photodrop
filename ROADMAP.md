# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
Everything through **1.3.1** is shipped: reliability & delivery (1.1.0), the polish /
mobile / lifecycle line (1.1.3–1.1.5), the security-hardening tranche (1.2.0 —
configurable proxy-trust, bulk-endpoint rate caps, TOTP replay protection, session
revocation), and the download UX (1.3.0 — explicit picker + reliable single-photo
full-resolution save; 1.3.1 — phone "download all" as direct per-file downloads).

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## 1.3.2 — security-doc corrections + small hardening (next)
From the v1.3.1 full-codebase audit — no high/critical issues; low-severity corrections
and defensive polish.
- **Fix two overstated SECURITY.md claims** (the audit's main output):
  - Refresh tokens: rotation issues a new token but does **not** invalidate the old one —
    version-based revocation only clears outstanding tokens on logout/expiry, so a stolen
    refresh token stays valid up to its 7-day life. Reword the "can't be replayed" line to
    match what's enforced.
  - Enumeration: a locked account returns 423 vs 401 for an unknown username — a mild
    existence oracle. Reword "no existence oracle", or return a generic 401 when locked.
- **Optional small hardening (low-risk):** pin the JWT verifier to `HS256` explicitly
  (already effectively HS-only — defence in depth); minimum-length check on the secrets in
  `env.ts`, on top of the `CHANGE_ME` guard.
- Deeper follow-ups the audit flagged (per-token refresh reuse detection; a softer lockout
  so the sole admin can't be locked out) are larger and left unscheduled for now.

## 1.4.0 — video support
- Accept video uploads; poster-frame thumbnails.
- Bitrate-capped preview transcode on the existing async job worker — one-time at upload, never on-the-fly on this CPU. Direct-play small/compatible files.

## Parked
- **2.0.0 — multi-tenant rework**: three-role auth model, register/onboarding flow, ownership checks. Scoped separately, deliberately out of this roadmap until the above ships.

## Backlog / blocked
- Online SQLite backup (`.backup` / `VACUUM INTO`) — blocked on the external backup landing. Manual pre-upgrade `.db` copy already taken by the deploy.
