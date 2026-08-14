import { en, type Catalogue, type MessageKey } from './locales/en.js';
import { es } from './locales/es.js';

// Adding a language is two lines: a catalogue file, and an entry here. Nothing
// else in the codebase enumerates locales.
export const CATALOGUES = { en, es } satisfies Record<string, Catalogue>;

export type Locale = keyof typeof CATALOGUES;

export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES = Object.keys(CATALOGUES) as Locale[];

export const isLocale = (v: string): v is Locale =>
  Object.prototype.hasOwnProperty.call(CATALOGUES, v);

/**
 * Look up `key` in `locale`, substituting `{placeholder}` params.
 *
 * Falls back to English per-key rather than per-catalogue, so a locale that is
 * somehow missing a key (only reachable via a hand-edited build — the type
 * checker rejects it at compile time) degrades to English text instead of
 * rendering the raw key at the user.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = CATALOGUES[locale][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Pick the best supported locale from an Accept-Language header.
 *
 * Parses q-values and matches on the primary subtag, so `es-419` and `es-ES`
 * both resolve to `es`. Anything unrecognised falls through to DEFAULT_LOCALE —
 * a request with no header (curl, the test harness) therefore gets English,
 * which keeps existing response assertions valid.
 */
export function negotiateLocale(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...rest] = part.trim().split(';');
      const q = rest
        .map((p) => /^\s*q=([\d.]+)\s*$/i.exec(p))
        .find((m): m is RegExpExecArray => m !== null);
      // A malformed q is treated as 0 by the spec's grammar; Number('') is 0 too.
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q[1]) : 1 };
    })
    .filter((e) => e.tag !== '' && Number.isFinite(e.q) && e.q > 0)
    // Stable sort by descending q: equal weights keep header order, which is
    // the client's own preference order.
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (tag === '*') return DEFAULT_LOCALE;
    const primary = tag.split('-')[0] ?? '';
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
