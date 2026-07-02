import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { env } from '../env.js';
import { hashSecret } from '../lib/hash.js';
import { newAlbumUid } from '../lib/ids.js';
import { albumDir, originalsDir, thumbsDir } from '../lib/paths.js';
import { UidParams } from '../schemas/common.js';
import { CreateAlbumBody, PatchAlbumBody, SetPasswordBody } from '../schemas/albums.js';
import type { AlbumRow } from '../db/types.js';

export async function adminAlbumRoutes(app: FastifyInstance): Promise<void> {
  const photoCount = (uid: string): number =>
    (app.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_uid = ?').get(uid) as { n: number })
      .n;

  const summary = (a: AlbumRow) => ({
    uid: a.uid,
    title: a.title,
    is_public: a.is_public === 1,
    exif_strip: a.exif_strip === 1,
    has_password: a.password_hash !== null,
    photo_count: photoCount(a.uid),
    created_at: a.created_at,
    url: `${env.publicOrigin}/a/${a.uid}`,
  });

  const getOwned = (uid: string, ownerId: number): AlbumRow | undefined =>
    app.db.prepare('SELECT * FROM albums WHERE uid = ? AND owner_id = ?').get(uid, ownerId) as
      | AlbumRow
      | undefined;

  // All routes below require an admin session; CSRF is enforced globally on
  // these state-changing methods.
  const guard = { preHandler: app.requireAdmin };

  app.get('/api/admin/albums', guard, async (req) => {
    const rows = app.db
      .prepare('SELECT * FROM albums WHERE owner_id = ? ORDER BY created_at DESC')
      .all(req.user.sub) as AlbumRow[];
    return { albums: rows.map(summary) };
  });

  app.post(
    '/api/admin/albums',
    { ...guard, schema: { body: CreateAlbumBody } },
    async (req, reply) => {
      const body = req.body as Static<typeof CreateAlbumBody>;
      const uid = newAlbumUid();
      const passwordHash = body.password ? await hashSecret(body.password) : null;

      app.db
        .prepare(
          `INSERT INTO albums (uid, owner_id, title, is_public, password_hash, exif_strip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uid,
          req.user.sub,
          body.title,
          body.is_public ? 1 : 0,
          passwordHash,
          body.exif_strip === false ? 0 : 1,
          Date.now(),
        );

      mkdirSync(originalsDir(uid), { recursive: true });
      mkdirSync(thumbsDir(uid), { recursive: true });

      const created = getOwned(uid, req.user.sub)!;
      return reply.code(201).send({ album: summary(created) });
    },
  );

  app.patch(
    '/api/admin/albums/:uid',
    { ...guard, schema: { params: UidParams, body: PatchAlbumBody } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      const body = req.body as Static<typeof PatchAlbumBody>;
      if (!getOwned(uid, req.user.sub)) return reply.code(404).send({ error: 'Not found' });

      const sets: string[] = [];
      const vals: (string | number)[] = [];
      if (body.title !== undefined) {
        sets.push('title = ?');
        vals.push(body.title);
      }
      if (body.is_public !== undefined) {
        sets.push('is_public = ?');
        vals.push(body.is_public ? 1 : 0);
      }
      if (body.exif_strip !== undefined) {
        sets.push('exif_strip = ?');
        vals.push(body.exif_strip ? 1 : 0);
      }
      vals.push(uid, req.user.sub);
      app.db
        .prepare(`UPDATE albums SET ${sets.join(', ')} WHERE uid = ? AND owner_id = ?`)
        .run(...vals);

      return { album: summary(getOwned(uid, req.user.sub)!) };
    },
  );

  app.post(
    '/api/admin/albums/:uid/password',
    { ...guard, schema: { params: UidParams, body: SetPasswordBody } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      const body = req.body as Static<typeof SetPasswordBody>;
      if (!getOwned(uid, req.user.sub)) return reply.code(404).send({ error: 'Not found' });

      const hash = body.password === null ? null : await hashSecret(body.password);
      app.db
        .prepare('UPDATE albums SET password_hash = ? WHERE uid = ? AND owner_id = ?')
        .run(hash, uid, req.user.sub);
      return { album: summary(getOwned(uid, req.user.sub)!) };
    },
  );

  // Regenerate the uid — instantly revokes the old link. Renames the on-disk
  // album dir; photos cascade via ON UPDATE CASCADE.
  app.post(
    '/api/admin/albums/:uid/regenerate-uid',
    { ...guard, schema: { params: UidParams } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      if (!getOwned(uid, req.user.sub)) return reply.code(404).send({ error: 'Not found' });

      const newUid = newAlbumUid();
      const oldDir = albumDir(uid);
      const newDir = albumDir(newUid);
      if (existsSync(oldDir)) renameSync(oldDir, newDir);
      try {
        app.db
          .prepare('UPDATE albums SET uid = ? WHERE uid = ? AND owner_id = ?')
          .run(newUid, uid, req.user.sub);
      } catch (err) {
        if (existsSync(newDir)) renameSync(newDir, oldDir); // roll back the rename
        throw err;
      }
      return { album: summary(getOwned(newUid, req.user.sub)!) };
    },
  );

  app.delete(
    '/api/admin/albums/:uid',
    { ...guard, schema: { params: UidParams } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      if (!getOwned(uid, req.user.sub)) return reply.code(404).send({ error: 'Not found' });

      app.db.prepare('DELETE FROM albums WHERE uid = ? AND owner_id = ?').run(uid, req.user.sub);
      rmSync(albumDir(uid), { recursive: true, force: true });
      return { ok: true };
    },
  );
}
