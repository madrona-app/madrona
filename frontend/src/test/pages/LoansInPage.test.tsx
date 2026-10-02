import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoansInPage from '../../pages/collections/LoansInPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';
import * as useGeoHook from '../../hooks/useGeo';

vi.mock('../../lib/api', () => ({
  getLoansIn: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('../../hooks/useGeo', () => ({
  useGeo: vi.fn(),
}));

// Stub LoanNetworkMap (lazy-loaded). Not exercised in list view.
vi.mock('../../components/maps/LoanNetworkMap', () => ({
  default: () => <div>Loan Network Map</div>,
}));

const mockGetLoansIn = vi.mocked(api.getLoansIn);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);
const mockUseGeo = vi.mocked(useGeoHook.useGeo);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/loans-in`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/loans-in"
            element={<LoansInPage />}
          />
          <Route
            path="/organizations/:orgId/collections/loans-in/create"
            element={<div>Create Loan In</div>}
          />
          <Route
            path="/organizations/:orgId/collections/loans-in/:loanId"
            element={<div>Loan In Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoansInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
    mockUseGeo.mockReturnValue({
      useLoanNetwork: () => ({ data: undefined, isLoading: false }),
    } as never);
  });

  it('renders heading', async () => {
    mockGetLoansIn.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Loans In' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state', async () => {
    mockGetLoansIn.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No incoming loans yet.' })).toBeInTheDocument();
    });
  });

  it('renders loan row with lender and number', async () => {
    mockGetLoansIn.mockResolvedValue({
      items: [
        {
          loan_in_id: 'l-1',
          loan_number: 'LI-2024-001',
          lender_name: 'British Museum',
          loan_purpose: 'exhibition',
          status: 'on_loan',
          loan_start_date: '2024-01-01',
          loan_end_date: null,
          insurance_value_total: 100000,
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('LI-2024-001')).toBeInTheDocument();
    });
    expect(screen.getByText('British Museum')).toBeInTheDocument();
    // "Exhibition" also appears as a <option> in purpose filter
    expect(screen.getAllByText('Exhibition').length).toBeGreaterThanOrEqual(1);
  });

  it('shows error state', async () => {
    mockGetLoansIn.mockRejectedValue(new Error('Boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading loans/i)).toBeInTheDocument();
    });
  });

  it('updates query when purpose filter changes', async () => {
    mockGetLoansIn.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Loans In' })).toBeInTheDocument();
    });

    const purposeSelect = screen.getByDisplayValue('All Purposes');
    fireEvent.change(purposeSelect, { target: { value: 'research' } });

    await waitFor(() => {
      expect(mockGetLoansIn).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ loan_purpose: 'research' })
      );
    });
  });

  it('hides create link when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetLoansIn.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Loans In' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /new incoming loan/i })).not.toBeInTheDocument();
  });
});
