import { randomBytes } from 'node:crypto';
import { customAlphabet } from 'nanoid';

// URL-safe alphanumeric. 14 chars over a 62-symbol alphabet ≈ 83 bits of
// entropy — opaque and non-enumerable.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const UID_LENGTH = 14;
const nano = customAlphabet(ALPHABET, UID_LENGTH);

export const UID_PATTERN = /^[0-9A-Za-z]{14}$/;

export function newAlbumUid(): string {
  return nano();
}

export function isValidUid(uid: string): boolean {
  return UID_PATTERN.test(uid);
}

// Randomised on-disk name, decoupled from any user-supplied filename.
export function newStoredFilename(ext: string): string {
  return `${randomBytes(16).toString('hex')}.${ext}`;
}
