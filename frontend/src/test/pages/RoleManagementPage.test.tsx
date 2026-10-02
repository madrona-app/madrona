import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RoleManagementPage from '../../pages/admin/RoleManagementPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as apiClient from '../../lib/apiClient';

// Mock useAuth
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

// Mock apiClient
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderRoleManagementPage(orgId = 'org-123', hasPermission = true) {
  mockUseAuth.mockReturnValue({
    user: {
      user_id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      permissions: hasPermission ? ['org.manage_members'] : [],
    },
    memberships: [],
    activeOrganizationId: orgId,
    applications: [
      { key: 'collections', enabled: true, status: 'active' },
      { key: 'bridge', enabled: true, status: 'active' },
    ],
    isLoading: false,
    error: null,
  } as any);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/roles`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/roles" element={<RoleManagementPage />} />
          <Route path="/organizations/:orgId/collections" element={<div>Collections Page</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Page</div>} />
          <Route path="/organizations/:orgId/flow" element={<div>Flow Page</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RoleManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ users: [], roles: [] });
  });

  describe('permission check', () => {
    it('redirects when user lacks manage_members permission', async () => {
      renderRoleManagementPage('org-123', false);

      await waitFor(() => {
        expect(screen.getByText(/collections page|flow page|home/i)).toBeInTheDocument();
      });
    });

    it('renders page when user has manage_members permission', async () => {
      mockApiFetch
        .mockResolvedValueOnce({ users: [] })
        .mockResolvedValueOnce({ roles: [] });

      renderRoleManagementPage('org-123', true);

      await waitFor(() => {
        expect(screen.getByText('Role Management')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching data', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      renderRoleManagementPage();

      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    // Only roles in the APP_ROLES set (registrar/curator/publisher/viewer) render
    // as columns for a given app tab.
    const mockRoles = [
      { role_id: 'role-1', role_key: 'registrar', display_name: 'Registrar' },
      { role_id: 'role-2', role_key: 'curator', display_name: 'Curator' },
      { role_id: 'role-3', role_key: 'viewer', display_name: 'Viewer' },
    ];

    const mockUsers = [
      { user_id: 'user-1', name: 'Admin User', email: 'admin@test.com', role_id: 'role-1', role_key: 'registrar' },
      { user_id: 'user-2', name: 'Member User', email: 'member@test.com', role_id: 'role-2', role_key: 'curator' },
    ];

    beforeEach(() => {
      mockApiFetch
        .mockResolvedValueOnce({ users: mockUsers })
        .mockResolvedValueOnce({ roles: mockRoles });
    });

    it('renders page title', async () => {
      renderRoleManagementPage();

      await waitFor(() => {
        expect(screen.getByText('Role Management')).toBeInTheDocument();
      });
    });

    it('renders app tab descriptions', async () => {
      renderRoleManagementPage();

      await waitFor(() => {
        // Default active tab is bridge — its description is rendered in the header
        expect(screen.getByText(/data pipelines and connectors/i)).toBeInTheDocument();
      });
    });

    it('renders role columns', async () => {
      renderRoleManagementPage();

      await waitFor(() => {
        expect(screen.getByText('Registrar')).toBeInTheDocument();
        expect(screen.getByText('Curator')).toBeInTheDocument();
        expect(screen.getByText('Viewer')).toBeInTheDocument();
      });
    });

    it('renders users in their role columns', async () => {
      renderRoleManagementPage();

      await waitFor(() => {
        expect(screen.getByText('Admin User')).toBeInTheDocument();
        expect(screen.getByText('Member User')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows no roles message when roles empty', async () => {
      mockApiFetch
        .mockResolvedValueOnce({ users: [] })
        .mockResolvedValueOnce({ roles: [] });

      renderRoleManagementPage();

      await waitFor(() => {
        expect(screen.getByText(/no roles found/i)).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message on API failure', async () => {
      mockApiFetch.mockRejectedValue(new Error('Failed to fetch'));

      renderRoleManagementPage();

      await waitFor(() => {
        expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument();
      });
    });
  });

  describe('API calls', () => {
    it('fetches users and roles on mount', async () => {
      mockApiFetch
        .mockResolvedValueOnce({ users: [] })
        .mockResolvedValueOnce({ roles: [] });

      renderRoleManagementPage('org-123', true);

      await waitFor(() => {
        const urls = mockApiFetch.mock.calls.map((c) => c[0]);
        expect(urls.some((u: string) => u.startsWith('/organizations/org-123/users?status=active'))).toBe(true);
        expect(urls.some((u: string) => u.startsWith('/organizations/org-123/roles'))).toBe(true);
      });
    });
  });
});
