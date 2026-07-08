import { statfs } from 'node:fs/promises';

// Free space (bytes) available to an unprivileged user on the filesystem holding
// `path`. Used as a pre-upload guard so a nearly-full volume can't leave SQLite
// unable to write its WAL (which risks DB corruption).
export async function freeBytes(path: string): Promise<number> {
  const s = await statfs(path);
  return s.bavail * s.bsize;
}

// Usage of the filesystem holding `path`, matching what `df` reports: the used
// percentage is relative to the space usable by an unprivileged process
// (used / (used + available)), so reserved-root blocks don't skew it.
export async function diskUsage(
  path: string,
): Promise<{ freeBytes: number; totalBytes: number; usedPct: number }> {
  const s = await statfs(path);
  const free = s.bavail * s.bsize; // available to unprivileged users
  const used = (s.blocks - s.bfree) * s.bsize; // blocks currently in use
  const usable = used + free;
  return {
    freeBytes: free,
    totalBytes: s.blocks * s.bsize,
    usedPct: usable > 0 ? Math.round((used / usable) * 100) : 0,
  };
}
