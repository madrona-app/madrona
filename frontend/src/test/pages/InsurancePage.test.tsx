import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InsurancePage from '../../pages/collections/InsurancePage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getInsurancePolicies: vi.fn(),
}));

const mockGetInsurancePolicies = vi.mocked(api.getInsurancePolicies);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/insurance`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/insurance"
            element={<InsurancePage />}
          />
          <Route
            path="/organizations/:orgId/collections/insurance/policies/create"
            element={<div>Create Policy</div>}
          />
          <Route
            path="/organizations/:orgId/collections/insurance/policies/:id"
            element={<div>Policy Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('InsurancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetInsurancePolicies.mockResolvedValue({ items: [] } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Insurance' })).toBeInTheDocument();
    });
  });

  it('shows empty state when no policies', async () => {
    mockGetInsurancePolicies.mockResolvedValue({ items: [] } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No insurance records yet.' })).toBeInTheDocument();
    });
  });

  it('renders a policy row', async () => {
    mockGetInsurancePolicies.mockResolvedValue({
      items: [
        {
          policy_id: 'pol-1',
          policy_number: 'INS-2024-001',
          policy_name: 'Annual Fine Arts Coverage',
          provider_name: 'AIG Fine Art',
          policy_type: 'fine_arts',
          status: 'active',
          coverage_limit: 1_000_000,
          expiration_date: '2025-01-01',
          currency: 'USD',
        },
      ],
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('INS-2024-001')).toBeInTheDocument();
    });
    expect(screen.getByText('AIG Fine Art')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockGetInsurancePolicies.mockRejectedValue(new Error('Server error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading insurance policies/i)).toBeInTheDocument();
    });
  });

  it('renders new policy CTA', async () => {
    mockGetInsurancePolicies.mockResolvedValue({ items: [] } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /new policy/i })).toBeInTheDocument();
    });
  });

  it('updates query when status filter changes', async () => {
    mockGetInsurancePolicies.mockResolvedValue({ items: [] } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Insurance' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'active' } });

    await waitFor(() => {
      expect(mockGetInsurancePolicies).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ status: 'active' })
      );
    });
  });
});
