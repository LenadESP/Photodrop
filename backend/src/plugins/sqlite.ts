import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type DB } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { ensureAdmin } from '../db/bootstrap.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

export default fp(async function sqlitePlugin(app: FastifyInstance): Promise<void> {
  const db = openDatabase();
  runMigrations(db);
  await ensureAdmin(db);

  app.decorate('db', db);
  app.addHook('onClose', async () => {
    db.close();
  });
});
