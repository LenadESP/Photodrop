import { CATALOGUES, nextLocale, useI18n } from '../i18n';

// Mirrors ThemeToggle: same 8×8 hit area, same hover treatment, sits next to it.
//
// The label is the CURRENT language, not the one you'd switch to — the standard
// language-switcher convention, and the one that stays readable past two
// languages. What the click does is in the aria-label instead, named with the
// next language's endonym ("Cambiar a English") so it is legible to someone who
// can't read the language currently on screen.
export function LangToggle() {
  const { locale, toggleLocale, t } = useI18n();
  const next = nextLocale(locale);
  const nextName = CATALOGUES[next]['lang.name'];

  return (
    <button
      onClick={toggleLocale}
      aria-label={t('lang.switchTo', { language: nextName })}
      title={nextName}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink/5"
    >
      {locale}
    </button>
  );
}
