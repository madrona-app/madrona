import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UseRequestsPage from '../../pages/collections/UseRequestsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

// These pages embed StartProcedure, which reads app access to hide
// itself when Guide is unavailable. useAuth throws without a provider.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => true }),
}));

vi.mock('../../lib/api', () => ({
  getUseRequests: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetUseRequests = vi.mocked(api.getUseRequests);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/use-requests`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/use-requests"
            element={<UseRequestsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/use-requests/create"
            element={<div>Create Request</div>}
          />
          <Route
            path="/organizations/:orgId/collections/use-requests/:id"
            element={<div>Use Request Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('UseRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('renders heading', async () => {
    mockGetUseRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Use of Collections' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state', async () => {
    mockGetUseRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
    });
  });

  it('renders a use request row', async () => {
    mockGetUseRequests.mockResolvedValue({
      items: [
        {
          request_id: 'use-1',
          request_number: 'UR-2024-001',
          requester_name: 'Visiting Scholar',
          use_type: 'research',
          status: 'submitted',
          request_date: '2024-04-15',
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('UR-2024-001')).toBeInTheDocument();
    });
  });

  it('shows error state on failure', async () => {
    mockGetUseRequests.mockRejectedValue(new Error('Failed'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading use requests/i)).toBeInTheDocument();
    });
  });

  it('hides create CTA when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetUseRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Use of Collections' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /new request/i })).not.toBeInTheDocument();
  });

  it('passes status filter to query when changed', async () => {
    mockGetUseRequests.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Use of Collections' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'approved' } });

    await waitFor(() => {
      expect(mockGetUseRequests).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ status: 'approved' })
      );
    });
  });
});
