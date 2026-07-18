import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { api, isApiError } from '../lib/api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { FullPageSpinner } from '../components/Spinner';
import { Lightbox } from '../components/Lightbox';
import { ThemeToggle } from '../components/ThemeToggle';
import { Spinner } from '../components/Spinner';
import { downloadAlbumZip, downloadOriginalsSequential, type DownloadItem } from '../lib/share';

interface Photo {
  id: number;
  width: number | null;
  height: number | null;
  name: string;
  ready: boolean;
  kind: 'image' | 'video';
  durationMs: number | null;
  previewReady: boolean;
  previewPending: boolean;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
interface AlbumMeta {
  album: { uid: string; title: string };
  photos: Photo[];
}

type View = 'loading' | 'locked' | 'ready' | 'error';

export function Gallery() {
  const { uid = '' } = useParams();
  const [view, setView] = useState<View>('loading');
  const [meta, setMeta] = useState<AlbumMeta | null>(null);
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [dlProgress, setDlProgress] = useState<{ started: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<AlbumMeta>(`/api/a/${uid}`);
      setMeta(data);
      setTitle(data.album.title);
      setView('ready');
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        const data = err.data as { title?: string } | null;
        setTitle(data?.title ?? 'Private album');
        setView('locked');
      } else {
        setView('error');
      }
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep polling while anything is still being processed — a thumbnail that
  // hasn't appeared yet, or a video transcode still queued behind it.
  useEffect(() => {
    if (view !== 'ready' || !meta) return;
    if (meta.photos.every((p) => p.ready && !p.previewPending)) return;
    const t = setTimeout(() => void load(), 3000);
    return () => clearTimeout(t);
  }, [view, meta, load]);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/a/${uid}/unlock`, { method: 'POST', body: { password } });
      setView('loading');
      await load();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Wrong password');
    }
  };

  if (view === 'loading') return <FullPageSpinner />;

  if (view === 'error') {
    return (
      <div className="flex min-h-full items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Album not found</h1>
          <p className="mt-2 text-muted">This link may have expired or been revoked.</p>
        </div>
      </div>
    );
  }

  if (view === 'locked') {
    return (
      <div className="flex min-h-full items-center justify-center px-6">
        <form onSubmit={unlock} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-soft space-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted">This album is password-protected.</p>
          </div>
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full">
            View album
          </Button>
        </form>
      </div>
    );
  }

  const photos = meta?.photos ?? [];
  const readyPhotos = photos.filter((p) => p.ready);
  const pendingCount = photos.length - readyPhotos.length;

  // Two ways to grab the whole album, both full-resolution originals: "Download all"
  // saves every original straight to the device as individual browser downloads (on
  // a phone they land in Downloads/Files and surface in the gallery); "Download ZIP"
  // streams the same originals as a single archive. The display derivative is only
  // ever used for on-screen viewing, never for saving.
  const downloadAll = async () => {
    if (readyPhotos.length === 0 || dlProgress) return;
    const items: DownloadItem[] = readyPhotos.map((p) => ({
      url: `/api/a/${uid}/download/${p.id}`,
      name: p.name,
    }));
    setDlProgress({ started: 0, total: items.length });
    try {
      await downloadOriginalsSequential(items, {
        onProgress: (started, total) => setDlProgress({ started, total }),
      });
    } finally {
      setDlProgress(null);
    }
  };

  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
            {pendingCount > 0 && ` · ${pendingCount} processing…`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {readyPhotos.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => void downloadAll()} disabled={!!dlProgress}>
              {dlProgress ? <Spinner className="h-4 w-4" /> : null}
              {dlProgress
                ? dlProgress.started === 0
                  ? 'Starting…'
                  : `Downloading ${dlProgress.started} / ${dlProgress.total}…`
                : 'Download all'}
            </Button>
          )}
          {readyPhotos.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => downloadAlbumZip(uid)} disabled={!!dlProgress}>
              Download ZIP
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {dlProgress && (
        <p className="px-4 pb-1 text-xs text-muted sm:px-6">
          Your browser may ask to allow multiple downloads — tap Allow to save them all.
        </p>
      )}

      {photos.length === 0 ? (
        <p className="px-6 py-16 text-center text-muted">This album is empty.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 px-4 py-1 sm:grid-cols-3 sm:px-6 md:grid-cols-4 lg:grid-cols-5 lg:px-8">
          {photos.map((p) =>
            p.ready ? (
              <button
                key={p.id}
                onClick={() => setLightbox(readyPhotos.indexOf(p))}
                className="group relative aspect-square overflow-hidden bg-line/40"
              >
                <img
                  src={`/api/a/${uid}/thumb/${p.id}`}
                  alt={p.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                />
                {p.kind === 'video' && (
                  <>
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
                        <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-white" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                    </span>
                    {p.durationMs != null && p.durationMs > 0 && (
                      <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                        {formatDuration(p.durationMs)}
                      </span>
                    )}
                  </>
                )}
              </button>
            ) : (
              <div
                key={p.id}
                className="flex aspect-square items-center justify-center bg-line/40"
                title="Processing…"
              >
                <Spinner className="h-5 w-5" />
              </div>
            ),
          )}
        </div>
      )}

      {lightbox !== null && (
        <Lightbox
          uid={uid}
          photos={readyPhotos}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndex={setLightbox}
        />
      )}
    </div>
  );
}
