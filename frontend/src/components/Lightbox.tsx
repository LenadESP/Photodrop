import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
const iconBtn =
  'flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function Lightbox({ uid, photos, index, onClose, onIndex }: Props) {
  const photo = photos[index];
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Reset zoom + pan whenever the photo changes.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex(Math.min(index + 1, photos.length - 1));
      if (e.key === 'ArrowLeft') onIndex(Math.max(index - 1, 0));
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(z + 0.5, MAX_ZOOM));
      if (e.key === '-') zoomOut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photos.length, onClose, onIndex]);

  if (!photo) return null;
  const downloadHref = `/api/a/${uid}/download/${photo.id}`;

  const zoomIn = () => setZoom((z) => Math.min(z + 0.5, MAX_ZOOM));
  function zoomOut() {
    setZoom((z) => {
      const next = Math.max(z - 0.5, MIN_ZOOM);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }

  const onSave = async () => {
    const shared = await shareFile(downloadHref, photo.name);
    if (!shared) downloadUrl(downloadHref, photo.name);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  };
  const endDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };

  const zoomed = zoom > 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-sm text-white/60">
          {index + 1} / {photos.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => downloadUrl(downloadHref, photo.name)}
            className="rounded-lg px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Download
          </button>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm hover:bg-white/10">
            Close
          </button>
        </div>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{
          touchAction: zoomed ? 'none' : 'auto',
          cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
      >
        {index > 0 && !zoomed && (
          <button aria-label="Previous" className={`${navBtn} left-3`} onClick={() => onIndex(index - 1)}>
            ‹
          </button>
        )}
        <img
          src={`/api/a/${uid}/photo/${photo.id}`}
          alt={photo.name}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transition: dragging ? 'none' : 'transform 150ms ease',
          }}
        />
        {index < photos.length - 1 && !zoomed && (
          <button aria-label="Next" className={`${navBtn} right-3`} onClick={() => onIndex(index + 1)}>
            ›
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 p-4">
        <button aria-label="Zoom out" className={iconBtn} onClick={zoomOut} disabled={zoom <= MIN_ZOOM}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button aria-label="Zoom in" className={iconBtn} onClick={zoomIn} disabled={zoom >= MAX_ZOOM}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        {canShareFiles() && (
          <Button variant="secondary" size="sm" onClick={() => void onSave()}>
            Save to Photos
          </Button>
        )}
      </div>
    </div>
  );
}
