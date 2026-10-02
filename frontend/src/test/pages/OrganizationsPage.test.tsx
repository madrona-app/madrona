import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrganizationsPage from '../../pages/admin/OrganizationsPage';
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/orgs`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/orgs" element={<OrganizationsPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrganizationsPage', () => {
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
        expect(screen.getByRole('heading', { name: /^Organizations$/i })).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
    });

    it('renders search and filter controls', async () => {
      mockApiFetch.mockResolvedValue({ organizations: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Search by name or slug/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Create Organization/i })).toBeInTheDocument();
    });

    it('renders organization rows', async () => {
      mockApiFetch.mockResolvedValue({
        organizations: [
          {
            organization_id: 'org-1',
            name: 'Alpha Museum',
            slug: 'alpha',
            created_at: '2026-01-01',
            user_count: 10,
            storage: { used_gb: 5, limit_gb: 100, usage_percent: 5 },
            apps: [],
            contract_end_date: null,
            status: 'active',
          },
          {
            organization_id: 'org-2',
            name: 'Beta Gallery',
            slug: 'beta',
            created_at: '2026-01-01',
            user_count: 5,
            storage: { used_gb: 1, limit_gb: 50, usage_percent: 2 },
            apps: [],
            contract_end_date: null,
            status: 'active',
          },
        ],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Alpha Museum')).toBeInTheDocument();
      });
      expect(screen.getByText('Beta Gallery')).toBeInTheDocument();
    });

    it('shows summary stats', async () => {
      mockApiFetch.mockResolvedValue({
        organizations: [
          {
            organization_id: 'o-1',
            name: 'Active Org',
            slug: 'active',
            created_at: '2026-01-01',
            user_count: 1,
            storage: { used_gb: 0, limit_gb: 100, usage_percent: 0 },
            apps: [],
            contract_end_date: null,
            status: 'active',
          },
        ],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Total Organizations/i)).toBeInTheDocument();
      });
    });
  });

  describe('search', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
    });

    it('filters orgs by search term', async () => {
      mockApiFetch.mockResolvedValue({
        organizations: [
          {
            organization_id: 'org-1',
            name: 'Alpha Museum',
            slug: 'alpha',
            created_at: '2026-01-01',
            user_count: 10,
            storage: { used_gb: 5, limit_gb: 100, usage_percent: 5 },
            apps: [],
            contract_end_date: null,
            status: 'active',
          },
          {
            organization_id: 'org-2',
            name: 'Beta Gallery',
            slug: 'beta',
            created_at: '2026-01-01',
            user_count: 5,
            storage: { used_gb: 1, limit_gb: 50, usage_percent: 2 },
            apps: [],
            contract_end_date: null,
            status: 'active',
          },
        ],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Alpha Museum')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText(/Search by name or slug/i), {
        target: { value: 'Beta' },
      });

      expect(screen.queryByText('Alpha Museum')).not.toBeInTheDocument();
      expect(screen.getByText('Beta Gallery')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error when load fails', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockRejectedValue(new Error('Cannot fetch'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Cannot fetch/i)).toBeInTheDocument();
      });
    });
  });
});
