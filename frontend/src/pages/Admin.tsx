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
import { useI18n, useT } from '../i18n';

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
  kind: 'image' | 'video';
  durationMs: number | null;
  status: 'pending' | 'ready' | 'failed';
  ready: boolean;
  failed: boolean;
  // Human failure reason (e.g. "Metadata stripping timed out"), null unless failed.
  error: string | null;
}

export function Admin() {
  const t = useT();
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
      // Admin-only listing: carries processing status and the failure reason the
      // public gallery endpoint deliberately omits.
      const data = await api<{ photos: Photo[] }>(`/api/admin/albums/${uid}/photos`);
      setPhotos(data.photos);
    } catch {
      setPhotos([]);
    }
  }, []);

  useEffect(() => {
    if (selectedUid) void loadPhotos(selectedUid);
    else setPhotos([]);
  }, [selectedUid, loadPhotos]);

  // Poll while anything is still processing. A 'failed' item is terminal until
  // the admin acts on it, so it does NOT keep the poll alive (no endless spin).
  useEffect(() => {
    if (!selectedUid || !photos.some((p) => p.status === 'pending')) return;
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
      notify(err instanceof Error ? err.message : t('admin.errUpdateFailed'), 'error');
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
      notify(t('admin.toastAlbumCreated'));
    } catch (err) {
      notify(err instanceof Error ? err.message : t('admin.errCreateFailed'), 'error');
    }
  };

  const setPassword = async (uid: string, password: string | null) => {
    try {
      await api(`/api/admin/albums/${uid}/password`, { method: 'POST', body: { password } });
      await loadAlbums();
      notify(password ? t('admin.toastPasswordSet') : t('admin.toastPasswordRemoved'));
    } catch (err) {
      notify(err instanceof Error ? err.message : t('admin.errFailed'), 'error');
    }
  };

  const regenerate = async (uid: string) => {
    try {
      const data = await api<{ album: Album }>(`/api/admin/albums/${uid}/regenerate-uid`, {
        method: 'POST',
      });
      await loadAlbums();
      setSelectedUid(data.album.uid);
      notify(t('admin.toastLinkRegenerated'));
    } catch (err) {
      notify(err instanceof Error ? err.message : t('admin.errFailed'), 'error');
    }
  };

  const removeAlbum = async (uid: string) => {
    try {
      await api(`/api/admin/albums/${uid}`, { method: 'DELETE' });
      setSelectedUid(null);
      await loadAlbums();
      notify(t('admin.toastAlbumDeleted'));
    } catch (err) {
      notify(err instanceof Error ? err.message : t('admin.errDeleteFailed'), 'error');
    }
  };

  const deletePhoto = async (uid: string, id: number) => {
    try {
      await api(`/api/admin/albums/${uid}/photos/${id}`, { method: 'DELETE' });
      await refreshAlbum();
    } catch (err) {
      notify(err instanceof Error ? err.message : t('admin.errDeleteFailed'), 'error');
    }
  };

  // Act on a failed photo: 'retry' reprocesses it (strip + poster); 'accept'
  // ("upload anyway") reprocesses without stripping, keeping the file's metadata.
  const resolvePhoto = async (uid: string, id: number, action: 'retry' | 'accept') => {
    try {
      await api(`/api/admin/albums/${uid}/photos/${id}/resolve`, {
        method: 'POST',
        body: { action },
      });
      notify(action === 'retry' ? t('admin.toastRetrying') : t('admin.toastReprocessing'));
      await loadPhotos(uid);
    } catch (err) {
      notify(err instanceof Error ? err.message : t('admin.errActionFailed'), 'error');
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 pb-16 sm:px-6 md:grid-cols-[280px_1fr]">
        {/* Album list */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('admin.albums')}</h2>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {t('common.new')}
            </Button>
          </div>
          {loading ? (
            <div className="py-8"><Spinner /></div>
          ) : albums.length === 0 ? (
            <p className="text-sm text-muted">{t('admin.noAlbums')}</p>
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
              {t('admin.selectOrCreate')}
            </div>
          ) : (
            <div className="space-y-6">
              <AlbumControls
                album={selected}
                onCopy={() => {
                  void navigator.clipboard.writeText(selected.url);
                  notify(t('admin.toastLinkCopied'));
                }}
                onTogglePublic={() => void patch(selected.uid, { is_public: !selected.is_public })}
                onToggleExif={() => void patch(selected.uid, { exif_strip: !selected.exif_strip })}
                onRename={() =>
                  setPrompt({
                    title: t('admin.renameAlbum'),
                    label: t('admin.fieldTitle'),
                    action: (v) => void patch(selected.uid, { title: v }),
                  })
                }
                onSetPassword={() =>
                  setPrompt({
                    title: t('admin.setAlbumPassword'),
                    label: t('admin.fieldNewPassword'),
                    action: (v) => void setPassword(selected.uid, v),
                  })
                }
                onRemovePassword={() => void setPassword(selected.uid, null)}
                onRegenerate={() =>
                  setConfirm({
                    message: t('admin.confirmRegenerate'),
                    action: () => void regenerate(selected.uid),
                  })
                }
                onDelete={() =>
                  setConfirm({
                    message: t('admin.confirmDeleteAlbum', { title: selected.title }),
                    action: () => void removeAlbum(selected.uid),
                  })
                }
                onSetExpiry={() =>
                  setPrompt({
                    title: t('admin.setLinkExpiry'),
                    label: t('admin.fieldExpiryDays'),
                    action: (v) => {
                      const days = Number.parseInt(v, 10);
                      if (!Number.isFinite(days) || days <= 0) {
                        notify(t('admin.errPositiveDays'), 'error');
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
                  notify(t('admin.toastUploaded', { count: n }));
                  void refreshAlbum();
                }}
                onError={(m) => notify(m, 'error')}
              />

              {photos.some((p) => p.failed) && (
                <FailedPhotos
                  uid={selected.uid}
                  photos={photos.filter((p) => p.failed)}
                  onRetry={(id) => void resolvePhoto(selected.uid, id, 'retry')}
                  onAccept={(id) =>
                    setConfirm({
                      message:
                        t('admin.confirmUploadAnyway'),
                      action: () => void resolvePhoto(selected.uid, id, 'accept'),
                    })
                  }
                  onCancel={(id) =>
                    setConfirm({
                      message: t('admin.confirmCancelUpload'),
                      action: () => void deletePhoto(selected.uid, id),
                    })
                  }
                />
              )}

              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5">
                  {photos.map((p) =>
                    p.failed ? null : (
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
                                  message: t('admin.confirmDeletePhoto'),
                                  action: () => void deletePhoto(selected.uid, p.id),
                                })
                              }
                              className="absolute right-1 top-1 hidden rounded-md bg-ink/70 px-2 py-1 text-xs text-canvas group-hover:block"
                            >
                              {t('common.delete')}
                            </button>
                          </>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center" title={t('gallery.processing')}>
                            <Spinner className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                    ),
                  )}
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

// A distinct, persistent panel for photos the worker could not process. It
// stays until the admin retries, accepts, or cancels each one — the failure is
// stored server-side, so it survives reloads and restarts.
function FailedPhotos(props: {
  uid: string;
  photos: Photo[];
  onRetry: (id: number) => void;
  onAccept: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-2xl border border-danger/40 bg-danger/5 p-4">
      <h3 className="text-sm font-semibold text-danger">
        {t('admin.failedHeading', { count: props.photos.length })}
      </h3>
      <ul className="space-y-2">
        {props.photos.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="text-xs text-danger">
                {t('admin.failedReason', { reason: p.error ?? t('admin.failedFallback') })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" onClick={() => props.onRetry(p.id)}>
                {t('admin.tryAgain')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => props.onAccept(p.id)}>
                {t('admin.uploadAnyway')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => props.onCancel(p.id)}>
                {t('common.cancel')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
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
  const { t, formatDate } = useI18n();
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{album.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <Badge on={album.is_public}>
              {album.is_public ? t('admin.badgePublic') : t('admin.badgePrivate')}
            </Badge>
            {album.has_password && <Badge on>{t('admin.badgePassword')}</Badge>}
            <Badge on={album.exif_strip}>
              {album.exif_strip ? t('admin.badgeExifStripped') : t('admin.badgeExifKept')}
            </Badge>
            {album.expires_at !== null && (
              <Badge on>{t('admin.badgeExpires', { date: formatDate(album.expires_at) })}</Badge>
            )}
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={props.onDelete}>
          {t('common.delete')}
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-sm text-muted">{album.url}</code>
        <Button variant="secondary" size="sm" onClick={props.onCopy}>
          {t('common.copy')}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={props.onRename}>
          {t('admin.rename')}
        </Button>
        <Button variant="secondary" size="sm" onClick={props.onTogglePublic}>
          {album.is_public ? t('admin.makePrivate') : t('admin.makePublic')}
        </Button>
        <Button variant="secondary" size="sm" onClick={props.onToggleExif}>
          {album.exif_strip ? t('admin.keepExif') : t('admin.stripExif')}
        </Button>
        {album.has_password ? (
          <Button variant="secondary" size="sm" onClick={props.onRemovePassword}>
            {t('admin.removePassword')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={props.onSetPassword}>
            {t('admin.setPassword')}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={props.onRegenerate}>
          {t('admin.regenerateLink')}
        </Button>
        {album.expires_at !== null ? (
          <Button variant="secondary" size="sm" onClick={props.onClearExpiry}>
            {t('admin.clearExpiry')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={props.onSetExpiry}>
            {t('admin.setExpiry')}
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
  const t = useT();
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
    <Modal open={props.open} onClose={props.onClose} title={t('admin.newAlbum')}>
      <form onSubmit={submit} className="space-y-4">
        <Input label={t('admin.fieldTitle')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          {t('admin.publicCheckbox')}
        </label>
        <Input
          label={t('admin.fieldPasswordOptional')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('admin.passwordPlaceholder')}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit">{t('common.create')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PromptModal(props: {
  prompt: { title: string; label: string; action: (v: string) => void } | null;
  onClose: () => void;
}) {
  const t = useT();
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
            {t('common.cancel')}
          </Button>
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal(props: {
  confirm: { message: string; action: () => void } | null;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal open={props.confirm !== null} onClose={props.onClose} title={t('common.areYouSure')}>
      <p className="text-sm text-muted">{props.confirm?.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={props.onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            props.confirm?.action();
            props.onClose();
          }}
        >
          {t('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
