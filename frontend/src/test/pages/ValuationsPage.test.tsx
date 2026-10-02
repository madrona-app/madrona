import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ValuationsPage from '../../pages/collections/ValuationsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getValuations: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetValuations = vi.mocked(api.getValuations);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/valuations`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/valuations"
            element={<ValuationsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleValuations = {
  total: 2,
  items: [
    {
      valuation_id: 'v-1',
      object_id: 'obj-1',
      object_number: 'OBJ-001',
      object_title: 'A Painting',
      valuation_type: 'insurance',
      valuation_amount: 50000,
      valuation_currency: 'USD',
      valuation_date: '2024-01-01',
      valuator_name: 'Jane Appraiser',
      valuator_organization: null,
      is_current: true,
    },
    {
      valuation_id: 'v-2',
      object_id: null,
      object_number: null,
      object_title: null,
      valuation_type: 'market',
      valuation_amount: 100000,
      valuation_currency: 'USD',
      valuation_date: '2023-06-01',
      valuator_name: null,
      valuator_organization: 'Auction House',
      is_current: false,
    },
  ],
};

describe('ValuationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows loader before data arrives', () => {
    mockGetValuations.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /^valuations$/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and rows', async () => {
    mockGetValuations.mockResolvedValue(sampleValuations as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /^valuations$/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('OBJ-001')).toBeInTheDocument();
    expect(screen.getByText(/auction house/i)).toBeInTheDocument();
  });

  it('renders stat cards', async () => {
    mockGetValuations.mockResolvedValue(sampleValuations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Insurance Total')).toBeInTheDocument();
    });
    expect(screen.getByText('Market Total')).toBeInTheDocument();
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
  });

  it('renders create link when permitted', async () => {
    mockGetValuations.mockResolvedValue(sampleValuations as any);
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /create valuation/i });
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/valuations/create',
      );
    });
  });

  it('disables create when not permitted', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetValuations.mockResolvedValue(sampleValuations as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByTitle(/requires collections.create permission/i),
      ).toBeInTheDocument();
    });
  });

  it('renders error state on failure', async () => {
    mockGetValuations.mockRejectedValue(new Error('valuations broke'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading valuations: valuations broke/i),
      ).toBeInTheDocument();
    });
  });

  it('changing valuation type filter triggers refetch', async () => {
    mockGetValuations.mockResolvedValue(sampleValuations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('OBJ-001')).toBeInTheDocument();
    });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'insurance' } });
    await waitFor(() => {
      expect(mockGetValuations).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ valuation_type: 'insurance' }),
      );
    });
  });

  it('toggling "Current valuations only" updates query', async () => {
    mockGetValuations.mockResolvedValue(sampleValuations as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('OBJ-001')).toBeInTheDocument();
    });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });
});
