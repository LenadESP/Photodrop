export interface ApiError extends Error {
  status: number;
  data: unknown;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  // Raw binary body (one part of a resumable upload), sent as
  // application/octet-stream so the server can stream it straight to disk.
  raw?: Blob;
  signal?: AbortSignal;
}

let csrfToken: string | null = null;

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/auth/csrf', { credentials: 'include' });
  const data = (await res.json()) as { csrfToken: string };
  csrfToken = data.csrfToken;
  return csrfToken;
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

let refreshInFlight: Promise<boolean> | null = null;

// Mint a fresh access token from the refresh cookie.
//
// The access token lives 15 minutes, which is far shorter than a large upload:
// 2 GiB over a home uplink runs 15-30 minutes, so the later part requests of an
// upload routinely outlive the token that authorised the first one. Without this
// they all 401 and the whole upload fails on exactly the files resumable upload
// exists for.
//
// Concurrent 401s share one refresh instead of stampeding the endpoint — and
// since refresh rotates the token, parallel refreshes would fight each other.
async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'X-CSRF-Token': await ensureCsrf() },
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (opts.raw) {
    headers['Content-Type'] = 'application/octet-stream';
    body = opts.raw;
  } else if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (isMutation(method)) headers['X-CSRF-Token'] = await ensureCsrf();

  const send = () =>
    fetch(path, { method, headers, body, credentials: 'include', signal: opts.signal });

  let res = await send();
  // The CSRF token may have rotated/expired — refresh once and retry.
  if (res.status === 403 && isMutation(method)) {
    csrfToken = null;
    headers['X-CSRF-Token'] = await ensureCsrf();
    res = await send();
  }
  // The access token may have expired mid-flight. Mint a new one and retry once.
  // Auth routes are excluded so a dead refresh cookie can't recurse. Blob and
  // FormData bodies are re-readable, so replaying the request is safe.
  if (res.status === 401 && !path.startsWith('/api/auth/') && (await refreshSession())) {
    if (isMutation(method)) headers['X-CSRF-Token'] = await ensureCsrf();
    res = await send();
  }

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : res.statusText) || 'Request failed';
    const err = new Error(message) as ApiError;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && 'status' in err;
}
