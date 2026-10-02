import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFlowPreferences } from '../../hooks/useFlowPreferences';
import type { Dataset } from '../../lib/schemas';

// Mock the API module
vi.mock('../../lib/api', () => ({
  getOverviewPreferences: vi.fn(),
  updateOverviewPreferences: vi.fn(),
}));

import { getOverviewPreferences, updateOverviewPreferences } from '../../lib/api';

const mockGetPreferences = getOverviewPreferences as ReturnType<typeof vi.fn>;
const mockUpdatePreferences = updateOverviewPreferences as ReturnType<typeof vi.fn>;

function makeDataset(id: string, createdAt?: string): Dataset {
  return {
    dataset_id: id,
    name: `Dataset ${id}`,
    created_at: createdAt || new Date().toISOString(),
  } as Dataset;
}

describe('useFlowPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPreferences.mockResolvedValue(null);
    mockUpdatePreferences.mockResolvedValue(undefined);
  });

  describe('initialization', () => {
    it('starts with empty selected IDs and loads preferences', async () => {
      mockGetPreferences.mockResolvedValue({
        visible_dataset_ids: ['ds-1', 'ds-2'],
        dataset_order: ['ds-1', 'ds-2'],
      });

      const datasets = [makeDataset('ds-1'), makeDataset('ds-2')];
      const { result } = renderHook(() => useFlowPreferences({ datasets }));

      await waitFor(() => {
        expect(result.current.preferencesLoaded).toBe(true);
      });

      expect(result.current.selectedDatasetIds).toEqual(new Set(['ds-1', 'ds-2']));
    });

    it('prunes saved visibility IDs whose datasets no longer exist', async () => {
      mockGetPreferences.mockResolvedValue({
        visible_dataset_ids: ['ds-1', 'ds-stale'],
        dataset_order: ['ds-1', 'ds-stale'],
      });

      const datasets = [makeDataset('ds-1'), makeDataset('ds-2')];
      const { result } = renderHook(() => useFlowPreferences({ datasets }));

      await waitFor(() => {
        expect(result.current.preferencesLoaded).toBe(true);
      });
      // Selection loses the stale ID; order is reconciled to live datasets.
      await waitFor(() => {
        expect(result.current.selectedDatasetIds).toEqual(new Set(['ds-1']));
      });
      expect(result.current.datasetOrder).not.toContain('ds-stale');

      // A subsequent save must not round-trip the stale ID.
      await act(async () => {
        await result.current.savePreferences();
      });
      const payload = mockUpdatePreferences.mock.calls.at(-1)?.[0];
      expect(payload.visible_dataset_ids).not.toContain('ds-stale');
      expect(payload.dataset_order).not.toContain('ds-stale');
    });

    it('sets preferencesLoaded to true even on API error', async () => {
      mockGetPreferences.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useFlowPreferences({ datasets: [] }));

      await waitFor(() => {
        expect(result.current.preferencesLoaded).toBe(true);
      });
    });

    it('handles null API response gracefully', async () => {
      mockGetPreferences.mockResolvedValue(null);

      const { result } = renderHook(() => useFlowPreferences({ datasets: [] }));

      await waitFor(() => {
        expect(result.current.preferencesLoaded).toBe(true);
      });

      expect(result.current.selectedDatasetIds.size).toBe(0);
    });
  });

  describe('dataset ordering', () => {
    it('initializes order from all datasets when no saved order', async () => {
      mockGetPreferences.mockResolvedValue(null);

      const datasets = [
        makeDataset('ds-1', '2024-01-01'),
        makeDataset('ds-2', '2024-06-01'),
        makeDataset('ds-3', '2024-03-01'),
      ];

      const { result } = renderHook(() => useFlowPreferences({ datasets }));

      await waitFor(() => {
        expect(result.current.datasetOrder.length).toBe(3);
      });

      // Should be sorted by created_at desc
      expect(result.current.datasetOrder[0]).toBe('ds-2');
    });
  });

  describe('savePreferences', () => {
    it('calls API with current state', async () => {
      mockGetPreferences.mockResolvedValue({
        visible_dataset_ids: ['ds-1'],
        dataset_order: ['ds-1'],
      });

      const datasets = [makeDataset('ds-1')];
      const { result } = renderHook(() => useFlowPreferences({ datasets }));

      await waitFor(() => {
        expect(result.current.preferencesLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.savePreferences();
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          visible_dataset_ids: ['ds-1'],
        })
      );
    });

    it('allows overrides when saving', async () => {
      mockGetPreferences.mockResolvedValue({
        visible_dataset_ids: ['ds-1'],
        dataset_order: ['ds-1'],
      });

      const datasets = [makeDataset('ds-1')];
      const { result } = renderHook(() => useFlowPreferences({ datasets }));

      await waitFor(() => {
        expect(result.current.preferencesLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.savePreferences({ visible_dataset_ids: ['ds-2', 'ds-3'] });
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          visible_dataset_ids: ['ds-2', 'ds-3'],
        })
      );
    });
  });

  describe('clearPreferences', () => {
    it('resets selectedDatasetIds to empty', async () => {
      mockGetPreferences.mockResolvedValue({
        visible_dataset_ids: ['ds-1', 'ds-2'],
        dataset_order: ['ds-1', 'ds-2'],
      });

      const datasets = [makeDataset('ds-1'), makeDataset('ds-2')];
      const { result } = renderHook(() => useFlowPreferences({ datasets }));

      await waitFor(() => {
        expect(result.current.selectedDatasetIds.size).toBe(2);
      });

      act(() => {
        result.current.clearPreferences();
      });

      expect(result.current.selectedDatasetIds.size).toBe(0);
    });
  });
});
