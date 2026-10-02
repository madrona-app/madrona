import { useState, useCallback } from 'react';

interface UseFlowSelectionReturn {
  // Hover state
  hoveredPipelineId: string | null;
  hoveredConnectorId: string | null;
  hoveredDatasetId: string | null;
  setHoveredPipelineId: (id: string | null) => void;
  setHoveredConnectorId: (id: string | null) => void;
  setHoveredDatasetId: (id: string | null) => void;
  clearHover: () => void;

  // Selection state (for drawers)
  selectedSourceConnectorId: string | null;
  selectedDestinationConnectorId: string | null;
  madronaDrawerOpen: boolean;
  filterDrawerOpen: boolean;
  setSelectedSourceConnectorId: (id: string | null) => void;
  setSelectedDestinationConnectorId: (id: string | null) => void;
  setMadronaDrawerOpen: (open: boolean) => void;
  setFilterDrawerOpen: (open: boolean) => void;
}

/**
 * Hook to manage hover and selection state for the flow canvas.
 * Separates UI interaction state from data state.
 */
export function useFlowSelection(): UseFlowSelectionReturn {
  // Hover state
  const [hoveredPipelineId, setHoveredPipelineId] = useState<string | null>(null);
  const [hoveredConnectorId, setHoveredConnectorId] = useState<string | null>(null);
  const [hoveredDatasetId, setHoveredDatasetId] = useState<string | null>(null);

  // Selection state (for drawers)
  const [selectedSourceConnectorId, setSelectedSourceConnectorId] = useState<string | null>(null);
  const [selectedDestinationConnectorId, setSelectedDestinationConnectorId] = useState<string | null>(null);
  const [madronaDrawerOpen, setMadronaDrawerOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const clearHover = useCallback(() => {
    setHoveredPipelineId(null);
    setHoveredConnectorId(null);
    setHoveredDatasetId(null);
  }, []);

  return {
    // Hover state
    hoveredPipelineId,
    hoveredConnectorId,
    hoveredDatasetId,
    setHoveredPipelineId,
    setHoveredConnectorId,
    setHoveredDatasetId,
    clearHover,

    // Selection state
    selectedSourceConnectorId,
    selectedDestinationConnectorId,
    madronaDrawerOpen,
    filterDrawerOpen,
    setSelectedSourceConnectorId,
    setSelectedDestinationConnectorId,
    setMadronaDrawerOpen,
    setFilterDrawerOpen,
  };
}
