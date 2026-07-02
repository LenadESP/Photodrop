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
