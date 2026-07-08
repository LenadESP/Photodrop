import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { downloadUrl, shareFile } from '../lib/share';

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
  'absolute top-1/2 z-10 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20';
const iconBtn =
  'flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
// Horizontal travel (px) past which an unzoomed drag counts as a navigation swipe.
const SWIPE_THRESHOLD = 50;

export function Lightbox({ uid, photos, index, onClose, onIndex }: Props) {
  const photo = photos[index];
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // Swipe-to-navigate is armed only when not zoomed (zoomed → the same gesture pans).
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  // A completed swipe fires a synthetic click; briefly ignore it so it can't also
  // trigger a nav button that happens to sit under the release point.
  const suppressClick = useRef(false);

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
    if (zoom > 1) {
      // Zoomed: the drag pans the image.
      dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      // Not zoomed: arm a horizontal swipe-to-navigate (resolved on pointer up).
      swipeStart.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return; // only an active pan moves the image
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current) {
      dragStart.current = null; // finish a pan
      setDragging(false);
      return;
    }
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // A mostly-horizontal drag past the threshold navigates; clamp at the ends.
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 350);
      if (dx < 0) onIndex(Math.min(index + 1, photos.length - 1));
      else onIndex(Math.max(index - 1, 0));
    }
  };
  const onPointerCancel = () => {
    dragStart.current = null;
    setDragging(false);
    swipeStart.current = null;
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
            onClick={() => void onSave()}
            className="rounded-lg px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Save
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
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerCancel}
        onPointerCancel={onPointerCancel}
        style={{
          // Not zoomed: reserve horizontal gestures for our swipe, leave vertical
          // (scroll / pull-to-refresh) to the browser. Zoomed: we own all of it.
          touchAction: zoomed ? 'none' : 'pan-y',
          cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
      >
        {index > 0 && !zoomed && (
          <button
            aria-label="Previous"
            className={`${navBtn} left-3`}
            onClick={() => {
              if (suppressClick.current) return;
              onIndex(index - 1);
            }}
          >
            ‹
          </button>
        )}
        <img
          src={`/api/a/${uid}/display/${photo.id}`}
          alt={photo.name}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transition: dragging ? 'none' : 'transform 150ms ease',
          }}
        />
        {index < photos.length - 1 && !zoomed && (
          <button
            aria-label="Next"
            className={`${navBtn} right-3`}
            onClick={() => {
              if (suppressClick.current) return;
              onIndex(index + 1);
            }}
          >
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
      </div>
    </div>
  );
}
