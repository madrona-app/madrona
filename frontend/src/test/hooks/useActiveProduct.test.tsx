import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useActiveProduct, getProductLandingPath, getDefaultLandingPath } from '../../hooks/useActiveProduct';
import type { Application } from '../../contexts/AuthContext';

function createWrapper(initialRoute: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialRoute]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useActiveProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('product detection from URL', () => {
    it('detects collections product from URL', () => {
      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/collections/objects'),
      });

      expect(result.current.activeProductId).toBe('collections');
      expect(result.current.isInProduct).toBe(true);
    });

    it('detects media product from URL', () => {
      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/media'),
      });

      expect(result.current.activeProductId).toBe('media');
      expect(result.current.isInProduct).toBe(true);
    });

    it('detects guide product from URL', () => {
      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/guide/chat'),
      });

      expect(result.current.activeProductId).toBe('guide');
      expect(result.current.isInProduct).toBe(true);
    });

    it('returns null for non-matching paths', () => {
      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/login'),
      });

      expect(result.current.activeProduct).toBeNull();
      expect(result.current.activeProductId).toBeNull();
      expect(result.current.isInProduct).toBe(false);
    });
  });

  describe('non-product pages', () => {
    it('preserves last active product on admin pages', () => {
      localStorage.setItem('madrona_last_active_product', 'collections');

      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/admin'),
      });

      expect(result.current.activeProductId).toBe('collections');
      expect(result.current.isInProduct).toBe(false);
    });

    it('preserves last active product on settings pages', () => {
      localStorage.setItem('madrona_last_active_product', 'bridge');

      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/settings'),
      });

      expect(result.current.activeProductId).toBe('bridge');
      expect(result.current.isInProduct).toBe(false);
    });

    it('preserves last active product on the home page (regression: home used to empty the nav)', () => {
      localStorage.setItem('madrona_last_active_product', 'collections');

      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/home'),
      });

      // home is not a product segment and is not in any allow-list; the
      // fail-safe default must keep the last product's nav rendered.
      expect(result.current.activeProductId).toBe('collections');
      expect(result.current.isInProduct).toBe(false);
    });

    it('preserves last active product on any unknown top-level segment', () => {
      localStorage.setItem('madrona_last_active_product', 'media');

      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/some-future-page'),
      });

      expect(result.current.activeProductId).toBe('media');
      expect(result.current.isInProduct).toBe(false);
    });

    it('returns null when no last product and on non-product page', () => {
      const { result } = renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/admin'),
      });

      expect(result.current.activeProductId).toBeNull();
      expect(result.current.isInProduct).toBe(false);
    });
  });

  describe('localStorage persistence', () => {
    it('saves active product to localStorage', () => {
      renderHook(() => useActiveProduct(), {
        wrapper: createWrapper('/organizations/org-1/collections/objects'),
      });

      expect(localStorage.getItem('madrona_last_active_product')).toBe('collections');
    });
  });
});

describe('getProductLandingPath', () => {
  it('returns correct path for collections', () => {
    expect(getProductLandingPath('collections', 'org-1')).toBe('/organizations/org-1/collections/objects');
  });

  it('returns default path for unknown product', () => {
    expect(getProductLandingPath('unknown', 'org-1')).toBe('/organizations/org-1/collections/objects');
  });
});

describe('getDefaultLandingPath', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const makeApp = (key: string, enabled = true, status: 'active' | 'coming_soon' = 'active'): Application => ({
    key,
    display_name: key,
    status,
    enabled,
  });

  it('returns last-used product if still enabled', () => {
    localStorage.setItem('madrona_last_active_product', 'bridge');
    const apps = [makeApp('collections'), makeApp('bridge')];
    expect(getDefaultLandingPath('org-1', apps)).toBe('/organizations/org-1/bridge');
  });

  it('falls back to first enabled app by display order', () => {
    // productOrder is ['collections', 'bridge', 'media', 'content', 'guide']
    // so collections wins even though bridge is first in the apps array
    const apps = [makeApp('bridge'), makeApp('collections')];
    expect(getDefaultLandingPath('org-1', apps)).toBe('/organizations/org-1/collections/objects');

    // When only bridge is enabled, bridge wins
    const bridgeOnly = [makeApp('bridge'), makeApp('collections', false)];
    expect(getDefaultLandingPath('org-1', bridgeOnly)).toBe('/organizations/org-1/bridge');
  });

  it('falls back to home, not a disabled app, when nothing is enabled', () => {
    // Landing on an app that is switched off drops the user straight onto
    // the blocked-access dialog at sign-in. Home is never app-gated.
    expect(getDefaultLandingPath('org-1', [])).toBe('/organizations/org-1/home');
  });

  it('skips disabled apps', () => {
    const apps = [makeApp('collections', false), makeApp('bridge')];
    expect(getDefaultLandingPath('org-1', apps)).toBe('/organizations/org-1/bridge');
  });
});
