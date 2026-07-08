-- Album link expiry. NULL = never expires — the default, and the behaviour of
-- every album that existed before this migration. When set (epoch ms), the
-- album's link stops working at that instant, and the maintenance pass then
-- permanently deletes the album (DB row + on-disk files).
ALTER TABLE albums ADD COLUMN expires_at INTEGER;

CREATE INDEX idx_albums_expires ON albums(expires_at) WHERE expires_at IS NOT NULL;
