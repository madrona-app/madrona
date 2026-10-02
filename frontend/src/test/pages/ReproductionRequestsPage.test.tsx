import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReproductionRequestsPage from '../../pages/collections/ReproductionRequestsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getReproductionRequests: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetReproductionRequests = vi.mocked(api.getReproductionRequests);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/reproduction-requests`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/reproduction-requests"
            element={<ReproductionRequestsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/reproduction-requests/create"
            element={<div>Create Request</div>}
          />
          <Route
            path="/organizations/:orgId/collections/reproduction-requests/:id"
            element={<div>Request Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ReproductionRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('renders heading', async () => {
    mockGetReproductionRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reproduction' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state', async () => {
    mockGetReproductionRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
    });
  });

  it('renders a request row', async () => {
    mockGetReproductionRequests.mockResolvedValue({
      items: [
        {
          reproduction_id: 'req-1',
          request_number: 'RR-2024-001',
          requester_name: 'Researcher A',
          reproduction_type: 'photograph',
          status: 'submitted',
          request_date: '2024-04-12',
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('RR-2024-001')).toBeInTheDocument();
    });
  });

  it('shows error state on failure', async () => {
    mockGetReproductionRequests.mockRejectedValue(new Error('Whoops'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading reproduction requests/i)).toBeInTheDocument();
    });
  });

  it('hides create CTA when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetReproductionRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reproduction' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /new request/i })).not.toBeInTheDocument();
  });

  it('passes status filter to query when changed', async () => {
    mockGetReproductionRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reproduction' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'in_production' } });

    await waitFor(() => {
      expect(mockGetReproductionRequests).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ status: 'in_production' })
      );
    });
  });
});
