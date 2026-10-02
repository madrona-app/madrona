import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFeatureFlag, setFeatureFlag, FEATURE_FLAGS } from '../../lib/featureFlags';

const originalLocation = window.location;

function setSearch(search: string) {
  // jsdom Location is read-only, so replace it with a stub.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, search } as Location,
  });
}

describe('featureFlags', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  describe('getFeatureFlag', () => {
    it('returns false by default when no param or storage value is set', () => {
      setSearch('');
      expect(getFeatureFlag('foo')).toBe(false);
    });

    it('reads from localStorage when no query param is present', () => {
      setSearch('');
      window.localStorage.setItem('ff:foo', 'true');
      expect(getFeatureFlag('foo')).toBe(true);
    });

    it('treats anything other than literal "true" in storage as false', () => {
      setSearch('');
      window.localStorage.setItem('ff:foo', 'yes');
      expect(getFeatureFlag('foo')).toBe(false);
    });

    it('enables the flag from ?ff_<key>=1 and persists to storage', () => {
      setSearch('?ff_foo=1');
      expect(getFeatureFlag('foo')).toBe(true);
      expect(window.localStorage.getItem('ff:foo')).toBe('true');
    });

    it('enables the flag from ?ff_<key>=true', () => {
      setSearch('?ff_foo=true');
      expect(getFeatureFlag('foo')).toBe(true);
    });

    it('disables the flag from ?ff_<key>=0 and overwrites storage', () => {
      window.localStorage.setItem('ff:foo', 'true');
      setSearch('?ff_foo=0');
      expect(getFeatureFlag('foo')).toBe(false);
      expect(window.localStorage.getItem('ff:foo')).toBe('false');
    });

    it('disables the flag from ?ff_<key>=false', () => {
      setSearch('?ff_foo=false');
      expect(getFeatureFlag('foo')).toBe(false);
    });

    it('ignores other unrelated query params', () => {
      setSearch('?somethingelse=1');
      expect(getFeatureFlag('foo')).toBe(false);
    });

    it('returns false when window is undefined (SSR guard)', () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error - simulating SSR
      delete globalThis.window;
      expect(getFeatureFlag('foo')).toBe(false);
      globalThis.window = originalWindow;
    });
  });

  describe('setFeatureFlag', () => {
    it('persists "true" when enabled', () => {
      setFeatureFlag('foo', true);
      expect(window.localStorage.getItem('ff:foo')).toBe('true');
    });

    it('persists "false" when disabled', () => {
      setFeatureFlag('foo', false);
      expect(window.localStorage.getItem('ff:foo')).toBe('false');
    });

    it('round-trips with getFeatureFlag', () => {
      setSearch('');
      setFeatureFlag('roundtrip', true);
      expect(getFeatureFlag('roundtrip')).toBe(true);
      setFeatureFlag('roundtrip', false);
      expect(getFeatureFlag('roundtrip')).toBe(false);
    });

    it('is a no-op when window is undefined', () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error - simulating SSR
      delete globalThis.window;
      // Should not throw
      expect(() => setFeatureFlag('foo', true)).not.toThrow();
      globalThis.window = originalWindow;
    });
  });

  describe('FEATURE_FLAGS constants', () => {
    it('exposes the HOME_V2 flag key', () => {
      expect(FEATURE_FLAGS.HOME_V2).toBe('home-v2');
    });
  });
});
