import { renameSync, rmSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { env } from '../env.js';
import { freeBytes } from '../lib/disk.js';
import { newStoredFilename } from '../lib/ids.js';
import { displayDir, originalsDir, safeJoin, thumbsDir } from '../lib/paths.js';
import { probeImage } from '../lib/images.js';
import { UidParams, UidPhotoParams } from '../schemas/common.js';
import type { AlbumRow, PhotoRow } from '../db/types.js';

interface Prepared {
  tmpOriginal: string;
  storedFilename: string;
  thumbName: string;
  originalName: string;
  width: number;
  height: number;
  bytes: number;
}

export async function adminUploadRoutes(app: FastifyInstance): Promise<void> {
  const getOwned = (uid: string, ownerId: number): AlbumRow | undefined =>
    app.db.prepare('SELECT * FROM albums WHERE uid = ? AND owner_id = ?').get(uid, ownerId) as
      | AlbumRow
      | undefined;

  app.post(
    '/api/admin/albums/:uid/photos',
    { preHandler: app.requireAdmin, schema: { params: UidParams } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      const album = getOwned(uid, req.user.sub);
      if (!album) return reply.code(404).send({ error: 'Not found' });

      // Disk-full guard: refuse the upload before writing anything if the data
      // volume is below the free-space floor, so a full disk can't leave SQLite
      // unable to write its WAL (a DB-corruption risk).
      if ((await freeBytes(env.dataDir)) < env.minFreeBytes) {
        return reply.code(507).send({ error: 'Insufficient storage on the server' });
      }

      // Stream every part to the data volume (never tmpfs). An oversized file or
      // too many files throws here → the whole upload is rejected, nothing saved.
      try {
        await req.saveRequestFiles({
          tmpdir: env.tmpDir,
          limits: { fileSize: env.maxFileBytes, files: env.maxFilesPerUpload },
        });
      } catch (err) {
        if (
          err instanceof app.multipartErrors.RequestFileTooLargeError ||
          err instanceof app.multipartErrors.FilesLimitError
        ) {
          return reply.code(413).send({ error: 'Upload exceeds the size or count limit' });
        }
        throw err;
      }

      const saved = req.savedRequestFiles ?? [];
      if (saved.length === 0) return reply.code(400).send({ error: 'No files uploaded' });

      // Phase A — validate (cheap): magic-byte sniff + header-only dimension read.
      // Rejects non-images, wrong types, and decompression bombs (declared pixels
      // vs the cap). Any failure rejects the ENTIRE upload; nothing is persisted.
      // The full pixel decode — the definitive hostile-image gate — runs in the
      // background worker, which drops any file that fails it.
      const prepared: Prepared[] = [];
      for (const file of saved) {
        const probe = await probeImage(file.filepath);
        if (!probe) {
          return reply.code(415).send({ error: `Unsupported or invalid image: ${file.filename}` });
        }
        prepared.push({
          tmpOriginal: file.filepath,
          storedFilename: newStoredFilename(probe.kind),
          thumbName: newStoredFilename('webp'),
          originalName: file.filename,
          width: probe.width,
          height: probe.height,
          bytes: statSync(file.filepath).size,
        });
      }

      // Phase B — commit: atomic same-fs renames of the originals into place,
      // then one DB txn inserting rows as 'pending'. Thumbnails + EXIF strip
      // happen in the worker; bytes are NOT served until the row is 'ready', so
      // an un-stripped original is never exposed.
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
      return reply.code(202).send({ uploaded: prepared.length, pending: true });
    },
  );

  app.delete(
    '/api/admin/albums/:uid/photos/:id',
    { preHandler: app.requireAdmin, schema: { params: UidPhotoParams } },
    async (req, reply) => {
      const { uid, id } = req.params as Static<typeof UidPhotoParams>;
      if (!getOwned(uid, req.user.sub)) return reply.code(404).send({ error: 'Not found' });
      const photo = app.db.prepare('SELECT * FROM photos WHERE id = ? AND album_uid = ?').get(id, uid) as
        | PhotoRow
        | undefined;
      if (!photo) return reply.code(404).send({ error: 'Not found' });

      app.db.prepare('DELETE FROM photos WHERE id = ? AND album_uid = ?').run(id, uid);
      for (const p of [
        safeJoin(originalsDir(uid), photo.stored_filename),
        safeJoin(thumbsDir(uid), photo.thumb_path),
        safeJoin(displayDir(uid), photo.thumb_path),
      ]) {
        try {
          rmSync(p, { force: true });
        } catch {
          /* ignore */
        }
      }
      return { ok: true };
    },
  );
}
