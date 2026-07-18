import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { diskUsage } from '../lib/disk.js';
import { notify } from '../lib/notify.js';
import { albumDir, displayDir, originalsDir, previewDir, safeJoin, thumbsDir, uploadSessionDir } from '../lib/paths.js';
import { isValidUid } from '../lib/ids.js';

const HOUR = 60 * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = HOUR; // expiry + disk pass cadence
const DISK_ALERT_COOLDOWN_MS = 6 * HOUR; // don't re-alert more often than this

interface FileRow {
  id: number;
  album_uid: string;
  stored_filename: string;
  thumb_path: string;
}

// Every on-disk name a surviving row lays claim to. originals/ uses
// stored_filename, thumbs/ and display/ share thumb_path, and a video's preview
// is named from the row id — so the id has to be in the set too, or the sweep
// would delete every preview as unreferenced.
function claimedNames(row: { id: number; stored_filename: string; thumb_path: string }): string[] {
  return [row.stored_filename, row.thumb_path, `${row.id}.mp4`];
}

// Boot-time storage reconciliation after an interrupted upload or a crash:
//   1. Clear tmp/ — anything staged there belongs to a request that never
//      finished.
//   2. Drop photo rows whose original is gone: the original is the source of
//      truth (thumbnail/display are regenerated from it, and only it is served),
//      so a row without one is dead weight.
//   3. Delete on-disk files no surviving row references — leaked when a commit
//      was interrupted between moving originals into place and inserting rows.
// Runs before the thumbnailer's drain, so a 'pending' row whose original is
// present is left untouched for the worker to process.
export function orphanSweep(app: FastifyInstance): void {
  // 1 — upload staging
  try {
    for (const name of readdirSync(env.tmpDir)) {
      rmSync(join(env.tmpDir, name), { recursive: true, force: true });
    }
  } catch (err) {
    app.log.warn({ err }, 'maintenance: tmp sweep failed');
  }

  let droppedRows = 0;
  let deletedFiles = 0;

  // 2 — rows missing their original
  const rows = app.db
    .prepare('SELECT id, album_uid, stored_filename, thumb_path FROM photos')
    .all() as FileRow[];
  for (const p of rows) {
    if (existsSync(safeJoin(originalsDir(p.album_uid), p.stored_filename))) continue;
    app.db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
    for (const f of [
      safeJoin(thumbsDir(p.album_uid), p.thumb_path),
      safeJoin(displayDir(p.album_uid), p.thumb_path),
      safeJoin(previewDir(p.album_uid), `${p.id}.mp4`),
    ]) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* ignore */
      }
    }
    droppedRows++;
  }

  // 3 — files no row references. Rebuild the reference set from surviving rows;
  // thumbs/ and display/ share the row's thumb_path, originals/ its
  // stored_filename.
  const ref = new Map<string, Set<string>>();
  const survivors = app.db
    .prepare('SELECT id, album_uid, stored_filename, thumb_path FROM photos')
    .all() as FileRow[];
  for (const r of survivors) {
    let set = ref.get(r.album_uid);
    if (!set) {
      set = new Set();
      ref.set(r.album_uid, set);
    }
    for (const name of claimedNames(r)) set.add(name);
  }
  let uids: string[] = [];
  try {
    uids = readdirSync(env.albumsDir);
  } catch {
    /* albums dir may not exist yet on a fresh deploy */
  }
  for (const uid of uids) {
    if (!isValidUid(uid)) continue; // ignore stray non-album entries
    const referenced = ref.get(uid) ?? new Set<string>();
    for (const sub of [originalsDir(uid), thumbsDir(uid), displayDir(uid), previewDir(uid)]) {
      let files: string[] = [];
      try {
        files = readdirSync(sub);
      } catch {
        continue;
      }
      for (const name of files) {
        if (referenced.has(name)) continue;
        try {
          rmSync(join(sub, name), { force: true });
          deletedFiles++;
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (droppedRows || deletedFiles) {
    app.log.warn({ droppedRows, deletedFiles }, 'maintenance: reconciled orphaned storage');
  }
}

// Permanently delete every album past its expiry: the DB row (photos +
// assignments cascade) and the whole album directory. Idempotent.
export function expirySweep(app: FastifyInstance): void {
  const expired = app.db
    .prepare('SELECT uid FROM albums WHERE expires_at IS NOT NULL AND expires_at <= ?')
    .all(Date.now()) as { uid: string }[];
  for (const { uid } of expired) {
    app.db.prepare('DELETE FROM albums WHERE uid = ?').run(uid);
    try {
      rmSync(albumDir(uid), { recursive: true, force: true });
    } catch (err) {
      app.log.warn({ err, uid }, 'maintenance: expired album dir removal failed');
    }
    app.log.info({ uid }, 'maintenance: deleted expired album');
  }
}

// Reclaim abandoned resumable uploads: sessions nobody completed, and part
// directories with no session row behind them.
//
// Note this deliberately does NOT run as part of the boot sweep above, and the
// parts do not live under tmp/. A restart mid-upload must leave the parts intact
// — surviving that is the entire point of resumability — so staleness is decided
// by age, not by the fact that the process restarted.
export function uploadSweep(app: FastifyInstance): void {
  let dropped = 0;
  const cutoff = Date.now() - env.staleUploadMs;
  const stale = app.db
    .prepare('SELECT id FROM upload_sessions WHERE created_at <= ?')
    .all(cutoff) as { id: string }[];
  for (const { id } of stale) {
    app.db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(id);
    try {
      rmSync(uploadSessionDir(id), { recursive: true, force: true });
    } catch (err) {
      app.log.warn({ err, sessionId: id }, 'maintenance: stale upload dir removal failed');
    }
    dropped++;
  }

  // Directories with no surviving session row — left behind if a delete was
  // interrupted between removing the row and removing the files.
  const live = new Set(
    (app.db.prepare('SELECT id FROM upload_sessions').all() as { id: string }[]).map((r) => r.id),
  );
  let orphanDirs = 0;
  let dirs: string[] = [];
  try {
    dirs = readdirSync(env.uploadsDir);
  } catch {
    /* uploads dir may not exist yet */
  }
  for (const name of dirs) {
    if (!isValidUid(name) || live.has(name)) continue;
    try {
      rmSync(join(env.uploadsDir, name), { recursive: true, force: true });
      orphanDirs++;
    } catch {
      /* ignore */
    }
  }

  if (dropped || orphanDirs) {
    app.log.info({ staleSessions: dropped, orphanDirs }, 'maintenance: reclaimed abandoned uploads');
  }
}

let lastDiskAlert = 0;

// Warn (once per cooldown) when the data volume crosses the usage threshold.
async function diskCheck(app: FastifyInstance): Promise<void> {
  try {
    const { usedPct, freeBytes, totalBytes } = await diskUsage(env.dataDir);
    if (usedPct < env.diskAlertPct) return;
    if (Date.now() - lastDiskAlert < DISK_ALERT_COOLDOWN_MS) return;
    lastDiskAlert = Date.now();
    const gib = (n: number) => (n / 1024 ** 3).toFixed(1);
    const sent = await notify({
      title: 'photodrop: disk almost full',
      message: `Data volume is ${usedPct}% full (${gib(freeBytes)} GiB free of ${gib(totalBytes)} GiB). Uploads are refused below ${gib(env.minFreeBytes)} GiB free.`,
      priority: 'high',
      tags: 'warning,floppy_disk',
    });
    app.log.warn({ usedPct, freeBytes, sent }, 'maintenance: disk usage over threshold');
  } catch (err) {
    app.log.warn({ err }, 'maintenance: disk check failed');
  }
}

// Registered before the thumbnailer so the boot reconciliation completes before
// the worker starts draining the pending queue.
export default fp(async function maintenancePlugin(app: FastifyInstance): Promise<void> {
  orphanSweep(app);
  expirySweep(app);
  uploadSweep(app);

  const timer = setInterval(() => {
    try {
      expirySweep(app);
    } catch (err) {
      app.log.warn({ err }, 'maintenance: expiry sweep failed');
    }
    try {
      uploadSweep(app);
    } catch (err) {
      app.log.warn({ err }, 'maintenance: upload sweep failed');
    }
    void diskCheck(app);
  }, MAINTENANCE_INTERVAL_MS);
  timer.unref(); // never keep the process alive just for maintenance

  // First disk check once serving, outside the plugin body so a slow ntfy POST
  // can't delay readiness.
  app.addHook('onReady', async () => {
    void diskCheck(app);
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
});
