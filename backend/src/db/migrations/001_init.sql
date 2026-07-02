-- photodrop initial schema (V1). Designed so the V2 client portal is purely
-- additive: users already carry roles and album_assignments already exists.

CREATE TABLE users (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  username               TEXT    NOT NULL UNIQUE,
  password_hash          TEXT    NOT NULL,
  role                   TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  totp_secret            TEXT,
  totp_enabled           INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           INTEGER,
  created_at             INTEGER NOT NULL
);

CREATE TABLE albums (
  uid            TEXT    PRIMARY KEY,            -- nanoid(14): opaque, non-enumerable
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT    NOT NULL,
  is_public      INTEGER NOT NULL DEFAULT 0,
  password_hash  TEXT,                           -- argon2id; NULL = no album password
  exif_strip     INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_albums_owner ON albums(owner_id);

CREATE TABLE photos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  album_uid        TEXT    NOT NULL REFERENCES albums(uid) ON DELETE CASCADE,
  stored_filename  TEXT    NOT NULL,             -- randomised; never derived from user input
  original_name    TEXT    NOT NULL,
  thumb_path       TEXT    NOT NULL,
  width            INTEGER,
  height           INTEGER,
  bytes            INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_photos_album ON photos(album_uid);

-- Created in V1, USED in V2 (client portal). Assignment authz is enforced
-- server-side regardless of this table's presence.
CREATE TABLE album_assignments (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_uid  TEXT    NOT NULL REFERENCES albums(uid) ON DELETE CASCADE,
  PRIMARY KEY (user_id, album_uid)
);
