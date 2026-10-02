import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DiscoverSearchParams } from '../../../types/discover';

const PAGE_SIZE = 24;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function parseSearchParams(sp: URLSearchParams): DiscoverSearchParams {
  const params: DiscoverSearchParams = {};
  const q = sp.get('q');
  if (q) params.q = q;

  const objectType = sp.getAll('object_type');
  if (objectType.length) params.object_type = objectType;

  const classification = sp.getAll('classification');
  if (classification.length) params.classification = classification;

  const creator = sp.get('creator');
  if (creator) params.creator = creator;

  const material = sp.get('material');
  if (material) params.material = material;

  const technique = sp.get('technique');
  if (technique) params.technique = technique;

  const subject = sp.get('subject');
  if (subject) params.subject = subject;

  const stylePeriod = sp.getAll('style_period');
  if (stylePeriod.length) params.style_period = stylePeriod;

  const creationPlace = sp.get('creation_place');
  if (creationPlace) params.creation_place = creationPlace;

  const hasImage = sp.get('has_image');
  if (hasImage === 'true') params.has_image = true;

  const dateFrom = sp.get('date_from');
  if (dateFrom) params.date_from = dateFrom;

  const dateTo = sp.get('date_to');
  if (dateTo) params.date_to = dateTo;

  const onDisplay = sp.get('on_display');
  if (onDisplay === 'true') params.on_display = true;

  const sort = sp.get('sort');
  if (sort) params.sort = sort as DiscoverSearchParams['sort'];

  const page = sp.get('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  if (pageNum > 1) params.offset = (pageNum - 1) * PAGE_SIZE;

  params.limit = PAGE_SIZE;
  params.include_facets = true;

  return params;
}

function buildSearchParamsFromState(
  params: DiscoverSearchParams,
  page: number,
): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.object_type) params.object_type.forEach((v) => sp.append('object_type', v));
  if (params.classification) params.classification.forEach((v) => sp.append('classification', v));
  if (params.creator) sp.set('creator', params.creator);
  if (params.material) sp.set('material', params.material);
  if (params.technique) sp.set('technique', params.technique);
  if (params.subject) sp.set('subject', params.subject);
  if (params.style_period) params.style_period.forEach((v) => sp.append('style_period', v));
  if (params.creation_place) sp.set('creation_place', params.creation_place);
  if (params.has_image) sp.set('has_image', 'true');
  if (params.date_from) sp.set('date_from', params.date_from);
  if (params.date_to) sp.set('date_to', params.date_to);
  if (params.on_display) sp.set('on_display', 'true');
  if (params.sort && params.sort !== 'relevance') sp.set('sort', params.sort);
  if (page > 1) sp.set('page', String(page));
  return sp;
}

export function useDiscoverSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const debouncedSearch = useDebounce(searchInput, 300);

  // Parse URL -> params
  const params = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const currentPage = params.offset ? Math.floor(params.offset / PAGE_SIZE) + 1 : 1;

  // Sync debounced search input to URL
  useEffect(() => {
    const currentQ = searchParams.get('q') || '';
    if (debouncedSearch !== currentQ) {
      const newSp = new URLSearchParams(searchParams);
      if (debouncedSearch) {
        newSp.set('q', debouncedSearch);
      } else {
        newSp.delete('q');
      }
      newSp.delete('page');
      setSearchParams(newSp, { replace: true });
    }
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
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    const newSp = new URLSearchParams(searchParams);
    newSp.delete('q');
    newSp.delete('page');
    setSearchParams(newSp, { replace: true });
  }, [searchParams, setSearchParams]);

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
  };
}
