import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocale } from '../../lib/i18n/useLocale';

const LOCALE_KEY = 'madrona-visitor-locale';

describe('useLocale', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset navigator.language mock
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'en-US',
    });
  });

  it('defaults to English when no stored locale and browser is en-*', () => {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'en-US',
    });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('en');
  });

  it('detects browser locale (Spanish) when no stored locale', () => {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'es-MX',
    });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('es');
  });

  it('falls back to English for unsupported browser locale', () => {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'ko-KR',
    });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('en');
  });

  it('uses stored locale when valid', () => {
    localStorage.setItem(LOCALE_KEY, 'fr');
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('fr');
  });

  it('ignores invalid stored locale and detects from browser', () => {
    localStorage.setItem(LOCALE_KEY, 'xx');
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'de-DE',
    });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('de');
  });

  it('persists locale to localStorage when setLocale is called', () => {
    const { result } = renderHook(() => useLocale());
    act(() => {
      result.current.setLocale('ja');
    });
    expect(result.current.locale).toBe('ja');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('ja');
  });

  it('returns translated strings matching the current locale', () => {
    localStorage.setItem(LOCALE_KEY, 'es');
    const { result } = renderHook(() => useLocale());
    expect(result.current.strings.sendLabel).toBe('Enviar mensaje');
  });

  it('updates strings when locale changes', () => {
    const { result } = renderHook(() => useLocale());
    act(() => {
      result.current.setLocale('zh');
    });
    expect(result.current.strings.languageLabel).toBe('语言');
  });

  it('handles missing navigator.language gracefully', () => {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: '',
    });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('en');
  });
});
