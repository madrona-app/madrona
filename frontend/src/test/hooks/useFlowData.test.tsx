import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFlowData } from '../../hooks/useFlowData';
import * as api from '../../lib/api';
import { AuthContext } from '../../contexts/AuthContext';
import { createMockAuthContext, createMockWebSocketContext } from '../utils/renderWithProviders';
import {
  mockPipelines,
  mockConnectors,
  mockDatasets,
  mockRuns,
} from '../fixtures/mockData';

// Mock the API module
vi.mock('../../lib/api', () => ({
  getPipelines: vi.fn(),
  getConnectorInstances: vi.fn(),
  getDatasets: vi.fn(),
  getRuns: vi.fn(),
}));

// Mock the useRunUpdates hook
vi.mock('../../hooks/useRunUpdates', () => ({
  useRunUpdates: vi.fn(),
}));

// Mock WebSocket context
const mockWebSocketContext = createMockWebSocketContext({ isConnected: true });

vi.mock('../../contexts/WebSocketContext', () => ({
  useWebSocket: () => mockWebSocketContext,
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * Create a wrapper with AuthContext for testing hooks
 */
function createWrapper(organizationId: string | null = 'org-1') {
  const mockContext = createMockAuthContext({
    user: organizationId
      ? {
          user_id: 'user-1',
          email: 'test@example.com',
          name: 'Test User',
          active_organization_id: organizationId,
          permissions: ['data.view'],
          role_label: 'Viewer',
          organizations: [],
        }
      : null,
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthContext.Provider value={mockContext}>
        {children}
      </AuthContext.Provider>
    );
  };
}

describe('useFlowData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('initial data loading', () => {
    it('fetches pipelines, connectors, and datasets on mount', async () => {
      vi.mocked(api.getPipelines).mockResolvedValue(mockPipelines);
      vi.mocked(api.getConnectorInstances).mockResolvedValue(mockConnectors);
      vi.mocked(api.getDatasets).mockResolvedValue(mockDatasets);
      vi.mocked(api.getRuns).mockResolvedValue({ items: mockRuns, total: mockRuns.length });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      // Initially loading
      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(api.getPipelines).toHaveBeenCalledWith('org-1');
      expect(api.getConnectorInstances).toHaveBeenCalledWith('org-1');
      expect(api.getDatasets).toHaveBeenCalledWith('org-1');
      expect(api.getRuns).toHaveBeenCalledWith({ organization_id: 'org-1', limit: 100 });
    });

    it('returns fetched data correctly', async () => {
      vi.mocked(api.getPipelines).mockResolvedValue(mockPipelines);
      vi.mocked(api.getConnectorInstances).mockResolvedValue(mockConnectors);
      vi.mocked(api.getDatasets).mockResolvedValue(mockDatasets);
      vi.mocked(api.getRuns).mockResolvedValue({ items: mockRuns, total: mockRuns.length });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.pipelines).toEqual(mockPipelines);
      expect(result.current.connectors).toEqual(mockConnectors);
      expect(result.current.datasets).toEqual(mockDatasets);
      expect(result.current.error).toBeNull();
    });

    it('tracks active runs from initial fetch', async () => {
      vi.mocked(api.getPipelines).mockResolvedValue(mockPipelines);
      vi.mocked(api.getConnectorInstances).mockResolvedValue(mockConnectors);
      vi.mocked(api.getDatasets).mockResolvedValue(mockDatasets);
      vi.mocked(api.getRuns).mockResolvedValue({ items: mockRuns, total: mockRuns.length });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // mockRunRunning has status 'running' and pipeline_id 'pipeline-2'
      expect(result.current.activeRunsByPipeline.get('pipeline-2')).toBe(true);
      // mockRunSuccess has status 'success', should not be active
      expect(result.current.activeRunsByPipeline.get('pipeline-1')).toBeUndefined();
    });

    it('stores latest run per pipeline', async () => {
      vi.mocked(api.getPipelines).mockResolvedValue(mockPipelines);
      vi.mocked(api.getConnectorInstances).mockResolvedValue(mockConnectors);
      vi.mocked(api.getDatasets).mockResolvedValue(mockDatasets);
      vi.mocked(api.getRuns).mockResolvedValue({ items: mockRuns, total: mockRuns.length });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should have runs for pipelines
      expect(result.current.runsByPipeline.size).toBeGreaterThan(0);
    });
  });

  describe('loading and error states', () => {
    it('sets loading to true during fetch', async () => {
      vi.mocked(api.getPipelines).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );
      vi.mocked(api.getConnectorInstances).mockResolvedValue([]);
      vi.mocked(api.getDatasets).mockResolvedValue([]);
      vi.mocked(api.getRuns).mockResolvedValue({ items: [], total: 0 });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('handles API errors gracefully', async () => {
      const error = new Error('Network error');
      vi.mocked(api.getPipelines).mockRejectedValue(error);
      vi.mocked(api.getConnectorInstances).mockResolvedValue([]);
      vi.mocked(api.getDatasets).mockResolvedValue([]);
      vi.mocked(api.getRuns).mockResolvedValue({ items: [], total: 0 });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });

    it('wraps non-Error objects in Error', async () => {
      vi.mocked(api.getPipelines).mockRejectedValue('string error');
      vi.mocked(api.getConnectorInstances).mockResolvedValue([]);
      vi.mocked(api.getDatasets).mockResolvedValue([]);
      vi.mocked(api.getRuns).mockResolvedValue({ items: [], total: 0 });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Failed to fetch flow data');
    });
  });

  describe('with null organizationId', () => {
    it('does not fetch data when organizationId is null', async () => {
      const { result } = renderHook(
        () => useFlowData({ organizationId: null }),
        { wrapper: createWrapper(null) }
      );

      // Give it some time to potentially make calls
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(api.getPipelines).not.toHaveBeenCalled();
      expect(api.getConnectorInstances).not.toHaveBeenCalled();
      expect(api.getDatasets).not.toHaveBeenCalled();
      expect(result.current.pipelines).toEqual([]);
    });

    it('does not fetch data when organizationId is undefined', async () => {
      const { result } = renderHook(
        () => useFlowData({ organizationId: undefined }),
        { wrapper: createWrapper(null) }
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(api.getPipelines).not.toHaveBeenCalled();
      expect(result.current.pipelines).toEqual([]);
    });
  });

  describe('handles null API responses', () => {
    it('defaults to empty arrays when APIs return null', async () => {
      vi.mocked(api.getPipelines).mockResolvedValue(null as unknown as typeof mockPipelines);
      vi.mocked(api.getConnectorInstances).mockResolvedValue(null as unknown as typeof mockConnectors);
      vi.mocked(api.getDatasets).mockResolvedValue(null as unknown as typeof mockDatasets);
      vi.mocked(api.getRuns).mockResolvedValue({ items: [], total: 0 });

      const { result } = renderHook(
        () => useFlowData({ organizationId: 'org-1' }),
        { wrapper: createWrapper('org-1') }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.pipelines).toEqual([]);
      expect(result.current.connectors).toEqual([]);
      expect(result.current.datasets).toEqual([]);
    });
  });
});
