import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { env } from '../env.js';
import { isValidUid } from './ids.js';

// Create the data subdirectories the app writes to. openDatabase() makes the DB
// dir, and album dirs are created on first album, but tmp/ (upload staging) is
// otherwise never created — so on a fresh deploy the first upload would fail
// writing to it. Make albums/ and tmp/ up front, idempotently.
export function ensureDataDirs(): void {
  for (const dir of [env.albumsDir, env.tmpDir]) {
    mkdirSync(dir, { recursive: true });
  }
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

// Resolve `name` under `base` and refuse anything that escapes it (defence in
// depth — stored filenames are already random, never user-derived).
export function safeJoin(base: string, name: string): string {
  const full = resolve(base, name);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error('path traversal blocked');
  }
  return full;
}
