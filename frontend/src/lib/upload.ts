import { api } from './api';

// Resumable chunked upload for a single file.
//
// Cloudflare caps tunnel request bodies at ~100 MB, so a file bigger than that
// can't be sent as one request no matter how the batch is arranged. Here the file
// is sliced client-side and each part is its own small request, which also means
// a dropped connection costs one part rather than the whole upload.

export interface UploadLimits {
  maxFileBytes: number;
  maxUploadBytes: number;
  uploadPartBytes: number;
}

interface Session {
  id: string;
  partSize: number;
  totalParts: number;
  received: number[];
}

const PART_RETRIES = 3;
const RETRY_BASE_MS = 800;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A part that fails is retried with a widening gap before the upload gives up.
// This is the payoff of parts: a blip costs one part, not the whole file.
async function putPart(sessionId: string, partNo: number, blob: Blob, signal?: AbortSignal): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PART_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new Error('Upload cancelled');
    try {
      await api(`/api/admin/uploads/${sessionId}/parts/${partNo}`, {
        method: 'PUT',
        raw: blob,
        signal,
      });
      return;
    } catch (err) {
      lastError = err;
      if (attempt < PART_RETRIES - 1) await delay(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Part upload failed');
}

export async function uploadResumable(
  albumUid: string,
  file: File,
  opts: { onProgress?: (sentBytes: number, totalBytes: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const session = await api<Session>(`/api/admin/albums/${albumUid}/uploads`, {
    method: 'POST',
    body: { name: file.name, size: file.size },
    signal: opts.signal,
  });

  // The server reports what it already holds, so an interrupted upload restarted
  // against the same session only sends what is actually missing.
  const have = new Set(session.received);
  for (let part = 0; part < session.totalParts; part += 1) {
    if (have.has(part)) {
      opts.onProgress?.(Math.min((part + 1) * session.partSize, file.size), file.size);
      continue;
    }
    const start = part * session.partSize;
    const end = Math.min(start + session.partSize, file.size);
    await putPart(session.id, part, file.slice(start, end), opts.signal);
    opts.onProgress?.(end, file.size);
  }

  // Assembly, validation and commit all happen server-side here.
  await api(`/api/admin/uploads/${session.id}/complete`, { method: 'POST', signal: opts.signal });
}

export async function abortUpload(sessionId: string): Promise<void> {
  try {
    await api(`/api/admin/uploads/${sessionId}`, { method: 'DELETE' });
  } catch {
    /* best effort — the maintenance sweep reclaims abandoned sessions anyway */
  }
}
