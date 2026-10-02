import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import ConnectorSourceNode from '../../components/ConnectorSourceNode';
import ConnectorDestinationNode from '../../components/ConnectorDestinationNode';
import MadronaContainerNode from '../../components/MadronaContainerNode';
import DatasetNode from '../../components/DatasetNode';
import MergeNode from '../../components/MergeNode';
import SourceConnectorDrawer from '../../components/SourceConnectorDrawer';
import MadronaSyncDrawer from '../../components/MadronaSyncDrawer';
import DestinationConnectorDrawer from '../../components/DestinationConnectorDrawer';
import { DatasetVisibilityModal } from '../../components/DatasetVisibilityModal';
import { FlowEmptyState } from '../../components/FlowEmptyState';
import { FlowSkeleton } from '../../components/FlowSkeleton';
import { PipelineListView } from '../../components/PipelineListView';
import { useFlowData } from '../../hooks/useFlowData';
import { useFlowSelection } from '../../hooks/useFlowSelection';
import { useFlowPreferences } from '../../hooks/useFlowPreferences';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import type { Pipeline } from '../../lib/schemas';
import { useOrganization } from '../../contexts/useOrganization';
import { logger } from '../../lib/logger';

const nodeTypes = {
  connectorSourceNode: ConnectorSourceNode,
  connectorDestinationNode: ConnectorDestinationNode,
  madronaContainerNode: MadronaContainerNode,
  datasetNode: DatasetNode,
  mergeNode: MergeNode,
};

const backgroundStyle: React.CSSProperties = {
  background: 'rgb(var(--color-parchment))',
};

// Active run color - Muted Moss
const ACTIVE_RUN_COLOR = 'rgb(var(--color-success))';
const DEFAULT_EDGE_COLOR = 'rgb(var(--color-stone))';

// Animation timing for sequential flow visualization
const ANIMATION_TIMING = {
  sourceDuration: 2.5,      // Sources to merge: 2.5s
  mergeDelay: 2.5,          // Merge starts after sources
  mergeDuration: 1.5,       // Merge to dataset: 1.5s
  destinationDelay: 4.0,    // Destinations start after merge (2.5 + 1.5)
  destinationDuration: 2.0, // Dataset to destinations: 2.0s
};

// CSS for subtle flow animation - injected into document head
const FLOW_ANIMATION_CSS = `
  @keyframes flowPulse {
    0%, 100% {
      stroke-opacity: 0.3;
      stroke-dashoffset: 24;
    }
    50% {
      stroke-opacity: 1;
      stroke-dashoffset: 0;
    }
  }

  .react-flow__edge.edge--animated-source path {
    stroke-dasharray: 8 4;
    animation: flowPulse ${ANIMATION_TIMING.sourceDuration}s ease-in-out infinite;
  }

  .react-flow__edge.edge--animated-merge path {
    stroke-dasharray: 8 4;
    animation: flowPulse ${ANIMATION_TIMING.mergeDuration}s ease-in-out infinite;
    animation-delay: ${ANIMATION_TIMING.mergeDelay}s;
  }

  .react-flow__edge.edge--animated-destination path {
    stroke-dasharray: 8 4;
    animation: flowPulse ${ANIMATION_TIMING.destinationDuration}s ease-in-out infinite;
    animation-delay: ${ANIMATION_TIMING.destinationDelay}s;
  }
`;

/**
 * Get active path (edges and nodes) for pipelines with running jobs.
 * Returns sets of IDs that should be animated.
 *
 * Updated for multi-source/multi-destination: checks all sources and destinations.
 */
function getActivePath(
  pipelines: Pipeline[],
  activeRunsByPipeline: Map<string, boolean>
): { activeEdgeIds: Set<string>; activeNodeIds: Set<string> } {
  const activeEdgeIds = new Set<string>();
  const activeNodeIds = new Set<string>();

  pipelines.forEach((pipeline) => {
    const pipelineId = pipeline.pipeline_id;
    if (activeRunsByPipeline.get(pipelineId)) {
      // Add edges for all sources in this pipeline
      if (pipeline.sources && pipeline.dataset_id) {
        pipeline.sources.forEach((source) => {
          activeEdgeIds.add(`edge-source-${pipelineId}-${source.connector_instance_id}`);
        });
      }

      // Add edges for all destinations in this pipeline
      if (pipeline.dataset_id && pipeline.destinations) {
        pipeline.destinations.forEach((dest) => {
          activeEdgeIds.add(`edge-dest-${pipelineId}-${dest.connector_instance_id}`);
        });
      }

      // Add nodes for all sources
      if (pipeline.sources) {
        pipeline.sources.forEach((source) => {
          activeNodeIds.add(`source-${source.connector_instance_id}`);
        });
      }

      // Add dataset node
      if (pipeline.dataset_id) {
        activeNodeIds.add(`dataset-${pipeline.dataset_id}`);
      }

      // Add nodes for all destinations
      if (pipeline.destinations) {
        pipeline.destinations.forEach((dest) => {
          activeNodeIds.add(`destination-${dest.connector_instance_id}`);
        });
      }
    }
  });

  return { activeEdgeIds, activeNodeIds };
}

/**
 * Get CSS class name for an edge based on active state.
 */
function getEdgeClassName(
  edgeId: string,
  activeEdgeIds: Set<string>
): string {
  return activeEdgeIds.has(edgeId) ? 'edge--active' : 'edge--inactive';
}

/**
 * Get CSS class name for a node based on active state.
 */
function getNodeClassName(
  nodeId: string,
  activeNodeIds: Set<string>
): string {
  return activeNodeIds.has(nodeId) ? 'node--active' : 'node--inactive';
}

/**
 * Validate layout constraints to prevent architectural regressions.
 * Logs warnings in development mode if constraints are violated.
 * 
 * Rules enforced:
 * 1. A dataset may have multiple inbound edges only via a merge node
 * 2. A merge node may only connect to exactly one dataset
 * 3. A dataset may have multiple outbound edges (no constraint)
 * 4. Connectors may not connect directly to other connectors
 */
function validateLayoutConstraints(nodes: Node[], edges: Edge[]): void {
  const warnings: string[] = [];
  
  // Build edge mappings
  const inboundEdges = new Map<string, Edge[]>();
  const outboundEdges = new Map<string, Edge[]>();
  
  edges.forEach(edge => {
    if (!inboundEdges.has(edge.target)) {
      inboundEdges.set(edge.target, []);
    }
    inboundEdges.get(edge.target)!.push(edge);
    
    if (!outboundEdges.has(edge.source)) {
      outboundEdges.set(edge.source, []);
    }
    outboundEdges.get(edge.source)!.push(edge);
  });
  
  // Rule 1: A dataset may have multiple inbound edges only via a merge node
  nodes.forEach(node => {
    if (node.id.startsWith('dataset-')) {
      const inbound = inboundEdges.get(node.id) || [];
      const directSourceEdges = inbound.filter(edge => 
        edge.source.startsWith('source-') && !edge.source.startsWith('merge-')
      );
      
      if (directSourceEdges.length > 1) {
        warnings.push(
          `Dataset "${node.id}" has ${directSourceEdges.length} direct source edges. ` +
          `Multiple sources should converge via a merge node.`
        );
      }
    }
  });
  
  // Rule 2: A merge node may only connect to exactly one dataset
  nodes.forEach(node => {
    if (node.id.startsWith('merge-')) {
      const outbound = outboundEdges.get(node.id) || [];
      const datasetTargets = outbound.filter(edge => edge.target.startsWith('dataset-'));
      
      if (datasetTargets.length !== 1) {
        warnings.push(
          `Merge node "${node.id}" connects to ${datasetTargets.length} datasets. ` +
          `Expected exactly 1.`
        );
      }
    }
  });
  
  // Rule 3: Dataset outbound edges - no constraint needed, but validate they're not to other datasets
  nodes.forEach(node => {
    if (node.id.startsWith('dataset-')) {
      const outbound = outboundEdges.get(node.id) || [];
      const datasetTargets = outbound.filter(edge => edge.target.startsWith('dataset-'));
      
      if (datasetTargets.length > 0) {
        warnings.push(
          `Dataset "${node.id}" connects directly to another dataset. ` +
          `Datasets should never connect to other datasets.`
        );
      }
    }
  });
  
  // Rule 4: Connectors may not connect directly to other connectors
  nodes.forEach(node => {
    if (node.id.startsWith('source-') || node.id.startsWith('destination-')) {
      const outbound = outboundEdges.get(node.id) || [];
      const connectorTargets = outbound.filter(edge => 
        edge.target.startsWith('source-') || edge.target.startsWith('destination-')
      );
      
      if (connectorTargets.length > 0) {
        warnings.push(
          `Connector "${node.id}" connects directly to another connector. ` +
          `All flows must pass through a dataset.`
        );
      }
    }
  });
  
  // Log warnings if any violations found
  if (warnings.length > 0) {
    logger.warn('⚠️  Layout constraint violations detected:');
    warnings.forEach((warning, index) => {
      logger.warn(`  ${index + 1}. ${warning}`);
    });
  }
}

function FlowOverviewInner() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const { fitView, setViewport } = useReactFlow();
  const viewport = useViewport();
  const navigate = useNavigate();
  const hasInitializedView = useRef(false);
  const savedViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const [isReady, setIsReady] = useState(false);
  const { isMobile, isTablet } = useBreakpoint();

  // View mode: 'canvas' or 'list' - default to list on mobile
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>(() => {
    // Check localStorage for saved preference
    const saved = localStorage.getItem('flowOverview_viewMode');
    if (saved === 'canvas' || saved === 'list') {
      return saved;
    }
    return isMobile ? 'list' : 'canvas';
  });

  // Save view mode preference
  const toggleViewMode = useCallback(() => {
    // Save viewport state when leaving canvas view
    if (viewMode === 'canvas') {
      savedViewport.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    }
    const newMode = viewMode === 'canvas' ? 'list' : 'canvas';
    setViewMode(newMode);
    localStorage.setItem('flowOverview_viewMode', newMode);
  }, [viewMode, viewport]);

  // Use custom hooks for state management
  const {
    pipelines,
    connectors,
    datasets,
    activeRunsByPipeline,
    runsByPipeline,
    loading,
  } = useFlowData({ organizationId });

  const {
    hoveredPipelineId,
    hoveredConnectorId,
    hoveredDatasetId,
    setHoveredPipelineId,
    setHoveredConnectorId,
    setHoveredDatasetId,
    selectedSourceConnectorId,
    selectedDestinationConnectorId,
    madronaDrawerOpen,
    filterDrawerOpen,
    setSelectedSourceConnectorId,
    setSelectedDestinationConnectorId,
    setMadronaDrawerOpen,
    setFilterDrawerOpen,
  } = useFlowSelection();

  const {
    selectedDatasetIds,
    datasetOrder,
    preferencesLoaded,
    setSelectedDatasetIds,
    setDatasetOrder,
    savePreferences,
  } = useFlowPreferences({ datasets });

  // Create a stable string key for selectedDatasetIds to use in dependency arrays
  // This ensures React properly detects changes since Set comparison by reference is unreliable
  const selectedDatasetIdsKey = useMemo(
    () => Array.from(selectedDatasetIds).sort().join(','),
    [selectedDatasetIds]
  );

  // Create a key for ReactFlow that changes when visible datasets change
  // This forces ReactFlow to re-initialize with new nodes when visibility changes
  const flowKey = useMemo(() => {
    const visibleIds = selectedDatasetIds.size > 0
      ? datasetOrder.filter(id => selectedDatasetIds.has(id))
      : datasetOrder.slice(0, 5);
    return `flow-${visibleIds.join('-')}`;
  }, [selectedDatasetIds, datasetOrder]);

  // Inject animation CSS once on mount
  useEffect(() => {
    const styleId = 'flow-animation-styles';
    if (!document.getElementById(styleId)) {
      const styleElement = document.createElement('style');
      styleElement.id = styleId;
      styleElement.textContent = FLOW_ANIMATION_CSS;
      document.head.appendChild(styleElement);
    }
    return () => {
      const styleElement = document.getElementById(styleId);
      if (styleElement) {
        styleElement.remove();
      }
    };
  }, []);

  // Handler for saving preferences from modal
  const handleSavePreferences = useCallback(
    async (selectedIds: Set<string>, order: string[]) => {
      // Create new references to ensure React detects state changes
      const newSelectedIds = new Set(selectedIds);
      const newOrder = [...order];

      // Update state immediately for instant UI response
      setSelectedDatasetIds(newSelectedIds);
      setDatasetOrder(newOrder);

      // Save to backend in background (don't await - let UI update immediately)
      savePreferences({
        visible_dataset_ids: Array.from(newSelectedIds),
        dataset_order: newOrder,
      }).catch((err) => {
        logger.error('Failed to save preferences:', err);
      });
    },
    [setSelectedDatasetIds, setDatasetOrder, savePreferences]
  );

  // Determine if MiniMap should be shown
  const showMiniMap = useMemo(() => {
    // Derive count from the key (comma-separated string of IDs)
    const selectedCount = selectedDatasetIdsKey ? selectedDatasetIdsKey.split(',').filter(Boolean).length : 0;
    const filteredCount = selectedCount > 0 ? selectedCount : Math.min(datasets.length, 5);
    return filteredCount > 3 || viewport.zoom < 0.7;
  }, [selectedDatasetIdsKey, datasets.length, viewport.zoom]);

  // Filter datasets: Use saved preferences if they exist, otherwise default to first 5 by created_at desc
  // User can opt-in to select specific datasets via visibility control
  const filteredDatasets = useMemo(() => {
    // If backend provided an explicit ordering, prefer it
    if (preferencesLoaded && datasetOrder && datasetOrder.length > 0) {
      const ordered = datasetOrder
        .map((id) => datasets.find((d) => d.dataset_id === id))
        .filter((d): d is typeof datasets[number] => d !== undefined);

      if (selectedDatasetIds.size > 0) {
        // Keep only selected datasets, preserving the persisted order
        return ordered.filter((d) => selectedDatasetIds.has(d.dataset_id));
      }

      // No explicit selection: show ordered list but limit to 5 if many datasets
      return datasets.length <= 5 ? ordered : ordered.slice(0, 5);
    }

    // Fallback: if user has explicitly selected datasets, use that selection
    if (preferencesLoaded && selectedDatasetIds.size > 0) {
      const selectedList = datasets.filter((d) => selectedDatasetIds.has(d.dataset_id));
      // Sort by created_at desc (newest first)
      return selectedList.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
    }

    // Default: top datasets by entity count (limit to 5)
    const sorted = [...datasets].sort((a, b) => {
      const countA = a.entity_count || 0;
      const countB = b.entity_count || 0;
      return countB - countA;
    });

    return datasets.length <= 5 ? sorted : sorted.slice(0, 5);
  }, [datasets, selectedDatasetIds, selectedDatasetIdsKey, preferencesLoaded, datasetOrder]);

  // Build nodes and edges from data (only when data changes, not on hover)
  // 
  // DATASET VISIBILITY:
  // By default, shows first 5 datasets (sorted by creation date)
  // User can intentionally select which datasets to render via "Dataset visibility" control
  // This is view-only display tuning, not configuration or system state
  // Does not persist, affect routes, datasets, runs, or other pages
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Compute active paths FIRST so it's available for all node/edge creation
    const { activeEdgeIds, activeNodeIds } = getActivePath(pipelines, activeRunsByPipeline);

    // NEW APPROACH: Dataset-centric lanes with hierarchy
    // Each dataset defines its own horizontal lane
    // Primary dataset (largest entity count) is positioned at center
    // Secondary datasets are spaced above and below
    
    const datasetCount = filteredDatasets.length || 1;

    // Increased lane height for clearer hierarchy and spacing
    // Account for larger dataset nodes (now more prominent)
    const laneHeight = datasetCount <= 3 ? 150 : 
                       datasetCount <= 6 ? 130 : 110;

    // Calculate Madrona width early to determine centered positioning
    // Responsive sizing based on breakpoint
    const madronaPadding = isMobile ? 30 : isTablet ? 40 : 50;
    const datasetNodeWidth = isMobile ? 160 : isTablet ? 180 : 200;
    const datasetNodeHeight = isMobile ? 80 : isTablet ? 85 : 95;

    // Single column of datasets only (no multi-column)
    const madronaWidth = datasetNodeWidth + (madronaPadding * 2);

    // Layout constants - responsive and centered
    const connectorNodeWidth = isMobile ? 140 : isTablet ? 160 : 180;
    const gapBetweenConnectorAndMadrona = isMobile ? 60 : isTablet ? 80 : 110;

    const startX = isMobile ? 40 : 100;
    const sourceX = startX;
    const madronaX = sourceX + connectorNodeWidth + gapBetweenConnectorAndMadrona;
    const destinationX = madronaX + madronaWidth + gapBetweenConnectorAndMadrona;

    const LAYOUT = {
      sourceX: sourceX,
      destinationX: destinationX,
      madronaX: madronaX,
      madronaY: 100,                   // Top Y position for Madrona 
      laneHeight: laneHeight,
      laneStartY: 100,                 // Starting Y position for first lane 
      madronaPadding: madronaPadding,
      datasetNodeWidth: datasetNodeWidth,
      datasetNodeHeight: datasetNodeHeight,
      labelHeight: 65,                 // Space reserved for "CANONICAL STORE" label (increased for badge)
    };

    // STEP 1: Sort datasets for positioning
    // Use user's saved order if available, otherwise sort by entity count (largest first)
    const sortedDatasets = [...filteredDatasets].sort((a, b) => {
      const orderIndexA = datasetOrder.indexOf(a.dataset_id);
      const orderIndexB = datasetOrder.indexOf(b.dataset_id);

      // If both have saved order positions, use that order
      if (orderIndexA !== -1 && orderIndexB !== -1) {
        return orderIndexA - orderIndexB;
      }
      // If only one has order, prioritize the ordered one
      if (orderIndexA !== -1) return -1;
      if (orderIndexB !== -1) return 1;
      // Otherwise sort by entity count (largest first)
      const countA = a.entity_count || 0;
      const countB = b.entity_count || 0;
      return countB - countA;
    });
    
    const datasetLanes = new Map<string, number>(); // dataset_id -> lane number
    sortedDatasets.forEach((dataset, index) => {
      datasetLanes.set(dataset.dataset_id, index);
    });

    // STEP 2: Calculate dataset Y positions with primary (first) dataset at center
    const datasetPositions = new Map<string, number>();
    const totalHeight = datasetCount * laneHeight;
    const centerY = LAYOUT.laneStartY + LAYOUT.labelHeight + (totalHeight / 2);  // Account for label space
    
    sortedDatasets.forEach((dataset, laneIndex) => {
      // Position first dataset (primary) at center, others distributed above/below
      const offsetFromCenter = (laneIndex - (datasetCount - 1) / 2) * laneHeight;
      const y = centerY + offsetFromCenter;
      datasetPositions.set(dataset.dataset_id, y);
    });

    // STEP 3: Build connector-to-dataset mappings from pipelines (multi-source/destination)
    // Use pipeline.sources[] and pipeline.destinations[] arrays
    const sourceConnectorToDatasets = new Map<string, Set<string>>();
    const destConnectorToDatasets = new Map<string, Set<string>>();

    // Track unique sources and destinations per dataset for pipeline summary
    const datasetSourceCounts = new Map<string, Set<string>>();
    const datasetDestinationCounts = new Map<string, Set<string>>();

    pipelines.forEach((pipeline) => {
      // Map each source connector to its datasets
      if (pipeline.sources && pipeline.dataset_id) {
        pipeline.sources.forEach((source) => {
          if (!sourceConnectorToDatasets.has(source.connector_instance_id)) {
            sourceConnectorToDatasets.set(source.connector_instance_id, new Set());
          }
          sourceConnectorToDatasets.get(source.connector_instance_id)!.add(pipeline.dataset_id!);

          // Track unique sources per dataset
          if (!datasetSourceCounts.has(pipeline.dataset_id!)) {
            datasetSourceCounts.set(pipeline.dataset_id!, new Set());
          }
          datasetSourceCounts.get(pipeline.dataset_id!)!.add(source.connector_instance_id);
        });
      }

      // Map each destination connector to its datasets
      if (pipeline.destinations && pipeline.dataset_id) {
        pipeline.destinations.forEach((dest) => {
          if (!destConnectorToDatasets.has(dest.connector_instance_id)) {
            destConnectorToDatasets.set(dest.connector_instance_id, new Set());
          }
          destConnectorToDatasets.get(dest.connector_instance_id)!.add(pipeline.dataset_id!);

          // Track unique destinations per dataset
          if (!datasetDestinationCounts.has(pipeline.dataset_id!)) {
            datasetDestinationCounts.set(pipeline.dataset_id!, new Set());
          }
          datasetDestinationCounts.get(pipeline.dataset_id!)!.add(dest.connector_instance_id);
        });
      }
    });

    // For positioning, pick primary dataset for each connector (first visible dataset it connects to)
    const sourceConnectorToDataset = new Map<string, string>();
    const destConnectorToDataset = new Map<string, string>();

    sourceConnectorToDatasets.forEach((datasets, connectorId) => {
      // Find first visible dataset for this connector
      const visibleDataset = sortedDatasets.find(d => datasets.has(d.dataset_id));
      if (visibleDataset) {
        sourceConnectorToDataset.set(connectorId, visibleDataset.dataset_id);
      }
    });

    destConnectorToDatasets.forEach((datasets, connectorId) => {
      // Find first visible dataset for this connector
      const visibleDataset = sortedDatasets.find(d => datasets.has(d.dataset_id));
      if (visibleDataset) {
        destConnectorToDataset.set(connectorId, visibleDataset.dataset_id);
      }
    });

    // STEP 4: Calculate Madrona container height based on dataset distribution
    // Since datasets are centered, we need the actual vertical span they occupy
    const datasetYPositions = Array.from(datasetPositions.values());
    const maxY = datasetYPositions.length > 0 ? Math.max(...datasetYPositions) : LAYOUT.madronaY + 100;
    
    // Height from container top to bottom of lowest dataset
    const bottomDatasetOffset = maxY - LAYOUT.madronaY;
    const madronaHeight = bottomDatasetOffset + (datasetNodeHeight / 2) + madronaPadding + LAYOUT.labelHeight;

    // STEP 5: Create Madrona container node
    // Check if any dataset is active to soften container border
    const hasActiveDataset = Array.from(activeNodeIds).some(id => id.startsWith('dataset-'));
    
    nodes.push({
      id: 'madrona-container',
      type: 'madronaContainerNode',
      position: { x: LAYOUT.madronaX, y: LAYOUT.madronaY },
      data: {
        onClick: () => setMadronaDrawerOpen(true),
      },
      className: hasActiveDataset ? 'madrona-container--active' : '',
      style: {
        width: madronaWidth,
        height: madronaHeight,
      },
    });

    // STEP 6: Create dataset nodes INSIDE Madrona container (centered in their lanes)
    if (filteredDatasets.length === 0) {
      // Show placeholder when no datasets exist
      nodes.push({
        id: 'placeholder-dataset',
        type: 'datasetNode',
        position: { 
          x: LAYOUT.madronaPadding, 
          y: madronaPadding + LAYOUT.labelHeight + (laneHeight / 2) - (datasetNodeHeight / 2)
        },
        data: {
          name: 'No datasets yet',
          entityCount: 0,
          highlighted: false,
          onClick: () => {},
          sourceCount: 0,
          destinationCount: 0,
        },
        parentNode: 'madrona-container',
        draggable: false,
      });
    } else {
      sortedDatasets.forEach((dataset) => {
        const absoluteY = datasetPositions.get(dataset.dataset_id)!;
        const relativeY = absoluteY - LAYOUT.madronaY - (datasetNodeHeight / 2); // Center in lane, relative to container
        const nodeId = `dataset-${dataset.dataset_id}`;
        
        // Get pipeline counts for this dataset
        const sourceCount = datasetSourceCounts.get(dataset.dataset_id)?.size || 0;
        const destinationCount = datasetDestinationCounts.get(dataset.dataset_id)?.size || 0;
        
        nodes.push({
          id: nodeId,
          type: 'datasetNode',
          position: { 
            x: LAYOUT.madronaPadding, 
            y: relativeY
          },
          data: {
            name: dataset.name || 'Dataset',
            entityCount: dataset.entity_count || 0,
            highlighted: false,
            onClick: () => navigate(`/organizations/${organizationId}/bridge/datasets/${dataset.dataset_id}`),
            sourceCount: sourceCount,
            destinationCount: destinationCount,
          },
          className: getNodeClassName(nodeId, activeNodeIds),
          parentNode: 'madrona-container',
          extent: 'parent' as const,
          draggable: true,
        });
      });
    }

    // STEP 7: Create source connector nodes (grouped by dataset, sorted by name)
    // Group connectors by dataset for tighter clustering
    const sourceConnectorsByDataset = new Map<string, Array<{ connector: any, connectorId: string }>>();
    
    Array.from(sourceConnectorToDataset.entries()).forEach(([connectorId, datasetId]) => {
      const connector = connectors.find(c => c.connector_instance_id === connectorId);
      if (!connector) return;
      
      if (!sourceConnectorsByDataset.has(datasetId)) {
        sourceConnectorsByDataset.set(datasetId, []);
      }
      sourceConnectorsByDataset.get(datasetId)!.push({ connector, connectorId });
    });

    // Sort connectors within each dataset group by name (deterministic ordering)
    sourceConnectorsByDataset.forEach((connectorsInGroup) => {
      connectorsInGroup.sort((a, b) => 
        (a.connector.name || '').localeCompare(b.connector.name || '')
      );
    });

    // Position connectors within each dataset group
    const connectorHeight = 60; // Approximate connector node height
    const connectorSpacingWithinGroup = 8; // Tight spacing for same dataset
    
    sourceConnectorsByDataset.forEach((connectorsInGroup, datasetId) => {
      const datasetY = datasetPositions.get(datasetId);
      if (datasetY === undefined) return;
      
      // Calculate total height of this connector group
      const groupHeight = (connectorsInGroup.length * connectorHeight) + 
                          ((connectorsInGroup.length - 1) * connectorSpacingWithinGroup);
      
      // Start Y position (center the group on the dataset Y)
      const groupStartY = datasetY - (groupHeight / 2);
      
      connectorsInGroup.forEach((item, indexInGroup) => {
        const y = groupStartY + (indexInGroup * (connectorHeight + connectorSpacingWithinGroup));
        const nodeId = `source-${item.connectorId}`;
        
        nodes.push({
          id: nodeId,
          type: 'connectorSourceNode',
          position: { 
            x: LAYOUT.sourceX, 
            y: y
          },
          data: {
            name: item.connector.name || 'Source',
            onClick: () => setSelectedSourceConnectorId(item.connectorId),
          },
          className: getNodeClassName(nodeId, activeNodeIds),
        });
      });
    });

    if (sourceConnectorsByDataset.size === 0) {
      nodes.push({
        id: 'placeholder-source',
        type: 'connectorSourceNode',
        position: { 
          x: LAYOUT.sourceX, 
          y: LAYOUT.laneStartY + (laneHeight / 2)
        },
        data: {
          name: 'No source connectors',
          onClick: undefined,
          isPlaceholder: true,
        },
        draggable: false,
      });
    }

    // STEP 8: Create destination connector nodes (grouped by dataset, sorted by name)
    const destConnectorsByDataset = new Map<string, Array<{ connector: any, connectorId: string }>>();
    
    Array.from(destConnectorToDataset.entries()).forEach(([connectorId, datasetId]) => {
      const connector = connectors.find(c => c.connector_instance_id === connectorId);
      if (!connector) return;
      
      if (!destConnectorsByDataset.has(datasetId)) {
        destConnectorsByDataset.set(datasetId, []);
      }
      destConnectorsByDataset.get(datasetId)!.push({ connector, connectorId });
    });

    // Sort connectors within each dataset group by name (deterministic ordering)
    destConnectorsByDataset.forEach((connectorsInGroup) => {
      connectorsInGroup.sort((a, b) => 
        (a.connector.name || '').localeCompare(b.connector.name || '')
      );
    });

    destConnectorsByDataset.forEach((connectorsInGroup, datasetId) => {
      const datasetY = datasetPositions.get(datasetId);
      if (datasetY === undefined) return;
      
      // Calculate total height of this connector group
      const groupHeight = (connectorsInGroup.length * connectorHeight) + 
                          ((connectorsInGroup.length - 1) * connectorSpacingWithinGroup);
      
      // Start Y position (center the group on the dataset Y)
      const groupStartY = datasetY - (groupHeight / 2);
      
      connectorsInGroup.forEach((item, indexInGroup) => {
        const y = groupStartY + (indexInGroup * (connectorHeight + connectorSpacingWithinGroup));
        const nodeId = `destination-${item.connectorId}`;
        
        nodes.push({
          id: nodeId,
          type: 'connectorDestinationNode',
          position: { 
            x: LAYOUT.destinationX, 
            y: y
          },
          data: {
            name: item.connector.name || 'Destination',
            onClick: () => setSelectedDestinationConnectorId(item.connectorId),
          },
          className: getNodeClassName(nodeId, activeNodeIds),
        });
      });
    });

    if (destConnectorsByDataset.size === 0) {
      // Show placeholder when no destinations exist
      nodes.push({
        id: 'placeholder-destination',
        type: 'connectorDestinationNode',
        position: { 
          x: LAYOUT.destinationX, 
          y: LAYOUT.laneStartY + (laneHeight / 2)
        },
        data: {
          name: 'No destination connectors',
          onClick: undefined,
          isPlaceholder: true,
        },
        draggable: false,
      });
    }

    // STEP 9: Create edges for pipelines (multi-source → dataset → multi-destination)
    //
    // ARCHITECTURAL CONSTRAINT: Datasets are the pipeline nucleus
    // - All data flows MUST pass through exactly ONE dataset
    // - Datasets NEVER connect directly to other datasets
    // - Flow pattern: Source(s) → [Merge] → Dataset → Destination(s)
    // - This ensures datasets act as the canonical center of all pipelines
    pipelines.forEach((pipeline) => {
      const hasDataset = pipeline.dataset_id;
      if (!hasDataset) return;

      const pipelineId = pipeline.pipeline_id;

      // Create edges from each source to dataset
      if (pipeline.sources) {
        const isMultiSource = pipeline.sources.length > 1;

        if (isMultiSource) {
          // For multi-source pipelines, create a merge node
          // Calculate average Y position of all sources for this pipeline
          const sourceYPositions = pipeline.sources
            .map(source => {
              const sourceNode = nodes.find(n => n.id === `source-${source.connector_instance_id}`);
              return sourceNode ? sourceNode.position.y : 0;
            })
            .filter(y => y > 0);

          const avgSourceY = sourceYPositions.length > 0
            ? sourceYPositions.reduce((a, b) => a + b, 0) / sourceYPositions.length
            : 0;

          if (avgSourceY > 0 && pipeline.dataset_id) {
            const datasetY = datasetPositions.get(pipeline.dataset_id);
            if (datasetY !== undefined) {
              // Create merge node with custom component
              const mergeNodeId = `merge-${pipelineId}`;
              const mergeX = LAYOUT.madronaX - 35; // Position closer to dataset to show merge is a dataset concern

              nodes.push({
                id: mergeNodeId,
                type: 'mergeNode',
                position: { x: mergeX, y: avgSourceY - 20 }, // Center vertically on label
                data: {
                  sourceCount: pipeline.sources.length,
                },
                draggable: false,
                selectable: false,
              });

              // Create edges from each source to merge node
              pipeline.sources.forEach((source) => {
                const edgeId = `edge-source-merge-${pipelineId}-${source.connector_instance_id}`;
                const isActive = activeEdgeIds.has(`edge-source-${pipelineId}-${source.connector_instance_id}`);

                edges.push({
                  id: edgeId,
                  source: `source-${source.connector_instance_id}`,
                  sourceHandle: 'right',
                  target: mergeNodeId,
                  targetHandle: 'left',
                  type: 'smoothstep',
                  style: {
                    stroke: isActive ? ACTIVE_RUN_COLOR : DEFAULT_EDGE_COLOR,
                    strokeWidth: 1,
                    cursor: 'pointer',
                  },
                  className: `${getEdgeClassName(`edge-source-${pipelineId}-${source.connector_instance_id}`, activeEdgeIds)} ${isActive ? 'edge--animated-source' : ''}`,
                  data: { pipelineId },
                  markerEnd: undefined,
                  animated: false,
                  interactionWidth: 20,
                });
              });

              // Create single edge from merge node to dataset
              const mergeToDatasetEdgeId = `edge-merge-dataset-${pipelineId}`;
              const isPipelineActive = pipeline.sources.some(source =>
                activeEdgeIds.has(`edge-source-${pipelineId}-${source.connector_instance_id}`)
              );

              edges.push({
                id: mergeToDatasetEdgeId,
                source: mergeNodeId,
                sourceHandle: 'right',
                target: `dataset-${pipeline.dataset_id}`,
                targetHandle: 'left',
                type: 'straight',
                style: {
                  stroke: isPipelineActive ? ACTIVE_RUN_COLOR : DEFAULT_EDGE_COLOR,
                  strokeWidth: 2, // Thicker to show merged flow
                  cursor: 'pointer',
                },
                className: `${getEdgeClassName(mergeToDatasetEdgeId, activeEdgeIds)} ${isPipelineActive ? 'edge--animated-merge' : ''}`,
                data: { pipelineId },
                markerEnd: undefined,
                animated: false,
                interactionWidth: 20,
              });
            }
          }
        } else {
          // Single source - direct connection (existing behavior)
          pipeline.sources.forEach((source) => {
            const edgeId = `edge-source-${pipelineId}-${source.connector_instance_id}`;
            const isActive = activeEdgeIds.has(edgeId);

            edges.push({
              id: edgeId,
              source: `source-${source.connector_instance_id}`,
              sourceHandle: 'right',
              target: `dataset-${pipeline.dataset_id}`,
              targetHandle: 'left',
              type: 'straight',
              style: {
                stroke: isActive ? ACTIVE_RUN_COLOR : DEFAULT_EDGE_COLOR,
                strokeWidth: 1,
                cursor: 'pointer',
              },
              className: `${getEdgeClassName(edgeId, activeEdgeIds)} ${isActive ? 'edge--animated-source' : ''}`,
              data: { pipelineId },
              markerEnd: undefined,
              animated: false,
              interactionWidth: 20,
            });
          });
        }
      }

      // Create edges from dataset to each destination
      // These edges show downstream flow with clear directionality (arrows)
      if (pipeline.destinations) {
        pipeline.destinations.forEach((dest) => {
          const edgeId = `edge-dest-${pipelineId}-${dest.connector_instance_id}`;
          const isActive = activeEdgeIds.has(edgeId);

          edges.push({
            id: edgeId,
            source: `dataset-${pipeline.dataset_id}`,
            sourceHandle: 'right',
            target: `destination-${dest.connector_instance_id}`,
            targetHandle: 'left',
            type: 'straight',
            style: {
              stroke: isActive ? ACTIVE_RUN_COLOR : 'rgb(var(--color-stone))',
              strokeWidth: 1,
              cursor: 'pointer',
              opacity: 0.7, // Slightly muted to de-emphasize
            },
            className: `${getEdgeClassName(edgeId, activeEdgeIds)} ${isActive ? 'edge--animated-destination' : ''}`,
            data: { pipelineId },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: isActive ? ACTIVE_RUN_COLOR : 'rgb(var(--color-stone))',
            },
            animated: false,
            interactionWidth: 20,
          });
        });
      }
    });

    // VALIDATION: Enforce layout rules in development mode
    if (import.meta.env.DEV) {
      validateLayoutConstraints(nodes, edges);
    }

    return { nodes, edges };
  }, [pipelines, connectors, filteredDatasets, datasetOrder, organizationId, activeRunsByPipeline, isMobile, isTablet]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when data changes (but not on hover)
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Update edge styles when hover state changes (multi-source/destination support)
  useEffect(() => {
    setEdges((eds) =>
      eds.map((edge) => {
        const pipelineId = edge.data?.pipelineId;
        if (!pipelineId) return edge;

        const pipeline = pipelines.find(p => p.pipeline_id === pipelineId);
        if (!pipeline) return edge;

        const isPipelineHovered = hoveredPipelineId === pipelineId;

        // Check if any source in the pipeline is hovered
        const isSourceHovered = hoveredConnectorId && pipeline.sources?.some(
          s => s.connector_instance_id === hoveredConnectorId
        );

        // Check if any destination in the pipeline is hovered
        const isDestinationHovered = hoveredConnectorId && pipeline.destinations?.some(
          d => d.connector_instance_id === hoveredConnectorId
        );

        const isDatasetHovered = hoveredDatasetId && pipeline.dataset_id === hoveredDatasetId;
        const shouldHighlight = isPipelineHovered || isSourceHovered || isDestinationHovered || isDatasetHovered;

        // Check if pipeline has active run
        const isRunning = activeRunsByPipeline.get(pipelineId) || false;

        // Determine stroke color: running (green) > highlighted (grey) > default (beige)
        let strokeColor = 'rgb(var(--color-stone))'; // default beige
        if (isRunning) {
          strokeColor = 'rgb(var(--color-semantic-success))'; // green for running
        } else if (shouldHighlight) {
          strokeColor = '#ADA79D'; // grey for hover
        }

        // Check if this is a destination edge
        const isDestinationEdge = edge.id.startsWith('edge-dest-');

        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: strokeColor,
            strokeWidth: edge.id.includes('merge-dataset') ? (isRunning ? 3 : 2) : (isRunning ? 2 : 1),
            cursor: 'pointer',
            opacity: isDestinationEdge ? (shouldHighlight || isRunning ? 1 : 0.7) : 1, // De-emphasize destination edges
          },
          markerEnd: isDestinationEdge ? {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: strokeColor,
          } : edge.markerEnd,
          animated: isRunning,
        };
      })
    );
  }, [hoveredPipelineId, hoveredConnectorId, hoveredDatasetId, pipelines, setEdges, activeRunsByPipeline]);

  // Update dataset node highlighting when hover state changes (multi-source/destination support)
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (!node.id.startsWith('dataset-')) return node;

        const datasetId = node.id.replace('dataset-', '');

        // Only highlight if:
        // 1. The dataset itself is hovered, OR
        // 2. A pipeline touching this dataset is hovered, OR
        // 3. A connector that has a pipeline touching this specific dataset is hovered
        const isHighlighted =
          hoveredDatasetId === datasetId ||
          (hoveredPipelineId && pipelines.find(p => p.pipeline_id === hoveredPipelineId)?.dataset_id === datasetId) ||
          (hoveredConnectorId && pipelines.some(p =>
            p.dataset_id === datasetId && // Dataset must match
            (p.sources?.some(s => s.connector_instance_id === hoveredConnectorId) ||
             p.destinations?.some(d => d.connector_instance_id === hoveredConnectorId))
          ));

        return {
          ...node,
          data: {
            ...node.data,
            highlighted: isHighlighted,
          },
        };
      })
    );
  }, [hoveredPipelineId, hoveredConnectorId, hoveredDatasetId, pipelines, setNodes]);

  // Fit view on initial load, or restore viewport when switching back from list view
  useEffect(() => {
    if (viewMode === 'canvas' && !loading && !hasInitializedView.current && nodes.length > 0) {
      setTimeout(() => {
        if (savedViewport.current) {
          // Restore the saved viewport position
          setViewport(savedViewport.current, { duration: 0 });
        } else {
          // Initial load - fit the view
          fitView({ padding: 0.1, minZoom: 0.1, maxZoom: 1.5, duration: 0 });
        }
        hasInitializedView.current = true;
        setIsReady(true);
      }, 100);
    }
  }, [loading, nodes.length, fitView, setViewport, viewMode]);

  // Re-fit view when dataset visibility changes (after initial load)
  const prevFlowKeyRef = useRef(flowKey);
  useEffect(() => {
    if (hasInitializedView.current && prevFlowKeyRef.current !== flowKey) {
      prevFlowKeyRef.current = flowKey;
      // Small delay to let nodes update, then smoothly fit view
      setTimeout(() => {
        fitView({ padding: 0.1, minZoom: 0.1, maxZoom: 1.5, duration: 400 });
      }, 50);
    }
  }, [flowKey, fitView]);

  // Reset initialization state when switching to list view (ReactFlow unmounts)
  // This ensures fitView runs again when switching back to canvas
  useEffect(() => {
    if (viewMode === 'list') {
      hasInitializedView.current = false;
      setIsReady(false);
    }
  }, [viewMode]);

  if (loading) {
    return <FlowSkeleton />;
  }

  // Show empty state if no pipelines are configured
  if (!loading && pipelines.length === 0 && organizationId) {
    return <FlowEmptyState organizationId={organizationId} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: isMobile ? 'calc(100vh - 120px)' : 'calc(100vh - 150px)' }}>
      {/* Overview Controls Row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMobile ? '10px 12px' : '12px 16px',
        background: 'rgb(var(--color-parchment))',
        borderBottom: '1px solid #E4DCCB',
        minHeight: isMobile ? '44px' : '48px',
        flexShrink: 0,
        gap: isMobile ? '8px' : '16px',
        flexWrap: 'wrap',
      }}>
        {/* Left: Dataset visibility control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px', minWidth: 0 }}>
          <button
            onClick={() => setFilterDrawerOpen(true)}
            style={{
              color: 'rgb(var(--color-archive))',
              fontSize: isMobile ? '12px' : '13px',
              fontFamily: 'Georgia, serif',
              cursor: 'pointer',
              background: 'transparent',
              border: '1px solid #D4CBC3',
              borderRadius: '4px',
              padding: isMobile ? '8px 10px' : '6px 12px',
              minHeight: isMobile ? '44px' : 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgb(var(--color-parchment-warm))';
              e.currentTarget.style.borderColor = 'rgb(var(--color-archive))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = '#D4CBC3';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {!isMobile && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Dataset visibility</span>}
          </button>

          {pipelines.length === 0 && !isMobile && (
            <div style={{
              fontSize: '13px',
              color: 'rgb(var(--color-archive))',
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic',
            }}>
              No pipelines configured
            </div>
          )}
        </div>

        {/* Right: View toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={toggleViewMode}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: isMobile ? '8px 10px' : '6px 12px',
              minHeight: isMobile ? '44px' : 'auto',
              background: 'transparent',
              border: '1px solid #D4CBC3',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'rgb(var(--color-archive))',
              fontSize: isMobile ? '12px' : '13px',
              fontFamily: 'Georgia, serif',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgb(var(--color-parchment-warm))';
              e.currentTarget.style.borderColor = 'rgb(var(--color-archive))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = '#D4CBC3';
            }}
            title={viewMode === 'canvas' ? 'Switch to list view' : 'Switch to canvas view'}
          >
            {viewMode === 'canvas' ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <rect x="2" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.5" rx="1" />
                <rect x="9" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.5" rx="1" />
                <rect x="2" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.5" rx="1" />
                <rect x="9" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.5" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {!isMobile && <span>{viewMode === 'canvas' ? 'List view' : 'Canvas view'}</span>}
          </button>
        </div>
      </div>

      {/* Main content area - Canvas or List view */}
      <div style={{ flex: 1, position: 'relative', background: 'rgb(var(--color-parchment))', overflow: 'auto' }}>
        {viewMode === 'list' ? (
          <PipelineListView
            pipelines={pipelines}
            connectors={connectors}
            datasets={datasets}
            runsByPipeline={runsByPipeline}
            activeRunsByPipeline={activeRunsByPipeline}
            onSourceClick={setSelectedSourceConnectorId}
            onDestinationClick={setSelectedDestinationConnectorId}
            onDatasetClick={(datasetId) => navigate(`/organizations/${organizationId}/bridge/datasets/${datasetId}`)}
          />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            style={{ opacity: isReady ? 1 : 0, transition: 'opacity 0.2s ease-in-out' }}
            onEdgeClick={() => {
              // Navigate to setup pipelines page when clicking an edge
              if (organizationId) {
                navigate(`/organizations/${organizationId}/bridge/setup/pipelines`);
              }
            }}
            onEdgeMouseEnter={(_event, edge) => {
              if (edge.data?.pipelineId) {
                setHoveredPipelineId(edge.data.pipelineId);
                setHoveredConnectorId(null);
                setHoveredDatasetId(null);
              }
            }}
            onEdgeMouseLeave={() => {
              setHoveredPipelineId(null);
            }}
            onNodeMouseEnter={(_event, node) => {
              if (node.id.startsWith('source-') || node.id.startsWith('destination-')) {
                const connectorId = node.id.replace(/^(source|destination)-/, '');
                setHoveredConnectorId(connectorId);
                setHoveredPipelineId(null);
                setHoveredDatasetId(null);
              } else if (node.id.startsWith('dataset-')) {
                const datasetId = node.id.replace('dataset-', '');
                setHoveredDatasetId(datasetId);
                setHoveredPipelineId(null);
                setHoveredConnectorId(null);
              }
            }}
            onNodeMouseLeave={(_event, node) => {
              if (node.id.startsWith('source-') || node.id.startsWith('destination-')) {
                setHoveredConnectorId(null);
              } else if (node.id.startsWith('dataset-')) {
                setHoveredDatasetId(null);
              }
            }}
            nodeTypes={nodeTypes}
            minZoom={0.3}
            maxZoom={1.5}
          >
            <Background gap={32} size={1} color="#E4DCCB" style={backgroundStyle} />
            <Controls />
            {showMiniMap && <MiniMap />}
          </ReactFlow>
        )}
      </div>

      {/* Source Connector Drawer */}
      {selectedSourceConnectorId && (() => {
        // Find pipeline where this connector is a source (using new multi-source model)
        const pipeline = pipelines.find(p =>
          p.sources?.some(source => source.connector_instance_id === selectedSourceConnectorId)
        );
        const pipelineId = pipeline?.pipeline_id || '';
        return (
          <SourceConnectorDrawer
            isOpen={true}
            onClose={() => setSelectedSourceConnectorId(null)}
            connectorName={connectors.find(c => c.connector_instance_id === selectedSourceConnectorId)?.name || 'Source Connector'}
            connectorInstanceId={selectedSourceConnectorId}
            organizationId={organizationId || ''}
            pipelineId={pipelineId}
            datasetId={pipeline?.dataset_id || null}
            latestRun={pipelineId ? runsByPipeline.get(pipelineId) || null : null}
            onRunComplete={() => {}}
          />
        );
      })()}

      {/* Madrona Sync Drawer */}
      <MadronaSyncDrawer
        isOpen={madronaDrawerOpen}
        onClose={() => setMadronaDrawerOpen(false)}
        latestRun={null}
      />

      {/* Destination Connector Drawer */}
      {selectedDestinationConnectorId && (
        <DestinationConnectorDrawer
          isOpen={true}
          onClose={() => setSelectedDestinationConnectorId(null)}
          connectorName={connectors.find(c => c.connector_instance_id === selectedDestinationConnectorId)?.name || 'Destination Connector'}
          connectorType={connectors.find(c => c.connector_instance_id === selectedDestinationConnectorId)?.name || 'Target'}
          connectorInstanceId={selectedDestinationConnectorId}
          organizationId={organizationId || ''}
          latestRun={null}
        />
      )}

      {/* Dataset Visibility Modal */}
      <DatasetVisibilityModal
        isOpen={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        datasets={datasets}
        selectedDatasetIds={selectedDatasetIds}
        datasetOrder={datasetOrder}
        onSave={handleSavePreferences}
      />
    </div>
  );
}

export default function FlowOverview() {
  return (
    <ReactFlowProvider>
      <FlowOverviewInner />
    </ReactFlowProvider>
  );
}
