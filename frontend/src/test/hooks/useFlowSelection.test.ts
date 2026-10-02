import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlowSelection } from '../../hooks/useFlowSelection';

describe('useFlowSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('all hover states start as null', () => {
      const { result } = renderHook(() => useFlowSelection());

      expect(result.current.hoveredPipelineId).toBeNull();
      expect(result.current.hoveredConnectorId).toBeNull();
      expect(result.current.hoveredDatasetId).toBeNull();
    });

    it('all selection states start as null/false', () => {
      const { result } = renderHook(() => useFlowSelection());

      expect(result.current.selectedSourceConnectorId).toBeNull();
      expect(result.current.selectedDestinationConnectorId).toBeNull();
      expect(result.current.madronaDrawerOpen).toBe(false);
      expect(result.current.filterDrawerOpen).toBe(false);
    });
  });

  describe('hover state management', () => {
    it('sets hovered pipeline ID', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setHoveredPipelineId('pipeline-1');
      });

      expect(result.current.hoveredPipelineId).toBe('pipeline-1');
    });

    it('sets hovered connector ID', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setHoveredConnectorId('connector-1');
      });

      expect(result.current.hoveredConnectorId).toBe('connector-1');
    });

    it('sets hovered dataset ID', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setHoveredDatasetId('dataset-1');
      });

      expect(result.current.hoveredDatasetId).toBe('dataset-1');
    });

    it('clearHover resets all hover states', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setHoveredPipelineId('pipeline-1');
        result.current.setHoveredConnectorId('connector-1');
        result.current.setHoveredDatasetId('dataset-1');
      });

      act(() => {
        result.current.clearHover();
      });

      expect(result.current.hoveredPipelineId).toBeNull();
      expect(result.current.hoveredConnectorId).toBeNull();
      expect(result.current.hoveredDatasetId).toBeNull();
    });
  });

  describe('selection state management', () => {
    it('sets source connector ID', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setSelectedSourceConnectorId('src-1');
      });

      expect(result.current.selectedSourceConnectorId).toBe('src-1');
    });

    it('sets destination connector ID', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setSelectedDestinationConnectorId('dest-1');
      });

      expect(result.current.selectedDestinationConnectorId).toBe('dest-1');
    });

    it('manages drawer open states', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setMadronaDrawerOpen(true);
      });
      expect(result.current.madronaDrawerOpen).toBe(true);

      act(() => {
        result.current.setFilterDrawerOpen(true);
      });
      expect(result.current.filterDrawerOpen).toBe(true);

      act(() => {
        result.current.setMadronaDrawerOpen(false);
      });
      expect(result.current.madronaDrawerOpen).toBe(false);
      expect(result.current.filterDrawerOpen).toBe(true);
    });
  });

  describe('independence of hover and selection', () => {
    it('clearHover does not affect selection state', () => {
      const { result } = renderHook(() => useFlowSelection());

      act(() => {
        result.current.setSelectedSourceConnectorId('src-1');
        result.current.setHoveredPipelineId('pipeline-1');
      });

      act(() => {
        result.current.clearHover();
      });

      expect(result.current.hoveredPipelineId).toBeNull();
      expect(result.current.selectedSourceConnectorId).toBe('src-1');
    });
  });
});
