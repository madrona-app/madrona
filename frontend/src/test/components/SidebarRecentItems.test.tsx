import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarRecentItems } from '../../components/navigation/SidebarRecentItems';
import type { RecentItem } from '../../contexts/WorkContext';

function renderWithRouter(ui: React.ReactElement, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      {ui}
    </MemoryRouter>
  );
}

const mockItems: RecentItem[] = [
  { id: '1', type: 'object', label: 'Vase, Ming Dynasty', sublabel: 'OBJ-001', path: '/organizations/org-1/collections/objects/1' },
  { id: '2', type: 'loan_in', label: 'British Museum Loan', sublabel: 'LI-002', path: '/organizations/org-1/collections/loans-in/2' },
  { id: '3', type: 'conservation', label: 'Frame Repair', sublabel: 'CON-003', path: '/organizations/org-1/collections/conservation/3' },
];

describe('SidebarRecentItems', () => {
  it('renders empty state when no items', () => {
    renderWithRouter(<SidebarRecentItems recentItems={[]} />);
    expect(screen.getByText('No recent items')).toBeInTheDocument();
  });

  it('renders recent items as links', () => {
    renderWithRouter(<SidebarRecentItems recentItems={mockItems} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(screen.getByText('Vase, Ming Dynasty')).toBeInTheDocument();
    expect(screen.getByText('British Museum Loan')).toBeInTheDocument();
    expect(screen.getByText('Frame Repair')).toBeInTheDocument();
  });

  it('links have correct href paths', () => {
    renderWithRouter(<SidebarRecentItems recentItems={mockItems} />);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/organizations/org-1/collections/objects/1');
    expect(links[1]).toHaveAttribute('href', '/organizations/org-1/collections/loans-in/2');
  });

  it('respects limit prop', () => {
    renderWithRouter(<SidebarRecentItems recentItems={mockItems} limit={2} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(screen.queryByText('Frame Repair')).not.toBeInTheDocument();
  });

  it('applies active class based on current path', () => {
    renderWithRouter(
      <SidebarRecentItems recentItems={mockItems} />,
      '/organizations/org-1/collections/objects/1'
    );
    const links = screen.getAllByRole('link');
    // The component sets sidebar-nav-item--active class on active items
    expect(links[0]).toHaveClass('sidebar-nav-item--active');
  });

  it('does not highlight non-active items', () => {
    renderWithRouter(
      <SidebarRecentItems recentItems={mockItems} />,
      '/organizations/org-1/collections/something-else'
    );
    const links = screen.getAllByRole('link');
    links.forEach(link => {
      expect(link).not.toHaveAttribute('aria-current');
    });
  });

  it('renders navigation landmark', () => {
    renderWithRouter(<SidebarRecentItems recentItems={mockItems} />);
    expect(screen.getByRole('navigation', { name: /Recent items/i })).toBeInTheDocument();
  });

  it('sets title attribute with sublabel for tooltip', () => {
    renderWithRouter(<SidebarRecentItems recentItems={mockItems} />);
    const link = screen.getByText('Vase, Ming Dynasty').closest('a');
    expect(link).toHaveAttribute('title', 'Vase, Ming Dynasty - OBJ-001');
  });
});
