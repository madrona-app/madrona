import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SSOConfigurationPage from '../../pages/admin/SSOConfigurationPage';
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/sso`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/sso" element={<SSOConfigurationPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SSOConfigurationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('permission gate', () => {

    it('renders page when user has platform.admin', async () => {
      setAuth(['platform.admin']);
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/platform/organizations') {
          return Promise.resolve({ organizations: [] });
        }
        return Promise.resolve({
          organization_id: 'org-1',
          organization_name: 'Org',
          sso_config: null,
          sp_metadata: { entity_id: 'sp', acs_url: 'https://acs' },
          available_roles: [],
          enabled_apps: [],
        });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /SSO Configuration/i })).toBeInTheDocument();
      });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
    });

    it('renders organization selector', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/platform/organizations') {
          return Promise.resolve({
            organizations: [{ organization_id: 'org-1', name: 'Test Org' }],
          });
        }
        return Promise.resolve({
          organization_id: 'org-1',
          organization_name: 'Test Org',
          sso_config: null,
          sp_metadata: { entity_id: 'sp', acs_url: 'https://acs' },
          available_roles: [],
          enabled_apps: [],
        });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /SSO Configuration/i })).toBeInTheDocument();
      });
    });

    it('lists organizations in selector', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/platform/organizations') {
          return Promise.resolve({
            organizations: [
              { organization_id: 'org-1', name: 'Alpha Museum' },
              { organization_id: 'org-2', name: 'Beta Gallery' },
            ],
          });
        }
        return Promise.resolve({
          organization_id: 'org-1',
          organization_name: 'Alpha Museum',
          sso_config: null,
          sp_metadata: { entity_id: 'sp-id', acs_url: 'https://acs.example.com' },
          available_roles: [],
          enabled_apps: [],
        });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Alpha Museum')).toBeInTheDocument();
      });
    });

    it('shows SAML and OIDC tabs', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/platform/organizations') {
          return Promise.resolve({
            organizations: [{ organization_id: 'org-1', name: 'Test Org' }],
          });
        }
        return Promise.resolve({
          organization_id: 'org-1',
          organization_name: 'Test Org',
          sso_config: null,
          sp_metadata: { entity_id: 'sp-id', acs_url: 'https://acs.example.com' },
          available_roles: [],
          enabled_apps: [],
        });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /SAML 2.0/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /OIDC/i })).toBeInTheDocument();
    });

    it('shows SP metadata for IdP setup', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/platform/organizations') {
          return Promise.resolve({
            organizations: [{ organization_id: 'org-1', name: 'Test Org' }],
          });
        }
        return Promise.resolve({
          organization_id: 'org-1',
          organization_name: 'Test Org',
          sso_config: null,
          sp_metadata: {
            entity_id: 'urn:test:entity',
            acs_url: 'https://app.test/acs',
          },
          available_roles: [],
          enabled_apps: [],
        });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('urn:test:entity')).toBeInTheDocument();
      });
      expect(screen.getByText('https://app.test/acs')).toBeInTheDocument();
    });
  });

  describe('SAML form', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/platform/organizations') {
          return Promise.resolve({
            organizations: [{ organization_id: 'org-1', name: 'Test Org' }],
          });
        }
        return Promise.resolve({
          organization_id: 'org-1',
          organization_name: 'Test Org',
          sso_config: null,
          sp_metadata: { entity_id: 'sp', acs_url: 'https://acs' },
          available_roles: [],
          enabled_apps: [],
        });
      });
    });

    it('renders the SAML IdP form fields when SAML tab is active', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Identity Provider Settings/i)).toBeInTheDocument();
      });

      expect(screen.getByPlaceholderText('https://idp.example.com/metadata')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('https://idp.example.com/sso/saml')).toBeInTheDocument();
    });

    it('switches to OIDC view (which is coming-soon)', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Identity Provider Settings/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /OIDC/i }));

      await waitFor(() => {
        expect(screen.getByText(/OIDC support is coming soon/i)).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
    });

    it('shows error when organizations fail to load', async () => {
      mockApiFetch.mockRejectedValue(new Error('Network error'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });
    });
  });
});
