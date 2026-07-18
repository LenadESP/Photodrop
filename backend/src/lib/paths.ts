import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { env } from '../env.js';
import { isValidUid } from './ids.js';

// Create the data subdirectories the app writes to. openDatabase() makes the DB
// dir, and album dirs are created on first album, but tmp/ (upload staging) is
// otherwise never created — so on a fresh deploy the first upload would fail
// writing to it. Make albums/ and tmp/ up front, idempotently.
export function ensureDataDirs(): void {
  for (const dir of [env.albumsDir, env.tmpDir, env.uploadsDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

// Staging for a resumable upload's parts. Deliberately NOT under tmp/: the boot
// orphan sweep clears tmp/ wholesale, which would destroy the parts of an upload
// that was in flight across a restart — exactly the case resumability exists to
// survive. Stale sessions here are swept on their own schedule, by age, against
// the upload_sessions rows.
export function uploadSessionDir(sessionId: string): string {
  if (!isValidUid(sessionId)) throw new Error('invalid upload session id');
  return join(env.uploadsDir, sessionId);
}

// Part files are named from an integer part number, validated by the caller
// against the session's total_parts before it ever reaches the filesystem.
export function uploadPartPath(sessionId: string, partNo: number): string {
  if (!Number.isInteger(partNo) || partNo < 0) throw new Error('invalid part number');
  return safeJoin(uploadSessionDir(sessionId), `${partNo}.part`);
}

// Every album path is built from a validated uid — never from raw user input.
export function albumDir(uid: string): string {
  if (!isValidUid(uid)) throw new Error('invalid album uid');
  return join(env.albumsDir, uid);
}

export function originalsDir(uid: string): string {
  return join(albumDir(uid), 'originals');
}

export function thumbsDir(uid: string): string {
  return join(albumDir(uid), 'thumbs');
}

export function displayDir(uid: string): string {
  return join(albumDir(uid), 'display');
}

// Resolve `name` under `base` and refuse anything that escapes it (defence in
// depth — stored filenames are already random, never user-derived).
export function safeJoin(base: string, name: string): string {
  const full = resolve(base, name);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error('path traversal blocked');
  }
  return full;
}
