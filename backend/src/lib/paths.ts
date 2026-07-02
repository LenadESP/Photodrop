import { join, resolve, sep } from 'node:path';
import { env } from '../env.js';
import { isValidUid } from './ids.js';

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
