import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { api } from '../lib/api';
import { uploadResumable, type UploadLimits } from '../lib/upload';
import { Spinner } from './Spinner';

interface Props {
  uid: string;
  onUploaded: (count: number) => void;
  onError: (message: string) => void;
}

// Small files still go up as batched multipart requests — it's far fewer round
// trips than one session per photo. Anything at or over the server's per-file cap
// can't use that path at all (it would 413), so it goes through the resumable
// chunked route instead. The threshold comes from /api/config rather than a
// constant here, so it can't drift away from what the server actually enforces.
const MAX_CHUNK_BYTES = 90 * 1024 * 1024;
const MAX_CHUNK_FILES = 30;
// Used only until /api/config answers; deliberately conservative.
const FALLBACK_MAX_FILE_BYTES = 50 * 1024 * 1024;

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
  const [detail, setDetail] = useState<string | null>(null);
  const [limits, setLimits] = useState<UploadLimits | null>(null);

  useEffect(() => {
    api<UploadLimits>('/api/config')
      .then(setLimits)
      .catch(() => setLimits(null)); // fall back to the conservative constant
  }, []);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;
      const perFileCap = limits?.maxFileBytes ?? FALLBACK_MAX_FILE_BYTES;
      const big = accepted.filter((f) => f.size >= perFileCap);
      const small = accepted.filter((f) => f.size < perFileCap);

      setBusy(true);
      setProgress({ done: 0, total: accepted.length });
      try {
        let done = 0;

        for (const chunk of chunkFiles(small)) {
          const form = new FormData();
          for (const f of chunk) form.append('files', f, f.name);
          await api(`/api/admin/albums/${uid}/photos`, { method: 'POST', form });
          done += chunk.length;
          setProgress({ done, total: accepted.length });
        }

        // Large files go one at a time, in parts, with byte-level progress —
        // a single file here can be minutes of upload.
        for (const file of big) {
          await uploadResumable(uid, file, {
            onProgress: (sent, total) => {
              setDetail(`${file.name} — ${Math.round((sent / total) * 100)}%`);
            },
          });
          done += 1;
          setDetail(null);
          setProgress({ done, total: accepted.length });
        }

        onUploaded(accepted.length);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setBusy(false);
        setProgress(null);
        setDetail(null);
      }
    },
    [uid, onUploaded, onError, limits],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Match on extension as well as MIME type. The browser derives a file's type
    // from its extension, and for some camera files (Sony XAVC .MP4) it reports
    // an empty type — which matches no MIME key and would drop the file silently
    // before it is ever sent. Listing the extensions accepts it regardless.
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'video/mp4': ['.mp4', '.m4v'],
      'video/quicktime': ['.mov'],
    },
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
        <div className="flex flex-col items-center gap-1 text-muted">
          <div className="flex items-center gap-2">
            <Spinner />
            {progress ? `Uploading ${progress.done}/${progress.total}…` : 'Uploading…'}
          </div>
          {detail && <span className="text-xs">{detail}</span>}
        </div>
      ) : (
        <>
          <p className="font-medium">Drop photos or video here</p>
          <p className="text-sm text-muted">or click to choose — JPG, PNG, WebP, MP4, MOV</p>
        </>
      )}
    </div>
  );
}
