/**
 * Hook for fetching and caching lookup values (database-managed dropdowns).
 *
 * Usage:
 * ```tsx
 * const { getLookup, isLoading, error } = useLookupValues({ context: 'acquisitions' });
 *
 * <EditableSelect
 *   options={getLookup('acquisition_method')}
 *   isLoading={isLoading}
 * />
 * ```
 *
 * Features:
 * - Caches values for 5 minutes via React Query
 * - Merges system defaults + org customizations
 * - Returns { value, label, description?, icon? }[] format
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../contexts/useOrganization';
import {
  getAllLookups,
  type LookupCategoryWithValues,
  type LookupValue,
} from '../lib/api';

export interface LookupOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

export interface UseLookupValuesOptions {
  /** Filter categories by applicable context (e.g., 'acquisitions', 'loans') */
  context?: string;
  /** Include hidden system defaults (default: false) */
  includeHidden?: boolean;
  /** Enable the query (default: true) */
  enabled?: boolean;
}

export interface UseLookupValuesReturn {
  /** Get options array for a specific category key */
  getLookup: (categoryKey: string) => LookupOption[];
  /** Get a single value's label by category and value key */
  getLabel: (categoryKey: string, valueKey: string) => string;
  /** Get all categories with their values */
  categories: LookupCategoryWithValues[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch the data */
  refetch: () => void;
}

/**
 * Cache time for lookup values (5 minutes)
 */
const STALE_TIME = 5 * 60 * 1000;
const CACHE_TIME = 10 * 60 * 1000;

/**
 * Hook for fetching and caching lookup values.
 */
export function useLookupValues(options: UseLookupValuesOptions = {}): UseLookupValuesReturn {
  const { context, includeHidden = false, enabled = true } = options;
  const { activeOrganizationId } = useOrganization();

  const {
    data: categories = [],
    isLoading,
    error,
    refetch,
  } = useQuery<LookupCategoryWithValues[], Error>({
    queryKey: ['lookups', activeOrganizationId, context, includeHidden],
    queryFn: async () => {
      if (!activeOrganizationId) {
        throw new Error('No organization selected');
      }
      return getAllLookups(activeOrganizationId, {
        context,
        include_hidden: includeHidden,
      });
    },
    enabled: enabled && !!activeOrganizationId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  // Build a lookup map for fast access
  const lookupMap = useMemo(() => {
    const map = new Map<string, LookupValue[]>();
    for (const category of categories) {
      map.set(category.category_key, category.values);
    }
    return map;
  }, [categories]);

  // Get options array for a category
  const getLookup = useCallback(
    (categoryKey: string): LookupOption[] => {
      const values = lookupMap.get(categoryKey);
      if (!values) return [];

      return values.map((v) => ({
        value: v.value_key,
        label: v.label,
        description: v.description || undefined,
        icon: v.icon_name || undefined,
      }));
    },
    [lookupMap]
  );

  // Get a single label by category and value key
  const getLabel = useCallback(
    (categoryKey: string, valueKey: string): string => {
      const values = lookupMap.get(categoryKey);
      if (!values) return valueKey;

      const found = values.find((v) => v.value_key === valueKey);
      return found?.label || valueKey;
    },
    [lookupMap]
  );

  return {
    getLookup,
    getLabel,
    categories,
    isLoading,
    error: error ?? null,
    refetch,
  };
}

/**
 * Hook for fetching a single lookup category.
 * Use this when you only need one category to minimize data transfer.
 */
export function useLookupCategory(
  categoryKey: string,
  options: Omit<UseLookupValuesOptions, 'context'> = {}
) {
  const { includeHidden = false, enabled = true } = options;
  const { activeOrganizationId } = useOrganization();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['lookup', activeOrganizationId, categoryKey, includeHidden],
    queryFn: async () => {
      if (!activeOrganizationId) {
        throw new Error('No organization selected');
      }
      const { getLookupCategory } = await import('../lib/api');
      return getLookupCategory(activeOrganizationId, categoryKey, {
        include_hidden: includeHidden,
      });
    },
    enabled: enabled && !!activeOrganizationId && !!categoryKey,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  const options_: LookupOption[] = useMemo(() => {
    if (!data?.values) return [];
    return data.values.map((v) => ({
      value: v.value_key,
      label: v.label,
      description: v.description || undefined,
      icon: v.icon_name || undefined,
    }));
  }, [data?.values]);

  const getLabel = useCallback(
    (valueKey: string): string => {
      if (!data?.values) return valueKey;
      const found = data.values.find((v) => v.value_key === valueKey);
      return found?.label || valueKey;
    },
    [data?.values]
  );

  return {
    category: data?.category || null,
    values: data?.values || [],
    options: options_,
    getLabel,
    isLoading,
    error: error ?? null,
    refetch,
  };
}

export default useLookupValues;
