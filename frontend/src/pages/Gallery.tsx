import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { api, isApiError } from '../lib/api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { FullPageSpinner } from '../components/Spinner';
import { Lightbox } from '../components/Lightbox';
import { ThemeToggle } from '../components/ThemeToggle';
import { downloadUrl } from '../lib/share';

interface Photo {
  id: number;
  width: number | null;
  height: number | null;
  name: string;
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
  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {photos.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => downloadUrl(`/api/a/${uid}/zip`)}>
              Download all
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {photos.length === 0 ? (
        <p className="px-6 py-16 text-center text-muted">This album is empty.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1 p-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {photos.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setLightbox(i)}
              className="group relative aspect-square overflow-hidden bg-line/40"
            >
              <img
                src={`/api/a/${uid}/thumb/${p.id}`}
                alt={p.name}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            </button>
          ))}
        </div>
      )}

      {lightbox !== null && (
        <Lightbox
          uid={uid}
          photos={photos}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndex={setLightbox}
        />
      )}
    </div>
  );
}
