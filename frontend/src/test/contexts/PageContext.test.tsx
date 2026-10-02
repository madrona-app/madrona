import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  PageContextProvider,
  usePageContext,
} from '../../contexts/PageContext';

function wrapper({ children }: { children: React.ReactNode }) {
  return <PageContextProvider>{children}</PageContextProvider>;
}

describe('PageContext', () => {
  it('exposes a default context with a route', () => {
    const { result } = renderHook(() => usePageContext(), { wrapper });
    expect(result.current.hasProvider).toBe(true);
    expect(result.current.pageContext.route).toBeTruthy();
  });

  it('merges partial updates', () => {
    const { result } = renderHook(() => usePageContext(), { wrapper });
    act(() => {
      result.current.setPageContext({ route: '/foo', product: 'collections' });
    });
    expect(result.current.pageContext.route).toBe('/foo');
    expect(result.current.pageContext.product).toBe('collections');
    act(() => {
      result.current.setPageContext({ navItemId: 'conservation' });
    });
    // Earlier fields preserved
    expect(result.current.pageContext.route).toBe('/foo');
    expect(result.current.pageContext.product).toBe('collections');
    expect(result.current.pageContext.navItemId).toBe('conservation');
  });

  it('keeps the ref in sync with state', () => {
    const { result } = renderHook(() => usePageContext(), { wrapper });
    act(() => {
      result.current.setPageContext({ route: '/a' });
    });
    expect(result.current.pageContextRef.current.route).toBe('/a');
    act(() => {
      result.current.setPageContext({ route: '/b' });
    });
    expect(result.current.pageContextRef.current.route).toBe('/b');
  });

  it('clearEntityContext drops entity, workflow, and editMode', () => {
    const { result } = renderHook(() => usePageContext(), { wrapper });
    act(() => {
      result.current.setPageContext({
        route: '/x',
        entity: { type: 't', id: '1', label: 'X' },
        workflow: { status: 'draft', blockingCount: 1, topBlockers: ['y'] },
        editMode: true,
      });
    });
    expect(result.current.pageContext.entity).toBeDefined();
    act(() => {
      result.current.clearEntityContext();
    });
    expect(result.current.pageContext.entity).toBeUndefined();
    expect(result.current.pageContext.workflow).toBeUndefined();
    expect(result.current.pageContext.editMode).toBeUndefined();
    // Nav-level fields preserved
    expect(result.current.pageContext.route).toBe('/x');
  });

  it('returns a no-op fallback when used outside the provider', () => {
    const { result } = renderHook(() => usePageContext());
    expect(result.current.hasProvider).toBe(false);
    // Should not throw
    expect(() => result.current.setPageContext({ route: '/x' })).not.toThrow();
    expect(() => result.current.clearEntityContext()).not.toThrow();
  });
});
