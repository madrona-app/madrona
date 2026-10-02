import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RunsPage from '../../pages/bridge/RunsListPage';
import {
  mockRunSuccess,
  mockRunFailed,
  mockRunRunning,
  mockDatasets,
  mockPipelines,
} from '../fixtures/mockData';
import * as api from '../../lib/api';
import * as useOrganization from '../../contexts/useOrganization';
import * as usePermissions from '../../hooks/usePermissions';
import * as useTimezone from '../../hooks/useTimezone';

// Mock API functions
vi.mock('../../lib/api');
vi.mock('../../contexts/useOrganization');
vi.mock('../../hooks/usePermissions');
vi.mock('../../hooks/useTimezone');

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

describe('RunsListPage', () => {
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

    // Mock permissions (default: can view but not delete)
    vi.mocked(usePermissions.usePermissions).mockReturnValue({
      hasPermission: vi.fn((perm) => perm !== 'runs.delete'),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
      permissions: ['runs.view'],
    });

    // Mock timezone
    vi.mocked(useTimezone.useTimezone).mockReturnValue({
      timezone: 'America/New_York',
      setTimezone: vi.fn(),
    });

    // Mock API responses
    vi.mocked(api.getDatasets).mockResolvedValue(mockDatasets);
    vi.mocked(api.getPipelines).mockResolvedValue(mockPipelines);
  });

  const renderRunsPage = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/organizations/org-1/runs']}>
          <Routes>
            <Route path="/organizations/:orgId/runs" element={<RunsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  describe('renders run list', () => {
    it('displays runs with their status badges', async () => {
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess, mockRunFailed, mockRunRunning],
        total: 3,
        limit: 9,
        offset: 0,
        
      });

      renderRunsPage();

      // Wait for runs to load - check for status labels
      // success -> "All set", failed -> "Needs attention", running -> "Syncing…"
      expect(await screen.findByText('All set')).toBeInTheDocument();
      expect(screen.getByText('Needs attention')).toBeInTheDocument();
      expect(screen.getByText('Syncing…')).toBeInTheDocument();
    });

    it('displays empty state when no runs exist', async () => {
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [],
        total: 0,
        limit: 9,
        offset: 0,
        
      });

      renderRunsPage();

      expect(await screen.findByText('No Runs Yet')).toBeInTheDocument();
    });
  });

  describe('filters', () => {
    it('renders filter dropdowns', async () => {
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess],
        total: 1,
        limit: 9,
        offset: 0,
        
      });

      renderRunsPage();

      // Wait for page to load
      await waitFor(() => {
        expect(screen.getByText('All Datasets')).toBeInTheDocument();
      });

      expect(screen.getByText('All Statuses')).toBeInTheDocument();
    });
  });

  describe('table structure', () => {
    it('renders table headers when runs exist', async () => {
      vi.mocked(api.getRuns).mockResolvedValue({
        items: [mockRunSuccess],
        total: 1,
        limit: 9,
        offset: 0,
        
      });

      renderRunsPage();

      // Wait for table headers
      await waitFor(() => {
        expect(screen.getByText('Dataset')).toBeInTheDocument();
      });

      expect(screen.getByText('When')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Duration')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching', async () => {
      // Create a delayed promise
      let resolveRuns: (value: any) => void;
      vi.mocked(api.getRuns).mockImplementation(
        () => new Promise(resolve => { resolveRuns = resolve; })
      );

      renderRunsPage();

      // Should show loading
      expect(await screen.findByText('Loading history...')).toBeInTheDocument();

      // Resolve the promise
      resolveRuns!({
        items: [],
        total: 0,
        limit: 9,
        offset: 0,
        
      });

      // Should show empty state
      await waitFor(() => {
        expect(screen.getByText('No Runs Yet')).toBeInTheDocument();
      });
    });
  });
});
