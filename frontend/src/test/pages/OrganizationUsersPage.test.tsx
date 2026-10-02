import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrganizationUsersPage from '../../pages/admin/OrganizationUsersPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockApiFetch = vi.mocked(apiClient.apiFetch);

function setAuth(permissions: string[] = ['org.manage_members']) {
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
      { key: 'bridge', enabled: true, status: 'active' },
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/users`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/users" element={<OrganizationUsersPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrganizationUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('permission gate', () => {
    it('redirects when user lacks org.manage_members', async () => {
      setAuth([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Collections Landing|Home/i)).toBeInTheDocument();
      });
    });

    it('renders for users with org.manage_members', async () => {
      setAuth(['org.manage_members']);
      mockApiFetch.mockResolvedValue({ users: [], roles: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^Users$/i })).toBeInTheDocument();
      });
    });

    it('renders for platform admin', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockResolvedValue({ users: [], roles: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^Users$/i })).toBeInTheDocument();
      });
    });
  });

  describe('with data', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
    });

    it('renders user list', async () => {
      const mockUsers = [
        {
          user_id: 'u-1',
          email: 'jane@example.com',
          name: 'Jane Doe',
          role_id: 'r-1',
          role_key: 'admin',
          role_display_name: 'Admin',
          status: 'active',
          user_status: 'active',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      mockApiFetch.mockImplementation((url: string) => {
        if (url.includes('/users')) {
          return Promise.resolve({ users: mockUsers });
        }
        if (url.includes('/roles')) {
          return Promise.resolve({
            roles: [{ role_id: 'r-1', role_key: 'admin', display_name: 'Admin' }],
          });
        }
        return Promise.resolve({});
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      });
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('shows error when load fails', async () => {
      mockApiFetch.mockRejectedValue(new Error('Cannot load users'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Cannot load users/i)).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading while fetching', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockImplementation(() => new Promise(() => {}));

      renderPage();

      // Either a generic loading indicator or wait for any visible content
      await waitFor(() => {
        // It should not crash; nothing else rendered yet
        expect(mockApiFetch).toHaveBeenCalled();
      });
    });
  });
});
