import { env } from '../env.js';

// Best-effort push to ntfy (reuses the homelab topic — see NTFY_URL in .env).
// Returns false and never throws: if NTFY_URL is unset the feature is simply
// off, and a failed POST must never take the app down or block a caller.
export async function notify(opts: {
  title: string;
  message: string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'urgent';
  tags?: string; // comma-separated ntfy tags, e.g. "warning,floppy_disk"
}): Promise<boolean> {
  if (!env.ntfyUrl) return false;
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    // Keep the Title ASCII — emoji ride along as Tags, which ntfy renders safely.
    Title: opts.title,
  };
  if (opts.priority) headers.Priority = opts.priority;
  if (opts.tags) headers.Tags = opts.tags;
  if (env.ntfyToken) headers.Authorization = `Bearer ${env.ntfyToken}`;
  try {
    const res = await fetch(env.ntfyUrl, { method: 'POST', headers, body: opts.message });
    return res.ok;
  } catch {
    return false;
  }
}
