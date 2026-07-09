// Photo delivery helpers: the single-photo "Save to Photos" via the Web Share API
// (files), and the bulk "Download all" as direct per-file browser downloads.

export function canShareFiles(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function'
  );
}

export async function fetchAsFile(url: string, filename: string): Promise<File> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}

// Share already-loaded File objects (full-resolution originals). Kept separate
// from the fetch-then-share helpers so a caller that has prepared the bytes ahead
// of time can fire the share sheet synchronously inside the tap's user-activation
// window — the difference between a reliable "Save to Photos" and a silent failure
// when a multi-MB original takes longer than that window to download.
export async function shareLoadedFiles(files: File[]): Promise<boolean> {
  if (!canShareFiles() || files.length === 0) return false;
  try {
    if (!navigator.canShare({ files })) return false;
    await navigator.share({ files });
    return true;
  } catch (err) {
    // User cancelling the sheet throws AbortError — treat as handled.
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    return false;
  }
}

export function downloadUrl(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface DownloadItem {
  url: string;
  name: string;
}

// Bulk "Download all": trigger a direct browser download of every full-resolution
// original in sequence — one hidden <a download> click per photo. Each click
// streams straight to disk, so nothing is buffered in JS. (The old share-sheet
// path fetched every original into memory at once and hung on a real album.)
// These URLs always point at /download, i.e. the full-res original — never a
// derivative or re-encode.
//
// The first file fires, then a longer pause before the rest: the browser shows a
// one-time "allow multiple downloads" prompt on the second file, and downloads
// fired while that prompt is still open can be dropped rather than queued. The gap
// gives the grant time to land so no photo goes missing on the first run.
//
// Note: an <a> click has no completion event, so `onProgress` reports downloads
// *started*, not finished — the count can reach the total while the browser is
// still writing files to disk.
export async function downloadOriginalsSequential(
  items: DownloadItem[],
  opts: {
    staggerMs?: number;
    firstGapMs?: number;
    onProgress?: (started: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const { staggerMs = 500, firstGapMs = 1800, onProgress, signal } = opts;
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let started = 0;
  for (const item of items) {
    if (signal?.aborted) return;
    downloadUrl(item.url, item.name);
    started += 1;
    onProgress?.(started, items.length);
    if (started === items.length) break;
    await delay(started === 1 ? firstGapMs : staggerMs);
  }
}

// "Download ZIP": a single streamed zip from the server (the browser saves it via
// the response's Content-Disposition). One file, no per-file prompts.
export function downloadAlbumZip(uid: string): void {
  downloadUrl(`/api/a/${uid}/zip`);
}
