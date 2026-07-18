import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { env } from '../env.js';
import { freeBytes } from '../lib/disk.js';
import { displayDir, originalsDir, safeJoin, thumbsDir } from '../lib/paths.js';
import { ingestFiles } from '../lib/ingest.js';
import { UidParams, UidPhotoParams } from '../schemas/common.js';
import type { AlbumRow, PhotoRow } from '../db/types.js';

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

      // Validate + commit via the shared ingest path (same gate the resumable
      // chunked route uses).
      const outcome = await ingestFiles(
        app,
        uid,
        saved.map((f) => ({ tmpPath: f.filepath, originalName: f.filename })),
      );
      if (!outcome.ok) return reply.code(outcome.status).send({ error: outcome.error });
      return reply.code(202).send({ uploaded: outcome.count, pending: true });
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
