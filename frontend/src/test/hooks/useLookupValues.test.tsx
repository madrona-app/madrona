import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLookupValues } from '../../hooks/useLookupValues';

// Mock useOrganization
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn().mockReturnValue({
    activeOrganizationId: 'org-1',
  }),
}));

// Mock API
vi.mock('../../lib/api', () => ({
  getAllLookups: vi.fn(),
  getLookupCategory: vi.fn(),
}));

import { getAllLookups } from '../../lib/api';
const mockGetAllLookups = getAllLookups as ReturnType<typeof vi.fn>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

const mockCategories = [
  {
    category_key: 'acquisition_method',
    values: [
      { value_key: 'purchase', label: 'Purchase', description: 'Bought', icon_name: null },
      { value_key: 'gift', label: 'Gift', description: null, icon_name: 'gift' },
    ],
  },
  {
    category_key: 'condition_grade',
    values: [
      { value_key: 'excellent', label: 'Excellent', description: null, icon_name: null },
      { value_key: 'good', label: 'Good', description: null, icon_name: null },
    ],
  },
];

describe('useLookupValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllLookups.mockReset();
  });

  describe('loading state', () => {
    it('starts in loading state', () => {
      mockGetAllLookups.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useLookupValues(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.categories).toEqual([]);
    });
  });

  describe('successful data fetch', () => {
    it('fetches and maps lookup values', async () => {
      mockGetAllLookups.mockResolvedValue(mockCategories);

      const { result } = renderHook(() => useLookupValues(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.categories).toHaveLength(2);
    });

    it('getLookup returns options for a category', async () => {
      mockGetAllLookups.mockResolvedValue(mockCategories);

      const { result } = renderHook(() => useLookupValues(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const options = result.current.getLookup('acquisition_method');
      expect(options).toEqual([
        { value: 'purchase', label: 'Purchase', description: 'Bought', icon: undefined },
        { value: 'gift', label: 'Gift', description: undefined, icon: 'gift' },
      ]);
    });

    it('getLookup returns empty array for unknown category', async () => {
      mockGetAllLookups.mockResolvedValue(mockCategories);

      const { result } = renderHook(() => useLookupValues(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.getLookup('nonexistent')).toEqual([]);
    });

    it('getLabel returns label for known value', async () => {
      mockGetAllLookups.mockResolvedValue(mockCategories);

      const { result } = renderHook(() => useLookupValues(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.getLabel('acquisition_method', 'purchase')).toBe('Purchase');
    });

    it('getLabel returns valueKey as fallback', async () => {
      mockGetAllLookups.mockResolvedValue(mockCategories);

      const { result } = renderHook(() => useLookupValues(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.getLabel('acquisition_method', 'unknown')).toBe('unknown');
      expect(result.current.getLabel('nonexistent', 'any')).toBe('any');
    });
  });

  describe('error handling', () => {
    it('sets error on fetch failure', async () => {
      mockGetAllLookups.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useLookupValues(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  describe('options', () => {
    it('passes context to API call', async () => {
      mockGetAllLookups.mockResolvedValue([]);

      renderHook(() => useLookupValues({ context: 'acquisitions' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockGetAllLookups).toHaveBeenCalledWith('org-1', {
          context: 'acquisitions',
          include_hidden: false,
        });
      });
    });

    it('does not fetch when disabled', () => {
      const { result } = renderHook(() => useLookupValues({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(mockGetAllLookups).not.toHaveBeenCalled();
      expect(result.current.isLoading).toBe(false);
    });
  });
});
