/**
 * Tests for useSectionState — section expand/collapse + nav id management.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSectionState } from '../../../pages/collections/CollectionObjectWorkspacePage/hooks';
import {
  ALL_SECTION_IDS,
  CREATE_MODE_EXCLUDE,
} from '../../../pages/collections/CollectionObjectWorkspacePage/types';
import { makeCollectionObject } from './fixtures';
import { SectionOrderProvider } from '../../../components/record-detail';

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// SectionOrderProvider reads auth context for per-user persistence; stub it out.
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { user_id: 'u-1', permissions: [] },
    isAuthenticated: true,
    isLoading: false,
    isPlatformAdmin: false,
    roleOverride: null,
    activeOrganizationId: 'org-1',
    memberships: [],
    applications: [],
    error: null,
    setRoleOverride: vi.fn(),
    hasAppAccess: () => true,
    refreshMe: vi.fn(),
    setActiveOrganization: vi.fn(),
    logout: vi.fn(),
  }),
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SectionOrderProvider>{children}</SectionOrderProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return Wrapper;
}

describe('useSectionState', () => {
  describe('sectionIds (nav order)', () => {
    it('returns the full section list outside create mode', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false),
        { wrapper: Wrapper },
      );
      expect(result.current.sectionIds).toEqual(ALL_SECTION_IDS);
    });

    it('excludes post-creation sections in create mode', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(undefined, true),
        { wrapper: Wrapper },
      );
      for (const excluded of CREATE_MODE_EXCLUDE) {
        expect(result.current.sectionIds).not.toContain(excluded);
      }
      // identification + description survive
      expect(result.current.sectionIds).toContain('identification');
      expect(result.current.sectionIds).toContain('description');
    });
  });

  describe('initial expanded state', () => {
    it('starts with all sections collapsed when there is no object', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(undefined, true),
        { wrapper: Wrapper },
      );
      for (const value of Object.values(result.current.expandedSections)) {
        expect(value).toBe(false);
      }
    });

    it('auto-expands the identification section once the object is loaded', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false, {}),
        { wrapper: Wrapper },
      );
      expect(result.current.expandedSections.identification).toBe(true);
    });
  });

  describe('toggleSection', () => {
    it('opens a collapsed section and raises it via the raise callback', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false, {}),
        { wrapper: Wrapper },
      );

      const raise = vi.fn();
      act(() => {
        result.current.toggleSection('rights', raise);
      });
      expect(result.current.expandedSections.rights).toBe(true);
      expect(raise).toHaveBeenCalledWith('rights');
    });

    it('collapses an already-expanded section', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false, {}),
        { wrapper: Wrapper },
      );

      const raise = vi.fn();
      act(() => {
        result.current.toggleSection('description', raise);
      });
      expect(result.current.expandedSections.description).toBe(true);

      act(() => {
        result.current.toggleSection('description', raise);
      });
      expect(result.current.expandedSections.description).toBe(false);
    });

    it('opens only one section at a time (accordion)', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false, {}),
        { wrapper: Wrapper },
      );

      const raise = vi.fn();
      act(() => {
        result.current.toggleSection('description', raise);
      });
      act(() => {
        result.current.toggleSection('physical', raise);
      });

      // physical should be expanded; description should be collapsed
      expect(result.current.expandedSections.physical).toBe(true);
      expect(result.current.expandedSections.description).toBe(false);
    });
  });

  describe('getSectionOrder', () => {
    it('returns a number for every known section id', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false, {}),
        { wrapper: Wrapper },
      );
      for (const id of ALL_SECTION_IDS) {
        expect(typeof result.current.getSectionOrder(id)).toBe('number');
      }
    });

    it('returns 999 (fallback) for unknown section ids', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false, {}),
        { wrapper: Wrapper },
      );
      expect(result.current.getSectionOrder('unknown-section')).toBe(999);
    });
  });

  describe('refs', () => {
    it('exposes a sectionRefs ref object initialized to {}', () => {
      const Wrapper = makeWrapper();
      const { result } = renderHook(
        () => useSectionState(makeCollectionObject(), false, {}),
        { wrapper: Wrapper },
      );
      expect(result.current.sectionRefs.current).toEqual({});
    });
  });
});
