import { useEffect, useState, useCallback } from 'react';
import { getOverviewPreferences, updateOverviewPreferences } from '../lib/api';
import type { Dataset } from '../lib/schemas';

interface UseFlowPreferencesOptions {
  datasets: Dataset[];
}

interface UseFlowPreferencesReturn {
  selectedDatasetIds: Set<string>;
  datasetOrder: string[];
  preferencesLoaded: boolean;
  setSelectedDatasetIds: (ids: Set<string>) => void;
  setDatasetOrder: (order: string[]) => void;
  savePreferences: (overrides?: { visible_dataset_ids?: string[]; dataset_order?: string[] }) => Promise<void>;
  clearPreferences: () => void;
}

/**
 * Hook to manage user preferences for dataset visibility and ordering.
 * Handles loading from API and saving changes.
 */
export function useFlowPreferences({ datasets }: UseFlowPreferencesOptions): UseFlowPreferencesReturn {
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<Set<string>>(new Set());
  const [datasetOrder, setDatasetOrder] = useState<string[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  // Load preferences and initialize order when datasets change
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const preferencesData = await getOverviewPreferences();

        if (preferencesData && preferencesData.visible_dataset_ids.length > 0) {
          setSelectedDatasetIds(new Set(preferencesData.visible_dataset_ids));
          // If backend provides an explicit dataset_order, use it to initialize ordering
          if (preferencesData.dataset_order && Array.isArray(preferencesData.dataset_order) && preferencesData.dataset_order.length > 0) {
            setDatasetOrder(preferencesData.dataset_order);
          }
        }
      } catch {
        // Graceful fallback - use defaults
      } finally {
        setPreferencesLoaded(true);
      }
    };

    loadPreferences();
  }, []);

  // Ensure datasetOrder always includes all datasets (append any missing ones)
  // This handles the case where new datasets were created after preferences were saved
  useEffect(() => {
    if (datasets.length === 0) return;

    // Create a set of dataset IDs from the current datasets array
    const datasetIds = new Set(datasets.map((d) => d.dataset_id));

    // Prune the visibility selection the same way the order is pruned below —
    // a stale saved ID is invisible in the UI (no checkbox renders for it)
    // but would otherwise ride along on every save.
    const prunedSelection = Array.from(selectedDatasetIds).filter((id) => datasetIds.has(id));
    if (prunedSelection.length !== selectedDatasetIds.size) {
      setSelectedDatasetIds(new Set(prunedSelection));
    }

    const currentOrderSet = new Set(datasetOrder);

    // Find datasets that exist but aren't in the order
    const missingDatasets = datasets.filter((d) => !currentOrderSet.has(d.dataset_id));

    // Also filter out any IDs in order that no longer exist in datasets
    const validOrder = datasetOrder.filter((id) => datasetIds.has(id));

    if (validOrder.length === 0 && datasets.length > 0) {
      // No valid order exists - initialize with all datasets sorted by created_at desc
      const sortedByDate = [...datasets].sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      setDatasetOrder(sortedByDate.map((d) => d.dataset_id));
    } else if (missingDatasets.length > 0 || validOrder.length !== datasetOrder.length) {
      // Order exists but is missing some datasets or has stale IDs - fix it
      const missingSorted = missingDatasets.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      setDatasetOrder([...validOrder, ...missingSorted.map((d) => d.dataset_id)]);
    }
  }, [datasets, datasetOrder, selectedDatasetIds]);

  const savePreferences = useCallback(async (overrides?: { visible_dataset_ids?: string[]; dataset_order?: string[] }) => {
    const payload = {
      visible_dataset_ids: Array.from(selectedDatasetIds),
      dataset_order: datasetOrder,
      ...(overrides || {}),
    };

    await updateOverviewPreferences(payload);
  }, [selectedDatasetIds, datasetOrder]);

  const clearPreferences = useCallback(() => {
    setSelectedDatasetIds(new Set());
  }, []);

  return {
    selectedDatasetIds,
    datasetOrder,
    preferencesLoaded,
    setSelectedDatasetIds,
    setDatasetOrder,
    savePreferences,
    clearPreferences,
  };
}
