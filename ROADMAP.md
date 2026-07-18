# Roadmap

Direction, not a commitment. Single-maintainer project; items land when they land.
The V1 schema was deliberately shaped so the big multi-tenant item stays additive.

Shipped items live in [CHANGELOG.md](https://github.com/LenadESP/Photodrop/blob/main/CHANGELOG.md).
Everything through **1.3.3** is shipped: reliability & delivery (1.1.0), the polish /
mobile / lifecycle line (1.1.3–1.1.5), the security-hardening tranche (1.2.0 —
configurable proxy-trust, bulk-endpoint rate caps, TOTP replay protection, session
revocation), the download UX (1.3.0 — explicit picker + reliable single-photo
full-resolution save; 1.3.1 — phone "download all" as direct per-file downloads), and
both halves of the v1.3.1 audit (1.3.2 documentation, 1.3.3 auth hardening).

Notation: `x.Y.0` = features, `x.x.Y` = fixes/polish.

## Unscheduled — deeper auth follow-ups
Flagged by the v1.3.1 audit, deliberately left unscheduled: both are larger than the
1.3.2/1.3.3 tranche and neither is a high/critical issue.
- **Per-token refresh reuse detection** (a `jti` per refresh token, invalidated on use).
  Today refresh re-issues without revoking, so a stolen refresh token stays valid up to
  its 7-day life unless you log out — see SECURITY.md "Known limitations".
- **A softer lockout** so the sole admin can't be locked out of their own instance by a
  password-guessing flood.

## 1.5.0 — video support (next)
Shipping on top of 1.4.0's resumable upload, without which a video of any real length
could not be uploaded at all.
- Accept video uploads (MP4/MOV, `ftyp` magic-byte sniff + ffprobe as the ingest gate);
  poster-frame thumbnails into the existing `thumbs/` dir.
- **1080p / 24fps / bitrate-capped preview** transcode on the existing async worker —
  one-time at upload, never on the fly on this CPU. `-threads 1` so a transcode can't
  saturate both cores and make the live site sluggish; ffmpeg scratch on the data volume,
  never the `/tmp` tmpfs (that is RAM, and counts against the container's 1500m ceiling).
- **Photo thumbnails take priority over video transcoding** in the queue
  (`ORDER BY (kind='video'), created_at, id`) — priority at pickup, not preemptive: a
  transcode already running finishes before a newly-queued photo starts.
- **Full-resolution delivery is unchanged.** The preview is for on-screen playback only;
  every save, download and zip path serves the original, exactly as with photos.
- Transcode failure keeps the original and marks the preview unavailable. A failure of
  the *metadata strip or poster* is different — that file can't be served safely at all,
  so the row is marked failed rather than served.
- **Byte-range (`206`) serving is a prerequisite** — `<video>` will not play on
  iOS/Safari without it, and seeking breaks everywhere.
- Verify empirically that exiftool actually strips GPS from a real phone MP4 before
  claiming the no-metadata-leaks guarantee covers video.

## Unscheduled — upload follow-up
- **Resume across a page reload.** The API already supports it (a session can be queried
  for its received parts); the UI does not offer it, so a re-drop starts fresh.

## Parked
- **2.0.0 — multi-tenant rework**: three-role auth model, register/onboarding flow, ownership checks. Scoped separately, deliberately out of this roadmap until the above ships.

## Backlog / blocked
- Online SQLite backup (`.backup` / `VACUUM INTO`) — blocked on the external backup landing. Manual pre-upgrade `.db` copy already taken by the deploy.
