import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SettingsPage from '../../pages/bridge/SettingsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

// Mock api
vi.mock('../../lib/api', () => ({
  getConnectorInstance: vi.fn(),
  getConnectorDefinitions: vi.fn(),
  updateConnectorInstance: vi.fn(),
  getOrganizations: vi.fn(),
  testConnectorConnection: vi.fn(),
}));

// Mock usePermissions
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

// Mock CatalogBrowser
vi.mock('../../components/CatalogBrowser', () => ({
  default: () => <div data-testid="catalog-browser">Catalog Browser</div>,
}));

// Mock DataPreviewModal
vi.mock('../../components/DataPreviewModal', () => ({
  default: () => null,
}));

const mockGetConnectorInstance = vi.mocked(api.getConnectorInstance);
const mockGetConnectorDefinitions = vi.mocked(api.getConnectorDefinitions);
const mockUpdateConnectorInstance = vi.mocked(api.updateConnectorInstance);
const mockGetOrganizations = vi.mocked(api.getOrganizations);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function renderSettingsPage(instanceId = 'inst-123', orgId = 'org-123') {
  return render(
    <MemoryRouter initialEntries={[`/organizations/${orgId}/bridge/setup/connectors/${instanceId}`]}>
      <Routes>
        <Route
          path="/organizations/:orgId/bridge/setup/connectors/:instanceId"
          element={<SettingsPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('SettingsPage', () => {
  const mockInstance = {
    connector_instance_id: 'inst-123',
    connector_definition_id: 'def-1',
    organization_id: 'org-123',
    name: 'Test Connector',
    config: { description: 'Test description' },
    direction: 'source' as const,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const mockDefinition = {
    connector_definition_id: 'def-1',
    key: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read from Google Sheets',
    icon: 'sheets.svg',
    auth_type: 'oauth2',
    config_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', title: 'Spreadsheet ID' },
      },
    },
    direction: 'source' as const,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const mockOrg = {
    organization_id: 'org-123',
    name: 'Test Org',
    slug: 'test-org',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
    mockGetOrganizations.mockResolvedValue([mockOrg]);
  });

  describe('loading state', () => {
    it('shows loading state initially', () => {
      mockGetConnectorInstance.mockImplementation(() => new Promise(() => {}));
      mockGetConnectorDefinitions.mockImplementation(() => new Promise(() => {}));

      renderSettingsPage();

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    beforeEach(() => {
      mockGetConnectorInstance.mockResolvedValue(mockInstance);
      mockGetConnectorDefinitions.mockResolvedValue([mockDefinition]);
    });

    it('renders connector name in input', async () => {
      renderSettingsPage();

      await waitFor(() => {
        const nameInput = screen.getByDisplayValue('Test Connector');
        expect(nameInput).toBeInTheDocument();
      });
    });

    it('renders description input', async () => {
      renderSettingsPage();

      await waitFor(() => {
        const descInput = screen.getByDisplayValue('Test description');
        expect(descInput).toBeInTheDocument();
      });
    });

    it('renders save button', async () => {
      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
      });
    });

    it('renders reset button', async () => {
      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
      });
    });
  });

  describe('save functionality', () => {
    beforeEach(() => {
      mockGetConnectorInstance.mockResolvedValue(mockInstance);
      mockGetConnectorDefinitions.mockResolvedValue([mockDefinition]);
      mockUpdateConnectorInstance.mockResolvedValue({});
    });

    it('calls update API on save', async () => {
      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

      await waitFor(() => {
        expect(mockUpdateConnectorInstance).toHaveBeenCalledWith('inst-123', expect.anything());
      });
    });

    it('shows success message after save', async () => {
      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

      await waitFor(() => {
        expect(screen.getByText(/settings saved/i)).toBeInTheDocument();
      });
    });

    it('updates name on change', async () => {
      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Connector')).toBeInTheDocument();
      });

      const nameInput = screen.getByDisplayValue('Test Connector');
      fireEvent.change(nameInput, { target: { value: 'Updated Name' } });

      expect(screen.getByDisplayValue('Updated Name')).toBeInTheDocument();
    });
  });

  describe('permissions', () => {
    beforeEach(() => {
      mockGetConnectorInstance.mockResolvedValue(mockInstance);
      mockGetConnectorDefinitions.mockResolvedValue([mockDefinition]);
    });

    it('disables save when user lacks edit permission', async () => {
      mockUsePermissions.mockReturnValue({
        hasPermission: vi.fn().mockReturnValue(false),
        hasAnyPermission: vi.fn().mockReturnValue(false),
        hasAllPermissions: vi.fn().mockReturnValue(false),
      });

      renderSettingsPage();

      await waitFor(() => {
        const saveButton = screen.getByRole('button', { name: /save settings/i });
        expect(saveButton).toBeDisabled();
      });
    });

    it('renders page with locked fields when no permission', async () => {
      mockUsePermissions.mockReturnValue({
        hasPermission: vi.fn().mockReturnValue(false),
        hasAnyPermission: vi.fn().mockReturnValue(false),
        hasAllPermissions: vi.fn().mockReturnValue(false),
      });

      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Connector')).toBeInTheDocument();
      });
    });
  });

  describe('database connector features', () => {
    const dbDefinition = {
      ...mockDefinition,
      connector_definition_id: 'def-db',
      key: 'db-postgres',
      name: 'PostgreSQL',
    };

    const dbInstance = {
      ...mockInstance,
      connector_definition_id: 'def-db',
    };

    it('renders catalog browser for database connectors', async () => {
      mockGetConnectorInstance.mockResolvedValue(dbInstance);
      mockGetConnectorDefinitions.mockResolvedValue([dbDefinition]);

      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByTestId('catalog-browser')).toBeInTheDocument();
      });
    });

    it('renders connection test section for database connectors', async () => {
      mockGetConnectorInstance.mockResolvedValue(dbInstance);
      mockGetConnectorDefinitions.mockResolvedValue([dbDefinition]);

      renderSettingsPage();

      await waitFor(() => {
        expect(screen.getByText('Connection Test')).toBeInTheDocument();
      });
    });
  });
});
