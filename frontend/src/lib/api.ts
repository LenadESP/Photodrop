export interface ApiError extends Error {
  status: number;
  data: unknown;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
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

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (opts.form) {
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
