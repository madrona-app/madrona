import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserSettingsPage } from '../../pages/admin/UserSettingsPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as usePermissionsHook from '../../hooks/usePermissions';
import * as api from '../../lib/api';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  updateUserProfile: vi.fn(),
  updateOrganization: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
  getOrganizationStorage: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);
const mockGetStorage = vi.mocked(api.getOrganizationStorage);

function setAuth(opts: { permissions?: string[]; activeOrgId?: string | null } = {}) {
  const { activeOrgId = 'org-1' } = opts;
  mockUseAuth.mockReturnValue({
    user: {
      user_id: 'user-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      timezone: 'America/New_York',
      permissions: [],
    },
    memberships: [
      {
        organization_id: 'org-1',
        name: 'Test Museum',
        slug: 'test-museum',
        timezone: 'UTC',
      },
    ],
    activeOrganizationId: activeOrgId,
    applications: [],
    isLoading: false,
    isAuthenticated: true,
    error: null,
    refreshMe: vi.fn(),
  } as any);
}

function setPermissions(canManage = false) {
  mockUsePermissions.mockReturnValue({
    hasPermission: vi.fn().mockReturnValue(canManage),
    hasAnyPermission: vi.fn().mockReturnValue(canManage),
    hasAllPermissions: vi.fn().mockReturnValue(canManage),
  });
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UserSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UserSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPermissions(false);
    mockGetStorage.mockResolvedValue({} as any);
  });

  describe('rendering', () => {
    it('renders Account Settings heading', async () => {
      setAuth();

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Account Settings/i })).toBeInTheDocument();
      });
    });

    it('renders profile section', async () => {
      setAuth();

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Your Profile/i })).toBeInTheDocument();
      });
    });


    it('shows user email', async () => {
      setAuth();

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('jane@example.com')).toBeInTheDocument();
      });
    });
  });

  describe('organization settings visibility', () => {
    it('shows org settings when user has org.manage_settings', async () => {
      setAuth();
      setPermissions(true);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Organization Settings/i })).toBeInTheDocument();
      });
    });

    it('hides org settings when user lacks permission', async () => {
      setAuth();
      setPermissions(false);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Account Settings/i })).toBeInTheDocument();
      });

      expect(screen.queryByRole('heading', { name: /Organization Settings/i })).not.toBeInTheDocument();
    });
  });
});
