import { renameSync, rmSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { newStoredFilename } from './ids.js';
import { originalsDir, safeJoin } from './paths.js';
import { probeImage } from './images.js';

export interface IngestFile {
  // A file already staged on the data volume (same filesystem as albums/, so the
  // commit below is an atomic rename rather than a copy).
  tmpPath: string;
  originalName: string;
}

export type IngestOutcome =
  | { ok: true; count: number }
  | { ok: false; status: number; error: string };

interface Prepared {
  tmpOriginal: string;
  storedFilename: string;
  thumbName: string;
  originalName: string;
  width: number;
  height: number;
  bytes: number;
}

// Validate + commit a batch of staged files into an album.
//
// Shared by both upload routes — the multipart batch path and the resumable
// chunked path — so there is exactly ONE validation and commit path in the app.
// A second implementation is how a gate quietly drifts out of sync with the one
// that is actually enforced.
//
// Phase A — validate (cheap): magic-byte sniff + header-only dimension read.
// Rejects non-images, wrong types, and decompression bombs. Any failure rejects
// the ENTIRE batch; nothing is persisted. The definitive full pixel decode runs
// later in the background worker, which drops whatever fails it.
//
// Phase B — commit: atomic same-filesystem renames into place, then one DB
// transaction inserting the rows as 'pending'. Any failure rolls the moves back.
// Bytes are not served until the worker flips a row to 'ready', so an
// un-stripped original is never exposed.
//
// The caller is responsible for the disk-space guard and for cleaning up
// `tmpPath` on a rejection.
export async function ingestFiles(
  app: FastifyInstance,
  uid: string,
  files: IngestFile[],
): Promise<IngestOutcome> {
  if (files.length === 0) return { ok: false, status: 400, error: 'No files uploaded' };

  const prepared: Prepared[] = [];
  for (const file of files) {
    const probe = await probeImage(file.tmpPath);
    if (!probe) {
      return { ok: false, status: 415, error: `Unsupported or invalid image: ${file.originalName}` };
    }
    prepared.push({
      tmpOriginal: file.tmpPath,
      storedFilename: newStoredFilename(probe.kind),
      thumbName: newStoredFilename('webp'),
      originalName: file.originalName,
      width: probe.width,
      height: probe.height,
      bytes: statSync(file.tmpPath).size,
    });
  }

  const moved: string[] = [];
  try {
    for (const item of prepared) {
      const finalOriginal = safeJoin(originalsDir(uid), item.storedFilename);
      renameSync(item.tmpOriginal, finalOriginal);
      moved.push(finalOriginal);
    }
    const insert = app.db.prepare(
      `INSERT INTO photos
         (album_uid, stored_filename, original_name, thumb_path, width, height, bytes, thumb_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    );
    app.db.transaction(() => {
      const now = Date.now();
      for (const item of prepared) {
        insert.run(
          uid,
          item.storedFilename,
          item.originalName,
          item.thumbName,
          item.width,
          item.height,
          item.bytes,
          now,
        );
      }
    })();
  } catch (err) {
    // Undo any moves so a partial failure persists nothing.
    for (const p of moved) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  app.kickThumbnailer();
  return { ok: true, count: prepared.length };
}
