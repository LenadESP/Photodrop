import { createReadStream, existsSync, statSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { verifySecret } from '../lib/hash.js';
import { ACCESS_COOKIE, albumCookie, albumCookieOpts } from '../lib/cookies.js';
import type { AccessClaims } from '../plugins/auth.js';
import { displayDir, originalsDir, safeJoin, thumbsDir } from '../lib/paths.js';
import { extToMime, sanitizeDownloadName } from '../lib/mime.js';
import { UidParams, UidPhotoParams } from '../schemas/common.js';
import { UnlockBody } from '../schemas/albums.js';
import type { AlbumRow, PhotoRow } from '../db/types.js';

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const getAlbum = (uid: string): AlbumRow | undefined =>
    app.db.prepare('SELECT * FROM albums WHERE uid = ?').get(uid) as AlbumRow | undefined;

  // Only 'ready' photos are servable: a 'pending' original hasn't been
  // EXIF-stripped yet, so its bytes must not leave the server.
  const getReadyPhoto = (uid: string, id: number): PhotoRow | undefined =>
    app.db
      .prepare("SELECT * FROM photos WHERE id = ? AND album_uid = ? AND thumb_status = 'ready'")
      .get(id, uid) as PhotoRow | undefined;

  // The owning admin (valid session) can always view their own albums — this is
  // what lets the dashboard preview private albums via the same endpoints.
  function isOwnerAdmin(req: FastifyRequest, album: AlbumRow): boolean {
    const token = req.cookies[ACCESS_COOKIE];
    if (!token) return false;
    try {
      const p = app.jwt.verify(token) as AccessClaims;
      return p.scope === 'session' && p.role === 'admin' && p.sub === album.owner_id;
    } catch {
      return false;
    }
  }

  // Access gate: public albums are open; the owning admin is always allowed;
  // password-gated albums require a valid per-album unlock cookie;
  // private-without-password albums are V2-only.
  function hasAccess(req: FastifyRequest, album: AlbumRow): boolean {
    if (album.is_public === 1) return true;
    if (isOwnerAdmin(req, album)) return true;
    if (album.password_hash === null) return false;
    const token = req.cookies[albumCookie(album.uid)];
    if (!token) return false;
    try {
      const payload = app.jwt.verify(token) as { scope?: string; uid?: string };
      return payload.scope === 'album' && payload.uid === album.uid;
    } catch {
      return false;
    }
  }

  interface SendOpts {
    downloadName?: string;
    // Stored filenames are random and their bytes are never rewritten, so the
    // content is immutable. `cacheable` is set only for PUBLIC albums — a
    // private/password album must never be cached by a shared/CDN cache, or the
    // URL alone would serve it past the access gate.
    cacheable?: boolean;
  }

  function sendImage(
    req: FastifyRequest,
    reply: FastifyReply,
    filePath: string,
    mime: string,
    opts: SendOpts = {},
  ) {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    reply.header('ETag', etag);
    reply.header(
      'Cache-Control',
      opts.cacheable ? 'public, max-age=31536000, immutable' : 'private, max-age=3600',
    );
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.header('Content-Length', stat.size);
    if (opts.downloadName) {
      reply.header('Content-Disposition', `attachment; filename="${opts.downloadName}"`);
    }
    return reply.type(mime).send(createReadStream(filePath));
  }

  // ── Unlock a password-gated album ─────────────────────────────────────────
  app.post(
    '/api/a/:uid/unlock',
    { schema: { params: UidParams, body: UnlockBody }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      const { password } = req.body as Static<typeof UnlockBody>;
      const album = getAlbum(uid);
      // Same response whether the album is missing or has no password — no oracle.
      if (!album || album.password_hash === null) {
        await verifySecret('$argon2id$v=19$m=19456,t=2,p=1$Zm9vYmFyYmF6cXV4$Zm9vYmFyYmF6cXV4', password);
        return reply.code(404).send({ error: 'Not found' });
      }
      if (!(await verifySecret(album.password_hash, password))) {
        return reply.code(401).send({ error: 'Invalid password' });
      }
      const token = await reply.jwtSign({ scope: 'album', uid }, { expiresIn: '2h' });
      reply.setCookie(albumCookie(uid), token, albumCookieOpts);
      return { ok: true };
    },
  );

  // ── Album metadata + photo list ───────────────────────────────────────────
  app.get('/api/a/:uid', { schema: { params: UidParams } }, async (req, reply) => {
    const { uid } = req.params as Static<typeof UidParams>;
    const album = getAlbum(uid);
    if (!album) return reply.code(404).send({ error: 'Not found' });
    if (!hasAccess(req, album)) {
      if (album.is_public !== 1 && album.password_hash !== null) {
        return reply.code(401).send({ passwordRequired: true, title: album.title });
      }
      return reply.code(404).send({ error: 'Not found' });
    }

    const photos = app.db
      .prepare(
        'SELECT id, width, height, original_name, thumb_status FROM photos WHERE album_uid = ? ORDER BY created_at, id',
      )
      .all(uid) as Pick<PhotoRow, 'id' | 'width' | 'height' | 'original_name' | 'thumb_status'>[];

    return {
      album: { uid: album.uid, title: album.title },
      photos: photos.map((p) => ({
        id: p.id,
        width: p.width,
        height: p.height,
        name: p.original_name,
        // Bytes aren't servable until the worker finishes; the client shows a
        // placeholder for not-yet-ready photos and polls.
        ready: p.thumb_status === 'ready',
      })),
    };
  });

  // ── Thumbnail bytes ───────────────────────────────────────────────────────
  app.get('/api/a/:uid/thumb/:id', { schema: { params: UidPhotoParams } }, async (req, reply) => {
    const { uid, id } = req.params as Static<typeof UidPhotoParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });
    const photo = getReadyPhoto(uid, id);
    if (!photo) return reply.code(404).send({ error: 'Not found' });
    return sendImage(req, reply, safeJoin(thumbsDir(uid), photo.thumb_path), 'image/webp', {
      cacheable: album.is_public === 1,
    });
  });

  // ── Intermediate "display" derivative (inline) ────────────────────────────
  // Served to the lightbox so viewers don't download a full-res original. Falls
  // back to the original for photos uploaded before display derivatives existed.
  app.get('/api/a/:uid/display/:id', { schema: { params: UidPhotoParams } }, async (req, reply) => {
    const { uid, id } = req.params as Static<typeof UidPhotoParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });
    const photo = getReadyPhoto(uid, id);
    if (!photo) return reply.code(404).send({ error: 'Not found' });
    const cacheable = album.is_public === 1;
    const displayPath = safeJoin(displayDir(uid), photo.thumb_path);
    if (existsSync(displayPath)) {
      return sendImage(req, reply, displayPath, 'image/webp', { cacheable });
    }
    const original = safeJoin(originalsDir(uid), photo.stored_filename);
    return sendImage(req, reply, original, extToMime(photo.stored_filename), { cacheable });
  });

  // ── Full-quality original (inline) ────────────────────────────────────────
  app.get('/api/a/:uid/photo/:id', { schema: { params: UidPhotoParams } }, async (req, reply) => {
    const { uid, id } = req.params as Static<typeof UidPhotoParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });
    const photo = getReadyPhoto(uid, id);
    if (!photo) return reply.code(404).send({ error: 'Not found' });
    const filePath = safeJoin(originalsDir(uid), photo.stored_filename);
    return sendImage(req, reply, filePath, extToMime(photo.stored_filename));
  });

  // ── Download one original (attachment) ────────────────────────────────────
  app.get('/api/a/:uid/download/:id', { schema: { params: UidPhotoParams } }, async (req, reply) => {
    const { uid, id } = req.params as Static<typeof UidPhotoParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });
    const photo = getReadyPhoto(uid, id);
    if (!photo) return reply.code(404).send({ error: 'Not found' });
    const filePath = safeJoin(originalsDir(uid), photo.stored_filename);
    return sendImage(req, reply, filePath, extToMime(photo.stored_filename), {
      downloadName: sanitizeDownloadName(photo.original_name),
    });
  });

}
