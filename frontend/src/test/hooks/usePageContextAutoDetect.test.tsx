import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

// Mock the navigation catalog so the test does not depend on the live nav config.
vi.mock('../../lib/navigationCatalog', () => {
  const catalog = [
    {
      id: 'collections:objects',
      product: 'collections',
      label: 'Objects',
      pathPattern: '/organizations/:orgId/collections/objects',
      breadcrumb: ['Collections', 'Objects'],
      keywords: ['objects'],
    },
    {
      id: 'collections:conservation',
      product: 'collections',
      label: 'Conservation',
      pathPattern: '/organizations/:orgId/collections/conservation',
      breadcrumb: ['Collections', 'Conservation'],
      keywords: ['conservation'],
    },
    {
      id: 'collections:loans-in:detail',
      product: 'collections',
      label: 'Loan In Detail',
      pathPattern: '/organizations/:orgId/collections/loans-in/:loanId',
      breadcrumb: ['Collections', 'Loans In', 'Detail'],
      keywords: ['loan'],
    },
  ];
  return {
    getNavCatalog: () => catalog,
  };
});

// Mock the PageContext so we can capture every setPageContext call.
const setPageContextMock = vi.fn();
let hasProvider = true;

vi.mock('../../contexts/PageContext', () => {
  return {
    usePageContext: () => ({
      pageContext: { route: '/' },
      pageContextRef: { current: { route: '/' } },
      setPageContext: setPageContextMock,
      clearEntityContext: vi.fn(),
      hasProvider,
    }),
  };
});

// Import AFTER mocks register so the hook picks them up.
import { usePageContextAutoDetect } from '../../hooks/usePageContextAutoDetect';

function withRouter(initialPath: string, routePattern = '*') {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={routePattern} element={<>{children}</>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('usePageContextAutoDetect', () => {
  beforeEach(() => {
    setPageContextMock.mockReset();
    hasProvider = true;
  });

  it('writes route + product + navItemId for the matching nav entry', () => {
    renderHook(() => usePageContextAutoDetect(), {
      wrapper: withRouter('/organizations/org-1/collections/objects'),
    });

    expect(setPageContextMock).toHaveBeenCalledTimes(1);
    expect(setPageContextMock).toHaveBeenCalledWith({
      route: '/organizations/org-1/collections/objects',
      product: 'collections',
      navItemId: 'objects',
    });
  });

  it('matches a deeper path even when a shorter pattern is a prefix', () => {
    renderHook(() => usePageContextAutoDetect(), {
      wrapper: withRouter('/organizations/org-1/collections/conservation'),
    });

    expect(setPageContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        navItemId: 'conservation',
        product: 'collections',
      }),
    );
  });

  it('emits route + undefined product/navItemId when no entry matches', () => {
    renderHook(() => usePageContextAutoDetect(), {
      wrapper: withRouter('/some/random/path'),
    });

    expect(setPageContextMock).toHaveBeenCalledWith({
      route: '/some/random/path',
      product: undefined,
      navItemId: undefined,
    });
  });

  it('does nothing when there is no provider', () => {
    hasProvider = false;
    renderHook(() => usePageContextAutoDetect(), {
      wrapper: withRouter('/organizations/org-1/collections/objects'),
    });

    expect(setPageContextMock).not.toHaveBeenCalled();
  });

  it('re-runs when the pathname changes', () => {
    let triggerNavigate: (path: string) => void = () => {};

    function Harness() {
      usePageContextAutoDetect();
      const nav = useNavigate();
      useEffect(() => {
        triggerNavigate = nav;
      }, [nav]);
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/organizations/org-1/collections/objects']}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(setPageContextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ navItemId: 'objects' }),
    );

    act(() => {
      triggerNavigate('/organizations/org-1/collections/conservation');
    });

    expect(setPageContextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ navItemId: 'conservation' }),
    );
  });
});
