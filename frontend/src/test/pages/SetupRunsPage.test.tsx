import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SetupRunsPage from '../../pages/bridge/SetupRunsPage';
import * as api from '../../lib/api';

// Mock the api module
vi.mock('../../lib/api', () => ({
  getRuns: vi.fn(),
  getPipelines: vi.fn(),
}));

// Mock useOrganization
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(() => ({
    activeOrganizationId: 'org-123',
  })),
}));

const mockGetRuns = vi.mocked(api.getRuns);
const mockGetPipelines = vi.mocked(api.getPipelines);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderSetupRunsPage(orgId = 'org-123') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/bridge/setup/runs`]}>
        <Routes>
          <Route path="/organizations/:orgId/bridge/setup/runs" element={<SetupRunsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SetupRunsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRuns.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, });
    mockGetPipelines.mockResolvedValue([]);
  });

  describe('basic rendering', () => {
    it('renders page title', async () => {
      renderSetupRunsPage();
      expect(await screen.findByText('Pipeline Runs')).toBeInTheDocument();
    });

    it('renders description', async () => {
      renderSetupRunsPage();
      expect(await screen.findByText(/execution history for your pipelines/i)).toBeInTheDocument();
    });

    it('renders view full history link', async () => {
      renderSetupRunsPage();
      expect(await screen.findByText(/view full history/i)).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching', () => {
      mockGetRuns.mockImplementation(() => new Promise(() => {})); // Never resolves
      renderSetupRunsPage();
      expect(screen.getByText(/loading runs/i)).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no runs', async () => {
      mockGetRuns.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, });
      renderSetupRunsPage();
      expect(await screen.findByText(/no pipeline runs yet/i)).toBeInTheDocument();
    });

    it('shows configure pipelines link in empty state', async () => {
      mockGetRuns.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, });
      renderSetupRunsPage();
      expect(await screen.findByText(/configure pipelines/i)).toBeInTheDocument();
    });
  });

  describe('with runs', () => {
    const mockRuns = [
      {
        run_id: 'run-1',
        pipeline_id: 'pipe-1',
        status: 'success',
        started_at: '2024-01-15T10:00:00Z',
        duration_ms: 5000,
      },
      {
        run_id: 'run-2',
        pipeline_id: 'pipe-1',
        status: 'failed',
        started_at: '2024-01-15T09:00:00Z',
        duration_ms: 3000,
      },
      {
        run_id: 'run-3',
        pipeline_id: 'pipe-2',
        status: 'running',
        started_at: '2024-01-15T11:00:00Z',
        duration_ms: null,
      },
    ];

    const mockPipelines = [
      { pipeline_id: 'pipe-1', name: 'Test Pipeline' },
      { pipeline_id: 'pipe-2', name: 'Other Pipeline' },
    ];

    it('renders table headers', async () => {
      mockGetRuns.mockResolvedValue({ items: mockRuns, total: 3, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Started')).toBeInTheDocument();
      expect(screen.getByText('Duration')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('renders pipeline names', async () => {
      mockGetRuns.mockResolvedValue({ items: mockRuns, total: 3, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      // Multiple runs use the same pipeline, so use getAllByText
      const testPipelineElements = await screen.findAllByText('Test Pipeline');
      expect(testPipelineElements.length).toBeGreaterThan(0);
      expect(screen.getByText('Other Pipeline')).toBeInTheDocument();
    });

    it('renders status labels', async () => {
      mockGetRuns.mockResolvedValue({ items: mockRuns, total: 3, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('Success')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders view details links', async () => {
      mockGetRuns.mockResolvedValue({ items: mockRuns, total: 3, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      const links = await screen.findAllByText('View details');
      expect(links).toHaveLength(3);
    });

    it('formats short durations in milliseconds', async () => {
      const runsWithShortDuration = [{ ...mockRuns[0], duration_ms: 500 }];
      mockGetRuns.mockResolvedValue({ items: runsWithShortDuration, total: 1, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('500ms')).toBeInTheDocument();
    });

    it('formats medium durations in seconds', async () => {
      const runsWithMediumDuration = [{ ...mockRuns[0], duration_ms: 5000 }];
      mockGetRuns.mockResolvedValue({ items: runsWithMediumDuration, total: 1, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('5.0s')).toBeInTheDocument();
    });

    it('formats long durations in minutes and seconds', async () => {
      const runsWithLongDuration = [{ ...mockRuns[0], duration_ms: 125000 }];
      mockGetRuns.mockResolvedValue({ items: runsWithLongDuration, total: 1, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('2m 5s')).toBeInTheDocument();
    });

    it('shows dash for null duration', async () => {
      const runsWithNullDuration = [{ ...mockRuns[0], duration_ms: null }];
      mockGetRuns.mockResolvedValue({ items: runsWithNullDuration, total: 1, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('—')).toBeInTheDocument();
    });

    it('shows unknown pipeline for unmapped pipeline id', async () => {
      const runsWithUnknownPipeline = [{ ...mockRuns[0], pipeline_id: 'unknown-pipe' }];
      mockGetRuns.mockResolvedValue({ items: runsWithUnknownPipeline, total: 1, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('Unknown Pipeline')).toBeInTheDocument();
    });

    it('shows manual run for null pipeline id', async () => {
      const runsWithNullPipeline = [{ ...mockRuns[0], pipeline_id: null }];
      mockGetRuns.mockResolvedValue({ items: runsWithNullPipeline, total: 1, limit: 20, offset: 0 });
      mockGetPipelines.mockResolvedValue(mockPipelines);
      renderSetupRunsPage();

      expect(await screen.findByText('Manual Run')).toBeInTheDocument();
    });
  });

  describe('status rendering', () => {
    const statusTests = [
      { status: 'success', label: 'Success' },
      { status: 'failed', label: 'Failed' },
      { status: 'failed_publish', label: 'Publish Failed' },
      { status: 'failed_finalize', label: 'Finalize Failed' },
      { status: 'warning', label: 'Warning' },
      { status: 'running', label: 'Running' },
      { status: 'publishing', label: 'Publishing' },
      { status: 'pending', label: 'Pending' },
      { status: 'queued', label: 'Queued' },
      { status: 'canceled', label: 'Canceled' },
    ];

    statusTests.forEach(({ status, label }) => {
      it(`renders ${status} status as ${label}`, async () => {
        const runWithStatus = [{
          run_id: 'run-1',
          pipeline_id: 'pipe-1',
          status,
          started_at: '2024-01-15T10:00:00Z',
          duration_ms: 1000,
        }];
        mockGetRuns.mockResolvedValue({ items: runWithStatus, total: 1, limit: 20, offset: 0 });
        mockGetPipelines.mockResolvedValue([{ pipeline_id: 'pipe-1', name: 'Test' }]);
        renderSetupRunsPage();

        expect(await screen.findByText(label)).toBeInTheDocument();
      });
    });
  });
});
