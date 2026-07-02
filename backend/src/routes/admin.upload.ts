import { renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { env } from '../env.js';
import { newStoredFilename } from '../lib/ids.js';
import { originalsDir, safeJoin, thumbsDir } from '../lib/paths.js';
import { makeThumbnail, sniffImageKind } from '../lib/images.js';
import { stripAllMetadata } from '../lib/exif.js';
import { UidParams, UidPhotoParams } from '../schemas/common.js';
import type { AlbumRow, PhotoRow } from '../db/types.js';

interface Prepared {
  tmpOriginal: string;
  tmpThumb: string;
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

      const prepared: Prepared[] = [];
      const tmpThumbs: string[] = [];

      try {
        // Phase A — validate: magic-byte sniff + full decode to a thumbnail.
        // Any failure rejects the ENTIRE upload; nothing is persisted.
        for (const file of saved) {
          const kind = await sniffImageKind(file.filepath);
          if (!kind) {
            return reply.code(415).send({ error: `Unsupported file type: ${file.filename}` });
          }
          const storedFilename = newStoredFilename(kind);
          const thumbName = newStoredFilename('webp');
          const tmpThumb = join(env.tmpDir, thumbName);
          tmpThumbs.push(tmpThumb);

          const { width, height } = await makeThumbnail(file.filepath, tmpThumb);
          prepared.push({
            tmpOriginal: file.filepath,
            tmpThumb,
            storedFilename,
            thumbName,
            originalName: file.filename,
            width,
            height,
            bytes: statSync(file.filepath).size,
          });
        }

        // Phase B — strip metadata from the originals (default on, lossless).
        if (album.exif_strip === 1) {
          for (const item of prepared) await stripAllMetadata(item.tmpOriginal);
        }

        // Phase C — commit: atomic same-fs renames into place, then one DB txn.
        const moved: string[] = [];
        try {
          for (const item of prepared) {
            const finalOriginal = safeJoin(originalsDir(uid), item.storedFilename);
            const finalThumb = safeJoin(thumbsDir(uid), item.thumbName);
            renameSync(item.tmpOriginal, finalOriginal);
            moved.push(finalOriginal);
            renameSync(item.tmpThumb, finalThumb);
            moved.push(finalThumb);
          }
          const insert = app.db.prepare(
            `INSERT INTO photos
               (album_uid, stored_filename, original_name, thumb_path, width, height, bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      } finally {
        // Clean up any thumbnails still in the temp dir (already-moved ones ENOENT).
        for (const t of tmpThumbs) {
          try {
            rmSync(t, { force: true });
          } catch {
            /* ignore */
          }
        }
      }

      return reply.code(201).send({ uploaded: prepared.length });
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
