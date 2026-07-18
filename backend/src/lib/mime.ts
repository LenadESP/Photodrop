const MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

export function extToMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MAP[ext] ?? 'application/octet-stream';
}

// Reduce an arbitrary original filename to a safe Content-Disposition value:
// path separators become underscores; control characters and double-quotes
// (which would break out of the quoted header value) are dropped. Spaces and
// unicode letters are preserved.
export function sanitizeDownloadName(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || ch === '"') continue;
    out += ch === '/' || ch === '\\' ? '_' : ch;
  }
  out = out.trim();
  return out.length > 0 ? out.slice(0, 200) : 'photo';
}
