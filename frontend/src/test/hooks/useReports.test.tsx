import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useReports } from '../../hooks/useReports';
import * as api from '../../lib/api';

// Mock the dependencies
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getReportsSummary: vi.fn(),
  getDailyRuns: vi.fn(),
  getDatasetsSummary: vi.fn(),
}));

import { useOrganization } from '../../contexts/useOrganization';

const mockUseOrganization = vi.mocked(useOrganization);
const mockGetReportsSummary = vi.mocked(api.getReportsSummary);
const mockGetDailyRuns = vi.mocked(api.getDailyRuns);
const mockGetDatasetsSummary = vi.mocked(api.getDatasetsSummary);

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

describe('useReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as any);
  });

  describe('initial state', () => {
    it('returns loading state initially', () => {
      mockGetReportsSummary.mockReturnValue(new Promise(() => {}));
      mockGetDailyRuns.mockReturnValue(new Promise(() => {}));
      mockGetDatasetsSummary.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isError).toBe(false);
    });

    it('returns empty arrays for dailyRuns and datasets initially', () => {
      mockGetReportsSummary.mockReturnValue(new Promise(() => {}));
      mockGetDailyRuns.mockReturnValue(new Promise(() => {}));
      mockGetDatasetsSummary.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      expect(result.current.dailyRuns).toEqual([]);
      expect(result.current.datasets).toEqual([]);
    });
  });

  describe('successful data fetching', () => {
    const mockSummary = {
      total_entities: 1000,
      total_datasets: 5,
      total_runs: 50,
      success_rate: 95,
    };

    const mockDailyRunsResponse = {
      days: [
        { date: '2024-01-15', success: 10, failed: 2 },
        { date: '2024-01-14', success: 8, failed: 1 },
      ],
    };

    const mockDatasetsResponse = {
      datasets: [
        { dataset_id: 'ds-1', name: 'Dataset 1', entity_count: 100 },
      ],
    };

    beforeEach(() => {
      mockGetReportsSummary.mockResolvedValue(mockSummary as any);
      mockGetDailyRuns.mockResolvedValue(mockDailyRunsResponse as any);
      mockGetDatasetsSummary.mockResolvedValue(mockDatasetsResponse as any);
    });

    it('fetches summary data', async () => {
      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.summary).toEqual(mockSummary);
      });
    });

    it('fetches daily runs data', async () => {
      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.dailyRuns).toEqual(mockDailyRunsResponse.days);
      });
    });

    it('fetches datasets data', async () => {
      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.datasets).toEqual(mockDatasetsResponse.datasets);
      });
    });

    it('sets loading to false after all fetches complete', async () => {
      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('calls API with correct organization ID', async () => {
      renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockGetReportsSummary).toHaveBeenCalledWith('org-123', 30);
        expect(mockGetDailyRuns).toHaveBeenCalledWith('org-123', 30);
        expect(mockGetDatasetsSummary).toHaveBeenCalledWith('org-123');
      });
    });
  });

  describe('custom options', () => {
    beforeEach(() => {
      mockGetReportsSummary.mockResolvedValue({} as any);
      mockGetDailyRuns.mockResolvedValue({ days: [] } as any);
      mockGetDatasetsSummary.mockResolvedValue({ datasets: [] } as any);
    });

    it('uses custom days parameter', async () => {
      renderHook(() => useReports({ days: 7 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockGetReportsSummary).toHaveBeenCalledWith('org-123', 7);
        expect(mockGetDailyRuns).toHaveBeenCalledWith('org-123', 7);
      });
    });

    it('disables queries when enabled is false', () => {
      renderHook(() => useReports({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(mockGetReportsSummary).not.toHaveBeenCalled();
      expect(mockGetDailyRuns).not.toHaveBeenCalled();
      expect(mockGetDatasetsSummary).not.toHaveBeenCalled();
    });
  });

  describe('disabled when no organization', () => {
    it('does not fetch when no active organization', () => {
      mockUseOrganization.mockReturnValue({
        activeOrganizationId: null,
      } as any);

      renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      expect(mockGetReportsSummary).not.toHaveBeenCalled();
      expect(mockGetDailyRuns).not.toHaveBeenCalled();
      expect(mockGetDatasetsSummary).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('sets isError when summary fetch fails', async () => {
      mockGetReportsSummary.mockRejectedValue(new Error('Failed'));
      mockGetDailyRuns.mockResolvedValue({ days: [] } as any);
      mockGetDatasetsSummary.mockResolvedValue({ datasets: [] } as any);

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('sets isError when daily runs fetch fails', async () => {
      mockGetReportsSummary.mockResolvedValue({} as any);
      mockGetDailyRuns.mockRejectedValue(new Error('Failed'));
      mockGetDatasetsSummary.mockResolvedValue({ datasets: [] } as any);

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('sets isError when datasets fetch fails', async () => {
      mockGetReportsSummary.mockResolvedValue({} as any);
      mockGetDailyRuns.mockResolvedValue({ days: [] } as any);
      mockGetDatasetsSummary.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('returns error object', async () => {
      const testError = new Error('Test error');
      mockGetReportsSummary.mockRejectedValue(testError);
      mockGetDailyRuns.mockResolvedValue({ days: [] } as any);
      mockGetDatasetsSummary.mockResolvedValue({ datasets: [] } as any);

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBe(testError);
      });
    });
  });

  describe('refetch', () => {
    it('provides refetch function', async () => {
      mockGetReportsSummary.mockResolvedValue({} as any);
      mockGetDailyRuns.mockResolvedValue({ days: [] } as any);
      mockGetDatasetsSummary.mockResolvedValue({ datasets: [] } as any);

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(typeof result.current.refetch).toBe('function');
    });

    it('refetch triggers all queries', async () => {
      mockGetReportsSummary.mockResolvedValue({} as any);
      mockGetDailyRuns.mockResolvedValue({ days: [] } as any);
      mockGetDatasetsSummary.mockResolvedValue({ datasets: [] } as any);

      const { result } = renderHook(() => useReports(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Clear call counts
      mockGetReportsSummary.mockClear();
      mockGetDailyRuns.mockClear();
      mockGetDatasetsSummary.mockClear();

      result.current.refetch();

      await waitFor(() => {
        expect(mockGetReportsSummary).toHaveBeenCalled();
        expect(mockGetDailyRuns).toHaveBeenCalled();
        expect(mockGetDatasetsSummary).toHaveBeenCalled();
      });
    });
  });
});
