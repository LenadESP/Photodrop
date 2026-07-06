// One-off maintenance: (re)generate the display derivative for every 'ready'
// photo — e.g. to backfill photos uploaded before display derivatives existed,
// or to re-render them after DISPLAY_SIZE changes. Run inside the container:
//
//   docker exec apps-photodrop node dist/scripts/backfill-display.js [--force]
//
// Without --force, photos that already have a display file are skipped. Each
// image is written to a temp file and atomically renamed into place, so a live
// /display request never sees a half-written file.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { openDatabase } from '../db/index.js';
import { makeDisplay } from '../lib/images.js';
import { displayDir, originalsDir, safeJoin } from '../lib/paths.js';
import type { PhotoRow } from '../db/types.js';

const force = process.argv.includes('--force');
const db = openDatabase();
const photos = db
  .prepare("SELECT * FROM photos WHERE thumb_status = 'ready' ORDER BY album_uid, id")
  .all() as PhotoRow[];

let generated = 0;
let skipped = 0;
let failed = 0;

for (const p of photos) {
  const dir = displayDir(p.album_uid);
  const dest = safeJoin(dir, p.thumb_path);
  if (!force && existsSync(dest)) {
    skipped++;
    continue;
  }
  const src = safeJoin(originalsDir(p.album_uid), p.stored_filename);
  const tmp = `${dest}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    await makeDisplay(src, tmp);
    renameSync(tmp, dest); // atomic swap — never serve a partial file
    generated++;
  } catch (err) {
    failed++;
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    console.error(`FAIL photo ${p.id} (album ${p.album_uid}): ${(err as Error).message}`);
  }
}

console.log(
  `Backfill done — generated ${generated}, skipped ${skipped}, failed ${failed}, total ${photos.length}.`,
);
db.close();
