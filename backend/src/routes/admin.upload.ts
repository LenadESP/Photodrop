import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { env } from '../env.js';
import { freeBytes } from '../lib/disk.js';
import { displayDir, originalsDir, previewDir, safeJoin, thumbsDir } from '../lib/paths.js';
import { ingestFiles } from '../lib/ingest.js';
import { UidParams, UidPhotoParams } from '../schemas/common.js';
import { ResolvePhotoBody } from '../schemas/albums.js';
import type { AlbumRow, ErrorCode, PhotoRow } from '../db/types.js';
import type { MessageKey } from '../i18n/locales/en.js';

// Message key for a persisted error_code. The raw exiftool/ffmpeg output is only
// ever logged; this is the only failure text that leaves the server. A 'failed'
// row from before error_code existed (NULL) falls through to the generic case.
// Unlike the reply.fail() path this text rides in a 200 body, so it is
// translated explicitly against the request locale.
const ERROR_KEYS: Record<NonNullable<ErrorCode>, MessageKey> = {
  metadata_timeout: 'media.metadataTimeout',
  metadata_failed: 'media.metadataFailed',
  poster_failed: 'media.posterFailed',
  unknown: 'media.processingFailed',
};
const errorKey = (code: ErrorCode): MessageKey =>
  (code && ERROR_KEYS[code]) || ERROR_KEYS.unknown;

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
      if (!album) return reply.fail(404, 'error.notFound');

      // Disk-full guard: refuse the upload before writing anything if the data
      // volume is below the free-space floor, so a full disk can't leave SQLite
      // unable to write its WAL (a DB-corruption risk).
      if ((await freeBytes(env.dataDir)) < env.minFreeBytes) {
        return reply.fail(507, 'upload.insufficientStorage');
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
          return reply.fail(413, 'upload.limitExceeded');
        }
        throw err;
      }

      const saved = req.savedRequestFiles ?? [];
      if (saved.length === 0) return reply.fail(400, 'upload.noFiles');

      // Validate + commit via the shared ingest path (same gate the resumable
      // chunked route uses).
      const outcome = await ingestFiles(
        app,
        uid,
        saved.map((f) => ({ tmpPath: f.filepath, originalName: f.filename })),
      );
      if (!outcome.ok) return reply.fail(outcome.status, outcome.key, { params: outcome.params });
      return reply.code(202).send({ uploaded: outcome.count, pending: true });
    },
  );

  app.delete(
    '/api/admin/albums/:uid/photos/:id',
    { preHandler: app.requireAdmin, schema: { params: UidPhotoParams } },
    async (req, reply) => {
      const { uid, id } = req.params as Static<typeof UidPhotoParams>;
      if (!getOwned(uid, req.user.sub)) return reply.fail(404, 'error.notFound');
      const photo = app.db.prepare('SELECT * FROM photos WHERE id = ? AND album_uid = ?').get(id, uid) as
        | PhotoRow
        | undefined;
      if (!photo) return reply.fail(404, 'error.notFound');

      app.db.prepare('DELETE FROM photos WHERE id = ? AND album_uid = ?').run(id, uid);
      for (const p of [
        safeJoin(originalsDir(uid), photo.stored_filename),
        safeJoin(thumbsDir(uid), photo.thumb_path),
        safeJoin(displayDir(uid), photo.thumb_path),
        // Video preview derivatives are named from the row id, not thumb_path.
        safeJoin(previewDir(uid), `${photo.id}.mp4`),
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

  // ── Admin photo list (with processing status + failure reason) ────────────
  // The gallery's public /api/a/:uid deliberately hides the internal error; the
  // dashboard needs it to render the failed-item card and its actions. Scoped to
  // an album the caller owns — no cross-owner read.
  app.get(
    '/api/admin/albums/:uid/photos',
    { preHandler: app.requireAdmin, schema: { params: UidParams } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      if (!getOwned(uid, req.user.sub)) return reply.fail(404, 'error.notFound');

      const photos = app.db
        .prepare(
          `SELECT id, original_name, thumb_status, kind, duration_ms, error_code
             FROM photos WHERE album_uid = ? ORDER BY created_at, id`,
        )
        .all(uid) as Pick<
        PhotoRow,
        'id' | 'original_name' | 'thumb_status' | 'kind' | 'duration_ms' | 'error_code'
      >[];

      return {
        photos: photos.map((p) => ({
          id: p.id,
          name: p.original_name,
          kind: p.kind,
          durationMs: p.duration_ms,
          status: p.thumb_status, // 'pending' | 'ready' | 'failed'
          ready: p.thumb_status === 'ready',
          failed: p.thumb_status === 'failed',
          error: p.thumb_status === 'failed' ? req.t(errorKey(p.error_code)) : null,
          // Stable identity for the failure, independent of the rendered text.
          errorCode: p.thumb_status === 'failed' ? errorKey(p.error_code) : null,
        })),
      };
    },
  );

  // ── Resolve a failed photo: retry, or accept ("upload anyway") ────────────
  // Only a currently-failed photo can be resolved — a 'ready' or still-'pending'
  // row is left untouched (409), so this can't be used to force-reprocess or to
  // clobber a healthy item. Both actions requeue the file for the worker.
  app.post(
    '/api/admin/albums/:uid/photos/:id/resolve',
    { preHandler: app.requireAdmin, schema: { params: UidPhotoParams, body: ResolvePhotoBody } },
    async (req, reply) => {
      const { uid, id } = req.params as Static<typeof UidPhotoParams>;
      const { action } = req.body as Static<typeof ResolvePhotoBody>;
      if (!getOwned(uid, req.user.sub)) return reply.fail(404, 'error.notFound');

      const photo = app.db
        .prepare('SELECT * FROM photos WHERE id = ? AND album_uid = ?')
        .get(id, uid) as PhotoRow | undefined;
      if (!photo) return reply.fail(404, 'error.notFound');
      if (photo.thumb_status !== 'failed') {
        return reply.fail(409, 'media.photoNotFailed');
      }

      // accept = "upload anyway": reprocess WITHOUT the metadata strip, so the
      // original keeps its tags. retry = reprocess as-is (strip included).
      const skipStrip = action === 'accept' ? 1 : 0;
      // Re-queue: back to 'pending' clears the error and lets the worker pick it
      // up. A video also re-queues its preview transcode (poster stage first).
      const previewStatus = photo.kind === 'video' ? 'pending' : null;
      app.db
        .prepare(
          `UPDATE photos
              SET thumb_status = 'pending', error_code = NULL,
                  skip_strip = ?, preview_status = ?
            WHERE id = ? AND album_uid = ?`,
        )
        .run(skipStrip, previewStatus, id, uid);

      app.kickThumbnailer();
      return { ok: true };
    },
  );
}
