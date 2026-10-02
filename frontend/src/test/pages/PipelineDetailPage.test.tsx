import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PipelineDetailPage from '../../pages/bridge/PipelineDetailPage';
import {
  mockPipelineSourceOnly,
  mockPipelineSourceAndDest,
  mockPipelineWithDeleteDetection,
  mockSourceConnector,
  mockDestinationConnector,
  mockDataset,
  mockRunSuccess,
  mockRunFailed,
  mockRunWithDeletes,
} from '../fixtures/mockData';
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

// Mock WebSocket context
vi.mock('../../contexts/WebSocketContext', () => ({
  useWebSocket: () => ({
    isConnected: false,
    subscribeToRun: vi.fn(),
    unsubscribeFromRun: vi.fn(),
    subscribeToPipeline: vi.fn(),
    unsubscribeFromPipeline: vi.fn(),
    on: vi.fn(() => vi.fn()),
    off: vi.fn(),
  }),
}));

describe('PipelineDetailPage', () => {
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

    // Mock permissions
    vi.mocked(usePermissions.usePermissions).mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
      permissions: ['pipelines.edit', 'schedules.manage', 'runs.create'],
    });
  });

  const renderPipelineDetail = (pipelineId: string) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/organizations/org-1/pipelines/${pipelineId}`]}>
          <Routes>
            <Route
              path="/organizations/:orgId/pipelines/:pipelineId"
              element={<PipelineDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  describe('Pipeline with 1 source, 0 destinations', () => {
    beforeEach(() => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineSourceOnly);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([mockSourceConnector]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess],
        total: 1,
        limit: 5,
        offset: 0,
        
      });
    });

    it('renders Flow section with source and dataset', async () => {
      renderPipelineDetail('pipeline-1');

      // Wait for Flow section to load
      expect(await screen.findByText('Flow')).toBeInTheDocument();

      // Check that source, dataset, and destinations are present
      expect(screen.getByText('Smithsonian Source')).toBeInTheDocument();
      expect(screen.getByText('Museum Objects')).toBeInTheDocument();

      // Check dataset card shows record count and updated date
      expect(screen.getByText('1,247')).toBeInTheDocument();
      expect(screen.getByText(/Updated/)).toBeInTheDocument();
    });

    it('renders Execution section with schedule and runs', async () => {
      renderPipelineDetail('pipeline-1');

      expect(await screen.findByText('Execution')).toBeInTheDocument();
      expect(screen.getByText('Schedule')).toBeInTheDocument();
      expect(screen.getByText('Last Run')).toBeInTheDocument();
      expect(screen.getByText('Recent Runs')).toBeInTheDocument();
    });
  });

  describe('Pipeline with 1 source, 1 destination', () => {
    beforeEach(() => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineSourceAndDest);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([
        mockSourceConnector,
        mockDestinationConnector,
      ]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess, mockRunFailed],
        total: 2,
        limit: 5,
        offset: 0,
        
      });
    });

    it('renders Flow section with source, dataset, and destination', async () => {
      renderPipelineDetail('pipeline-2');

      // Wait for data to load
      expect(await screen.findByText('Flow')).toBeInTheDocument();

      // Check Sources column
      expect(screen.getByText('Smithsonian Source')).toBeInTheDocument();

      // Check Dataset column
      expect(screen.getByText('Museum Objects')).toBeInTheDocument();

      // Check Destinations column shows connector
      expect(screen.getByText('Google Sheets Export')).toBeInTheDocument();
    });
  });

  describe('Health status indicators', () => {
    it('shows healthy status for successful runs', async () => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineSourceAndDest);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([mockSourceConnector]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess],
        total: 1,
        limit: 5,
        offset: 0,
        
      });

      renderPipelineDetail('pipeline-2');

      expect(await screen.findByText('Healthy')).toBeInTheDocument();
    });

    it('shows attention status for failed runs', async () => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineSourceAndDest);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([mockSourceConnector]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunFailed],
        total: 1,
        limit: 5,
        offset: 0,
        
      });

      renderPipelineDetail('pipeline-2');

      expect(await screen.findByText('Attention')).toBeInTheDocument();
    });

    it('shows idle status when no runs exist', async () => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineSourceOnly);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([mockSourceConnector]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [],
        total: 0,
        limit: 5,
        offset: 0,
        
      });

      renderPipelineDetail('pipeline-1');

      expect(await screen.findByText('Idle')).toBeInTheDocument();
    });
  });

  describe('Delete Detection Settings', () => {
    it('renders Settings section with delete detection toggle', async () => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineSourceOnly);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([mockSourceConnector]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess],
        total: 1,
        limit: 5,
        offset: 0,
        
      });

      renderPipelineDetail('pipeline-1');

      // Settings section should be present
      expect(await screen.findByText('Settings')).toBeInTheDocument();

      // Delete Detection section
      expect(screen.getByText('Delete Detection')).toBeInTheDocument();
      expect(screen.getByText('Enable delete detection')).toBeInTheDocument();

      // Toggle should exist (it's a switch role button)
      const toggles = screen.getAllByRole('switch');
      expect(toggles.length).toBeGreaterThan(0);
    });

    it('shows delete detection as enabled when pipeline has it configured', async () => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineWithDeleteDetection);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([
        mockSourceConnector,
        mockDestinationConnector,
      ]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunWithDeletes],
        total: 1,
        limit: 5,
        offset: 0,
        
      });

      renderPipelineDetail('pipeline-4');

      // Wait for content to load
      expect(await screen.findByText('Settings')).toBeInTheDocument();

      // Check there's a toggle that is enabled (aria-checked=true)
      const toggles = screen.getAllByRole('switch');
      const enabledToggle = toggles.find(t => t.getAttribute('aria-checked') === 'true');
      expect(enabledToggle).toBeInTheDocument();

      // Detection method dropdown should be visible when enabled
      expect(screen.getByText('Detection Method')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Full Sync/i })).toBeInTheDocument();
    });

    it('shows destination delete settings when delete detection is enabled', async () => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineWithDeleteDetection);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([
        mockSourceConnector,
        mockDestinationConnector,
      ]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunWithDeletes],
        total: 1,
        limit: 5,
        offset: 0,
        
      });

      renderPipelineDetail('pipeline-4');

      // Wait for content to load
      expect(await screen.findByText('Destination Settings')).toBeInTheDocument();

      // Should show the destination with publish deletes toggle text
      expect(screen.getByText('Publish deletes')).toBeInTheDocument();
      expect(screen.getByText('Deletes will be published')).toBeInTheDocument();
    });

    it('hides destination settings when delete detection is disabled', async () => {
      vi.mocked(api.getPipeline).mockResolvedValue(mockPipelineSourceAndDest);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([
        mockSourceConnector,
        mockDestinationConnector,
      ]);
      vi.mocked(api.getDatasets).mockResolvedValue([mockDataset]);
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess],
        total: 1,
        limit: 5,
        offset: 0,
        
      });

      renderPipelineDetail('pipeline-2');

      // Wait for content to load
      expect(await screen.findByText('Settings')).toBeInTheDocument();

      // Destination Settings should not be visible
      expect(screen.queryByText('Destination Settings')).not.toBeInTheDocument();
    });
  });
});
