import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './index.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function runMigrations(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     );`,
  );

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, Date.now());
    })();
  }
}
