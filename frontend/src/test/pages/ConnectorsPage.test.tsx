import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConnectorsPage from '../../pages/bridge/ConnectorsPage';
import * as api from '../../lib/api';
import * as useOrganizationHook from '../../contexts/useOrganization';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof api>('../../lib/api');
  return {
    ...actual,
    getConnectorDefinitions: vi.fn(),
    getConnectorInstances: vi.fn(),
    createConnectorInstance: vi.fn(),
    deleteConnectorInstance: vi.fn(),
    getOrganizations: vi.fn(),
    getPipelines: vi.fn(),
  };
});

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

// Mock heavy wizard components to keep tests focused
vi.mock('../../components/DatabaseConnectionWizard', () => ({
  default: () => <div data-testid="db-wizard">Database wizard</div>,
}));
vi.mock('../../components/ApiConnectionWizard', () => ({
  default: () => <div data-testid="api-wizard">API wizard</div>,
}));

const mockGetConnectorDefinitions = vi.mocked(api.getConnectorDefinitions);
const mockGetConnectorInstances = vi.mocked(api.getConnectorInstances);
const mockGetOrganizations = vi.mocked(api.getOrganizations);
const mockGetPipelines = vi.mocked(api.getPipelines);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/bridge/setup/connectors`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/bridge/setup/connectors"
            element={<ConnectorsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const mockDefinitions = [
  {
    connector_definition_id: 'def-1',
    key: 'db-postgres',
    display_name: 'PostgreSQL',
    direction: 'source',
    category: 'database',
    config_schema: { type: 'object' },
  },
  {
    connector_definition_id: 'def-2',
    key: 'api-rest',
    display_name: 'REST API',
    direction: 'source',
    category: 'api',
    config_schema: null,
  },
];

const mockInstances = [
  {
    connector_instance_id: 'inst-1',
    name: 'Production DB',
    connector_definition_id: 'def-1',
    config: { host: 'localhost' },
  },
];

describe('ConnectorsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    mockGetOrganizations.mockResolvedValue([
      {
        organization_id: 'org-123',
        name: 'Test Org',
        slug: 'test-org',
      },
    ] as never);
    mockGetPipelines.mockResolvedValue([] as never);
  });

  describe('basic render', () => {
    beforeEach(() => {
      mockGetConnectorDefinitions.mockResolvedValue(mockDefinitions as never);
      mockGetConnectorInstances.mockResolvedValue([] as never);
    });

    it('renders Connectors heading', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Connectors' })
        ).toBeInTheDocument();
      });
    });

    it('renders Connector Types section', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Connector Types' })
        ).toBeInTheDocument();
      });
    });

    it('renders Configured Systems section', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Configured Systems' })
        ).toBeInTheDocument();
      });
    });

    it('renders Create Instance button', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create instance/i })
        ).toBeInTheDocument();
      });
    });
  });

  describe('connector definitions', () => {
    beforeEach(() => {
      mockGetConnectorDefinitions.mockResolvedValue(mockDefinitions as never);
      mockGetConnectorInstances.mockResolvedValue([] as never);
    });

    it('groups by category - Databases', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/^Databases$/)).toBeInTheDocument();
      });
    });

    it('groups by category - APIs', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/^APIs$/)).toBeInTheDocument();
      });
    });

    it('shows definition display name', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
      });
      expect(screen.getByText('REST API')).toBeInTheDocument();
    });

    it('shows Connect button for database connectors', async () => {
      renderPage();
      await waitFor(() => {
        const connectButtons = screen.getAllByRole('button', { name: /^connect$/i });
        // Both db-postgres and api-rest should show connect (database & api categories)
        expect(connectButtons.length).toBe(2);
      });
    });
  });

  describe('configured instances', () => {
    it('shows empty state when no instances', async () => {
      mockGetConnectorDefinitions.mockResolvedValue(mockDefinitions as never);
      mockGetConnectorInstances.mockResolvedValue([] as never);
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByText(/No configured systems found/i)
        ).toBeInTheDocument();
      });
    });

    it('renders a configured instance', async () => {
      mockGetConnectorDefinitions.mockResolvedValue(mockDefinitions as never);
      mockGetConnectorInstances.mockResolvedValue(mockInstances as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Production DB')).toBeInTheDocument();
      });
    });

    it('shows pipeline usage as Not used by any pipelines', async () => {
      mockGetConnectorDefinitions.mockResolvedValue(mockDefinitions as never);
      mockGetConnectorInstances.mockResolvedValue(mockInstances as never);
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByText(/Not used by any pipelines/i)
        ).toBeInTheDocument();
      });
    });

    it('renders Delete button on instance', async () => {
      mockGetConnectorDefinitions.mockResolvedValue(mockDefinitions as never);
      mockGetConnectorInstances.mockResolvedValue(mockInstances as never);
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /^delete$/i })
        ).toBeInTheDocument();
      });
    });
  });

  describe('create instance form', () => {
    beforeEach(() => {
      mockGetConnectorDefinitions.mockResolvedValue(mockDefinitions as never);
      mockGetConnectorInstances.mockResolvedValue([] as never);
    });

    it('toggles create form on Create Instance click', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create instance/i })
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create instance/i }));

      expect(
        screen.getByRole('heading', { name: 'New Connector Instance' })
      ).toBeInTheDocument();
    });

    it('shows form fields when create form opened', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create instance/i })
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create instance/i }));

      expect(screen.getByLabelText('Organization')).toBeInTheDocument();
      expect(
        screen.getByLabelText(/connector instance name/i)
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/connector configuration json/i)
      ).toBeInTheDocument();
    });

    it('closes the form when Cancel clicked', async () => {
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create instance/i })
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /create instance/i }));
      expect(
        screen.getByRole('heading', { name: 'New Connector Instance' })
      ).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole('button', { name: /^cancel$/i })[0]);

      expect(
        screen.queryByRole('heading', { name: 'New Connector Instance' })
      ).not.toBeInTheDocument();
    });
  });
});
