# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
Everything through **1.5.0** is shipped: reliability & delivery (1.1.0), the polish /
mobile / lifecycle line (1.1.3–1.1.5), the security-hardening tranche (1.2.0 —
configurable proxy-trust, bulk-endpoint rate caps, TOTP replay protection, session
revocation), the download UX (1.3.0 — explicit picker + reliable single-photo
full-resolution save; 1.3.1 — phone "download all" as direct per-file downloads), both
halves of the v1.3.1 audit (1.3.2 documentation, 1.3.3 auth hardening), resumable
chunked upload (1.4.0, +1.4.1 so a long upload survives its session), and video
(1.5.0 — MP4/MOV, poster frames, capped 1080p/24fps previews, byte-range serving).

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## Unscheduled — deeper auth follow-ups
Flagged by the v1.3.1 audit, deliberately left unscheduled: both are larger than the
1.3.2/1.3.3 tranche and neither is a high/critical issue.
- **Per-token refresh reuse detection** (a `jti` per refresh token, invalidated on use).
  Today refresh re-issues without revoking, so a stolen refresh token stays valid up to
  its 7-day life unless you log out — see SECURITY.md "Known limitations".
- **A softer lockout** so the sole admin can't be locked out of their own instance by a
  password-guessing flood.

## Next up
Nothing is scheduled. Candidates, roughly in order of how much they'd actually be used:
- **Resume an upload across a page reload.** The API already supports it (a session can
  be queried for the parts it holds); the UI doesn't offer it, so a re-drop starts fresh.
- **Album-level "download all" for mixed albums** — a zip of a video-heavy album is very
  large; worth a size warning before it starts.
- **Per-token refresh reuse detection** and a **softer lockout** (see above).

## Parked
- **2.0.0 — multi-tenant rework**: three-role auth model, register/onboarding flow, ownership checks. Scoped separately, deliberately out of this roadmap until the above ships.

## Backlog / blocked
- Online SQLite backup (`.backup` / `VACUUM INTO`) — blocked on the external backup landing. Manual pre-upgrade `.db` copy already taken by the deploy.
