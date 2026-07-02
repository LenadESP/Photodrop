import { open } from 'node:fs/promises';
import sharp from 'sharp';
import { env } from '../env.js';

// 2017 dual-core CPU + a hard memory ceiling: never decode two images at once,
// and don't hold a pixel cache.
sharp.concurrency(1);
sharp.cache(false);

export type ImageKind = 'jpg' | 'png' | 'webp';

const THUMB_SIZE = 480;

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
