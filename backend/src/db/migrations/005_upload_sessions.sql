-- Resumable chunked uploads (1.4.0).
--
-- Cloudflare caps tunnel request bodies at ~100 MB, so a single file larger than
-- that could never be uploaded: batching many small files works, but one big file
-- cannot be split across requests by the multipart path. These tables track a file
-- being uploaded in parts, so the client can send it in pieces and resume where it
-- left off.
--
-- State lives in SQLite rather than on the filesystem alone so a resume survives a
-- container restart: the part files on disk are the payload, these rows are the
-- authoritative record of what has actually been accepted.

CREATE TABLE upload_sessions (
  id            TEXT PRIMARY KEY,          -- nanoid, same shape as an album uid
  album_uid     TEXT NOT NULL REFERENCES albums(uid) ON UPDATE CASCADE ON DELETE CASCADE,
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  total_bytes   INTEGER NOT NULL,
  part_size     INTEGER NOT NULL,
  total_parts   INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

-- One row per part actually written to disk. The PK makes a re-sent part
-- idempotent (upsert), which is what makes a retry safe: a client that loses its
-- connection mid-part can simply send that part again.
CREATE TABLE upload_parts (
  session_id TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
  part_no    INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,
  PRIMARY KEY (session_id, part_no)
) WITHOUT ROWID;

-- Sweeping stale sessions is by age, and listing a session's parts is by session.
CREATE INDEX idx_upload_sessions_created ON upload_sessions (created_at);
