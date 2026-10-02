import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useDiscoverSearch } from '../../pages/discover/hooks/useDiscoverSearch';

function wrapperFor(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };
}

describe('useDiscoverSearch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses query string into params', () => {
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/?q=ceramics']),
    });

    expect(result.current.params.q).toBe('ceramics');
    expect(result.current.searchInput).toBe('ceramics');
    expect(result.current.params.limit).toBe(24);
    expect(result.current.params.include_facets).toBe(true);
  });

  it('parses paged URLs into the right offset and currentPage', () => {
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/?page=3']),
    });

    expect(result.current.currentPage).toBe(3);
    expect(result.current.params.offset).toBe(48);
  });

  it('parses repeated array facets correctly', () => {
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/?object_type=painting&object_type=sculpture']),
    });

    expect(result.current.params.object_type).toEqual(['painting', 'sculpture']);
  });

  it('parses boolean facets has_image and on_display', () => {
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/?has_image=true&on_display=true']),
    });

    expect(result.current.params.has_image).toBe(true);
    expect(result.current.params.on_display).toBe(true);
  });

  it('debounces searchInput before reflecting on URL', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/']),
    });

    act(() => {
      result.current.setSearchInput('paintings');
    });

    // Within debounce window — input is set, URL params still empty
    expect(result.current.searchInput).toBe('paintings');
    expect(result.current.params.q).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.params.q).toBe('paintings');
  });

  it('clearSearch resets searchInput and removes q from params', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/?q=existing']),
    });

    expect(result.current.params.q).toBe('existing');

    act(() => {
      result.current.clearSearch();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.searchInput).toBe('');
    expect(result.current.params.q).toBeUndefined();
  });

  it('handleClearAll clears all params', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/?q=test&has_image=true']),
    });

    act(() => {
      result.current.handleClearAll();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.params.q).toBeUndefined();
    expect(result.current.params.has_image).toBeUndefined();
  });

  it('handleFacetToggle adds and removes array facets', () => {
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/']),
    });

    act(() => {
      result.current.handleFacetToggle('object_type', 'painting');
    });
    expect(result.current.params.object_type).toEqual(['painting']);

    act(() => {
      result.current.handleFacetToggle('object_type', 'painting');
    });
    expect(result.current.params.object_type).toBeUndefined();
  });

  it('handleFacetToggle toggles boolean facets', () => {
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/']),
    });

    act(() => {
      result.current.handleFacetToggle('has_image', 'true');
    });
    expect(result.current.params.has_image).toBe(true);

    act(() => {
      result.current.handleFacetToggle('has_image', 'true');
    });
    expect(result.current.params.has_image).toBeUndefined();
  });

  it('handleRemoveFilter removes a single value from array facet', () => {
    const { result } = renderHook(() => useDiscoverSearch(), {
      wrapper: wrapperFor(['/?object_type=painting&object_type=sculpture']),
    });

    act(() => {
      result.current.handleRemoveFilter('object_type', 'painting');
    });

    expect(result.current.params.object_type).toEqual(['sculpture']);
  });
});
