import { resolve } from 'node:path';

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid positive integer for ${name}: ${raw}`);
  }
  return n;
}

const nodeEnv = process.env.NODE_ENV ?? 'production';
const isProd = nodeEnv === 'production';
const dataDir = process.env.DATA_DIR ?? '/data';

function secret(name: string): string {
  const v = required(name);
  // Guard against shipping the .env.example placeholders to production.
  if (isProd && v.includes('CHANGE_ME')) {
    throw new Error(`Environment variable ${name} still holds a placeholder value`);
  }
  return v;
}

export const env = {
  nodeEnv,
  isProd,
  port: intEnv('PORT', 3000),
  dataDir,
  dbPath: resolve(dataDir, 'data', 'photodrop.db'),
  albumsDir: resolve(dataDir, 'albums'),
  tmpDir: resolve(dataDir, 'tmp'),
  publicOrigin: required('PUBLIC_ORIGIN'),
  jwtSecret: secret('JWT_SECRET'),
  csrfSecret: secret('CSRF_SECRET'),
  cookieSecret: secret('COOKIE_SECRET'),
  adminUsername: required('ADMIN_USERNAME'),
  adminPassword: secret('ADMIN_PASSWORD'),
  maxFileBytes: intEnv('MAX_FILE_BYTES', 52_428_800),
  maxFilesPerUpload: intEnv('MAX_FILES_PER_UPLOAD', 40),
  maxImagePixels: intEnv('MAX_IMAGE_PIXELS', 50_000_000),
  // Refuse uploads when free space on the data volume drops below this floor, so
  // a full disk can't corrupt the SQLite WAL. Default 1 GiB.
  minFreeBytes: intEnv('MIN_FREE_BYTES', 1_073_741_824),
  // Maintenance / alerting. The data volume is checked hourly; crossing this
  // usage percentage fires an ntfy alert (default 85%).
  diskAlertPct: intEnv('DISK_ALERT_PCT', 85),
  // ntfy destination for proactive alerts. Unset ⇒ alerting is off (the default
  // for the public distribution); the homelab wires it to the shared topic.
  ntfyUrl: process.env.NTFY_URL || undefined,
  ntfyToken: process.env.NTFY_TOKEN || undefined,
} as const;
