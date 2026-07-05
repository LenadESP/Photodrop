import { statfs } from 'node:fs/promises';

// Free space (bytes) available to an unprivileged user on the filesystem holding
// `path`. Used as a pre-upload guard so a nearly-full volume can't leave SQLite
// unable to write its WAL (which risks DB corruption).
export async function freeBytes(path: string): Promise<number> {
  const s = await statfs(path);
  return s.bavail * s.bsize;
}
