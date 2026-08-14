import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type Catalogue, type Message, type MessageKey, type PluralForms } from './locales/en';
import { es } from './locales/es';

// Adding a language is two lines: a catalogue file, and an entry here. The
// toggle cycles this registry in order, so nothing else enumerates locales.
export const CATALOGUES = { en, es } satisfies Record<string, Catalogue>;

export type Locale = keyof typeof CATALOGUES;

export const SUPPORTED_LOCALES = Object.keys(CATALOGUES) as Locale[];
export const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'lang';

const isLocale = (v: string): v is Locale =>
  Object.prototype.hasOwnProperty.call(CATALOGUES, v);

export type TParams = Record<string, string | number>;

/**
 * The locale the API should answer in.
 *
 * `lib/api.ts` is a plain module, not a component, so it reads this rather than
 * a hook. It matters that the header follows the *chosen* language and not the
 * browser's own Accept-Language: the server renders all error text, and an
 * English-in-Spanish-UI error is exactly the seam this release exists to close.
 */
let activeLocale: Locale = DEFAULT_LOCALE;
export const getActiveLocale = (): Locale => activeLocale;

/**
 * Resolve the language to open with: an explicit past choice wins, otherwise the
 * device language decides, otherwise English.
 *
 * `navigator.languages` is in the user's own preference order, so the first
 * entry we actually support wins — a device set to [ca, es, en] gets Spanish
 * rather than English. Region subtags are dropped (es-419 and es-ES are both es).
 */
export function resolveInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLocale(saved)) return saved;
  } catch {
    // Safari in private mode throws on localStorage access; fall through to the
    // device language rather than failing to render.
  }

  const preferences = navigator.languages ?? [navigator.language];
  for (const tag of preferences) {
    const primary = tag.toLowerCase().split('-')[0] ?? '';
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * Point the document at a locale. Called once before first paint (main.tsx) and
 * again on every switch, so `<html lang>` always matches what is on screen —
 * screen readers pick their voice from it, and it drives CSS hyphenation.
 */
export function applyLocale(locale: Locale): void {
  activeLocale = locale;
  document.documentElement.lang = locale;
}

/** The next locale in the registry, wrapping around. Two entries = a toggle. */
export const nextLocale = (current: Locale): Locale =>
  SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(current) + 1) % SUPPORTED_LOCALES.length] ??
  DEFAULT_LOCALE;

const interpolate = (template: string, params?: TParams): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    : template;

function selectForm(forms: PluralForms, locale: Locale, count: number): string {
  const category = new Intl.PluralRules(locale).select(count);
  // `other` is required by the type, so this is always a string.
  return forms[category] ?? forms.other;
}

function translate(locale: Locale, key: MessageKey, params?: TParams): string {
  // Per-key fallback to English: a key missing from a locale is a compile error,
  // so this only fires for a hand-edited build — better English than a raw key.
  const message: Message = CATALOGUES[locale][key] ?? en[key];

  if (typeof message === 'string') return interpolate(message, params);

  const count = typeof params?.count === 'number' ? params.count : 0;
  return interpolate(selectForm(message, locale, count), params);
}

/**
 * Translate outside React, against the active locale.
 *
 * For the plain modules under lib/ that throw Errors the UI ends up rendering
 * (a cancelled upload, a failed part). They have no hook available, and the
 * message is read at throw time, so the active locale is the right one.
 */
export const tr = (key: MessageKey, params?: TParams): string =>
  translate(activeLocale, key, params);

export interface I18n {
  locale: Locale;
  /** Translate a key. Pluralised keys read `params.count`. */
  t: (key: MessageKey, params?: TParams) => string;
  /** A date in the active locale — never the browser default, which may differ. */
  formatDate: (value: number | Date) => string;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // main.tsx has already resolved and applied this before first paint; reading
  // it again here keeps the two in step without a second source of truth.
  const [locale, setLocaleState] = useState<Locale>(getActiveLocale);

  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the choice holds for this tab, just not across reloads.
    }
    setLocaleState(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      formatDate: (value) => new Date(value).toLocaleDateString(locale),
      setLocale,
      toggleLocale: () => setLocale(nextLocale(locale)),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Shorthand for the common case — `const t = useT()`. */
export const useT = (): I18n['t'] => useI18n().t;
