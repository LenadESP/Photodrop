import { rmSync } from 'node:fs';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { makeThumbnail } from '../lib/images.js';
import { stripAllMetadata } from '../lib/exif.js';
import { originalsDir, safeJoin, thumbsDir } from '../lib/paths.js';
import type { AlbumRow, PhotoRow } from '../db/types.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Nudge the worker to drain the pending queue. Safe to call repeatedly; a
    // drain already in progress is not duplicated.
    kickThumbnailer: () => void;
  }
}

// Background thumbnail worker. Uploads persist photos as 'pending' after a cheap
// header validation; here we do the heavy work — full decode + resize + EXIF
// strip — one photo at a time (sharp.concurrency(1) already bounds native work,
// and the await between photos keeps the event loop responsive). The photos row
// IS the queue, so a crash mid-batch just leaves rows 'pending' for the next
// boot to reprocess.
export default fp(async function thumbnailerPlugin(app: FastifyInstance): Promise<void> {
  let draining = false;
  let stopped = false;

  const nextPending = (): PhotoRow | undefined =>
    app.db
      .prepare("SELECT * FROM photos WHERE thumb_status = 'pending' ORDER BY created_at, id LIMIT 1")
      .get() as PhotoRow | undefined;

  async function processOne(photo: PhotoRow): Promise<void> {
    const album = app.db.prepare('SELECT * FROM albums WHERE uid = ?').get(photo.album_uid) as
      | AlbumRow
      | undefined;
    const original = safeJoin(originalsDir(photo.album_uid), photo.stored_filename);
    const thumb = safeJoin(thumbsDir(photo.album_uid), photo.thumb_path);

    try {
      await makeThumbnail(original, thumb); // full decode — the definitive gate
      if (album && album.exif_strip === 1) await stripAllMetadata(original);
      app.db.prepare("UPDATE photos SET thumb_status = 'ready' WHERE id = ?").run(photo.id);
    } catch (err) {
      // A file that fails a full decode here is corrupt or hostile: drop it
      // entirely (row + on-disk files) rather than leave a broken photo behind.
      app.log.warn({ err, photoId: photo.id }, 'thumbnail generation failed; removing photo');
      app.db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
      for (const p of [original, thumb]) {
        try {
          rmSync(p, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let photo = nextPending(); photo && !stopped; photo = nextPending()) {
        await processOne(photo);
      }
    } finally {
      draining = false;
    }
  }

  app.decorate('kickThumbnailer', () => {
    void drain();
  });

  app.addHook('onClose', async () => {
    stopped = true;
  });

  // Boot reconciliation: process anything left 'pending' by a crash or a restart
  // mid-batch. Runs once everything is wired up.
  app.addHook('onReady', async () => {
    void drain();
  });
});
