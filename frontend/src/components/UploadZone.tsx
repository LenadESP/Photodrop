import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { api } from '../lib/api';
import { Spinner } from './Spinner';

interface Props {
  uid: string;
  onUploaded: (count: number) => void;
  onError: (message: string) => void;
}

// Chunk large drops by total size so each request stays under Cloudflare's
// ~100 MB tunnel limit, and by count so it stays under the backend's per-request
// cap (40). A single file over MAX_CHUNK_BYTES becomes its own request (and is
// rejected by the backend's 50 MB per-file cap if too large).
const MAX_CHUNK_BYTES = 90 * 1024 * 1024;
const MAX_CHUNK_FILES = 30;

function chunkFiles(files: File[]): File[][] {
  const chunks: File[][] = [];
  let current: File[] = [];
  let bytes = 0;
  for (const f of files) {
    if (current.length > 0 && (bytes + f.size > MAX_CHUNK_BYTES || current.length >= MAX_CHUNK_FILES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += f.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function UploadZone({ uid, onUploaded, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;
      setBusy(true);
      setProgress({ done: 0, total: accepted.length });
      try {
        let done = 0;
        for (const chunk of chunkFiles(accepted)) {
          const form = new FormData();
          for (const f of chunk) form.append('files', f, f.name);
          await api(`/api/admin/albums/${uid}/photos`, { method: 'POST', form });
          done += chunk.length;
          setProgress({ done, total: accepted.length });
        }
        onUploaded(accepted.length);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [uid, onUploaded, onError],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [] },
    disabled: busy,
  });

  return (
    <div
      {...getRootProps()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
        isDragActive ? 'border-ink bg-ink/5' : 'border-line hover:border-ink/40'
      }`}
    >
      <input {...getInputProps()} />
      {busy ? (
        <div className="flex items-center gap-2 text-muted">
          <Spinner />
          {progress ? `Uploading ${progress.done}/${progress.total}…` : 'Uploading…'}
        </div>
      ) : (
        <>
          <p className="font-medium">Drop photos here</p>
          <p className="text-sm text-muted">or click to choose — JPG, PNG, WebP</p>
        </>
      )}
    </div>
  );
}
