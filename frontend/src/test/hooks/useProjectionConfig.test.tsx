import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProjectionConfig, getScopeProfile } from '../../hooks/useProjectionConfig';
import * as api from '../../lib/api';
import * as resolver from '../../lib/projectionResolver';

// Mock dependencies
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(() => ({
    activeOrganizationId: 'org-123',
  })),
}));

vi.mock('../../lib/api', () => ({
  getProjectionProfiles: vi.fn(),
}));

vi.mock('../../lib/projectionResolver', () => ({
  getDefaultProjectionConfig: vi.fn(() => ({
    profiles: {
      entity_detail: { title: ['name'], subtitle: ['description'] },
      entities_list: { title: ['name'] },
      search: { title: ['name'] },
    },
  })),
}));

import { useOrganization } from '../../contexts/useOrganization';

const mockUseOrganization = vi.mocked(useOrganization);
const mockGetProjectionProfiles = vi.mocked(api.getProjectionProfiles);
const mockGetDefaultConfig = vi.mocked(resolver.getDefaultProjectionConfig);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useProjectionConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as any);
  });

  describe('when no organization', () => {
    beforeEach(() => {
      mockUseOrganization.mockReturnValue({
        activeOrganizationId: null,
      } as any);
    });

    it('returns default config', () => {
      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      expect(mockGetDefaultConfig).toHaveBeenCalled();
      expect(result.current.config).toBeDefined();
    });

    it('sets isDefault to true', () => {
      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isDefault).toBe(true);
    });

    it('sets isLoading to false', () => {
      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('does not call API', () => {
      renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      expect(mockGetProjectionProfiles).not.toHaveBeenCalled();
    });
  });

  describe('when organization is set', () => {
    it('returns loading true initially', () => {
      mockGetProjectionProfiles.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('calls API with organization ID', async () => {
      mockGetProjectionProfiles.mockResolvedValue({
        config: { profiles: {} },
        is_default: false,
      } as any);

      renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockGetProjectionProfiles).toHaveBeenCalledWith('org-123');
      });
    });

    it('uses orgId override when provided', async () => {
      mockGetProjectionProfiles.mockResolvedValue({
        config: { profiles: {} },
        is_default: false,
      } as any);

      renderHook(() => useProjectionConfig('override-org'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockGetProjectionProfiles).toHaveBeenCalledWith('override-org');
      });
    });

    it('returns config from API', async () => {
      const mockConfig = {
        profiles: {
          entity_detail: { title: ['custom_title'] },
          entities_list: { title: ['name'] },
          search: { title: ['name'] },
        },
      };

      mockGetProjectionProfiles.mockResolvedValue({
        config: mockConfig,
        is_default: false,
      } as any);

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.config).toEqual(mockConfig);
      });
    });

    it('sets isDefault from API response', async () => {
      mockGetProjectionProfiles.mockResolvedValue({
        config: { profiles: {} },
        is_default: false,
      } as any);

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isDefault).toBe(false);
      });
    });

    it('sets isLoading false after fetch', async () => {
      mockGetProjectionProfiles.mockResolvedValue({
        config: { profiles: {} },
        is_default: true,
      } as any);

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('sets error to null on success', async () => {
      mockGetProjectionProfiles.mockResolvedValue({
        config: { profiles: {} },
        is_default: true,
      } as any);

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe('error handling', () => {
    it('returns error on failure', async () => {
      const testError = new Error('API Error');
      mockGetProjectionProfiles.mockRejectedValue(testError);

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBe(testError);
      });
    });

    it('returns default config on error', async () => {
      mockGetProjectionProfiles.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockGetDefaultConfig).toHaveBeenCalled();
        expect(result.current.config).toBeDefined();
      });
    });

    it('sets isDefault true on error', async () => {
      mockGetProjectionProfiles.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useProjectionConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isDefault).toBe(true);
      });
    });
  });
});

describe('getScopeProfile', () => {
  const mockConfig = {
    profiles: {
      entity_detail: { title: ['detail_title'], subtitle: ['detail_subtitle'] },
      entities_list: { title: ['list_title'] },
      search: { title: ['search_title'], snippet: ['description'] },
    },
  };

  it('returns entity_detail profile', () => {
    const profile = getScopeProfile(mockConfig as any, 'entity_detail');
    expect(profile).toEqual(mockConfig.profiles.entity_detail);
  });

  it('returns entities_list profile', () => {
    const profile = getScopeProfile(mockConfig as any, 'entities_list');
    expect(profile).toEqual(mockConfig.profiles.entities_list);
  });

  it('returns search profile', () => {
    const profile = getScopeProfile(mockConfig as any, 'search');
    expect(profile).toEqual(mockConfig.profiles.search);
  });
});
