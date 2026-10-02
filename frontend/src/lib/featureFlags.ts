/**
 * Minimal client-side feature flags.
 *
 * Read order: URL query param (`?ff_<key>=1` or `=0`) → localStorage → default off.
 * Setting via query param persists to localStorage for the session, so a single
 * shared link enables a flag for the recipient without further config.
 */

const STORAGE_PREFIX = 'ff:';

export function getFeatureFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;

  const param = new URLSearchParams(window.location.search).get(`ff_${key}`);
  if (param === '1' || param === 'true') {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, 'true');
    return true;
  }
  if (param === '0' || param === 'false') {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, 'false');
    return false;
  }

  return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) === 'true';
}

export function setFeatureFlag(key: string, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(enabled));
}

export const FEATURE_FLAGS = {
  HOME_V2: 'home-v2',
} as const;
