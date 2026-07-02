import { existsSync, rmSync } from 'node:fs';
import { ExifTool } from 'exiftool-vendored';

// One shared exiftool process (spawns a perl interpreter — installed in the
// runtime image). -overwrite_original strips in place with no `_original`
// backup left behind in the temp dir.
const exiftool = new ExifTool({
  taskTimeoutMillis: 20_000,
  writeArgs: ['-overwrite_original'],
});

// Lossless, metadata-only removal of ALL tags (GPS, camera serial, etc.). Pixel
// data is untouched — no re-encode, no quality loss.
export async function stripAllMetadata(filePath: string): Promise<void> {
  await exiftool.deleteAllTags(filePath);
  // Defensive: if a backup slipped through, don't leave it in the temp dir.
  const backup = `${filePath}_original`;
  if (existsSync(backup)) rmSync(backup, { force: true });
}

export async function closeExif(): Promise<void> {
  await exiftool.end();
}
