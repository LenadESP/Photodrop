# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
Everything through **1.5.5** is shipped: reliability & delivery (1.1.0), the polish /
mobile / lifecycle line (1.1.3–1.1.5), the security-hardening tranche (1.2.0 —
configurable proxy-trust, bulk-endpoint rate caps, TOTP replay protection, session
revocation), the download UX (1.3.0 — explicit picker + reliable single-photo
full-resolution save; 1.3.1 — phone "download all" as direct per-file downloads), both
halves of the v1.3.1 audit (1.3.2 documentation, 1.3.3 auth hardening), resumable
chunked upload (1.4.0, +1.4.1 so a long upload survives its session), video
(1.5.0 — MP4/MOV, poster frames, capped 1080p/24fps previews, byte-range serving), a
preview cost budget so an over-large transcode is declined rather than run for an hour
(1.5.1), acceptance of professional-camera video whose standard brand is only a
compatible brand — Sony XAVC-S (1.5.2), recoverable media-processing failures surfaced
in the dashboard with retry / upload-anyway / cancel (1.5.3), and the upload-progress
line: real byte progress on every upload (1.5.4), then every file through the resumable
route so one blip or one bad file no longer costs the whole drop (1.5.5).

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## Unscheduled — deeper auth follow-ups
Flagged by the v1.3.1 audit, deliberately left unscheduled: both are larger than the
1.3.2/1.3.3 tranche and neither is a high/critical issue.
- **Per-token refresh reuse detection** (a `jti` per refresh token, invalidated on use).
  Today refresh re-issues without revoking, so a stolen refresh token stays valid up to
  its 7-day life unless you log out — see SECURITY.md "Known limitations".
- **A softer lockout** so the sole admin can't be locked out of their own instance by a
  password-guessing flood.

## In progress
- **1.6.0 — localisation.** English and Spanish, picked from the device language on
  first visit and switchable from a toggle beside the theme toggle (both the admin
  chrome and the recipient-facing gallery). The interesting half is server-side: the
  SPA renders API error text verbatim, so the backend negotiates `Accept-Language` and
  returns already-localised messages. Scaffolded for *n* languages — adding a third is
  a catalogue file, not a refactor — even though only two ship now.

## Next up
Nothing else is scheduled. Candidates, roughly in order of how much they'd actually be used:
- **Resume an upload across a page reload.** The API already supports it (a session can
  be queried for the parts it holds); the UI doesn't offer it, so a re-drop starts fresh.
- **Album-level "download all" for mixed albums** — a zip of a video-heavy album is very
  large; worth a size warning before it starts.
- **Per-token refresh reuse detection** and a **softer lockout** (see above).

## Parked
- **2.0.0 — multi-tenant rework**: three-role auth model, register/onboarding flow, ownership checks. Scoped separately, deliberately out of this roadmap until the above ships.

## Backlog / blocked
- Online SQLite backup (`.backup` / `VACUUM INTO`) — blocked on the external backup landing. Manual pre-upgrade `.db` copy already taken by the deploy.
