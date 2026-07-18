# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
Everything through **1.3.2** is shipped: reliability & delivery (1.1.0), the polish /
mobile / lifecycle line (1.1.3–1.1.5), the security-hardening tranche (1.2.0 —
configurable proxy-trust, bulk-endpoint rate caps, TOTP replay protection, session
revocation), the download UX (1.3.0 — explicit picker + reliable single-photo
full-resolution save; 1.3.1 — phone "download all" as direct per-file downloads), and
the documentation corrections from the v1.3.1 audit (1.3.2).

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## 1.3.3 — auth hardening (next)
The code half of the v1.3.1 audit; the documentation half shipped as 1.3.2.
- **A locked account should not identify itself at login.** Login answers 423 for a
  locked account but 401 for an unknown username — a mild existence oracle. Return the
  same generic 401, burning a comparable argon2 hash so the lockout does not become a
  *timing* oracle instead (the locked branch currently returns before any argon2 work).
  `/totp/verify` and `/api/auth/refresh` keep 423: both sit behind a correct password or
  a valid token, so no enumeration oracle exists there, and 423 is the more useful answer
  for the operator.
- **Pin the JWT verifier to `HS256`** explicitly — already effectively HS-only, so this
  is defence in depth.
- **Minimum-length check on the signing secrets** in `env.ts`, on top of the `CHANGE_ME`
  guard. Production-gated, and scoped to the three crypto secrets — `ADMIN_PASSWORD`
  flows through the same helper but is a human password, not a key.
- Deeper follow-ups the audit flagged (per-token refresh reuse detection; a softer lockout
  so the sole admin can't be locked out) are larger and left unscheduled for now.

## 1.4.0 — video support
- Accept video uploads; poster-frame thumbnails.
- Bitrate-capped preview transcode on the existing async job worker — one-time at upload, never on-the-fly on this CPU. Direct-play small/compatible files.

## Parked
- **2.0.0 — multi-tenant rework**: three-role auth model, register/onboarding flow, ownership checks. Scoped separately, deliberately out of this roadmap until the above ships.

## Backlog / blocked
- Online SQLite backup (`.backup` / `VACUUM INTO`) — blocked on the external backup landing. Manual pre-upgrade `.db` copy already taken by the deploy.
