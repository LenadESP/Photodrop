import { useEffect } from 'react';
import { Button } from './Button';
import { canShareFiles, downloadUrl, shareFile } from '../lib/share';

export interface LightboxPhoto {
  id: number;
  name: string;
}

interface Props {
  uid: string;
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}

const navBtn =
  'absolute top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20';

export function Lightbox({ uid, photos, index, onClose, onIndex }: Props) {
  const photo = photos[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex(Math.min(index + 1, photos.length - 1));
      if (e.key === 'ArrowLeft') onIndex(Math.max(index - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onClose, onIndex]);

  if (!photo) return null;
  const downloadHref = `/api/a/${uid}/download/${photo.id}`;

  const onSave = async () => {
    const shared = await shareFile(downloadHref, photo.name);
    if (!shared) downloadUrl(downloadHref, photo.name);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-sm text-white/60">
          {index + 1} / {photos.length}
        </span>
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm hover:bg-white/10">
          Close
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2">
        {index > 0 && (
          <button aria-label="Previous" className={`${navBtn} left-3`} onClick={() => onIndex(index - 1)}>
            ‹
          </button>
        )}
        <img
          src={`/api/a/${uid}/photo/${photo.id}`}
          alt={photo.name}
          className="max-h-full max-w-full object-contain"
        />
        {index < photos.length - 1 && (
          <button aria-label="Next" className={`${navBtn} right-3`} onClick={() => onIndex(index + 1)}>
            ›
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 p-4">
        {canShareFiles() && (
          <Button variant="secondary" size="sm" onClick={() => void onSave()}>
            Save to Photos
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => downloadUrl(downloadHref, photo.name)}>
          Download
        </Button>
      </div>
    </div>
  );
}
