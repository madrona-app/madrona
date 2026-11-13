import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DiscoverSearchParams } from '../../../types/discover';
import {
  DISCOVER_PAGE_SIZE as PAGE_SIZE,
  buildSearchParamsFromState,
  canonicalSearch,
  parseSearchParams,
} from '../searchUrl';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useDiscoverSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const debouncedSearch = useDebounce(searchInput, 300);

  // Parse URL -> params
  const params = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const currentPage = params.offset ? Math.floor(params.offset / PAGE_SIZE) + 1 : 1;

  // The last `q` this hook wrote to the URL. A URL `q` that differs from it
  // came from outside (back/forward, a breadcrumb, a pasted link), so the
  // search box follows the URL instead of overwriting it.
  const lastWrittenQ = useRef(searchParams.get('q') || '');
  const urlQ = searchParams.get('q') || '';
  useEffect(() => {
    if (urlQ !== lastWrittenQ.current) {
      lastWrittenQ.current = urlQ;
      setSearchInput(urlQ);
    }
  }, [urlQ]);

  // Sync debounced search input to URL (canonical form, back to page 1)
  useEffect(() => {
    const trimmed = debouncedSearch.trim();
    if (trimmed !== (searchParams.get('q') || '') && debouncedSearch === searchInput) {
      lastWrittenQ.current = trimmed;
      setSearchParams(buildSearchParamsFromState({ ...params, q: trimmed || undefined }, 1), { replace: true });
    }
    // Only a settled debounce writes; re-running on params/searchInput would
    // write mid-typing or fight external URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const updateParams = useCallback(
    (updater: (prev: DiscoverSearchParams) => DiscoverSearchParams) => {
      const updated = updater(params);
      const sp = buildSearchParamsFromState(updated, 1);
      setSearchParams(sp, { replace: true });
    },
    [params, setSearchParams],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      const sp = buildSearchParamsFromState(params, page);
      setSearchParams(sp, { replace: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setSearchParams],
  );

  const handleSortChange = useCallback(
    (sort: string) => {
      updateParams((prev) => ({ ...prev, sort: sort as DiscoverSearchParams['sort'] }));
    },
    [updateParams],
  );

  const handleFacetToggle = useCallback(
    (field: string, key: string) => {
      updateParams((prev) => {
        const next = { ...prev };
        if (field === 'object_type' || field === 'classification' || field === 'style_period') {
          const arrField = field as 'object_type' | 'classification' | 'style_period';
          const arr = [...(next[arrField] || [])];
          const idx = arr.indexOf(key);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(key);
          next[arrField] = arr.length ? arr : undefined;
        } else if (field === 'creator' || field === 'material' || field === 'technique' || field === 'subject' || field === 'creation_place') {
          const strField = field as 'creator' | 'material' | 'technique' | 'subject' | 'creation_place';
          next[strField] = next[strField] === key ? undefined : key;
        } else if (field === 'on_display') {
          next.on_display = next.on_display ? undefined : true;
        } else if (field === 'has_image') {
          next.has_image = next.has_image ? undefined : true;
        }
        return next;
      });
    },
    [updateParams],
  );

  const handleRemoveFilter = useCallback(
    (key: string, value?: string) => {
      updateParams((prev) => {
        const next = { ...prev };
        if ((key === 'object_type' || key === 'classification' || key === 'style_period') && value) {
          const arrField = key as 'object_type' | 'classification' | 'style_period';
          const arr = [...(next[arrField] || [])].filter((v) => v !== value);
          next[arrField] = arr.length ? arr : undefined;
        } else {
          (next as Record<string, unknown>)[key] = undefined;
        }
        return next;
      });
    },
    [updateParams],
  );

  const handleClearAll = useCallback(() => {
    lastWrittenQ.current = '';
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const clearSearch = useCallback(() => {
    lastWrittenQ.current = '';
    setSearchInput('');
    setSearchParams(buildSearchParamsFromState({ ...params, q: undefined }, 1), { replace: true });
  }, [params, setSearchParams]);

  /** Canonical `?query` for the results currently shown — the permalink. */
  const resultsSearch = useMemo(() => canonicalSearch(params, currentPage), [params, currentPage]);

  return {
    params,
    searchInput,
    setSearchInput,
    clearSearch,
    viewMode,
    setViewMode,
    currentPage,
    pageSize: PAGE_SIZE,
    handlePageChange,
    handleSortChange,
    handleFacetToggle,
    handleRemoveFilter,
    handleClearAll,
    updateParams,
    resultsSearch,
  };
}
