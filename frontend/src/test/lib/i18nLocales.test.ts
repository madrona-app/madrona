import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  getChatStrings,
} from '../../lib/i18n/locales';

describe('i18n/locales', () => {
  describe('SUPPORTED_LOCALES', () => {
    it('includes the expected locales', () => {
      expect(SUPPORTED_LOCALES).toEqual(['en', 'es', 'fr', 'zh', 'ja', 'de']);
    });

    it('is non-empty', () => {
      expect(SUPPORTED_LOCALES.length).toBeGreaterThan(0);
    });
  });

  describe('LOCALE_LABELS', () => {
    it('has a label for every supported locale', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(LOCALE_LABELS[locale]).toBeTruthy();
        expect(typeof LOCALE_LABELS[locale]).toBe('string');
      }
    });

    it('uses native-language labels (e.g. Español for es)', () => {
      expect(LOCALE_LABELS.en).toBe('English');
      expect(LOCALE_LABELS.es).toBe('Español');
      expect(LOCALE_LABELS.fr).toBe('Français');
      expect(LOCALE_LABELS.zh).toBe('中文');
      expect(LOCALE_LABELS.ja).toBe('日本語');
      expect(LOCALE_LABELS.de).toBe('Deutsch');
    });
  });

  describe('getChatStrings', () => {
    it('returns English strings for "en"', () => {
      const strings = getChatStrings('en');
      expect(strings.welcome).toContain('Madrona');
      expect(strings.placeholder).toBeTruthy();
      expect(strings.sendLabel).toBe('Send message');
    });

    it('returns Spanish strings for "es"', () => {
      const strings = getChatStrings('es');
      expect(strings.sendLabel).toBe('Enviar mensaje');
      expect(strings.languageLabel).toBe('Idioma');
    });

    it('returns French strings for "fr"', () => {
      const strings = getChatStrings('fr');
      expect(strings.sendLabel).toBe('Envoyer le message');
    });

    it('returns Chinese strings for "zh"', () => {
      const strings = getChatStrings('zh');
      expect(strings.languageLabel).toBe('语言');
    });

    it('returns Japanese strings for "ja"', () => {
      const strings = getChatStrings('ja');
      expect(strings.languageLabel).toBe('言語');
    });

    it('returns German strings for "de"', () => {
      const strings = getChatStrings('de');
      expect(strings.languageLabel).toBe('Sprache');
    });

    it('falls back to English for unknown locales', () => {
      const unknown = getChatStrings('xx');
      const en = getChatStrings('en');
      expect(unknown).toEqual(en);
    });

    it('falls back to English for empty string', () => {
      const empty = getChatStrings('');
      const en = getChatStrings('en');
      expect(empty).toEqual(en);
    });

    it('returns all required ChatStrings keys for each locale', () => {
      const requiredKeys: Array<keyof ReturnType<typeof getChatStrings>> = [
        'welcome',
        'placeholder',
        'sendLabel',
        'openLabel',
        'minimizeLabel',
        'headerTitle',
        'languageLabel',
        'errorGeneric',
        'errorRateLimit',
      ];
      for (const locale of SUPPORTED_LOCALES) {
        const strings = getChatStrings(locale);
        for (const key of requiredKeys) {
          expect(strings[key]).toBeTruthy();
          expect(typeof strings[key]).toBe('string');
        }
      }
    });

    it('uses Madrona as the headerTitle in all locales', () => {
      for (const locale of SUPPORTED_LOCALES) {
        const strings = getChatStrings(locale);
        expect(strings.headerTitle).toBe('Madrona');
      }
    });
  });
});
