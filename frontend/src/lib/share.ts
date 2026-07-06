// Mobile "Save to Photos" via the Web Share API (files), with a plain download
// fallback for browsers/desktops that can't share files.

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

// Returns true if the share sheet was invoked, false if the caller should fall
// back to a normal download.
export async function shareFile(url: string, filename: string): Promise<boolean> {
  if (!canShareFiles()) return false;
  try {
    const file = await fetchAsFile(url, filename);
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file] });
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

// Save many photos at once via the OS share sheet (one action → "Save N Images"
// straight into Photos). Returns false if the platform can't share multiple
// files, so the caller can fall back to individual downloads.
export async function shareFiles(items: DownloadItem[]): Promise<boolean> {
  if (!canShareFiles() || items.length === 0) return false;
  try {
    const files = await Promise.all(items.map((i) => fetchAsFile(i.url, i.name)));
    if (!navigator.canShare({ files })) return false;
    await navigator.share({ files });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    return false;
  }
}

// Desktop "Download all": a single streamed zip from the server (the browser
// saves it via the response's Content-Disposition). One file, no per-file prompts.
export function downloadAlbumZip(uid: string): void {
  downloadUrl(`/api/a/${uid}/zip`);
}
