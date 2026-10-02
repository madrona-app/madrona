import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PermissionManagementPage from '../../pages/admin/PermissionManagementPage';
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
    applications: [
      { key: 'collections', enabled: true, status: 'active' },
    ],
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/permissions`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/permissions" element={<PermissionManagementPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PermissionManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('permission gate', () => {
    it('redirects when user lacks platform.admin', async () => {
      setAuth([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/collections landing|home/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Permission Management/i)).not.toBeInTheDocument();
    });

    it('renders page when user has platform.admin', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockResolvedValue({ roles: [], scopes: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Permission Management/i })).toBeInTheDocument();
      });
    });
  });


  describe('error state', () => {
    it('shows error message on API failure', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockRejectedValue(new Error('Server unavailable'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Server unavailable/i)).toBeInTheDocument();
      });
    });
  });

  describe('with data', () => {
    const mockData = {
      roles: [
        { role_id: 'r-1', role_key: 'admin', display_name: 'Admin' },
        { role_id: 'r-2', role_key: 'viewer', display_name: 'Viewer' },
      ],
      scopes: [
        {
          scope: 'collections',
          permissions: [
            {
              permission_id: 'p-1',
              permission_key: 'collections.view',
              display_name: 'View Collections',
              description: 'View all collection objects',
              roles: ['admin'],
            },
          ],
        },
      ],
    };

    beforeEach(() => {
      setAuth(['platform.admin']);
      mockApiFetch.mockResolvedValue(mockData);
    });

    it('renders role columns', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeInTheDocument();
        expect(screen.getByText('Viewer')).toBeInTheDocument();
      });
    });

    it('renders scope group label', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Collections')).toBeInTheDocument();
      });
    });

    it('expands scope when clicked', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Collections')).toBeInTheDocument();
      });

      // Click scope header row to expand
      const scopeRow = screen.getByText('Collections').closest('tr');
      expect(scopeRow).not.toBeNull();
      fireEvent.click(scopeRow!);

      await waitFor(() => {
        expect(screen.getByText('View Collections')).toBeInTheDocument();
      });
    });

    it('filters by search query', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Collections')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search permissions/i);
      fireEvent.change(searchInput, { target: { value: 'View' } });

      // Search auto-expands matching scopes
      await waitFor(() => {
        expect(screen.getByText('View Collections')).toBeInTheDocument();
      });
    });

    it('shows no-match message when search has no results', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Collections')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search permissions/i);
      fireEvent.change(searchInput, { target: { value: 'zzzzznone' } });

      await waitFor(() => {
        expect(screen.getByText(/No permissions match/i)).toBeInTheDocument();
      });
    });
  });

  describe('API calls', () => {
    it('fetches permission matrix on mount', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockResolvedValue({ roles: [], scopes: [] });

      renderPage();

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/platform/permissions-matrix');
      });
    });
  });
});
