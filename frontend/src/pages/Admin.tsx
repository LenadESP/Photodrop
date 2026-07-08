import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { api } from '../lib/api';
import { useAuth } from '../context/auth';
import { useToast } from '../components/Toast';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { TopBar } from '../components/TopBar';
import { FullPageSpinner, Spinner } from '../components/Spinner';
import { UploadZone } from '../components/UploadZone';

interface Album {
  uid: string;
  title: string;
  is_public: boolean;
  exif_strip: boolean;
  has_password: boolean;
  photo_count: number;
  created_at: number;
  expires_at: number | null;
  url: string;
}
interface Photo {
  id: number;
  name: string;
  ready: boolean;
}

export function Admin() {
  const { user, loading: authLoading } = useAuth();
  const { notify } = useToast();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [prompt, setPrompt] = useState<{ title: string; label: string; action: (v: string) => void } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);

  const selected = albums.find((a) => a.uid === selectedUid) ?? null;

  const loadAlbums = useCallback(async () => {
    const data = await api<{ albums: Album[] }>('/api/admin/albums');
    setAlbums(data.albums);
    setSelectedUid((cur) => cur ?? data.albums[0]?.uid ?? null);
  }, []);

  useEffect(() => {
    void loadAlbums().finally(() => setLoading(false));
  }, [loadAlbums]);

  const loadPhotos = useCallback(async (uid: string) => {
    try {
      const data = await api<{ photos: Photo[] }>(`/api/a/${uid}`);
      setPhotos(data.photos);
    } catch {
      setPhotos([]);
    }
  }, []);

  useEffect(() => {
    if (selectedUid) void loadPhotos(selectedUid);
    else setPhotos([]);
  }, [selectedUid, loadPhotos]);

  // Poll while freshly-uploaded photos are still being processed by the worker.
  useEffect(() => {
    if (!selectedUid || photos.length === 0 || photos.every((p) => p.ready)) return;
    const t = setTimeout(() => void loadPhotos(selectedUid), 3000);
    return () => clearTimeout(t);
  }, [selectedUid, photos, loadPhotos]);

  if (authLoading) return <FullPageSpinner />;
  if (!user || user.role !== 'admin') return <Navigate to="/login" replace />;

  const refreshAlbum = async () => {
    await loadAlbums();
    if (selectedUid) await loadPhotos(selectedUid);
  };

  const patch = async (uid: string, changes: Record<string, unknown>) => {
    try {
      await api(`/api/admin/albums/${uid}`, { method: 'PATCH', body: changes });
      await loadAlbums();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const createAlbum = async (title: string, isPublic: boolean, password: string) => {
    try {
      const body: Record<string, unknown> = { title, is_public: isPublic };
      if (password) body.password = password;
      const data = await api<{ album: Album }>('/api/admin/albums', { method: 'POST', body });
      setCreateOpen(false);
      await loadAlbums();
      setSelectedUid(data.album.uid);
      notify('Album created');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Create failed', 'error');
    }
  };

  const setPassword = async (uid: string, password: string | null) => {
    try {
      await api(`/api/admin/albums/${uid}/password`, { method: 'POST', body: { password } });
      await loadAlbums();
      notify(password ? 'Password set' : 'Password removed');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const regenerate = async (uid: string) => {
    try {
      const data = await api<{ album: Album }>(`/api/admin/albums/${uid}/regenerate-uid`, {
        method: 'POST',
      });
      await loadAlbums();
      setSelectedUid(data.album.uid);
      notify('New link generated — the old one no longer works');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const removeAlbum = async (uid: string) => {
    try {
      await api(`/api/admin/albums/${uid}`, { method: 'DELETE' });
      setSelectedUid(null);
      await loadAlbums();
      notify('Album deleted');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const deletePhoto = async (uid: string, id: number) => {
    try {
      await api(`/api/admin/albums/${uid}/photos/${id}`, { method: 'DELETE' });
      await refreshAlbum();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 pb-16 sm:px-6 md:grid-cols-[280px_1fr]">
        {/* Album list */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Albums</h2>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              New
            </Button>
          </div>
          {loading ? (
            <div className="py-8"><Spinner /></div>
          ) : albums.length === 0 ? (
            <p className="text-sm text-muted">No albums yet.</p>
          ) : (
            <ul className="space-y-1">
              {albums.map((a) => (
                <li key={a.uid}>
                  <button
                    onClick={() => setSelectedUid(a.uid)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      a.uid === selectedUid ? 'bg-ink text-canvas' : 'hover:bg-ink/5'
                    }`}
                  >
                    <span className="truncate">{a.title}</span>
                    <span className={a.uid === selectedUid ? 'text-canvas/60' : 'text-muted'}>
                      {a.photo_count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Detail */}
        <section>
          {!selected ? (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-line text-muted">
              Select or create an album.
            </div>
          ) : (
            <div className="space-y-6">
              <AlbumControls
                album={selected}
                onCopy={() => {
                  void navigator.clipboard.writeText(selected.url);
                  notify('Link copied');
                }}
                onTogglePublic={() => void patch(selected.uid, { is_public: !selected.is_public })}
                onToggleExif={() => void patch(selected.uid, { exif_strip: !selected.exif_strip })}
                onRename={() =>
                  setPrompt({
                    title: 'Rename album',
                    label: 'Title',
                    action: (v) => void patch(selected.uid, { title: v }),
                  })
                }
                onSetPassword={() =>
                  setPrompt({
                    title: 'Set album password',
                    label: 'New password',
                    action: (v) => void setPassword(selected.uid, v),
                  })
                }
                onRemovePassword={() => void setPassword(selected.uid, null)}
                onRegenerate={() =>
                  setConfirm({
                    message: 'Generate a new link? The current link will stop working immediately.',
                    action: () => void regenerate(selected.uid),
                  })
                }
                onDelete={() =>
                  setConfirm({
                    message: `Delete “${selected.title}” and all its photos? This cannot be undone.`,
                    action: () => void removeAlbum(selected.uid),
                  })
                }
                onSetExpiry={() =>
                  setPrompt({
                    title: 'Set link expiry',
                    label: 'Days until the link expires',
                    action: (v) => {
                      const days = Number.parseInt(v, 10);
                      if (!Number.isFinite(days) || days <= 0) {
                        notify('Enter a positive number of days', 'error');
                        return;
                      }
                      void patch(selected.uid, { expires_at: Date.now() + days * 86_400_000 });
                    },
                  })
                }
                onClearExpiry={() => void patch(selected.uid, { expires_at: null })}
              />

              <UploadZone
                uid={selected.uid}
                onUploaded={(n) => {
                  notify(`Uploaded ${n} photo${n === 1 ? '' : 's'}`);
                  void refreshAlbum();
                }}
                onError={(m) => notify(m, 'error')}
              />

              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5">
                  {photos.map((p) => (
                    <div key={p.id} className="group relative aspect-square overflow-hidden rounded-md bg-line/40">
                      {p.ready ? (
                        <>
                          <img
                            src={`/api/a/${selected.uid}/thumb/${p.id}`}
                            alt={p.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          <button
                            onClick={() =>
                              setConfirm({
                                message: 'Delete this photo?',
                                action: () => void deletePhoto(selected.uid, p.id),
                              })
                            }
                            className="absolute right-1 top-1 hidden rounded-md bg-ink/70 px-2 py-1 text-xs text-canvas group-hover:block"
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center" title="Processing…">
                          <Spinner className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <CreateAlbumModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createAlbum} />
      <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />
      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function AlbumControls(props: {
  album: Album;
  onCopy: () => void;
  onTogglePublic: () => void;
  onToggleExif: () => void;
  onRename: () => void;
  onSetPassword: () => void;
  onRemovePassword: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onSetExpiry: () => void;
  onClearExpiry: () => void;
}) {
  const { album } = props;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{album.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <Badge on={album.is_public}>{album.is_public ? 'Public' : 'Private'}</Badge>
            {album.has_password && <Badge on>Password</Badge>}
            <Badge on={album.exif_strip}>{album.exif_strip ? 'EXIF stripped' : 'EXIF kept'}</Badge>
            {album.expires_at !== null && (
              <Badge on>Expires {new Date(album.expires_at).toLocaleDateString()}</Badge>
            )}
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={props.onDelete}>
          Delete
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-sm text-muted">{album.url}</code>
        <Button variant="secondary" size="sm" onClick={props.onCopy}>
          Copy
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={props.onRename}>
          Rename
        </Button>
        <Button variant="secondary" size="sm" onClick={props.onTogglePublic}>
          {album.is_public ? 'Make private' : 'Make public'}
        </Button>
        <Button variant="secondary" size="sm" onClick={props.onToggleExif}>
          {album.exif_strip ? 'Keep EXIF' : 'Strip EXIF'}
        </Button>
        {album.has_password ? (
          <Button variant="secondary" size="sm" onClick={props.onRemovePassword}>
            Remove password
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={props.onSetPassword}>
            Set password
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={props.onRegenerate}>
          Regenerate link
        </Button>
        {album.expires_at !== null ? (
          <Button variant="secondary" size="sm" onClick={props.onClearExpiry}>
            Clear expiry
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={props.onSetExpiry}>
            Set expiry
          </Button>
        )}
      </div>
    </div>
  );
}

function Badge({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${on ? 'bg-ink text-canvas' : 'bg-canvas text-muted border border-line'}`}
    >
      {children}
    </span>
  );
}

function CreateAlbumModal(props: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, isPublic: boolean, password: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    props.onCreate(title.trim(), isPublic, password);
    setTitle('');
    setIsPublic(false);
    setPassword('');
  };

  return (
    <Modal open={props.open} onClose={props.onClose} title="New album">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Public (anyone with the link can view)
        </label>
        <Input
          label="Password (optional)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank for none"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit">Create</Button>
        </div>
      </form>
    </Modal>
  );
}

function PromptModal(props: {
  prompt: { title: string; label: string; action: (v: string) => void } | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    props.prompt?.action(value.trim());
    setValue('');
    props.onClose();
  };
  return (
    <Modal open={props.prompt !== null} onClose={props.onClose} title={props.prompt?.title}>
      <form onSubmit={submit} className="space-y-4">
        <Input
          label={props.prompt?.label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          required
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal(props: {
  confirm: { message: string; action: () => void } | null;
  onClose: () => void;
}) {
  return (
    <Modal open={props.confirm !== null} onClose={props.onClose} title="Are you sure?">
      <p className="text-sm text-muted">{props.confirm?.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            props.confirm?.action();
            props.onClose();
          }}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
