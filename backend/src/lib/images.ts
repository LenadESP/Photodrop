import { open } from 'node:fs/promises';
import sharp, { type Metadata } from 'sharp';
import { env } from '../env.js';

// 2017 dual-core CPU + a hard memory ceiling: never decode two images at once,
// and don't hold a pixel cache.
sharp.concurrency(1);
sharp.cache(false);

export type ImageKind = 'jpg' | 'png' | 'webp';

const THUMB_SIZE = 480;
// Intermediate "display" derivative: longest edge, served to the lightbox so
// viewers don't fetch a full-res original to paint a ~1080p screen.
const DISPLAY_SIZE = 1920;

// Determine the real type from magic bytes. The extension and the multipart
// mimetype are attacker-controlled and ignored. SVG (XML) can never match.
export async function sniffImageKind(filePath: string): Promise<ImageKind | null> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    if (bytesRead < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return 'png';
    }
    if (
      buf[0] === 0x52 && // R
      buf[1] === 0x49 && // I
      buf[2] === 0x46 && // F
      buf[3] === 0x46 && // F
      buf[8] === 0x57 && // W
      buf[9] === 0x45 && // E
      buf[10] === 0x42 && // B
      buf[11] === 0x50 // P
    ) {
      return 'webp';
    }
    return null;
  } finally {
    await fh.close();
  }
}

export interface ImageProbe {
  kind: ImageKind;
  width: number;
  height: number;
}

// Cheap ingest-time validation: real type from magic bytes + a header-only
// dimension read (no full pixel decode). Rejects non-images, wrong types, and —
// via the declared dimensions vs the pixel cap — decompression bombs, so a
// hostile header is caught before anything is persisted. The definitive decode
// gate (a full sharp decode that trips on corrupt/hostile pixel data) runs later
// in the thumbnail worker. Returns display dimensions (EXIF orientation applied),
// or null if the file is not a valid, in-bounds image.
export async function probeImage(filePath: string): Promise<ImageProbe | null> {
  const kind = await sniffImageKind(filePath);
  if (!kind) return null;
  let meta: Metadata;
  try {
    meta = await sharp(filePath, { limitInputPixels: env.maxImagePixels }).metadata();
  } catch {
    return null;
  }
  const rawW = meta.width ?? 0;
  const rawH = meta.height ?? 0;
  if (rawW <= 0 || rawH <= 0 || rawW * rawH > env.maxImagePixels) return null;
  const swap = (meta.orientation ?? 1) >= 5;
  return { kind, width: swap ? rawH : rawW, height: swap ? rawW : rawH };
}

export interface ThumbResult {
  width: number;
  height: number;
}

// Full decode + thumbnail. This IS the validation gate: sharp must fully decode
// the file, so a corrupt/hostile/oversized image throws here and the caller
// rejects the whole upload. limitInputPixels caps decompression bombs; rotate()
// bakes EXIF orientation into the thumb; sharp drops metadata from its output by
// default, so thumbnails never carry GPS.
export async function makeThumbnail(srcPath: string, destThumbPath: string): Promise<ThumbResult> {
  const image = sharp(srcPath, { limitInputPixels: env.maxImagePixels });
  const meta = await image.metadata();

  await image
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(destThumbPath);

  // Report display dimensions (accounting for EXIF orientation swap).
  const orientation = meta.orientation ?? 1;
  const swap = orientation >= 5;
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  return { width: swap ? h : w, height: swap ? w : h };
}

// Intermediate display derivative (webp, longest edge DISPLAY_SIZE, never
// enlarged — a smaller original just passes through at its own size). Metadata is
// dropped by default, so it carries no GPS. Generated in the worker alongside the
// thumbnail; the lightbox serves this instead of the full-res original.
export async function makeDisplay(srcPath: string, destPath: string): Promise<void> {
  await sharp(srcPath, { limitInputPixels: env.maxImagePixels })
    .rotate()
    .resize(DISPLAY_SIZE, DISPLAY_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(destPath);
}
