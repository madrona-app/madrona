import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SetupDatasetsPage from '../../pages/bridge/SetupDatasetsPage';
import * as api from '../../lib/api';

// Mock the api module
vi.mock('../../lib/api', () => ({
  getDatasets: vi.fn(),
  getPipelines: vi.fn(),
  createDataset: vi.fn(),
}));

// Mock useOrganization
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(() => ({
    activeOrganizationId: 'org-123',
  })),
}));

const mockGetDatasets = vi.mocked(api.getDatasets);
const mockGetPipelines = vi.mocked(api.getPipelines);
const mockCreateDataset = vi.mocked(api.createDataset);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderSetupDatasetsPage(orgId = 'org-123') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/bridge/setup/datasets`]}>
        <Routes>
          <Route path="/organizations/:orgId/bridge/setup/datasets" element={<SetupDatasetsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SetupDatasetsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatasets.mockResolvedValue([]);
    mockGetPipelines.mockResolvedValue([]);
  });

  describe('basic rendering', () => {
    it('renders page title', async () => {
      renderSetupDatasetsPage();
      expect(await screen.findByText('Canonical Collections')).toBeInTheDocument();
    });

    it('renders description', async () => {
      renderSetupDatasetsPage();
      expect(await screen.findByText(/canonical collections of entities/i)).toBeInTheDocument();
    });

    it('renders create collection button', async () => {
      renderSetupDatasetsPage();
      expect(await screen.findByRole('button', { name: /create collection/i })).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching', () => {
      mockGetDatasets.mockImplementation(() => new Promise(() => {})); // Never resolves
      renderSetupDatasetsPage();
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no datasets', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();
      expect(await screen.findByText(/no datasets yet/i)).toBeInTheDocument();
    });

    it('shows configure pipeline link in empty state', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();
      expect(await screen.findByRole('link', { name: /configure a pipeline/i })).toBeInTheDocument();
    });
  });

  describe('with datasets', () => {
    const mockDatasets = [
      {
        dataset_id: 'ds-1',
        name: 'Museum Collection',
        key: 'museum-collection',
        description: 'Art objects from the museum',
        source_type: 'smithsonian',
        role: 'canonical',
        updated_at: new Date().toISOString(),
        entity_count: 1500,
      },
      {
        dataset_id: 'ds-2',
        name: 'Library Records',
        key: 'library-records',
        description: null,
        source_type: 'library-api',
        role: null,
        updated_at: new Date(Date.now() - 86400000).toISOString(), // Yesterday
        entity_count: 500,
      },
    ];

    const mockPipelines = [
      { pipeline_id: 'pipe-1', name: 'Museum Pipeline', dataset_id: 'ds-1' },
    ];

    it('renders dataset names', async () => {
      mockGetDatasets.mockResolvedValue(mockDatasets);
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupDatasetsPage();

      expect(await screen.findByText('Museum Collection')).toBeInTheDocument();
      expect(screen.getByText('Library Records')).toBeInTheDocument();
    });

    it('renders dataset descriptions', async () => {
      mockGetDatasets.mockResolvedValue(mockDatasets);
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupDatasetsPage();

      expect(await screen.findByText('Art objects from the museum')).toBeInTheDocument();
    });

    it('renders dataset keys', async () => {
      mockGetDatasets.mockResolvedValue(mockDatasets);
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupDatasetsPage();

      expect(await screen.findByText('museum-collection')).toBeInTheDocument();
      expect(screen.getByText('library-records')).toBeInTheDocument();
    });

    it('renders entity counts', async () => {
      mockGetDatasets.mockResolvedValue(mockDatasets);
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupDatasetsPage();

      expect(await screen.findByText('1,500 entities')).toBeInTheDocument();
      expect(screen.getByText('500 entities')).toBeInTheDocument();
    });

    it('renders producing pipeline name', async () => {
      mockGetDatasets.mockResolvedValue(mockDatasets);
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupDatasetsPage();

      expect(await screen.findByText('Museum Pipeline')).toBeInTheDocument();
    });

    it('shows no pipeline configured message', async () => {
      mockGetDatasets.mockResolvedValue(mockDatasets);
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupDatasetsPage();

      expect(await screen.findByText(/no pipeline configured/i)).toBeInTheDocument();
    });

    it('renders info footer', async () => {
      mockGetDatasets.mockResolvedValue(mockDatasets);
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupDatasetsPage();

      expect(await screen.findByText(/deduplicated and versioned/i)).toBeInTheDocument();
    });
  });

  describe('create form', () => {
    it('shows form when create button clicked', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();

      const createBtn = await screen.findByRole('button', { name: /create collection/i });
      fireEvent.click(createBtn);

      expect(screen.getByText('New Dataset')).toBeInTheDocument();
    });

    it('renders form fields', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();

      fireEvent.click(await screen.findByRole('button', { name: /create collection/i }));

      expect(screen.getByPlaceholderText('Museum Collection')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('museum-collection')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('smithsonian, salesforce, etc.')).toBeInTheDocument();
    });

    it('hides form when cancel clicked', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();

      fireEvent.click(await screen.findByRole('button', { name: /create collection/i }));
      expect(screen.getByText('New Dataset')).toBeInTheDocument();

      // The toggle button now says "Cancel" - get the first one (toggle has data-tour attribute)
      const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButtons[0]);
      expect(screen.queryByText('New Dataset')).not.toBeInTheDocument();
    });

    it('shows validation error for empty name', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();

      fireEvent.click(await screen.findByRole('button', { name: /create collection/i }));

      // Fill only key and source_type
      fireEvent.change(screen.getByPlaceholderText('museum-collection'), { target: { value: 'test-key' } });
      fireEvent.change(screen.getByPlaceholderText('smithsonian, salesforce, etc.'), { target: { value: 'test' } });

      // Find the blue submit button (the one with bg-semantic-info)
      const submitButton = screen.getByRole('button', { name: 'Create Dataset' });
      fireEvent.click(submitButton);

      expect(await screen.findByText('Name is required')).toBeInTheDocument();
    });

    it('shows validation error for empty key', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();

      fireEvent.click(await screen.findByRole('button', { name: /create collection/i }));

      // Fill only name and source_type
      fireEvent.change(screen.getByPlaceholderText('Museum Collection'), { target: { value: 'Test Name' } });
      fireEvent.change(screen.getByPlaceholderText('smithsonian, salesforce, etc.'), { target: { value: 'test' } });

      const submitButton = screen.getByRole('button', { name: 'Create Dataset' });
      fireEvent.click(submitButton);

      expect(await screen.findByText('Key is required')).toBeInTheDocument();
    });

    it('shows validation error for invalid key format', async () => {
      mockGetDatasets.mockResolvedValue([]);
      renderSetupDatasetsPage();

      fireEvent.click(await screen.findByRole('button', { name: /create collection/i }));

      fireEvent.change(screen.getByPlaceholderText('Museum Collection'), { target: { value: 'Test Name' } });
      fireEvent.change(screen.getByPlaceholderText('museum-collection'), { target: { value: 'INVALID KEY!' } });
      fireEvent.change(screen.getByPlaceholderText('smithsonian, salesforce, etc.'), { target: { value: 'test' } });

      const submitButton = screen.getByRole('button', { name: 'Create Dataset' });
      fireEvent.click(submitButton);

      expect(await screen.findByText(/lowercase alphanumeric/i)).toBeInTheDocument();
    });

    it('calls createDataset on valid submission', async () => {
      mockGetDatasets.mockResolvedValue([]);
      mockCreateDataset.mockResolvedValue({ dataset_id: 'new-ds' });
      renderSetupDatasetsPage();

      fireEvent.click(await screen.findByRole('button', { name: /create collection/i }));

      fireEvent.change(screen.getByPlaceholderText('Museum Collection'), { target: { value: 'Test Dataset' } });
      fireEvent.change(screen.getByPlaceholderText('museum-collection'), { target: { value: 'test-dataset' } });
      fireEvent.change(screen.getByPlaceholderText('smithsonian, salesforce, etc.'), { target: { value: 'test-source' } });

      const submitButton = screen.getByRole('button', { name: 'Create Dataset' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateDataset).toHaveBeenCalledWith(
          expect.objectContaining({
            organization_id: 'org-123',
            name: 'Test Dataset',
            key: 'test-dataset',
            source_type: 'test-source',
          }),
          expect.anything() // React Query passes additional mutation options
        );
      });
    });

    it('shows error on create failure', async () => {
      mockGetDatasets.mockResolvedValue([]);
      mockCreateDataset.mockRejectedValue(new Error('Creation failed'));
      renderSetupDatasetsPage();

      fireEvent.click(await screen.findByRole('button', { name: /create collection/i }));

      fireEvent.change(screen.getByPlaceholderText('Museum Collection'), { target: { value: 'Test' } });
      fireEvent.change(screen.getByPlaceholderText('museum-collection'), { target: { value: 'test' } });
      fireEvent.change(screen.getByPlaceholderText('smithsonian, salesforce, etc.'), { target: { value: 'test' } });

      const submitButton = screen.getByRole('button', { name: 'Create Dataset' });
      fireEvent.click(submitButton);

      expect(await screen.findByText(/creation failed/i)).toBeInTheDocument();
    });
  });
});
