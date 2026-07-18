-- Video support (1.5.0).
--
-- kind — what the row actually is. DEFAULT 'image' so every existing row stays
-- exactly what it was, and so the thumbnail worker's ordering
-- (ORDER BY (kind = 'video'), …) keeps picking photos first without a backfill.
ALTER TABLE photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'image';

-- duration_ms — video length, for the gallery badge. NULL for images.
ALTER TABLE photos ADD COLUMN duration_ms INTEGER;

-- preview_status — the bitrate-capped playback derivative, tracked separately
-- from thumb_status because the two have different consequences.
--
-- thumb_status='ready' means the metadata strip and the poster frame both
-- succeeded, which is what makes the file safe to serve at all. The preview is
-- best-effort on top of that: if ffmpeg can't transcode a perfectly valid file,
-- the original is still delivered at full resolution, it just can't be played
-- in the browser.
--
-- No default: NULL means "not applicable", which is every existing image row.
ALTER TABLE photos ADD COLUMN preview_status TEXT;
