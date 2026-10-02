import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductNav } from '../../components/navigation/ProductNav';
import type { Product } from '../../lib/navigationConfig';
import { Package, FileText } from 'lucide-react';

// Mock context hooks
const mockToggleSection = vi.fn();
const mockIsSectionExpanded = vi.fn(() => false);

vi.mock('../../contexts/SidebarContext', () => ({
  useSidebar: () => ({
    isCollapsed: false,
    isSectionExpanded: mockIsSectionExpanded,
    toggleSection: mockToggleSection,
    setCollapsed: vi.fn(),
  }),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
  }),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    hasAppAccess: () => true,
  }),
}));

const mockProduct: Product = {
  id: 'collections',
  label: 'Collections',
  icon: Package,
  items: [
    {
      id: 'objects',
      label: 'Objects',
      path: '/organizations/:orgId/collections/objects',
      icon: FileText,
    },
    {
      id: 'loans',
      label: 'Loans',
      path: '/organizations/:orgId/collections/loans',
      icon: FileText,
    },
  ],
} as Product;

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/organizations/org-1/collections']}>
      {ui}
    </MemoryRouter>
  );
}

describe('ProductNav', () => {
  it('renders product label', () => {
    renderWithRouter(<ProductNav product={mockProduct} orgId="org-1" />);
    expect(screen.getByText('Collections')).toBeInTheDocument();
  });

  it('renders product header as a button', () => {
    renderWithRouter(<ProductNav product={mockProduct} orgId="org-1" />);
    const button = screen.getByRole('button', { name: /Collections/i });
    expect(button).toBeInTheDocument();
  });

  it('calls toggleSection when header is clicked', () => {
    renderWithRouter(<ProductNav product={mockProduct} orgId="org-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Collections/i }));
    expect(mockToggleSection).toHaveBeenCalledWith('collections');
  });

  it('shows nav items when section is expanded', () => {
    mockIsSectionExpanded.mockReturnValue(true);
    renderWithRouter(<ProductNav product={mockProduct} orgId="org-1" />);
    expect(screen.getByText('Objects')).toBeInTheDocument();
    expect(screen.getByText('Loans')).toBeInTheDocument();
    mockIsSectionExpanded.mockReturnValue(false);
  });

  it('hides nav items when section is collapsed', () => {
    mockIsSectionExpanded.mockReturnValue(false);
    renderWithRouter(<ProductNav product={mockProduct} orgId="org-1" />);
    expect(screen.queryByText('Objects')).not.toBeInTheDocument();
    expect(screen.queryByText('Loans')).not.toBeInTheDocument();
  });

  it('shows "Soon" badge for coming-soon products', () => {
    const comingSoon: Product = {
      ...mockProduct,
      items: [],
      badge: 'coming-soon',
    } as Product;
    renderWithRouter(<ProductNav product={comingSoon} orgId="org-1" />);
    expect(screen.getByText('Soon')).toBeInTheDocument();
  });

  it('has aria-expanded attribute on header button', () => {
    mockIsSectionExpanded.mockReturnValue(true);
    renderWithRouter(<ProductNav product={mockProduct} orgId="org-1" />);
    const button = screen.getByRole('button', { name: /Collections/i });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    mockIsSectionExpanded.mockReturnValue(false);
  });

  it('renders navigation landmark when expanded', () => {
    mockIsSectionExpanded.mockReturnValue(true);
    renderWithRouter(<ProductNav product={mockProduct} orgId="org-1" />);
    expect(screen.getByRole('navigation', { name: /Collections navigation/i })).toBeInTheDocument();
    mockIsSectionExpanded.mockReturnValue(false);
  });
});
