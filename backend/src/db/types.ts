import type { Role } from '../plugins/auth.js';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number | null; // last accepted TOTP step (replay guard)
  failed_login_attempts: number;
  locked_until: number | null;
  token_version: number; // bumped on logout to revoke outstanding sessions
  created_at: number;
}

export interface AlbumRow {
  uid: string;
  owner_id: number;
  title: string;
  is_public: number;
  password_hash: string | null;
  exif_strip: number;
  created_at: number;
  expires_at: number | null; // epoch ms; NULL = never expires
}

export interface UploadSessionRow {
  id: string;
  album_uid: string;
  owner_id: number;
  original_name: string;
  total_bytes: number;
  part_size: number;
  total_parts: number;
  created_at: number;
}

export type ThumbStatus = 'pending' | 'ready' | 'failed';

export interface PhotoRow {
  id: number;
  album_uid: string;
  stored_filename: string;
  original_name: string;
  thumb_path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  thumb_status: ThumbStatus;
  created_at: number;
}
