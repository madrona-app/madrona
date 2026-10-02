import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

interface UseListStateOptions {
  /** Items per page */
  limit: number;
  /** Debounce delay for search in ms (default 300) */
  debounce?: number;
}

interface ListState {
  /** Current search query (immediate, for input binding) */
  searchQuery: string;
  /** Debounced search query (for API calls) */
  debouncedQuery: string;
  /** Current offset */
  offset: number;
  /** Set search query (updates URL after debounce) */
  setSearchQuery: (q: string) => void;
  /** Set offset (scrolls to top) */
  setOffset: (offset: number) => void;
  /** Get a filter value from URL params */
  getFilter: (key: string) => string;
  /** Set a filter value in URL params (resets offset to 0) */
  setFilter: (key: string, value: string) => void;
  /** Clear all filters, search, and offset */
  clearAll: () => void;
}

/**
 * Manages list page state (search, filters, pagination) in URL search params.
 * Persists across navigation so users don't lose their place.
 */
export function useListState({ limit: _limit, debounce = 300 }: UseListStateOptions): ListState {
  const [searchParams, setSearchParams] = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Read state from URL
  const debouncedQuery = searchParams.get('q') || '';
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  // Local state for immediate input binding (before debounce flushes to URL)
  const [localQuery, setLocalQuery] = useState(debouncedQuery);

  // Sync local state when URL changes externally (e.g. clearAll, back/forward)
  const prevDebouncedRef = useRef(debouncedQuery);
  useEffect(() => {
    if (debouncedQuery !== prevDebouncedRef.current) {
      prevDebouncedRef.current = debouncedQuery;
      setLocalQuery(debouncedQuery);
    }
  }, [debouncedQuery]);

  const setSearchQuery = useCallback((q: string) => {
    setLocalQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        if (q) {
          next.set('q', q);
        } else {
          next.delete('q');
        }
        next.delete('offset'); // Reset to page 1
        return next;
      }, { replace: true });
    }, debounce);
  }, [setSearchParams, debounce]);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const setOffset = useCallback((newOffset: number) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (newOffset > 0) {
        next.set('offset', String(newOffset));
      } else {
        next.delete('offset');
      }
      return next;
    }, { replace: true });
    // Scroll to top on pagination
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const getFilter = useCallback((key: string) => {
    return searchParams.get(key) || '';
  }, [searchParams]);

  const setFilter = useCallback((key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete('offset'); // Reset to page 1
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const clearAll = useCallback(() => {
    setLocalQuery('');
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return {
    searchQuery: localQuery,
    debouncedQuery,
    offset,
    setSearchQuery,
    setOffset,
    getFilter,
    setFilter,
    clearAll,
  };
}
