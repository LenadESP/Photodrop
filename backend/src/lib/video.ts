import { execFile } from 'node:child_process';
import { open, rename, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { env } from '../env.js';

const run = promisify(execFile);

export type VideoKind = 'mp4' | 'mov';

// Preview target: 1080p at 24fps with a capped bitrate. This is a playback
// derivative only — every save, download and zip path serves the original.
const PREVIEW_HEIGHT = 1080;
const PREVIEW_WIDTH = 1920;
const PREVIEW_FPS = 24;
const PREVIEW_CRF = 30;
const PREVIEW_MAXRATE = '2M';
const PREVIEW_BUFSIZE = '4M';
const POSTER_SIZE = 480;

// This box is a 2017 dual-core with a 1.5-CPU container limit. An unbounded
// transcode saturates both cores and makes the live gallery sluggish while it
// runs, so ffmpeg gets exactly one thread and the cheapest useful preset.
const THREADS = '1';
const PRESET = 'veryfast';

// Measured on this box (6144x3456 10-bit HEVC, 60fps): the pipeline chews
// through roughly 98 megapixels of SOURCE video per second, and ~78% of that
// cost is decode, which the downscale cannot avoid — every frame is decoded at
// full resolution before the scaler ever sees it. So the cost of a preview
// tracks source pixels x fps x duration, NOT the 1080p output size.
const THROUGHPUT_MP_PER_SEC = 98;

// The most wall-clock one preview may cost. Past this we do not start at all:
// a 5-minute 6K60 clip needs ~64 min, so the old behaviour was to occupy a core
// for a full hour and then fail on timeout anyway. Failing immediately produces
// the same outcome for the viewer (original served at full resolution, no
// preview) without the wasted hour — and without the thumbnail queue, which is
// priority-at-pickup rather than preemptive, stalling behind it.
const PREVIEW_BUDGET_SEC = 20 * 60;

export class PreviewTooExpensiveError extends Error {
  constructor(estimateSec: number) {
    super(`preview would need ~${Math.round(estimateSec / 60)} min, over the ${PREVIEW_BUDGET_SEC / 60} min budget`);
    this.name = 'PreviewTooExpensiveError';
  }
}

// Seconds of wall-clock this source is expected to cost, from the measured
// throughput above. Deliberately based on the SOURCE dimensions and frame rate.
export function estimatePreviewSeconds(probe: Pick<VideoProbe, 'width' | 'height' | 'fps' | 'durationMs'>): number {
  const megapixels = (probe.width * probe.height) / 1_000_000;
  return (megapixels * probe.fps * (probe.durationMs / 1000)) / THROUGHPUT_MP_PER_SEC;
}

// ffmpeg writes scratch data next to its output. That MUST be the data volume:
// /tmp in this container is a tmpfs, i.e. RAM counted against the 1500m ceiling,
// and a few hundred MB of transcode scratch there would OOM-kill the process.
const ffmpegEnv = { ...process.env, TMPDIR: env.tmpDir };

// Brands we treat as an MP4-family container. This is a cheap pre-filter, not the
// security boundary: ffprobe and then the worker's full decode are the real gates,
// and they run regardless of what the brand claims.
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'mp4v', 'M4V ', 'dash']);

// Real type from the ISO base-media `ftyp` box, never the extension or the
// client-supplied mimetype. The box is: 4-byte size, `ftyp`, 4-byte MAJOR brand,
// 4-byte minor version, then zero or more 4-byte COMPATIBLE brands.
//
// A file must be accepted on the strength of the major brand OR any compatible
// brand (ISO/IEC 14496-12 §4.3): a professional camera declares a vendor major
// brand — Sony XAVC writes `XAVC` — while listing the standard brand it conforms
// to (`mp42`, `iso2`, …) among the compatible brands. Reading only the major
// brand rejected those files even though they announce standard compatibility one
// field over.
export async function sniffVideoKind(filePath: string): Promise<VideoKind | null> {
  const fh = await open(filePath, 'r');
  try {
    // The declared box size bounds how many compatible brands there are. Read a
    // fixed, small window and never trust the size past it — a hostile `ftyp`
    // cannot make us read or allocate arbitrarily. A real ftyp box is tens of
    // bytes; 512 covers any legitimate brand list many times over.
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    if (bytesRead < 16) return null;
    if (buf.subarray(4, 8).toString('latin1') !== 'ftyp') return null;

    const declaredSize = buf.readUInt32BE(0);
    // Brand region ends at the box boundary, clamped to what we actually read.
    // size 0 ("to end of file") falls back to the read length.
    const boxEnd = Math.min(declaredSize > 0 ? declaredSize : bytesRead, bytesRead);

    const brands: string[] = [buf.subarray(8, 12).toString('latin1')]; // major
    for (let off = 16; off + 4 <= boxEnd; off += 4) {
      brands.push(buf.subarray(off, off + 4).toString('latin1')); // compatible
    }

    // QuickTime wins if present anywhere: a `qt  ` brand means a .mov container,
    // which the worker and byte-range serving both handle.
    if (brands.includes('qt  ')) return 'mov';
    return brands.some((b) => MP4_BRANDS.has(b)) ? 'mp4' : null;
  } finally {
    await fh.close();
  }
}

export interface VideoProbe {
  kind: VideoKind;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  side_data_list?: { rotation?: number }[];
}

// ffprobe reports the frame rate as a rational string ("60/1", "30000/1001").
// Falls back to 30 rather than 0 — an unknown rate must not make an expensive
// source look free to the budget check below.
function parseFps(raw: string | undefined): number {
  if (!raw) return 30;
  const parts = raw.split('/');
  const num = Number(parts[0]);
  const den = parts.length > 1 ? Number(parts[1]) : 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 30;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : 30;
}

// Cheap ingest gate: magic bytes, then an ffprobe header read for a real video
// stream and sane dimensions. The analogue of probeImage — it never decodes the
// whole file. The definitive gate is the worker's actual transcode.
export async function probeVideo(filePath: string): Promise<VideoProbe | null> {
  const kind = await sniffVideoKind(filePath);
  if (!kind) return null;

  let parsed: { streams?: FfprobeStream[]; format?: { duration?: string } };
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { env: ffmpegEnv, maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
    );
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return null;
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) return null;

  const rawW = video.width ?? 0;
  const rawH = video.height ?? 0;
  if (rawW <= 0 || rawH <= 0) return null;

  // A rotated phone video reports its stored dimensions; report display ones so
  // the gallery lays it out the right way round, mirroring probeImage's EXIF
  // orientation handling.
  const rotation = Math.abs(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  const swap = rotation === 90 || rotation === 270;

  const durationSec = Number(parsed.format?.duration ?? 0);
  return {
    kind,
    width: swap ? rawH : rawW,
    height: swap ? rawW : rawH,
    fps: parseFps(video.r_frame_rate),
    durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : 0,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

// Single frame from a little way in — the very first frame of a phone video is
// often black while the sensor settles. Written as a webp into the same thumbs/
// directory images use, so the gallery grid needs no special case.
export async function makePoster(srcPath: string, destPath: string, durationMs: number): Promise<void> {
  const seek = durationMs > 2000 ? '1' : '0';
  const attempt = (ss: string) =>
    run(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', ss,
        '-i', srcPath,
        '-frames:v', '1',
        '-vf', `scale=min(${POSTER_SIZE}\\,iw):min(${POSTER_SIZE}\\,ih):force_original_aspect_ratio=decrease`,
        '-c:v', 'libwebp', '-quality', '80',
        '-threads', THREADS,
        destPath,
      ],
      { env: ffmpegEnv, timeout: 5 * 60_000 },
    );
  try {
    await attempt(seek);
  } catch {
    // Shorter than the seek, or unseekable — take the first frame instead.
    await attempt('0');
  }
}

// Bitrate-capped playback derivative: 1080p, 24fps, H.264 + AAC in MP4 for the
// widest browser support. Never upscales — a smaller source passes through at
// its own size.
//
// Written to a temp file and renamed into place, so a crash or a kill mid-
// transcode can never leave a truncated preview that would still be served.
export async function makePreview(srcPath: string, destPath: string): Promise<void> {
  // Refuse work that cannot finish before starting it. Without this a long 6K
  // source occupies the single transcode slot for the full timeout and then
  // fails anyway, while newly-uploaded photos sit `pending` — and a pending
  // photo is not served at all.
  const probe = await probeVideo(srcPath);
  if (probe) {
    const estimate = estimatePreviewSeconds(probe);
    if (estimate > PREVIEW_BUDGET_SEC) throw new PreviewTooExpensiveError(estimate);
  }

  const temp = `${destPath}.tmp`;
  try {
    await run(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', srcPath,
        // `?` makes the audio stream optional — a silent clip has none.
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `scale=min(${PREVIEW_WIDTH}\\,iw):min(${PREVIEW_HEIGHT}\\,ih):force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        '-r', String(PREVIEW_FPS),
        '-c:v', 'libx264', '-preset', PRESET, '-crf', String(PREVIEW_CRF),
        '-maxrate', PREVIEW_MAXRATE, '-bufsize', PREVIEW_BUFSIZE,
        '-profile:v', 'high', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
        // moov atom up front, or the browser must fetch the whole file before
        // it can start playing.
        '-movflags', '+faststart',
        '-threads', THREADS,
        // Name the container explicitly. ffmpeg otherwise infers it from the
        // output extension, and the temp file below ends in `.tmp` — which it
        // cannot map to any format, so every transcode would fail.
        '-f', 'mp4',
        temp,
      ],
      // Backstop only — the budget check above is the real bound. Sized at
      // 1.5x the budget so a source the estimate merely underrates still
      // finishes, while a pathological one cannot run for an hour.
      { env: ffmpegEnv, maxBuffer: 8 * 1024 * 1024, timeout: Math.round(PREVIEW_BUDGET_SEC * 1.5) * 1000 },
    );
    await rename(temp, destPath);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}
