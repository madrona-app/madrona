import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoansOutPage from '../../pages/collections/LoansOutPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';
import * as useGeoHook from '../../hooks/useGeo';

vi.mock('../../lib/api', () => ({
  getLoansOut: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('../../hooks/useGeo', () => ({
  useGeo: vi.fn(),
}));

vi.mock('../../components/maps/LoanNetworkMap', () => ({
  default: () => <div>Loan Network Map</div>,
}));

const mockGetLoansOut = vi.mocked(api.getLoansOut);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);
const mockUseGeo = vi.mocked(useGeoHook.useGeo);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/loans-out`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/loans-out"
            element={<LoansOutPage />}
          />
          <Route
            path="/organizations/:orgId/collections/loans-out/create"
            element={<div>Create Loan Out</div>}
          />
          <Route
            path="/organizations/:orgId/collections/loans-out/:loanId"
            element={<div>Loan Out Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoansOutPage', () => {
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
    mockGetLoansOut.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Loans Out' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state when no loans', async () => {
    mockGetLoansOut.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no outgoing loans yet/i })).toBeInTheDocument();
    });
  });

  it('renders a loan row with borrower', async () => {
    mockGetLoansOut.mockResolvedValue({
      items: [
        {
          loan_out_id: 'l-1',
          loan_number: 'LO-2024-001',
          borrower_name: 'MoMA',
          loan_purpose: 'exhibition',
          status: 'on_loan',
          loan_start_date: '2024-01-01',
          loan_end_date: null,
          insurance_value_total: 250000,
          certificate_of_insurance_received: true,
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('LO-2024-001')).toBeInTheDocument();
    });
    expect(screen.getByText('MoMA')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockGetLoansOut.mockRejectedValue(new Error('Boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading loans/i)).toBeInTheDocument();
    });
  });

  it('hides create link when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetLoansOut.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Loans Out' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /new outgoing loan/i })).not.toBeInTheDocument();
  });
});
