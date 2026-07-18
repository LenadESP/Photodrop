import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { env } from '../env.js';
import { freeBytes } from '../lib/disk.js';
import { newAlbumUid, newStoredFilename } from '../lib/ids.js';
import { safeJoin, uploadPartPath, uploadSessionDir } from '../lib/paths.js';
import { ingestFiles } from '../lib/ingest.js';
import { CreateUploadBody, UploadPartParams, UploadSessionParams } from '../schemas/uploads.js';
import { UidParams } from '../schemas/common.js';
import type { AlbumRow, UploadSessionRow } from '../db/types.js';

// Resumable chunked upload.
//
// Cloudflare caps tunnel request bodies at ~100 MB. Batching many small files
// works around that, but a single file larger than the cap cannot be split by the
// multipart route — so a big file was simply un-uploadable. Here the client sends
// one file as a sequence of parts, each comfortably under the ceiling, and can
// resume from wherever it stopped.
//
// Once every part has landed the file is assembled and handed to the SAME
// validate-and-commit path the multipart route uses (`ingestFiles`), so there is
// no second, drifting validation gate.
export async function adminUploadSessionRoutes(app: FastifyInstance): Promise<void> {
  // A part is raw bytes, not multipart or JSON: take the request stream unparsed
  // and write it straight to disk, so a part is never buffered whole in memory on
  // a box with a 1500m ceiling.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });

  const getOwnedAlbum = (uid: string, ownerId: number): AlbumRow | undefined =>
    app.db.prepare('SELECT * FROM albums WHERE uid = ? AND owner_id = ?').get(uid, ownerId) as
      | AlbumRow
      | undefined;

  // Every session lookup is scoped to the calling admin. Without the owner_id
  // predicate a session id would be an IDOR into someone else's upload.
  const getOwnedSession = (id: string, ownerId: number): UploadSessionRow | undefined =>
    app.db.prepare('SELECT * FROM upload_sessions WHERE id = ? AND owner_id = ?').get(id, ownerId) as
      | UploadSessionRow
      | undefined;

  const receivedParts = (sessionId: string): number[] =>
    (
      app.db
        .prepare('SELECT part_no FROM upload_parts WHERE session_id = ? ORDER BY part_no')
        .all(sessionId) as { part_no: number }[]
    ).map((r) => r.part_no);

  function destroySession(session: UploadSessionRow): void {
    app.db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id);
    try {
      rmSync(uploadSessionDir(session.id), { recursive: true, force: true });
    } catch (err) {
      app.log.warn({ err, sessionId: session.id }, 'upload: session dir cleanup failed');
    }
  }

  // ── Start a session ───────────────────────────────────────────────────────
  app.post(
    '/api/admin/albums/:uid/uploads',
    { preHandler: app.requireAdmin, schema: { params: UidParams, body: CreateUploadBody } },
    async (req, reply) => {
      const { uid } = req.params as Static<typeof UidParams>;
      const { name, size } = req.body as Static<typeof CreateUploadBody>;
      if (!getOwnedAlbum(uid, req.user.sub)) return reply.code(404).send({ error: 'Not found' });

      if (size > env.maxUploadBytes) {
        return reply.code(413).send({ error: 'File exceeds the maximum upload size' });
      }
      // Refuse before staging anything if the volume can't hold the file plus the
      // free-space floor — the assembled copy briefly doubles it on disk.
      if ((await freeBytes(env.dataDir)) < env.minFreeBytes + size * 2) {
        return reply.code(507).send({ error: 'Insufficient storage on the server' });
      }

      const id = newAlbumUid(); // same opaque 14-char shape as an album uid
      const partSize = env.uploadPartBytes;
      const totalParts = Math.max(1, Math.ceil(size / partSize));
      mkdirSync(uploadSessionDir(id), { recursive: true });
      app.db
        .prepare(
          `INSERT INTO upload_sessions
             (id, album_uid, owner_id, original_name, total_bytes, part_size, total_parts, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, uid, req.user.sub, name, size, partSize, totalParts, Date.now());

      return reply.code(201).send({ id, partSize, totalParts, received: [] });
    },
  );

  // ── Resume: which parts does the server already have? ─────────────────────
  app.get(
    '/api/admin/uploads/:id',
    { preHandler: app.requireAdmin, schema: { params: UploadSessionParams } },
    async (req, reply) => {
      const { id } = req.params as Static<typeof UploadSessionParams>;
      const session = getOwnedSession(id, req.user.sub);
      if (!session) return reply.code(404).send({ error: 'Not found' });
      return {
        id: session.id,
        partSize: session.part_size,
        totalParts: session.total_parts,
        received: receivedParts(session.id),
      };
    },
  );

  // ── Upload one part ───────────────────────────────────────────────────────
  app.put(
    '/api/admin/uploads/:id/parts/:part',
    { preHandler: app.requireAdmin, schema: { params: UploadPartParams } },
    async (req, reply) => {
      const { id, part } = req.params as Static<typeof UploadPartParams>;
      const session = getOwnedSession(id, req.user.sub);
      if (!session) return reply.code(404).send({ error: 'Not found' });
      if (part >= session.total_parts) {
        return reply.code(400).send({ error: 'Part number out of range' });
      }

      // Every part is exactly part_size except the last, which is the remainder.
      // Enforced server-side: the client's framing is not trusted to decide how
      // many bytes may land on disk.
      const isLast = part === session.total_parts - 1;
      const expected = isLast
        ? session.total_bytes - session.part_size * (session.total_parts - 1)
        : session.part_size;

      // Check the declared length BEFORE reading a byte. Rejecting up front costs
      // no disk I/O, and it avoids tearing down a half-read body: aborting a
      // request mid-stream leaves the unread remainder in the socket and the
      // request never settles. Node's HTTP parser holds the body to
      // Content-Length, so agreeing on it here bounds what can actually arrive.
      const declared = Number(req.headers['content-length']);
      if (!Number.isInteger(declared) || declared !== expected) {
        return reply.code(400).send({ error: `Part must be exactly ${expected} bytes` });
      }

      const destination = uploadPartPath(session.id, part);
      const partial = `${destination}.partial`;
      let written = 0;
      try {
        // Backstop: with Content-Length agreed above this cannot trip, but it
        // keeps the byte count honest if that ever stops being true.
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            written += chunk.length;
            if (written > expected) {
              callback(new Error('part exceeds its declared size'));
              return;
            }
            callback(null, chunk);
          },
        });
        await pipeline(req.body as NodeJS.ReadableStream, limiter, createWriteStream(partial));
      } catch (err) {
        rmSync(partial, { force: true });
        app.log.warn({ err, sessionId: session.id, part }, 'upload: part write failed');
        return reply.code(400).send({ error: 'Part upload failed' });
      }
      if (written !== expected) {
        rmSync(partial, { force: true });
        return reply.code(400).send({ error: `Part must be exactly ${expected} bytes` });
      }

      // Only now is the part real: rename is atomic, so a part file that exists is
      // always complete. Re-sending a part simply overwrites it, which is what
      // makes retrying a dropped connection safe.
      renameSync(partial, destination);
      app.db
        .prepare(
          `INSERT INTO upload_parts (session_id, part_no, bytes) VALUES (?, ?, ?)
             ON CONFLICT(session_id, part_no) DO UPDATE SET bytes = excluded.bytes`,
        )
        .run(session.id, part, written);

      const received = receivedParts(session.id);
      return { received: received.length, totalParts: session.total_parts };
    },
  );

  // ── Assemble and commit ───────────────────────────────────────────────────
  app.post(
    '/api/admin/uploads/:id/complete',
    { preHandler: app.requireAdmin, schema: { params: UploadSessionParams } },
    async (req, reply) => {
      const { id } = req.params as Static<typeof UploadSessionParams>;
      const session = getOwnedSession(id, req.user.sub);
      if (!session) return reply.code(404).send({ error: 'Not found' });

      // The album may have been deleted while the upload was in flight.
      if (!getOwnedAlbum(session.album_uid, req.user.sub)) {
        destroySession(session);
        return reply.code(404).send({ error: 'Not found' });
      }

      const received = receivedParts(session.id);
      if (received.length !== session.total_parts) {
        return reply.code(409).send({
          error: 'Upload incomplete',
          received,
          totalParts: session.total_parts,
        });
      }

      // Assemble into tmp/ (swept on boot, so a crash here leaks nothing) by
      // streaming each part in order — the whole file is never held in memory.
      const assembled = safeJoin(env.tmpDir, newStoredFilename('upload'));
      const out = createWriteStream(assembled);
      try {
        // Write the parts through one stream, respecting backpressure. Deliberately
        // NOT pipeline-per-part into a shared stream: that attaches a fresh set of
        // error/close listeners to `out` for every part, which leaks them and warns
        // past ten — a 2 GiB file is 256 parts.
        for (let i = 0; i < session.total_parts; i += 1) {
          for await (const chunk of createReadStream(uploadPartPath(session.id, i))) {
            if (!out.write(chunk as Buffer)) await once(out, 'drain');
          }
        }
        await new Promise<void>((resolve, reject) => {
          out.end((err?: NodeJS.ErrnoException | null) => (err ? reject(err) : resolve()));
        });
      } catch (err) {
        out.destroy();
        rmSync(assembled, { force: true });
        app.log.error({ err, sessionId: session.id }, 'upload: assembly failed');
        return reply.code(500).send({ error: 'Failed to assemble upload' });
      }

      if (statSync(assembled).size !== session.total_bytes) {
        rmSync(assembled, { force: true });
        destroySession(session);
        return reply.code(400).send({ error: 'Assembled file does not match the declared size' });
      }

      // Same validation and commit path as the multipart batch route.
      const outcome = await ingestFiles(app, session.album_uid, [
        { tmpPath: assembled, originalName: session.original_name },
      ]);
      if (!outcome.ok) {
        rmSync(assembled, { force: true });
        destroySession(session);
        return reply.code(outcome.status).send({ error: outcome.error });
      }

      destroySession(session);
      return reply.code(202).send({ uploaded: outcome.count, pending: true });
    },
  );

  // ── Abort ─────────────────────────────────────────────────────────────────
  app.delete(
    '/api/admin/uploads/:id',
    { preHandler: app.requireAdmin, schema: { params: UploadSessionParams } },
    async (req, reply) => {
      const { id } = req.params as Static<typeof UploadSessionParams>;
      const session = getOwnedSession(id, req.user.sub);
      if (!session) return reply.code(404).send({ error: 'Not found' });
      destroySession(session);
      return { ok: true };
    },
  );
}
