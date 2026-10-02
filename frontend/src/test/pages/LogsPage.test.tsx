import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogsPage from '../../pages/admin/LogsPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as apiClient from '../../lib/apiClient';
import * as api from '../../lib/api';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getEmailEvents: vi.fn(),
  getEmailStats: vi.fn(),
  getUsersByEmailStatus: vi.fn(),
  updateUserEmailStatus: vi.fn(),
  bulkDeleteEmailEvents: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockApiFetch = vi.mocked(apiClient.apiFetch);

function setAuth(opts: { permissions?: string[]; isPlatformAdmin?: boolean } = {}) {
  const { permissions = [], isPlatformAdmin = false } = opts;
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
    isPlatformAdmin,
    error: null,
  } as any);
}

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/logs`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/logs" element={<LogsPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ items: [], total: 0, page: { limit: 25, offset: 0, has_more: false } });
    vi.mocked(api.getEmailEvents).mockResolvedValue({ items: [] } as any);
    vi.mocked(api.getEmailStats).mockResolvedValue({} as any);
    vi.mocked(api.getUsersByEmailStatus).mockResolvedValue({ items: [] } as any);
  });

  describe('permission gate', () => {
    it('redirects when user lacks audit log permissions', async () => {
      setAuth({ permissions: [], isPlatformAdmin: false });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Collections Landing|Home/i)).toBeInTheDocument();
      });
    });

    it('renders for platform admin', async () => {
      setAuth({ permissions: [], isPlatformAdmin: true });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^Logs$/i })).toBeInTheDocument();
      });
    });

    it('renders for users with org.view_audit_logs', async () => {
      setAuth({ permissions: ['org.view_audit_logs'], isPlatformAdmin: false });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^Logs$/i })).toBeInTheDocument();
      });
    });
  });

  describe('rendering tabs', () => {
    it('shows all tabs for platform admin', async () => {
      setAuth({ isPlatformAdmin: true });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /User Activity/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Provisioning/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Email Events/i })).toBeInTheDocument();
    });

    it('only shows User Activity tab for non-admin org users', async () => {
      setAuth({ permissions: ['org.view_audit_logs'], isPlatformAdmin: false });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /User Activity/i })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /Provisioning/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Email Events/i })).not.toBeInTheDocument();
    });
  });
});
