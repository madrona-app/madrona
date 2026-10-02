/**
 * React hooks for OpenSearch-powered entity search.
 *
 * Provides:
 * - useSearch: Full-featured search with pagination, facets, and filters
 * - useAutocomplete: Type-ahead suggestions
 * - useDebouncedValue: Utility for debouncing input values
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { searchEntities, getAutocomplete } from '../lib/api';
import type {
  SearchRequest,
  SearchFilters,
  SearchResponse,
  AutocompleteResponse,
  AdvancedCriterion,
} from '../lib/api';
import { useOrganization } from '../contexts/useOrganization';

/**
 * Debounce a value with a configurable delay.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Full-featured entity search hook.
 *
 * Features:
 * - Full-text search with debouncing
 * - Faceted filtering
 * - Infinite scroll pagination
 * - Sort options
 *
 * @param initialFilters - Optional initial filter values
 */
export function useSearch(initialFilters?: SearchFilters) {
  const { activeOrganizationId } = useOrganization();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(initialFilters || {});
  const [sortField, setSortField] = useState('_score');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [advancedCriteria, setAdvancedCriteria] = useState<AdvancedCriterion[]>([]);
  const [advancedOperator, setAdvancedOperator] = useState<'and' | 'or'>('and');

  const debouncedQuery = useDebouncedValue(query, 300);

  // Filter out empty criteria for the request
  const validCriteria = useMemo(
    () => advancedCriteria.filter((c) => c.value.trim().length > 0),
    [advancedCriteria]
  );

  const searchRequest: SearchRequest = useMemo(
    () => ({
      query: debouncedQuery ? { q: debouncedQuery, fuzziness: 'AUTO' } : undefined,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      sort: { field: sortField, order: sortOrder },
      advanced_criteria: validCriteria.length > 0 ? validCriteria : undefined,
      advanced_operator: validCriteria.length > 0 ? advancedOperator : undefined,
      limit: 20,
      include_facets: true,
      highlight: true,
    }),
    [debouncedQuery, filters, sortField, sortOrder, validCriteria, advancedOperator]
  );

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery<SearchResponse, Error>({
    queryKey: ['search', activeOrganizationId, searchRequest],
    queryFn: async ({ pageParam }) => {
      if (!activeOrganizationId) {
        throw new Error('No organization selected');
      }
      return searchEntities(activeOrganizationId, {
        ...searchRequest,
        offset: pageParam as number,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    enabled: !!activeOrganizationId,
  });

  const results = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap((page) => page.hits);
  }, [data]);

  const facets = data?.pages[0]?.facets ?? null;
  const total = data?.pages[0]?.total ?? 0;
  const tookMs = data?.pages[0]?.took_ms ?? 0;

  const updateFilter = useCallback(
    <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
      setFilters((prev) => {
        if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
          const { [key]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [key]: value };
      });
    },
    []
  );

  const clearFilters = useCallback(() => {
    setFilters({});
    setAdvancedCriteria([]);
    setAdvancedOperator('and');
  }, []);

  const toggleFilterValue = useCallback(
    (key: 'dataset_id' | 'entity_type' | 'creator_name' | 'date_range', value: string) => {
      setFilters((prev) => {
        // creator_name is a single-value filter, not an array
        if (key === 'creator_name') {
          if (prev.creator_name === value) {
            const { creator_name: _, ...rest } = prev;
            return rest;
          }
          return { ...prev, creator_name: value };
        }

        // date_range sets date_from and date_to for a year
        if (key === 'date_range') {
          // value is like "1773-01-01", extract year
          const year = value.substring(0, 4);
          const currentFrom = prev.date_from;
          // If already filtering this year, clear it
          if (currentFrom?.startsWith(year)) {
            const { date_from: _, date_to: __, ...rest } = prev;
            return rest;
          }
          return { ...prev, date_from: `${year}-01-01`, date_to: `${year}-12-31` };
        }

        // Array-based filters (dataset_id, entity_type)
        const currentValues = (prev[key] as string[] | undefined) || [];
        if (currentValues.includes(value)) {
          const newValues = currentValues.filter((v) => v !== value);
          if (newValues.length === 0) {
            const { [key]: _, ...rest } = prev;
            return rest;
          }
          return { ...prev, [key]: newValues };
        }
        return { ...prev, [key]: [...currentValues, value] };
      });
    },
    []
  );

  // Helper to update advanced search
  const updateAdvancedSearch = useCallback(
    (criteria: AdvancedCriterion[], operator: 'and' | 'or') => {
      setAdvancedCriteria(criteria);
      setAdvancedOperator(operator);
    },
    []
  );

  return {
    // State
    query,
    filters,
    sortField,
    sortOrder,
    advancedCriteria,
    advancedOperator,

    // Setters
    setQuery,
    setFilters,
    updateFilter,
    clearFilters,
    toggleFilterValue,
    setSortField,
    setSortOrder,
    updateAdvancedSearch,

    // Results
    results,
    facets,
    total,
    tookMs,

    // Status
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  };
}

/**
 * Autocomplete suggestions hook.
 *
 * Provides type-ahead suggestions for search input.
 *
 * @param field - Field to autocomplete (default: 'title')
 */
export function useAutocomplete(field: string = 'title') {
  const { activeOrganizationId } = useOrganization();
  const [query, setQuery] = useState('');

  const debouncedQuery = useDebouncedValue(query, 150);

  const { data, isLoading, error } = useQuery<AutocompleteResponse, Error>({
    queryKey: ['autocomplete', activeOrganizationId, field, debouncedQuery],
    queryFn: () => {
      if (!activeOrganizationId) {
        throw new Error('No organization selected');
      }
      return getAutocomplete(activeOrganizationId, debouncedQuery, field);
    },
    enabled: !!activeOrganizationId && debouncedQuery.length >= 2,
  });

  return {
    query,
    setQuery,
    suggestions: data?.suggestions ?? [],
    isLoading,
    error,
  };
}
