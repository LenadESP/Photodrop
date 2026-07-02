import { createReadStream, statSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Static } from '@sinclair/typebox';
import archiver from 'archiver';
import { verifySecret } from '../lib/hash.js';
import { albumCookie, albumCookieOpts } from '../lib/cookies.js';
import { originalsDir, safeJoin, thumbsDir } from '../lib/paths.js';
import { extToMime, sanitizeDownloadName } from '../lib/mime.js';
import { UidParams, UidPhotoParams } from '../schemas/common.js';
import { UnlockBody } from '../schemas/albums.js';
import type { AlbumRow, PhotoRow } from '../db/types.js';

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const getAlbum = (uid: string): AlbumRow | undefined =>
    app.db.prepare('SELECT * FROM albums WHERE uid = ?').get(uid) as AlbumRow | undefined;

  const getPhoto = (uid: string, id: number): PhotoRow | undefined =>
    app.db.prepare('SELECT * FROM photos WHERE id = ? AND album_uid = ?').get(id, uid) as
      | PhotoRow
      | undefined;

  // Access gate: public albums are open; password-gated albums require a valid
  // per-album unlock cookie; private-without-password albums are V2-only.
  function hasAccess(req: FastifyRequest, album: AlbumRow): boolean {
    if (album.is_public === 1) return true;
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

  function sendImage(reply: FastifyReply, filePath: string, mime: string, downloadName?: string) {
    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.header('Content-Length', size);
    if (downloadName) {
      reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);
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
      .prepare('SELECT id, width, height, original_name FROM photos WHERE album_uid = ? ORDER BY created_at, id')
      .all(uid) as Pick<PhotoRow, 'id' | 'width' | 'height' | 'original_name'>[];

    return {
      album: { uid: album.uid, title: album.title },
      photos: photos.map((p) => ({ id: p.id, width: p.width, height: p.height, name: p.original_name })),
    };
  });

  // ── Thumbnail bytes ───────────────────────────────────────────────────────
  app.get('/api/a/:uid/thumb/:id', { schema: { params: UidPhotoParams } }, async (req, reply) => {
    const { uid, id } = req.params as Static<typeof UidPhotoParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });
    const photo = getPhoto(uid, id);
    if (!photo) return reply.code(404).send({ error: 'Not found' });
    return sendImage(reply, safeJoin(thumbsDir(uid), photo.thumb_path), 'image/webp');
  });

  // ── Full-quality original (inline) ────────────────────────────────────────
  app.get('/api/a/:uid/photo/:id', { schema: { params: UidPhotoParams } }, async (req, reply) => {
    const { uid, id } = req.params as Static<typeof UidPhotoParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });
    const photo = getPhoto(uid, id);
    if (!photo) return reply.code(404).send({ error: 'Not found' });
    const filePath = safeJoin(originalsDir(uid), photo.stored_filename);
    return sendImage(reply, filePath, extToMime(photo.stored_filename));
  });

  // ── Download one original (attachment) ────────────────────────────────────
  app.get('/api/a/:uid/download/:id', { schema: { params: UidPhotoParams } }, async (req, reply) => {
    const { uid, id } = req.params as Static<typeof UidPhotoParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });
    const photo = getPhoto(uid, id);
    if (!photo) return reply.code(404).send({ error: 'Not found' });
    const filePath = safeJoin(originalsDir(uid), photo.stored_filename);
    return sendImage(reply, filePath, extToMime(photo.stored_filename), sanitizeDownloadName(photo.original_name));
  });

  // ── Bulk download: streamed, store-only zip (originals already compressed) ─
  app.get('/api/a/:uid/zip', { schema: { params: UidParams } }, async (req, reply) => {
    const { uid } = req.params as Static<typeof UidParams>;
    const album = getAlbum(uid);
    if (!album || !hasAccess(req, album)) return reply.code(403).send({ error: 'Forbidden' });

    const photos = app.db
      .prepare('SELECT * FROM photos WHERE album_uid = ? ORDER BY created_at, id')
      .all(uid) as PhotoRow[];

    reply.header('Content-Type', 'application/zip');
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${sanitizeDownloadName(album.title)}.zip"`,
    );

    const archive = archiver('zip', { store: true });
    archive.on('error', (err) => {
      app.log.error(err);
      reply.raw.destroy(err);
    });

    const used = new Set<string>();
    for (const p of photos) {
      const base = sanitizeDownloadName(p.original_name);
      let name = base;
      let i = 1;
      while (used.has(name)) name = `${i++}_${base}`;
      used.add(name);
      archive.file(safeJoin(originalsDir(uid), p.stored_filename), { name });
    }
    void archive.finalize();
    return reply.send(archive);
  });
}
