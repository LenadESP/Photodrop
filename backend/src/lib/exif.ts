import { existsSync, rmSync } from 'node:fs';
import { ExifTool } from 'exiftool-vendored';
import { env } from '../env.js';

// Stripping metadata from a container format (MP4/MOV) rewrites the WHOLE file:
// exiftool copies every byte to move the metadata atom, so the cost is O(file
// size), not O(metadata). Measured on the target box, exiftool sustains ~32
// MB/s; we budget against a conservative 20 MB/s for headroom under a
// concurrent transcode. A fixed 20s cap (the old value) therefore timed out on
// any file over ~600 MB — a 2 GiB video needs ~60s+ — which stranded large
// videos as unservable. Size the timeout off the upload CEILING so any file the
// server will accept has enough time, floored so small files aren't rushed.
const STRIP_BYTES_PER_SEC = 20 * 1024 * 1024;
const STRIP_TIMEOUT_MS = Math.max(
  30_000,
  Math.ceil((env.maxUploadBytes / STRIP_BYTES_PER_SEC) * 1.5) * 1000,
);

// One shared exiftool process (spawns a perl interpreter — installed in the
// runtime image). -overwrite_original strips in place with no `_original`
// backup left behind in the temp dir. maxProcAgeMillis must be >= the task
// timeout (batch-cluster refuses otherwise), so it tracks it.
const exiftool = new ExifTool({
  taskTimeoutMillis: STRIP_TIMEOUT_MS,
  maxProcAgeMillis: STRIP_TIMEOUT_MS,
  writeArgs: ['-overwrite_original'],
});

// Thrown by stripAllMetadata when exiftool exceeds its per-task timeout, so the
// worker can record the specific 'metadata_timeout' code the admin UI shows.
export class MetadataTimeoutError extends Error {
  constructor(cause?: unknown) {
    super('metadata strip timed out');
    this.name = 'MetadataTimeoutError';
    this.cause = cause;
  }
}

// Lossless, metadata-only removal of ALL tags (GPS, camera serial, etc.). Pixel
// data is untouched — no re-encode, no quality loss.
export async function stripAllMetadata(filePath: string): Promise<void> {
  try {
    await exiftool.deleteAllTags(filePath);
  } catch (err) {
    // exiftool-vendored surfaces a timeout as an Error whose message mentions
    // the timeout; normalise it so the caller doesn't string-match itself.
    if (err instanceof Error && /timeout|timed out/i.test(err.message)) {
      throw new MetadataTimeoutError(err);
    }
    throw err;
  }
  // Defensive: if a backup slipped through, don't leave it in the temp dir.
  const backup = `${filePath}_original`;
  if (existsSync(backup)) rmSync(backup, { force: true });
}

export async function closeExif(): Promise<void> {
  await exiftool.end();
}
