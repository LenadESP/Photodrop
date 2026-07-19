// Verification harness for photodrop 1.5.0 (video support).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, copyFileSync } from 'node:fs';
import { buildApp } from '/app/dist/app.js';
import { ensureDataDirs, originalsDir, previewDir, thumbsDir, safeJoin } from '/app/dist/lib/paths.js';
import sharp from 'sharp';

const run = promisify(execFile);
// exiftool is not on PATH: it ships as a vendored Perl script inside node_modules,
// which is exactly how the app itself invokes it.
const EXIFTOOL = '/app/node_modules/exiftool-vendored.pl/bin/exiftool';
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ensureDataDirs();
const app = await buildApp();
await app.ready();

// ── T0 toolchain ──────────────────────────────────────────────────────────
for (const bin of ['ffmpeg', 'ffprobe']) {
  let ok = false;
  try { await run(bin, ['-version']); ok = true; } catch { /* missing */ }
  check(`T0 ${bin} present in the image`, ok);
}

const jar = new Map();
let ip = 0;
async function req(method, url, { body, raw, range } = {}) {
  const headers = {};
  if (range) headers.range = range;
  const ck = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (ck) headers.cookie = ck;
  if (method !== 'GET' && jar.has('csrf_token')) headers['x-csrf-token'] = jar.get('csrf_token');
  if (raw !== undefined) headers['content-type'] = 'application/octet-stream';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.inject({ method, url, headers, payload: raw ?? body, remoteAddress: `10.0.${++ip & 255}.1` });
  for (const c of res.cookies ?? []) { if (c.value === '') jar.delete(c.name); else jar.set(c.name, c.value); }
  return res;
}
const admin = app.db.prepare('SELECT * FROM users WHERE username = ?').get(process.env.ADMIN_USERNAME);
jar.set('access_token', app.jwt.sign({ sub: admin.id, role: 'admin', scope: 'session', tv: admin.token_version }));
await req('GET', '/api/auth/csrf');
const created = JSON.parse((await req('POST', '/api/admin/albums', { body: { title: 'video' } })).body);
const uid = created.uid ?? created.album?.uid;
check('T0 album created', !!uid, JSON.stringify(created).slice(0, 200));

// ── Build a test video WITH GPS metadata ──────────────────────────────────
const src = '/data/sample.mp4';
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x480:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', src]);
await run(EXIFTOOL, ['-overwrite_original', '-api', 'QuickTimeUTC',
  '-UserData:GPSCoordinates=+40.4168-003.7038/', '-Make=TestPhone', src]);

async function gpsOf(file) {
  try {
    const { stdout } = await run(EXIFTOOL, ['-s', '-GPSCoordinates', '-GPSPosition', '-Make', file]);
    return stdout.trim();
  } catch { return ''; }
}
const gpsBefore = await gpsOf(src);
check('T1 test video carries GPS before upload', /GPSCoordinates/.test(gpsBefore), gpsBefore || '(none)');

// ── T2 ingest ─────────────────────────────────────────────────────────────
const { ingestFiles } = await import('/app/dist/lib/ingest.js');
copyFileSync(src, '/data/tmp/staged.mp4');
const outcome = await ingestFiles(app, uid, [{ tmpPath: '/data/tmp/staged.mp4', originalName: 'clip.mp4' }]);
check('T2a video accepted by the shared ingest gate', outcome.ok, JSON.stringify(outcome));
const vid = app.db.prepare("SELECT * FROM photos WHERE album_uid = ? AND kind = 'video'").get(uid);
check('T2b row stored as kind=video, preview pending',
  vid?.kind === 'video' && vid.preview_status === 'pending' && vid.thumb_status === 'pending',
  JSON.stringify(vid && { kind: vid.kind, t: vid.thumb_status, p: vid.preview_status }));
check('T2c dimensions and duration probed', vid?.width === 640 && vid?.height === 480 && vid?.duration_ms >= 2500,
  `${vid?.width}x${vid?.height} ${vid?.duration_ms}ms`);

// A file whose bytes are not a video is refused however it is named.
copyFileSync('/etc/hostname', '/data/tmp/fake.mp4');
const fake = await ingestFiles(app, uid, [{ tmpPath: '/data/tmp/fake.mp4', originalName: 'fake.mp4' }]);
check('T2d a non-video named .mp4 is refused (magic bytes, not the name)',
  !fake.ok && fake.status === 415, JSON.stringify(fake));

// ── T3 worker: poster, then preview ───────────────────────────────────────
app.kickThumbnailer();
for (let i = 0; i < 120; i += 1) {
  const r = app.db.prepare('SELECT thumb_status, preview_status FROM photos WHERE id = ?').get(vid.id);
  if (r.thumb_status !== 'pending' && r.preview_status !== 'pending') break;
  await sleep(1000);
}
const done = app.db.prepare('SELECT * FROM photos WHERE id = ?').get(vid.id);
check('T3a poster generated, row ready', done.thumb_status === 'ready', done.thumb_status);
check('T3b poster file exists', existsSync(safeJoin(thumbsDir(uid), done.thumb_path)));
check('T3c preview transcoded', done.preview_status === 'ready', done.preview_status);
const previewPath = safeJoin(previewDir(uid), `${done.id}.mp4`);
check('T3d preview file exists', existsSync(previewPath));

// The preview must actually be the capped derivative, not a copy.
if (existsSync(previewPath)) {
  const { stdout } = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json',
    '-show_streams', '-show_format', previewPath]);
  const pv = JSON.parse(stdout).streams.find((s) => s.codec_type === 'video');
  const fps = eval(pv.r_frame_rate); // e.g. "24/1"
  check('T3e preview is H.264', pv.codec_name === 'h264', pv.codec_name);
  check('T3f preview is 24fps (source was 30)', Math.round(fps) === 24, String(fps));
  check('T3g preview is within 1080p', pv.width <= 1920 && pv.height <= 1080, `${pv.width}x${pv.height}`);
}

// ── T4 THE PRIVACY CHECK: GPS actually gone from the served original ──────
const storedOriginal = safeJoin(originalsDir(uid), done.stored_filename);
const gpsAfter = await gpsOf(storedOriginal);
check('T4a GPS stripped from the stored video original',
  !/GPS/i.test(gpsAfter) && !/TestPhone/.test(gpsAfter), gpsAfter || '(clean)');
const gpsPreview = await gpsOf(previewPath);
check('T4b preview carries no GPS either', !/GPS/i.test(gpsPreview), gpsPreview || '(clean)');

// ── T5 serving ────────────────────────────────────────────────────────────
const prev = await req('GET', `/api/a/${uid}/preview/${done.id}`);
check('T5a /preview serves the derivative', prev.statusCode === 200 && prev.headers['content-type'] === 'video/mp4',
  `${prev.statusCode} ${prev.headers['content-type']}`);
check('T5b Accept-Ranges advertised', prev.headers['accept-ranges'] === 'bytes', prev.headers['accept-ranges']);

const ranged = await req('GET', `/api/a/${uid}/preview/${done.id}`, { range: 'bytes=0-99' });
check('T5c range request returns 206', ranged.statusCode === 206, String(ranged.statusCode));
check('T5d Content-Range is correct', /^bytes 0-99\/\d+$/.test(ranged.headers['content-range'] ?? ''),
  ranged.headers['content-range']);
check('T5e ranged body is exactly the requested slice', ranged.rawPayload.length === 100,
  String(ranged.rawPayload.length));

const suffix = await req('GET', `/api/a/${uid}/preview/${done.id}`, { range: 'bytes=-50' });
check('T5f suffix range works', suffix.statusCode === 206 && suffix.rawPayload.length === 50,
  `${suffix.statusCode} ${suffix.rawPayload.length}`);

const size = statSync(previewPath).size;
const bad = await req('GET', `/api/a/${uid}/preview/${done.id}`, { range: `bytes=${size + 10}-` });
check('T5g unsatisfiable range returns 416', bad.statusCode === 416, String(bad.statusCode));

const disp = await req('GET', `/api/a/${uid}/display/${done.id}`);
check('T5h /display 404s for video (never falls back to the huge original)',
  disp.statusCode === 404, String(disp.statusCode));

// ── T6 FULL-RES RULE: download must be the original, not the preview ──────
const dl = await req('GET', `/api/a/${uid}/download/${done.id}`);
check('T6a download serves the ORIGINAL, not the preview',
  dl.statusCode === 200 && Number(dl.headers['content-length']) === statSync(storedOriginal).size,
  `${dl.headers['content-length']} vs original ${statSync(storedOriginal).size}`);
check('T6b download is an attachment', /attachment/.test(dl.headers['content-disposition'] ?? ''));

// ── T7 album listing exposes what the client needs ────────────────────────
const listed = JSON.parse((await req('GET', `/api/a/${uid}`)).body).photos.find((p) => p.id === done.id);
check('T7 listing reports kind/duration/previewReady',
  listed.kind === 'video' && listed.previewReady === true && listed.durationMs > 0,
  JSON.stringify(listed));

// ── T8 priority: a queued photo beats a queued video transcode ────────────
// Reset the video to needing a transcode, and queue a photo behind it.
app.db.prepare("UPDATE photos SET preview_status = 'pending' WHERE id = ?").run(done.id);
const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 200, b: 90 } } })
  .jpeg().toBuffer();
const { writeFileSync } = await import('node:fs');
writeFileSync('/data/tmp/photo.jpg', jpeg);
await ingestFiles(app, uid, [{ tmpPath: '/data/tmp/photo.jpg', originalName: 'photo.jpg' }]);
const photoRow = app.db.prepare("SELECT * FROM photos WHERE album_uid = ? AND kind = 'image' ORDER BY id DESC LIMIT 1").get(uid);
app.kickThumbnailer();
// The photo thumbnail should land well before the transcode finishes.
let photoReadyBeforePreview = false;
for (let i = 0; i < 60; i += 1) {
  const p = app.db.prepare('SELECT thumb_status FROM photos WHERE id = ?').get(photoRow.id);
  const v = app.db.prepare('SELECT preview_status FROM photos WHERE id = ?').get(done.id);
  if (p.thumb_status === 'ready') { photoReadyBeforePreview = v.preview_status === 'pending'; break; }
  if (v.preview_status !== 'pending') break;
  await sleep(250);
}
check('T8 a queued photo thumbnail is processed before the video transcode', photoReadyBeforePreview);

// Let the queue settle so the preview exists again for T9.
for (let i = 0; i < 120; i += 1) {
  const v = app.db.prepare('SELECT preview_status FROM photos WHERE id = ?').get(done.id);
  if (v.preview_status !== 'pending') break;
  await sleep(1000);
}

// ── T9 sweeps and delete must respect preview files ───────────────────────
const { orphanSweep } = await import('/app/dist/plugins/maintenance.js');
orphanSweep(app);
check('T9a orphan sweep keeps a referenced preview', existsSync(previewPath));
check('T9b orphan sweep keeps the video row', !!app.db.prepare('SELECT 1 FROM photos WHERE id = ?').get(done.id));

const del = await req('DELETE', `/api/admin/albums/${uid}/photos/${done.id}`);
check('T9c delete succeeds', del.statusCode === 200, del.body);
check('T9d delete removes the preview file too', !existsSync(previewPath));

// ── T10 preview cost budget ───────────────────────────────────────────────
// Measured on this box: 6K 10-bit 60fps transcodes at ~0.079x realtime, so a
// 5-minute clip needs ~64 min. The old code had a flat 1-hour ffmpeg timeout,
// which meant such a source occupied the single transcode slot for a full hour
// and then failed anyway — while newly-uploaded photos sat `pending`, and a
// pending photo is not served at all. The budget refuses that work up front.
const { estimatePreviewSeconds, PreviewTooExpensiveError } = await import('/app/dist/lib/video.js');
const BUDGET = 20 * 60;

const realProbe = await (await import('/app/dist/lib/video.js')).probeVideo(src);
check(
  'T10a the test clip is estimated well under budget',
  estimatePreviewSeconds(realProbe) < BUDGET,
  `${estimatePreviewSeconds(realProbe).toFixed(1)}s`,
);

const bigSource = { width: 6144, height: 3456, fps: 60, durationMs: 5 * 60 * 1000 };
check(
  'T10b a 5-min 6K60 source is refused before any work starts',
  estimatePreviewSeconds(bigSource) > BUDGET,
  `${(estimatePreviewSeconds(bigSource) / 60).toFixed(1)} min estimated`,
);

// The guard must not over-reject ordinary footage — 10 minutes of 1080p30 is
// well within what this box can actually chew through.
const normalSource = { width: 1920, height: 1080, fps: 30, durationMs: 10 * 60 * 1000 };
check(
  'T10c 10 min of 1080p30 stays under budget (no over-rejection)',
  estimatePreviewSeconds(normalSource) < BUDGET,
  `${(estimatePreviewSeconds(normalSource) / 60).toFixed(1)} min estimated`,
);

check(
  'T10d an unknown frame rate does not read as free',
  estimatePreviewSeconds({ ...bigSource, fps: 30 }) > BUDGET,
  'a missing r_frame_rate must fall back to a real rate, not 0',
);

check('T10e PreviewTooExpensiveError is exported for the worker to distinguish', typeof PreviewTooExpensiveError === 'function');

await app.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
