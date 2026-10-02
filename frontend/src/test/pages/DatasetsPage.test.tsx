import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DatasetsPage from '../../pages/bridge/DatasetsPage';
import { mockDatasets } from '../fixtures/mockData';
import * as api from '../../lib/api';
import * as useOrganization from '../../contexts/useOrganization';
import * as usePermissions from '../../hooks/usePermissions';

// Mock API functions
vi.mock('../../lib/api');
vi.mock('../../contexts/useOrganization');
vi.mock('../../hooks/usePermissions');
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

describe('DatasetsPage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    // Mock organization context
    vi.mocked(useOrganization.useOrganization).mockReturnValue({
      activeOrganizationId: 'org-1',
      organizations: [],
      activeOrganization: null,
      setActiveOrganizationId: vi.fn(),
      refreshOrganizations: vi.fn(),
      isLoading: false,
      error: null,
    });

    // Mock permissions (default: can view, no export)
    vi.mocked(usePermissions.usePermissions).mockReturnValue({
      hasPermission: vi.fn((perm) => perm === 'data.view'),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
      permissions: ['data.view'],
    });

    // Mock API responses
    vi.mocked(api.getDatasets).mockResolvedValue(mockDatasets);
    vi.mocked(api.getOrganizationSettings).mockResolvedValue({
      'export.formats.enabled': ['jsonl', 'json'],
      'export.formats.default': 'jsonl',
    });
  });

  const renderDatasetsPage = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/organizations/org-1/datasets']}>
          <Routes>
            <Route path="/organizations/:orgId/datasets" element={<DatasetsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  describe('renders dataset list', () => {
    it('displays page title and datasets', async () => {
      renderDatasetsPage();

      // Wait for datasets to load
      expect(await screen.findByText('Museum Objects')).toBeInTheDocument();
      expect(screen.getByText('Exhibitions')).toBeInTheDocument();
    });

    it('displays entity counts for datasets', async () => {
      renderDatasetsPage();

      await waitFor(() => {
        expect(screen.getByText('Museum Objects')).toBeInTheDocument();
      });

      // Check entity counts are displayed (formatted with locale)
      expect(screen.getByText(/1,247 records/)).toBeInTheDocument();
      expect(screen.getByText(/89 records/)).toBeInTheDocument();
    });

    it('displays empty state when no datasets exist', async () => {
      vi.mocked(api.getDatasets).mockResolvedValue([]);

      renderDatasetsPage();

      expect(await screen.findByText('No datasets')).toBeInTheDocument();
    });
  });

  describe('dataset details', () => {
    it('shows dataset description', async () => {
      renderDatasetsPage();

      await waitFor(() => {
        expect(screen.getByText('Museum Objects')).toBeInTheDocument();
      });

      expect(screen.getByText('Collection objects from museums')).toBeInTheDocument();
      expect(screen.getByText('Museum exhibitions')).toBeInTheDocument();
    });
  });

  describe('export functionality', () => {
    it('shows disabled export button when user lacks permission', async () => {
      vi.mocked(usePermissions.usePermissions).mockReturnValue({
        hasPermission: vi.fn().mockReturnValue(false),
        hasAnyPermission: vi.fn().mockReturnValue(false),
        hasAllPermissions: vi.fn().mockReturnValue(false),
        permissions: [],
      });

      renderDatasetsPage();

      await waitFor(() => {
        expect(screen.getByText('Museum Objects')).toBeInTheDocument();
      });

      // Export buttons should be disabled
      const exportButtons = screen.getAllByText('Export snapshot');
      expect(exportButtons[0].closest('button')).toBeDisabled();
    });

    it('shows enabled export button when user has data.export permission', async () => {
      vi.mocked(usePermissions.usePermissions).mockReturnValue({
        hasPermission: vi.fn((perm) => perm === 'data.export'),
        hasAnyPermission: vi.fn().mockReturnValue(true),
        hasAllPermissions: vi.fn().mockReturnValue(true),
        permissions: ['data.export'],
      });

      renderDatasetsPage();

      await waitFor(() => {
        expect(screen.getByText('Museum Objects')).toBeInTheDocument();
      });

      // Export buttons should be enabled
      const exportButtons = screen.getAllByText('Export snapshot');
      expect(exportButtons[0].closest('button')).not.toBeDisabled();
    });
  });

  describe('navigation', () => {
    it('renders links to dataset detail pages', async () => {
      renderDatasetsPage();

      await waitFor(() => {
        expect(screen.getByText('Museum Objects')).toBeInTheDocument();
      });

      // Dataset cards should be links
      const link = screen.getByText('Museum Objects').closest('a');
      expect(link).toHaveAttribute('href', expect.stringContaining('/datasets/dataset-1'));
    });
  });

  describe('loading state', () => {
    it('shows loading state while fetching datasets', async () => {
      // Create a delayed promise
      let resolveDatasets: (value: any) => void;
      vi.mocked(api.getDatasets).mockImplementation(
        () => new Promise(resolve => { resolveDatasets = resolve; })
      );

      renderDatasetsPage();

      // Should show loading
      expect(await screen.findByRole('status', { name: /loading/i })).toBeInTheDocument();

      // Resolve the promise
      resolveDatasets!([]);

      // Should show empty state
      await waitFor(() => {
        expect(screen.getByText('No datasets')).toBeInTheDocument();
      });
    });
  });
});
