import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { api } from '../lib/api';
import { Spinner } from './Spinner';

interface Props {
  uid: string;
  onUploaded: (count: number) => void;
  onError: (message: string) => void;
}

// Chunk large drops into bounded requests (backend caps per-request count/size).
const MAX_PER_REQUEST = 20;

export function UploadZone({ uid, onUploaded, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;
      setBusy(true);
      setProgress({ done: 0, total: accepted.length });
      try {
        for (let i = 0; i < accepted.length; i += MAX_PER_REQUEST) {
          const chunk = accepted.slice(i, i + MAX_PER_REQUEST);
          const form = new FormData();
          for (const f of chunk) form.append('files', f, f.name);
          await api(`/api/admin/albums/${uid}/photos`, { method: 'POST', form });
          setProgress({ done: Math.min(i + chunk.length, accepted.length), total: accepted.length });
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
        isDragActive ? 'border-ink bg-black/5' : 'border-line hover:border-ink/40'
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
