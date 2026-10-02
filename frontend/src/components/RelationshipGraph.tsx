import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, Minimize2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { getEntityRelationships, getEntity } from '../lib/api';

interface RelationshipGraphProps {
  entityKey: string;
  organizationId: string;
  onEntityClick?: (entityKey: string) => void;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'center' | 'outgoing' | 'incoming';
  x: number;
  y: number;
  entityType?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  direction: 'outgoing' | 'incoming';
}

const NODE_RADIUS = 40;
const CENTER_RADIUS = 50;
const GRAPH_RADIUS = 180;

// Color mapping for relationship types
const TYPE_COLORS: Record<string, string> = {
  hasMedia: '#6366f1',    // indigo
  relatedTo: '#8b5cf6',   // violet
  partOf: '#ec4899',      // pink
  hasPart: '#f43f5e',     // rose
  references: '#14b8a6',  // teal
  hasDonor: 'rgb(var(--color-warning))',    // orange
  inExhibition: '#84cc16', // lime
  hasAgent: '#06b6d4',    // cyan
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || 'rgb(var(--color-archive))';
}

export function RelationshipGraph({ entityKey, organizationId, onEntityClick }: RelationshipGraphProps) {
  const [zoom, setZoom] = useState(1);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedRelType, setSelectedRelType] = useState<string | null>(null);

  // Fetch the center entity
  const { data: centerEntity } = useQuery({
    queryKey: ['entity', entityKey, organizationId],
    queryFn: () => getEntity(entityKey, organizationId),
    enabled: !!entityKey && !!organizationId,
  });

  // Fetch relationships
  const { data: relData, isLoading } = useQuery({
    queryKey: ['entityRelationships', entityKey, organizationId, 'graph'],
    queryFn: () => getEntityRelationships(entityKey, organizationId, { direction: 'all' }),
    enabled: !!entityKey && !!organizationId,
  });

  // Build graph data
  const { nodes, edges, relationshipTypes } = useMemo(() => {
    if (!relData?.items) {
      return { nodes: [], edges: [], relationshipTypes: [] };
    }

    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];
    const typeSet = new Set<string>();

    // Center node
    const centerLabel = centerEntity?.payload?.label || entityKey;
    nodeMap.set(entityKey, {
      id: entityKey,
      label: truncateLabel(centerLabel as string, 15),
      type: 'center',
      x: 0,
      y: 0,
      entityType: centerEntity?.entity_type,
    });

    // Separate outgoing and incoming
    const outgoing = relData.items.filter(r => r.source_entity_key === entityKey);
    const incoming = relData.items.filter(r => r.target_entity_key === entityKey);

    // Position outgoing nodes on the right half
    outgoing.forEach((rel, i) => {
      typeSet.add(rel.relationship_type);
      const angle = -Math.PI / 2 + (Math.PI * (i + 1)) / (outgoing.length + 1);
      const x = Math.cos(angle) * GRAPH_RADIUS;
      const y = Math.sin(angle) * GRAPH_RADIUS;

      if (!nodeMap.has(rel.target_entity_key)) {
        // Use the last segment of entity_key as label (e.g., "abc123" from "source:conn:abc123")
        const label = rel.target_entity_key.split(':').pop() || rel.target_entity_key;
        nodeMap.set(rel.target_entity_key, {
          id: rel.target_entity_key,
          label: truncateLabel(label, 12),
          type: 'outgoing',
          x,
          y,
        });
      }

      edgeList.push({
        source: entityKey,
        target: rel.target_entity_key,
        type: rel.relationship_type,
        direction: 'outgoing',
      });
    });

    // Position incoming nodes on the left half
    incoming.forEach((rel, i) => {
      typeSet.add(rel.relationship_type);
      const angle = Math.PI / 2 + (Math.PI * (i + 1)) / (incoming.length + 1);
      const x = Math.cos(angle) * GRAPH_RADIUS;
      const y = Math.sin(angle) * GRAPH_RADIUS;

      if (!nodeMap.has(rel.source_entity_key)) {
        // Use the last segment of entity_key as label
        const label = rel.source_entity_key.split(':').pop() || rel.source_entity_key;
        nodeMap.set(rel.source_entity_key, {
          id: rel.source_entity_key,
          label: truncateLabel(label, 12),
          type: 'incoming',
          x,
          y,
        });
      }

      edgeList.push({
        source: rel.source_entity_key,
        target: entityKey,
        type: rel.relationship_type,
        direction: 'incoming',
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      edges: edgeList,
      relationshipTypes: Array.from(typeSet).sort(),
    };
  }, [relData, centerEntity, entityKey]);

  // Filter edges by selected type
  const filteredEdges = useMemo(() => {
    if (!selectedRelType) return edges;
    return edges.filter(e => e.type === selectedRelType);
  }, [edges, selectedRelType]);

  // Filter nodes to only show connected ones
  const filteredNodes = useMemo(() => {
    if (!selectedRelType) return nodes;
    const connectedIds = new Set<string>();
    connectedIds.add(entityKey);
    filteredEdges.forEach(e => {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    });
    return nodes.filter(n => connectedIds.has(n.id));
  }, [nodes, filteredEdges, entityKey, selectedRelType]);

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(z + 0.2, 2)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(z - 0.2, 0.5)), []);
  const handleReset = useCallback(() => {
    setZoom(1);
    setSelectedRelType(null);
  }, []);

  if (isLoading) {
    return <div className="text-center py-8 text-archive">Loading graph...</div>;
  }

  if (nodes.length <= 1) {
    return (
      <div className="text-center py-12 text-archive">
        <p>No relationships to visualize</p>
      </div>
    );
  }

  const viewBox = isExpanded ? '-400 -300 800 600' : '-300 -250 600 500';
  const containerClass = isExpanded
    ? 'fixed inset-4 z-50 bg-parchment rounded-lg shadow-2xl'
    : 'bg-stone rounded-lg border border-lichen';

  return (
    <div className={containerClass}>
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-lichen">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {nodes.length} entities, {edges.length} relationships
          </span>
          {relationshipTypes.length > 0 && (
            <select
              value={selectedRelType || ''}
              onChange={(e) => setSelectedRelType(e.target.value || null)}
              className="ml-4 text-sm border border-lichen rounded px-2 py-1"
            >
              <option value="">All types</option>
              {relationshipTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-archive hover:text-ink hover:bg-stone rounded"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-archive w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-archive hover:text-ink hover:bg-stone rounded"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 text-archive hover:text-ink hover:bg-stone rounded ml-2"
            title="Reset view"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-archive hover:text-ink hover:bg-stone rounded ml-2"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Graph SVG */}
      <svg
        viewBox={viewBox}
        className={`w-full ${isExpanded ? 'h-[calc(100%-60px)]' : 'h-80'}`}
        style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
      >
        <defs>
          {/* Arrow markers for each relationship type */}
          {relationshipTypes.map(type => (
            <marker
              key={type}
              id={`arrow-${type}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={getTypeColor(type)} />
            </marker>
          ))}
        </defs>

        {/* Edges */}
        {filteredEdges.map((edge, i) => {
          const sourceNode = filteredNodes.find(n => n.id === edge.source);
          const targetNode = filteredNodes.find(n => n.id === edge.target);
          if (!sourceNode || !targetNode) return null;

          const isHighlighted = hoveredNode === edge.source || hoveredNode === edge.target;
          const color = getTypeColor(edge.type);

          // Calculate edge positions (accounting for node radius)
          const dx = targetNode.x - sourceNode.x;
          const dy = targetNode.y - sourceNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const sourceRadius = sourceNode.type === 'center' ? CENTER_RADIUS : NODE_RADIUS;
          const targetRadius = targetNode.type === 'center' ? CENTER_RADIUS : NODE_RADIUS;

          const startX = sourceNode.x + (dx / dist) * sourceRadius;
          const startY = sourceNode.y + (dy / dist) * sourceRadius;
          const endX = targetNode.x - (dx / dist) * (targetRadius + 8);
          const endY = targetNode.y - (dy / dist) * (targetRadius + 8);

          return (
            <g key={`edge-${i}`}>
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke={color}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
                strokeOpacity={isHighlighted ? 1 : 0.6}
                markerEnd={`url(#arrow-${edge.type})`}
              />
              {/* Edge label on hover */}
              {isHighlighted && (
                <text
                  x={(startX + endX) / 2}
                  y={(startY + endY) / 2 - 8}
                  textAnchor="middle"
                  className="text-xs fill-accessible-gray"
                  style={{ fontSize: '10px' }}
                >
                  {edge.type}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {filteredNodes.map((node) => {
          const isCenter = node.type === 'center';
          const radius = isCenter ? CENTER_RADIUS : NODE_RADIUS;
          const isHovered = hoveredNode === node.id;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => !isCenter && onEntityClick?.(node.id)}
              style={{ cursor: isCenter ? 'default' : 'pointer' }}
            >
              {/* Node circle */}
              <circle
                r={radius}
                fill={isCenter ? 'rgb(var(--color-success))' : (node.type === 'outgoing' ? '#dbeafe' : 'rgb(var(--color-warning))')}
                stroke={isCenter ? '#3d5a4a' : (node.type === 'outgoing' ? '#3b82f6' : 'rgb(var(--color-warning))')}
                strokeWidth={isHovered ? 3 : 2}
              />

              {/* Node label */}
              <text
                textAnchor="middle"
                dy="0.35em"
                className={`${isCenter ? 'fill-parchment font-medium' : 'fill-ink'}`}
                style={{ fontSize: isCenter ? '12px' : '10px', pointerEvents: 'none' }}
              >
                {node.label}
              </text>

              {/* Entity type badge */}
              {node.entityType && (
                <text
                  textAnchor="middle"
                  y={radius + 14}
                  className="fill-archive"
                  style={{ fontSize: '9px' }}
                >
                  {node.entityType}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-3 py-2 border-t border-lichen bg-stone text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-semantic-success" />
          <span className="text-accessible-gray">Current entity</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-semantic-info/10 border-2 border-semantic-info/30" />
          <span className="text-accessible-gray">Outgoing</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-semantic-warning/10 border-2 border-semantic-warning/30" />
          <span className="text-accessible-gray">Incoming</span>
        </div>
        <span className="text-archive">|</span>
        {relationshipTypes.slice(0, 5).map(type => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-3 h-0.5" style={{ backgroundColor: getTypeColor(type) }} />
            <span className="text-accessible-gray">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function truncateLabel(label: string, maxLength: number): string {
  if (!label) return '?';
  if (label.length <= maxLength) return label;
  return label.substring(0, maxLength - 2) + '...';
}

// Wrapper component for use in the entity detail page
export function RelationshipGraphWrapper({ entityKey, organizationId }: RelationshipGraphProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-ink">Relationship Graph</h4>
      <RelationshipGraph
        entityKey={entityKey}
        organizationId={organizationId}
        onEntityClick={(key) => {
          // Navigate to the entity - use window.location for simplicity
          window.location.href = `/organizations/${organizationId}/bridge/entities/${encodeURIComponent(key)}`;
        }}
      />
      <p className="text-xs text-archive text-center">
        Click on a connected entity to navigate to it
      </p>
    </div>
  );
}
