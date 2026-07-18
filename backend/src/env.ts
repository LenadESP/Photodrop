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

// Length floor for the three signing keys. The documented `openssl rand -base64 48`
// yields 64 characters, so this only ever catches a hand-written or truncated key.
const MIN_SIGNING_SECRET_LEN = 32;

function secret(name: string): string {
  const v = required(name);
  // Guard against shipping the .env.example placeholders to production.
  if (isProd && v.includes('CHANGE_ME')) {
    throw new Error(`Environment variable ${name} still holds a placeholder value`);
  }
  return v;
}

// A cryptographic signing key: the placeholder guard plus a length floor. Kept
// separate from secret() because ADMIN_PASSWORD goes through that one, and a human
// password has no business being held to a signing key's length. Production-gated
// like the placeholder guard, so development and the test harnesses can run on
// short throwaway values.
function signingSecret(name: string): string {
  const v = secret(name);
  if (isProd && v.length < MIN_SIGNING_SECRET_LEN) {
    throw new Error(
      `Environment variable ${name} must be at least ${MIN_SIGNING_SECRET_LEN} characters; ` +
        'generate one with: openssl rand -base64 48',
    );
  }
  return v;
}

export const env = {
  nodeEnv,
  isProd,
  port: intEnv('PORT', 3000),
  // Proxy hops to trust for X-Forwarded-For, so req.ip is the real client behind
  // the proxy (drives per-IP rate limits). Default 1 = the single Caddy hop.
  trustProxyHops: intEnv('TRUST_PROXY_HOPS', 1),
  dataDir,
  dbPath: resolve(dataDir, 'data', 'photodrop.db'),
  albumsDir: resolve(dataDir, 'albums'),
  tmpDir: resolve(dataDir, 'tmp'),
  // Resumable-upload staging. Separate from tmpDir because the boot orphan sweep
  // clears that one wholesale, which would defeat resuming across a restart.
  uploadsDir: resolve(dataDir, 'uploads'),
  publicOrigin: required('PUBLIC_ORIGIN'),
  jwtSecret: signingSecret('JWT_SECRET'),
  csrfSecret: signingSecret('CSRF_SECRET'),
  cookieSecret: signingSecret('COOKIE_SECRET'),
  adminUsername: required('ADMIN_USERNAME'),
  adminPassword: secret('ADMIN_PASSWORD'),
  maxFileBytes: intEnv('MAX_FILE_BYTES', 52_428_800),
  maxFilesPerUpload: intEnv('MAX_FILES_PER_UPLOAD', 40),
  maxImagePixels: intEnv('MAX_IMAGE_PIXELS', 50_000_000),
  // Resumable uploads. A single file is sent in parts so no request approaches the
  // reverse proxy / Cloudflare body ceiling (~100 MB); partBytes is what the client
  // is told to use and what the server enforces per part. maxUploadBytes caps the
  // assembled file — the real ceiling for one upload. staleUploadMs is how long an
  // abandoned session's parts are kept before the maintenance pass reclaims them.
  uploadPartBytes: intEnv('UPLOAD_PART_BYTES', 8_388_608), // 8 MiB
  maxUploadBytes: intEnv('MAX_UPLOAD_BYTES', 2_147_483_648), // 2 GiB
  staleUploadMs: intEnv('STALE_UPLOAD_MS', 24 * 60 * 60 * 1000), // 24 h
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
