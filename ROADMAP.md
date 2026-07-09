# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
Everything through **1.3.0** is shipped: reliability & delivery (1.1.0), the polish /
mobile / lifecycle line (1.1.3–1.1.5), the security-hardening tranche (1.2.0 —
configurable proxy-trust, bulk-endpoint rate caps, TOTP replay protection, session
revocation), and the download UX (1.3.0 — explicit picker + reliable single-photo
full-resolution save; the bulk phone save is reworked in 1.3.1, below).

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## 1.3.1 — phone "download all" (next)
Owner's decision (2026-07-09): on a phone, "download all" saves the originals **straight
to the device — no ZIP, no share sheet**. A web page can't write to the photo library
directly, so this is what's achievable:
- "Download all" on a phone triggers a **direct browser download of every full-resolution
  original** (`/api/a/:uid/download/:id`), sequentially, with a progress indicator; the
  browser asks once to allow multiple files.
- **Android** → the files land in Downloads, which the gallery / Google Photos surfaces
  (this satisfies "lands in the gallery"). **iOS** → they land in Files; the Photos
  library isn't reachable from the web without the share sheet, which the owner has ruled
  out — accepted tradeoff.
- **Full resolution only**, always — never the display derivative or any re-encode.
- Replaces the 1.3.0 mobile "Save to Photos", which fetched every original into memory
  before invoking the share sheet and hung on a real album.
- Open (confirm with owner before building): whether desktop keeps the streamed ZIP or
  also goes direct, and whether the single-photo lightbox Save (share sheet → Photos,
  currently working) changes too.

## 1.4.0 — video support
- Accept video uploads; poster-frame thumbnails.
- Bitrate-capped preview transcode on the existing async job worker — one-time at upload, never on-the-fly on this CPU. Direct-play small/compatible files.

## Parked
- **2.0.0 — multi-tenant rework**: three-role auth model, register/onboarding flow, ownership checks. Scoped separately, deliberately out of this roadmap until the above ships.

## Backlog / blocked
- Online SQLite backup (`.backup` / `VACUUM INTO`) — blocked on the external backup landing. Manual pre-upgrade `.db` copy already taken by the deploy.
