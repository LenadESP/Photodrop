import { access, constants } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

// A live port with a corrupt DB or an unwritable data volume should report
// UNHEALTHY, not ok — so the container healthcheck can restart/alert. Both checks
// are cheap enough to run on every 30 s probe.
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_req, reply) => {
    // DB: a trivial query proves the connection and the DB file are readable.
    try {
      app.db.prepare('SELECT 1').get();
    } catch {
      return reply.code(503).send({ status: 'error', check: 'db' });
    }
    // Filesystem: the data volume must be writable for uploads and the WAL.
    try {
      await access(env.dataDir, constants.W_OK);
    } catch {
      return reply.code(503).send({ status: 'error', check: 'fs' });
    }
    return { status: 'ok' };
  });
}
