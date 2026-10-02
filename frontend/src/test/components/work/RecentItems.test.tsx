import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecentItems } from '../../../components/work/RecentItems';

const { useWorkMock, useActiveProductMock, filterMock } = vi.hoisted(() => ({
  useWorkMock: vi.fn(),
  useActiveProductMock: vi.fn(),
  filterMock: vi.fn(),
}));

vi.mock('../../../contexts/WorkContext', () => ({
  useWork: useWorkMock,
  RECORD_TYPE_TO_GROUP: { object: 'Identification', condition_report: 'Care' },
  filterRecentItemsByApp: filterMock,
}));

vi.mock('../../../hooks/useActiveProduct', () => ({
  useActiveProduct: useActiveProductMock,
}));

const baseItem = {
  id: 'i-1',
  type: 'object',
  label: 'Painting',
  sublabel: 'Oil on canvas',
  path: '/organizations/org-1/objects/i-1',
  timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
};

function setup(items = [baseItem]) {
  const clearRecentItems = vi.fn();
  useWorkMock.mockReturnValue({ recentItems: items, clearRecentItems });
  useActiveProductMock.mockReturnValue({ activeProductId: 'collections' });
  filterMock.mockReturnValue(items);
  return { clearRecentItems };
}

function renderItems(props: Parameters<typeof RecentItems>[0] = {}) {
  return render(
    <MemoryRouter>
      <RecentItems {...props} />
    </MemoryRouter>,
  );
}

describe('RecentItems', () => {
  beforeEach(() => {
    useWorkMock.mockReset();
    useActiveProductMock.mockReset();
    filterMock.mockReset();
  });

  it('renders the empty state when there are no items', () => {
    setup([]);
    renderItems();
    expect(screen.getByText('No recent items')).toBeInTheDocument();
  });

  it('renders the heading in cards mode', () => {
    setup();
    renderItems();
    expect(screen.getByText('Recent Items')).toBeInTheDocument();
  });

  it('renders item label and sublabel', () => {
    setup();
    renderItems();
    expect(screen.getByText('Painting')).toBeInTheDocument();
    expect(screen.getByText('Oil on canvas')).toBeInTheDocument();
  });

  it('renders the group label', () => {
    setup();
    renderItems();
    expect(screen.getByText('Identification')).toBeInTheDocument();
  });

  it('uses Link to item.path', () => {
    setup();
    const { container } = renderItems();
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/organizations/org-1/objects/i-1');
  });

  it('Clear button calls clearRecentItems', () => {
    const { clearRecentItems } = setup();
    renderItems();
    fireEvent.click(screen.getByText('Clear'));
    expect(clearRecentItems).toHaveBeenCalled();
  });

  it('compact mode skips heading and uses compact styling', () => {
    setup();
    renderItems({ compact: true });
    expect(screen.queryByText('Recent Items')).toBeNull();
    expect(screen.getByText('Painting')).toBeInTheDocument();
  });

  it('respects the limit prop', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...baseItem,
      id: `i-${i}`,
      label: `Item ${i}`,
      path: `/organizations/org-1/objects/i-${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
    }));
    setup(items);
    renderItems({ limit: 2 });
    expect(screen.getByText('Item 0')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.queryByText('Item 2')).toBeNull();
  });

  it('shows "Showing X of Y" message when over limit', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...baseItem,
      id: `i-${i}`,
      label: `Item ${i}`,
      path: `/organizations/org-1/objects/i-${i}`,
      timestamp: new Date().toISOString(),
    }));
    setup(items);
    renderItems({ limit: 2 });
    expect(screen.getByText(/Showing 2 of 5 recent items/)).toBeInTheDocument();
  });
});
