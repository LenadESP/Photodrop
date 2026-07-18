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

// ffmpeg writes scratch data next to its output. That MUST be the data volume:
// /tmp in this container is a tmpfs, i.e. RAM counted against the 1500m ceiling,
// and a few hundred MB of transcode scratch there would OOM-kill the process.
const ffmpegEnv = { ...process.env, TMPDIR: env.tmpDir };

// Real type from the ISO base-media `ftyp` box, never the extension or the
// client-supplied mimetype. Bytes 4..8 are the box type; the four after it are
// the major brand.
export async function sniffVideoKind(filePath: string): Promise<VideoKind | null> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    if (bytesRead < 12) return null;
    if (buf.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
    const brand = buf.subarray(8, 12).toString('latin1');
    if (brand === 'qt  ') return 'mov';
    // Everything else we accept is an MP4 flavour; anything unrecognised is
    // refused rather than guessed at.
    const mp4Brands = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'mp4v', 'M4V ', 'dash'];
    return mp4Brands.includes(brand) ? 'mp4' : null;
  } finally {
    await fh.close();
  }
}

export interface VideoProbe {
  kind: VideoKind;
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  side_data_list?: { rotation?: number }[];
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
      { env: ffmpegEnv, maxBuffer: 8 * 1024 * 1024, timeout: 60 * 60_000 },
    );
    await rename(temp, destPath);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}
