import { env } from '../env.js';
import { hashSecret } from '../lib/hash.js';
import type { DB } from './index.js';

// Seed the single admin account on first boot only. TOTP is left disabled here;
// enrollment is forced at first login, so this password alone cannot reach the
// dashboard.
export async function ensureAdmin(db: DB): Promise<void> {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return;

  const passwordHash = await hashSecret(env.adminPassword);
  db.prepare(
    `INSERT INTO users (username, password_hash, role, totp_enabled, created_at)
     VALUES (?, ?, 'admin', 0, ?)`,
  ).run(env.adminUsername, passwordHash, Date.now());
}
