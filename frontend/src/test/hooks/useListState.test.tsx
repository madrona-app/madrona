import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useListState } from '../../hooks/useListState';

function createWrapper(initialRoute = '/') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialRoute]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useListState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock scrollTo
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('returns default values', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper(),
      });

      expect(result.current.searchQuery).toBe('');
      expect(result.current.debouncedQuery).toBe('');
      expect(result.current.offset).toBe(0);
    });

    it('reads initial values from URL', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper('/?q=test&offset=40'),
      });

      expect(result.current.searchQuery).toBe('test');
      expect(result.current.debouncedQuery).toBe('test');
      expect(result.current.offset).toBe(40);
    });
  });

  describe('search', () => {
    it('updates local query immediately', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSearchQuery('hello');
      });

      expect(result.current.searchQuery).toBe('hello');
      // Debounced query should not update yet
      expect(result.current.debouncedQuery).toBe('');
    });

    it('updates debounced query after delay', () => {
      const { result } = renderHook(() => useListState({ limit: 20, debounce: 300 }), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSearchQuery('hello');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.debouncedQuery).toBe('hello');
    });

    it('resets offset when search changes', () => {
      const { result } = renderHook(() => useListState({ limit: 20, debounce: 300 }), {
        wrapper: createWrapper('/?offset=40'),
      });

      act(() => {
        result.current.setSearchQuery('new search');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.offset).toBe(0);
    });
  });

  describe('pagination', () => {
    it('sets offset', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setOffset(40);
      });

      expect(result.current.offset).toBe(40);
    });

    it('scrolls to top on pagination', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setOffset(20);
      });

      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });
  });

  describe('filters', () => {
    it('gets filter value from URL', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper('/?status=active'),
      });

      expect(result.current.getFilter('status')).toBe('active');
    });

    it('returns empty string for missing filter', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper(),
      });

      expect(result.current.getFilter('nonexistent')).toBe('');
    });

    it('sets filter and resets offset', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper('/?offset=40'),
      });

      act(() => {
        result.current.setFilter('status', 'active');
      });

      expect(result.current.getFilter('status')).toBe('active');
      expect(result.current.offset).toBe(0);
    });

    it('removes filter when value is empty', () => {
      const { result } = renderHook(() => useListState({ limit: 20 }), {
        wrapper: createWrapper('/?status=active'),
      });

      act(() => {
        result.current.setFilter('status', '');
      });

      expect(result.current.getFilter('status')).toBe('');
    });
  });

  describe('clearAll', () => {
    it('resets search, filters, and offset', () => {
      const { result } = renderHook(() => useListState({ limit: 20, debounce: 300 }), {
        wrapper: createWrapper('/?q=test&status=active&offset=40'),
      });

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.searchQuery).toBe('');
      expect(result.current.debouncedQuery).toBe('');
      expect(result.current.offset).toBe(0);
      expect(result.current.getFilter('status')).toBe('');
    });
  });
});
