-- Async thumbnail pipeline. Uploads are validated cheaply (magic bytes + header
-- dimensions) and stored immediately as 'pending'; a background worker does the
-- expensive full decode + thumbnail + EXIF strip, then flips the row to 'ready'.
-- Photo bytes are not served until 'ready', so an un-stripped original is never
-- exposed. The column also acts as the durable work queue: on boot the worker
-- reprocesses anything left 'pending' by a crash.
--
-- DEFAULT 'ready' so existing rows (already processed synchronously) stay
-- servable; only newly ingested rows start 'pending'.
ALTER TABLE photos ADD COLUMN thumb_status TEXT NOT NULL DEFAULT 'ready'
  CHECK (thumb_status IN ('pending', 'ready', 'failed'));

CREATE INDEX idx_photos_status ON photos(thumb_status);
