/**
 * Visitor locale hook.
 *
 * Persists locale preference in localStorage and provides translated
 * chat strings. Detects browser language on first visit.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  SUPPORTED_LOCALES,
  getChatStrings,
  type SupportedLocale,
  type ChatStrings,
} from './locales';

const LOCALE_KEY = 'madrona-visitor-locale';

function detectBrowserLocale(): SupportedLocale {
  const lang = navigator.language?.split('-')[0]?.toLowerCase();
  if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
    return lang as SupportedLocale;
  }
  return 'en';
}

export function useLocale() {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as SupportedLocale;
    }
    return detectBrowserLocale();
  });

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LOCALE_KEY, newLocale);
  }, []);

  const strings: ChatStrings = useMemo(() => getChatStrings(locale), [locale]);

  return { locale, setLocale, strings };
}
