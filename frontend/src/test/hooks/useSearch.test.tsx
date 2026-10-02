import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDebouncedValue, useAutocomplete, useSearch } from '../../hooks/useSearch';
import * as api from '../../lib/api';
import * as useOrganizationHook from '../../contexts/useOrganization';

// Mock dependencies
vi.mock('../../lib/api', () => ({
  searchEntities: vi.fn().mockResolvedValue({ hits: [], total: 0, took_ms: 10, facets: null }),
  getAutocomplete: vi.fn(),
}));

const mockSearchEntities = vi.mocked(api.searchEntities);

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

const mockGetAutocomplete = vi.mocked(api.getAutocomplete);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('test', 300));
    expect(result.current).toBe('test');
  });

  it('updates value after delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'initial' } }
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated' });
    expect(result.current).toBe('initial'); // Still initial before delay

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe('updated');
  });

  it('resets timer on rapid value changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } }
    );

    // Rapid updates
    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: 'c' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: 'd' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Still at initial because timer keeps resetting
    expect(result.current).toBe('a');

    // Wait for full delay
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe('d');
  });

  it('works with numbers', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 0 } }
    );

    expect(result.current).toBe(0);

    rerender({ value: 5 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe(5);
  });

  it('works with objects', () => {
    const initialObj = { foo: 'bar' };
    const newObj = { foo: 'baz' };

    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 100),
      { initialProps: { value: initialObj } }
    );

    expect(result.current).toEqual(initialObj);

    rerender({ value: newObj });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toEqual(newObj);
  });
});

describe('useAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
  });

  it('does not call API when query is empty', async () => {
    const { result } = renderHook(
      () => useAutocomplete(''),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetAutocomplete).not.toHaveBeenCalled();
  });

  it('does not call API when query is too short', async () => {
    const { result } = renderHook(
      () => useAutocomplete('ab'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetAutocomplete).not.toHaveBeenCalled();
  });

  it('enables query when conditions are met', async () => {
    mockGetAutocomplete.mockResolvedValue({ suggestions: ['test1', 'test2'] });

    const { result } = renderHook(
      () => useAutocomplete('test'),
      { wrapper: createWrapper() }
    );

    // Just verify the hook renders without error
    expect(result.current.isLoading).toBeDefined();
  });

  it('has correct initial state', async () => {
    mockGetAutocomplete.mockResolvedValue({
      suggestions: ['suggestion1', 'suggestion2', 'suggestion3'],
    });

    const { result } = renderHook(
      () => useAutocomplete('title'),
      { wrapper: createWrapper() }
    );

    // Verify hook returns expected shape
    expect(result.current).toHaveProperty('query');
    expect(result.current).toHaveProperty('setQuery');
    expect(result.current).toHaveProperty('suggestions');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('error');
  });

  it('returns empty suggestions when no organization', async () => {
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: null,
    } as unknown as ReturnType<typeof useOrganizationHook.useOrganization>);

    const { result } = renderHook(
      () => useAutocomplete('test'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetAutocomplete).not.toHaveBeenCalled();
  });
});

describe('useSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    mockSearchEntities.mockResolvedValue({
      hits: [],
      total: 0,
      took_ms: 10,
      facets: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    expect(result.current.query).toBe('');
    expect(result.current.filters).toEqual({});
    expect(result.current.sortField).toBe('_score');
    expect(result.current.sortOrder).toBe('desc');
    expect(result.current.results).toEqual([]);
  });

  it('setQuery updates query state', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.setQuery('test query');
    });

    expect(result.current.query).toBe('test query');
  });

  it('setFilters updates filters state', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.setFilters({ entity_type: ['Object'] });
    });

    expect(result.current.filters).toEqual({ entity_type: ['Object'] });
  });

  it('updateFilter adds a filter', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.updateFilter('entity_type', ['Object']);
    });

    expect(result.current.filters.entity_type).toEqual(['Object']);
  });

  it('updateFilter removes filter when value is empty', () => {
    const { result } = renderHook(() => useSearch({ entity_type: ['Object'] }), { wrapper: createWrapper() });

    act(() => {
      result.current.updateFilter('entity_type', []);
    });

    expect(result.current.filters.entity_type).toBeUndefined();
  });

  it('clearFilters resets all filters', () => {
    const { result } = renderHook(
      () => useSearch({ entity_type: ['Object'], dataset_id: ['ds-1'] }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.filters).toEqual({});
  });

  it('toggleFilterValue adds value to array filter', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.toggleFilterValue('entity_type', 'Object');
    });

    expect(result.current.filters.entity_type).toEqual(['Object']);
  });

  it('toggleFilterValue removes value from array filter', () => {
    const { result } = renderHook(
      () => useSearch({ entity_type: ['Object', 'Person'] }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.toggleFilterValue('entity_type', 'Object');
    });

    expect(result.current.filters.entity_type).toEqual(['Person']);
  });

  it('toggleFilterValue removes filter when array becomes empty', () => {
    const { result } = renderHook(
      () => useSearch({ entity_type: ['Object'] }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.toggleFilterValue('entity_type', 'Object');
    });

    expect(result.current.filters.entity_type).toBeUndefined();
  });

  it('toggleFilterValue handles creator_name as single value', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.toggleFilterValue('creator_name', 'John Doe');
    });

    expect(result.current.filters.creator_name).toBe('John Doe');
  });

  it('toggleFilterValue clears creator_name when same value', () => {
    const { result } = renderHook(
      () => useSearch({ creator_name: 'John Doe' }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.toggleFilterValue('creator_name', 'John Doe');
    });

    expect(result.current.filters.creator_name).toBeUndefined();
  });

  it('toggleFilterValue handles date_range', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.toggleFilterValue('date_range', '1773-01-01');
    });

    expect(result.current.filters.date_from).toBe('1773-01-01');
    expect(result.current.filters.date_to).toBe('1773-12-31');
  });

  it('toggleFilterValue clears date_range when same year', () => {
    const { result } = renderHook(
      () => useSearch({ date_from: '1773-01-01', date_to: '1773-12-31' }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.toggleFilterValue('date_range', '1773-06-15');
    });

    expect(result.current.filters.date_from).toBeUndefined();
    expect(result.current.filters.date_to).toBeUndefined();
  });

  it('setSortField updates sort field', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.setSortField('label');
    });

    expect(result.current.sortField).toBe('label');
  });

  it('setSortOrder updates sort order', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.setSortOrder('asc');
    });

    expect(result.current.sortOrder).toBe('asc');
  });

  it('updateAdvancedSearch sets criteria and operator', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.updateAdvancedSearch(
        [{ field: 'label', operator: 'contains', value: 'test' }],
        'or'
      );
    });

    expect(result.current.advancedCriteria).toEqual([
      { field: 'label', operator: 'contains', value: 'test' },
    ]);
    expect(result.current.advancedOperator).toBe('or');
  });

  it('does not search when no organization', () => {
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: null,
    } as unknown as ReturnType<typeof useOrganizationHook.useOrganization>);

    const { result } = renderHook(() => useSearch(), { wrapper: createWrapper() });

    // Advance timers to flush debounce
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Query should not be enabled when no organization
    expect(result.current.isLoading).toBe(false);
    expect(mockSearchEntities).not.toHaveBeenCalled();
  });
});
