import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { uploadResumable } from '../lib/upload';
import { useT } from '../i18n';
import { Spinner } from './Spinner';

interface Props {
  uid: string;
  onUploaded: (count: number) => void;
  onError: (message: string) => void;
}

// Every file — small or large — goes through the resumable chunked route, one at
// a time. It's a few more round trips than a single batched multipart POST, but
// each file is independent: a dropped connection costs one part (auto-retried),
// not the whole drop, and one rejected file doesn't fail the rest. It also gives
// uniform byte-level progress. The per-file size ceiling is enforced server-side
// on session creation (413), so there's no client-side cap to drift.

export function UploadZone({ uid, onUploaded, onError }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; pct: number } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;

      // Byte-based percentage across the whole drop, so the bar always moves —
      // even a single file reports its upload progress as it streams.
      const totalBytes = accepted.reduce((sum, f) => sum + f.size, 0) || 1;
      let sentBase = 0; // bytes fully sent by completed files
      const pctAt = (inFlight: number) =>
        Math.min(100, Math.round(((sentBase + inFlight) / totalBytes) * 100));

      setBusy(true);
      setProgress({ done: 0, total: accepted.length, pct: 0 });
      try {
        let done = 0;
        let failures = 0;

        for (const file of accepted) {
          if (accepted.length > 1) setDetail(file.name);
          try {
            await uploadResumable(uid, file, {
              onProgress: (sent) =>
                setProgress({ done, total: accepted.length, pct: pctAt(sent) }),
            });
          } catch (err) {
            // One file failing must not abandon the rest of the drop.
            failures += 1;
            onError(
              `${file.name}: ${err instanceof Error ? err.message : t('upload.failed')}`,
            );
          }
          sentBase += file.size;
          done += 1;
          setDetail(null);
          setProgress({ done, total: accepted.length, pct: pctAt(0) });
        }

        const succeeded = accepted.length - failures;
        if (succeeded > 0) onUploaded(succeeded);
      } finally {
        setBusy(false);
        setProgress(null);
        setDetail(null);
      }
    },
    [uid, onUploaded, onError, t],
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
            {progress ? t('upload.uploadingPct', { pct: progress.pct }) : t('upload.uploading')}
          </div>
          {progress && (
            <span className="text-xs">
              {detail ?? t('upload.fileProgress', { done: progress.done, total: progress.total })}
            </span>
          )}
        </div>
      ) : (
        <>
          <p className="font-medium">{t('upload.drop')}</p>
          <p className="text-sm text-muted">{t('upload.chooseHint')}</p>
        </>
      )}
    </div>
  );
}
