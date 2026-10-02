import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RecentActivityPage from '../../../../pages/home/v2/RecentActivityPage';

const { useWorkMock, useActiveProductMock, filterMock } = vi.hoisted(() => ({
  useWorkMock: vi.fn(),
  useActiveProductMock: vi.fn(),
  filterMock: vi.fn(),
}));

vi.mock('../../../../contexts/WorkContext', () => ({
  useWork: useWorkMock,
  RECORD_TYPE_TO_GROUP: { object: 'Identification' },
  filterRecentItemsByApp: filterMock,
}));

vi.mock('../../../../hooks/useActiveProduct', () => ({
  useActiveProduct: useActiveProductMock,
}));

function renderAt(path: string) {
  useWorkMock.mockReturnValue({ recentItems: [], clearRecentItems: vi.fn() });
  useActiveProductMock.mockReturnValue({ activeProductId: 'collections' });
  filterMock.mockImplementation((items: unknown[]) => items);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/organizations/:orgId/recent"
          element={<RecentActivityPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RecentActivityPage', () => {
  beforeEach(() => {
    useWorkMock.mockReset();
    useActiveProductMock.mockReset();
    filterMock.mockReset();
  });

  it('renders the heading and intro copy', () => {
    renderAt('/organizations/org-1/recent');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Recent activity' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Records you've opened recently/),
    ).toBeInTheDocument();
  });

  it('links back to the org home dashboard', () => {
    renderAt('/organizations/org-7/recent');
    const back = screen.getByRole('link', { name: /Back to home/ });
    expect(back).toHaveAttribute('href', '/organizations/org-7/home');
  });

  it('falls back to "/" when no orgId is in the route', () => {
    // Route without :orgId — render the component standalone via MemoryRouter.
    useWorkMock.mockReturnValue({ recentItems: [], clearRecentItems: vi.fn() });
    useActiveProductMock.mockReturnValue({ activeProductId: 'collections' });
    filterMock.mockImplementation((items: unknown[]) => items);
    render(
      <MemoryRouter initialEntries={['/recent']}>
        <Routes>
          <Route path="/recent" element={<RecentActivityPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const back = screen.getByRole('link', { name: /Back to home/ });
    expect(back).toHaveAttribute('href', '/');
  });

  it('renders RecentItems with scope="all" (does not filter by product)', () => {
    renderAt('/organizations/org-1/recent');
    // RecentItems.scope='all' bypasses filterRecentItemsByApp entirely.
    expect(filterMock).not.toHaveBeenCalled();
  });
});
