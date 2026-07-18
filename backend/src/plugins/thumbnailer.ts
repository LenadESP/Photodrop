import { mkdirSync, rmSync } from 'node:fs';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { makeDisplay, makeThumbnail } from '../lib/images.js';
import { makePoster, makePreview } from '../lib/video.js';
import { stripAllMetadata } from '../lib/exif.js';
import { displayDir, originalsDir, previewDir, safeJoin, thumbsDir } from '../lib/paths.js';
import type { AlbumRow, PhotoRow } from '../db/types.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Nudge the worker to drain the pending queue. Safe to call repeatedly; a
    // drain already in progress is not duplicated.
    kickThumbnailer: () => void;
  }
}

// Background media worker. Uploads persist rows as 'pending' after a cheap header
// validation; here we do the heavy work — full decode + resize + metadata strip
// for images, poster frame + bitrate-capped transcode for video — one item at a
// time (sharp.concurrency(1) and ffmpeg -threads 1 already bound native work, and
// the await between items keeps the event loop responsive). The photos row IS the
// queue, so a crash mid-batch just leaves rows 'pending' for the next boot.
//
// Two queues, deliberately ordered:
//
//   1. thumb_status='pending' — image thumbnails and video poster frames. Images
//      first within it (ORDER BY kind), because a photo's thumbnail is quick and
//      a viewer is waiting on it.
//   2. preview_status='pending' — video transcodes, which take minutes.
//
// Everything in queue 1 is drained before any of queue 2, and queue 1 is
// re-checked after every transcode, so newly-uploaded photos never sit behind a
// video being re-encoded. It is priority at pickup, not preemption: a transcode
// already running finishes first — ffmpeg can't be cheaply interrupted and resumed.
export default fp(async function thumbnailerPlugin(app: FastifyInstance): Promise<void> {
  let draining = false;
  let stopped = false;

  const nextPending = (): PhotoRow | undefined =>
    app.db
      .prepare(
        "SELECT * FROM photos WHERE thumb_status = 'pending' ORDER BY (kind = 'video'), created_at, id LIMIT 1",
      )
      .get() as PhotoRow | undefined;

  const nextPreview = (): PhotoRow | undefined =>
    app.db
      .prepare(
        "SELECT * FROM photos WHERE kind = 'video' AND thumb_status = 'ready' AND preview_status = 'pending' ORDER BY created_at, id LIMIT 1",
      )
      .get() as PhotoRow | undefined;

  const albumOf = (uid: string): AlbumRow | undefined =>
    app.db.prepare('SELECT * FROM albums WHERE uid = ?').get(uid) as AlbumRow | undefined;

  function dropPhoto(photo: PhotoRow, reason: string, err: unknown): void {
    app.log.warn({ err, photoId: photo.id }, reason);
    app.db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    for (const p of [
      safeJoin(originalsDir(photo.album_uid), photo.stored_filename),
      safeJoin(thumbsDir(photo.album_uid), photo.thumb_path),
      safeJoin(displayDir(photo.album_uid), photo.thumb_path),
    ]) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  async function processImage(photo: PhotoRow, album: AlbumRow | undefined): Promise<void> {
    const original = safeJoin(originalsDir(photo.album_uid), photo.stored_filename);
    const thumb = safeJoin(thumbsDir(photo.album_uid), photo.thumb_path);
    const display = safeJoin(displayDir(photo.album_uid), photo.thumb_path);
    try {
      mkdirSync(displayDir(photo.album_uid), { recursive: true }); // may predate the display dir
      await makeThumbnail(original, thumb); // full decode — the definitive gate
      await makeDisplay(original, display); // intermediate size for the lightbox
      if (album && album.exif_strip === 1) await stripAllMetadata(original);
      app.db.prepare("UPDATE photos SET thumb_status = 'ready' WHERE id = ?").run(photo.id);
    } catch (err) {
      // A file that fails a full decode here is corrupt or hostile: drop it
      // entirely (row + on-disk files) rather than leave a broken photo behind.
      dropPhoto(photo, 'thumbnail generation failed; removing photo', err);
    }
  }

  // Video, stage one: strip metadata and cut a poster frame. Both must succeed —
  // they are what makes the file safe to serve, since bytes are only served once
  // thumb_status is 'ready' and the strip is what the no-metadata-leaks guarantee
  // rests on.
  //
  // Unlike a corrupt image this does NOT delete the file. A video that ffmpeg
  // dislikes may still be a real recording the owner cares about, so the row is
  // marked 'failed': kept, visible in the dashboard, never served, deletable by
  // hand.
  async function processVideoPoster(photo: PhotoRow, album: AlbumRow | undefined): Promise<void> {
    const original = safeJoin(originalsDir(photo.album_uid), photo.stored_filename);
    const poster = safeJoin(thumbsDir(photo.album_uid), photo.thumb_path);
    try {
      if (album && album.exif_strip === 1) await stripAllMetadata(original);
      await makePoster(original, poster, photo.duration_ms ?? 0);
      app.db.prepare("UPDATE photos SET thumb_status = 'ready' WHERE id = ?").run(photo.id);
    } catch (err) {
      app.log.warn({ err, photoId: photo.id }, 'video poster/strip failed; marking unservable');
      app.db.prepare("UPDATE photos SET thumb_status = 'failed' WHERE id = ?").run(photo.id);
      try {
        rmSync(poster, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  // Video, stage two: the playback derivative. Best-effort by design — if this
  // fails the original is still delivered at full resolution, it just can't be
  // played in the browser.
  async function processVideoPreview(photo: PhotoRow): Promise<void> {
    const original = safeJoin(originalsDir(photo.album_uid), photo.stored_filename);
    const preview = safeJoin(previewDir(photo.album_uid), `${photo.id}.mp4`);
    try {
      mkdirSync(previewDir(photo.album_uid), { recursive: true });
      await makePreview(original, preview);
      app.db.prepare("UPDATE photos SET preview_status = 'ready' WHERE id = ?").run(photo.id);
      app.log.info({ photoId: photo.id }, 'video preview ready');
    } catch (err) {
      app.log.warn({ err, photoId: photo.id }, 'video preview transcode failed; original still served');
      app.db.prepare("UPDATE photos SET preview_status = 'failed' WHERE id = ?").run(photo.id);
    }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        if (stopped) return;

        // Queue 1 first, always, and completely.
        const pending = nextPending();
        if (pending) {
          const album = albumOf(pending.album_uid);
          if (pending.kind === 'video') await processVideoPoster(pending, album);
          else await processImage(pending, album);
          continue;
        }

        // Only once nothing is waiting on a thumbnail: one transcode, then back
        // to the top so a photo uploaded meanwhile jumps ahead of the next one.
        const preview = nextPreview();
        if (!preview) return;
        await processVideoPreview(preview);
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
