-- Persistent, actionable processing errors (1.5.3).
--
-- Before this, a video whose metadata strip or poster frame failed was left
-- thumb_status='failed' with no reason recorded and no way to act on it: it
-- spun forever in the gallery and was unservable across every endpoint. These
-- two columns make a failure durable and recoverable from the admin panel.

-- error_code — why the last processing attempt failed, or NULL for none. Set by
-- the worker alongside thumb_status='failed'; cleared to NULL when the admin
-- retries or accepts the file. A short machine code (e.g. 'metadata_timeout')
-- that the admin API maps to a human message; the raw ffmpeg/exiftool text is
-- only logged, never persisted or shown.
ALTER TABLE photos ADD COLUMN error_code TEXT;

-- skip_strip — set to 1 by the admin "upload anyway" action, which reprocesses
-- the file WITHOUT the metadata strip (accepting that GPS/camera tags remain in
-- the served original). DEFAULT 0 so every existing and future row strips as
-- before unless the admin explicitly overrides it for that one file.
ALTER TABLE photos ADD COLUMN skip_strip INTEGER NOT NULL DEFAULT 0;
