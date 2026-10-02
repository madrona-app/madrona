import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BulkUserImportPage from '../../pages/admin/BulkUserImportPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockApiFetch = vi.mocked(apiClient.apiFetch);

function setAuth(permissions: string[] = ['platform.admin']) {
  mockUseAuth.mockReturnValue({
    user: {
      user_id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      permissions,
    },
    memberships: [],
    activeOrganizationId: 'org-1',
    applications: [{ key: 'collections', enabled: true, status: 'active' }],
    isLoading: false,
    isAuthenticated: true,
    error: null,
  } as any);
}

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/bulk-users`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/bulk-users" element={<BulkUserImportPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BulkUserImportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('permission gate', () => {
    it('redirects when user lacks platform.admin', async () => {
      setAuth([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Collections Landing|Home/i)).toBeInTheDocument();
      });
    });

    it('renders for platform admin', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockResolvedValue({ organizations: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Bulk User Import/i })).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
    });


    it('renders file upload UI', async () => {
      mockApiFetch.mockResolvedValue({ organizations: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Bulk User Import/i })).toBeInTheDocument();
      });

      // Upload button should be present
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
  });

  describe('error state', () => {
    it('shows error when org load fails', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockRejectedValue(new Error('Failed to load orgs'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Failed to load orgs/i)).toBeInTheDocument();
      });
    });
  });
});
