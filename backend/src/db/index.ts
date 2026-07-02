import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../env.js';

export type DB = Database.Database;

export function openDatabase(): DB {
  mkdirSync(dirname(env.dbPath), { recursive: true });
  const db = new Database(env.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}
