import { useState } from 'react';
import { ChevronRight, ChevronDown, Table, Layers, RefreshCw, Eye, Columns } from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import type { CatalogObject, CatalogResult, ObjectDescription } from '../lib/api';
import { getConnectorCatalog, describeConnectorObject } from '../lib/api';
import { logger } from '../lib/logger';
import { formatNumber, formatTime } from '../lib/formatters';

interface CatalogBrowserProps {
  instanceId: string;
  onPreview?: (objectId: string, objectName: string) => void;
}

interface TreeNodeProps {
  object: CatalogObject;
  level: number;
  instanceId: string;
  onPreview?: (objectId: string, objectName: string) => void;
}

function TreeNode({ object, level, instanceId, onPreview }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, _setChildren] = useState<CatalogObject[] | null>(object.children || null);
  const [description, setDescription] = useState<ObjectDescription | null>(null);
  const [loadingDescription, setLoadingDescription] = useState(false);
  const [showColumns, setShowColumns] = useState(false);

  const hasChildren = object.type === 'schema' || object.type === 'database';
  const isTable = object.type === 'table' || object.type === 'view' || object.type === 'collection';

  const getIcon = () => {
    switch (object.type) {
      case 'database':
        return <FaDatabase size={16} className="text-semantic-info" />;
      case 'schema':
        return <Layers size={16} className="text-forest" />;
      case 'table':
      case 'view':
      case 'collection':
        return <Table size={16} className="text-semantic-success" />;
      default:
        return <Table size={16} className="text-accessible-gray" />;
    }
  };

  const handleExpand = () => {
    setExpanded(!expanded);
  };

  const handleDescribe = async () => {
    if (description) {
      setShowColumns(!showColumns);
      return;
    }

    try {
      setLoadingDescription(true);
      const desc = await describeConnectorObject(instanceId, object.id);
      setDescription(desc);
      setShowColumns(true);
    } catch (err) {
      logger.error('Failed to describe object:', err);
    } finally {
      setLoadingDescription(false);
    }
  };

  const nodeId = `catalog-node-${object.id}`;
  const childrenId = `${nodeId}-children`;
  const columnsId = `${nodeId}-columns`;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-stone rounded cursor-pointer group"
        style={{ paddingLeft: `${level * 20 + 8}px` }}
      >
        {/* Expand/Collapse for containers */}
        {hasChildren ? (
          <button
            onClick={handleExpand}
            aria-expanded={expanded}
            aria-controls={childrenId}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${object.name}`}
            className="p-0.5 hover:bg-stone rounded"
          >
            {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
        ) : (
          <span className="w-5" aria-hidden="true" />
        )}

        {/* Icon */}
        {getIcon()}

        {/* Name */}
        <span className="flex-1 text-sm text-ink truncate" title={object.name}>
          {object.name}
        </span>

        {/* Type badge */}
        <span className="text-xs text-archive px-1.5 py-0.5 bg-stone rounded">
          {object.type}
        </span>

        {/* Row count if available */}
        {object.row_count !== undefined && (
          <span className="text-xs text-archive">
            {formatNumber(object.row_count)} rows
          </span>
        )}

        {/* Actions for tables */}
        {isTable && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleDescribe}
              aria-expanded={showColumns}
              aria-controls={columnsId}
              aria-label={showColumns ? `Hide columns for ${object.name}` : `Show columns for ${object.name}`}
              className="p-1 hover:bg-stone rounded text-archive hover:text-ink"
            >
              {loadingDescription ? (
                <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Columns size={14} aria-hidden="true" />
              )}
            </button>
            {onPreview && (
              <button
                onClick={() => onPreview(object.id, object.name)}
                aria-label={`Preview data for ${object.name}`}
                className="p-1 hover:bg-bark/10 rounded text-bark hover:text-bark"
              >
                <Eye size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Columns list */}
      {showColumns && description && (
        <div
          id={columnsId}
          className="bg-stone border-l-2 border-lichen ml-4 my-1 py-2"
          style={{ marginLeft: `${level * 20 + 32}px` }}
        >
          <div className="text-xs font-medium text-archive px-3 pb-1">
            Columns ({description.columns.length})
          </div>
          <div className="max-h-48 overflow-y-auto">
            {description.columns.map((col) => (
              <div
                key={col.name}
                className="flex items-center gap-2 px-3 py-1 text-sm"
              >
                <span className="text-ink font-mono text-xs">{col.name}</span>
                <span className="text-archive text-xs">{col.type}</span>
                {col.primary_key && (
                  <span className="text-xs text-semantic-warning bg-semantic-warning/10 px-1 rounded">PK</span>
                )}
                {col.nullable && (
                  <span className="text-xs text-archive">nullable</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Children */}
      {expanded && children && (
        <div id={childrenId}>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              object={child}
              level={level + 1}
              instanceId={instanceId}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CatalogBrowser({ instanceId, onPreview }: CatalogBrowserProps) {
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const loadCatalog = async (refresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const result = await getConnectorCatalog(instanceId, { refresh });
      setCatalog(result);
      setHasLoaded(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  if (!hasLoaded && !loading) {
    return (
      <div className="border border-lichen rounded-lg p-6 text-center">
        <FaDatabase size={32} className="mx-auto text-archive mb-3" />
        <p className="text-accessible-gray mb-4">
          Browse database schemas, tables, and columns
        </p>
        <button
          onClick={() => loadCatalog()}
          className="px-4 py-2 bg-bark text-parchment rounded-md hover:bg-bark/10 inline-flex items-center gap-2"
        >
          <Layers size={16} aria-hidden="true" />
          Load Catalog
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="border border-lichen rounded-lg p-6 text-center">
        <RefreshCw size={24} className="mx-auto text-semantic-info animate-spin mb-3" aria-hidden="true" />
        <p className="text-accessible-gray">Loading catalog...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-semantic-error/30 bg-semantic-error/10 rounded-lg p-4">
        <p className="text-semantic-error mb-3">{error}</p>
        <button
          onClick={() => loadCatalog()}
          className="px-3 py-1.5 bg-semantic-error/10 text-semantic-error rounded hover:bg-semantic-error/20 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="border border-lichen rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lichen bg-stone">
        <div className="flex items-center gap-2">
          <FaDatabase size={18} className="text-accessible-gray" />
          <span className="font-medium text-ink">Database Catalog</span>
          {catalog?.objects && (
            <span className="text-sm text-archive">
              ({catalog.objects.length} {catalog.objects.length === 1 ? 'object' : 'objects'})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {catalog?.cached && catalog.cached_at && (
            <span className="text-xs text-archive">
              Cached {formatTime(catalog.cached_at)}
            </span>
          )}
          <button
            onClick={() => loadCatalog(true)}
            className="p-1.5 hover:bg-stone rounded text-archive hover:text-ink"
            aria-label="Refresh catalog"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="max-h-96 overflow-y-auto p-2">
        {catalog?.objects && catalog.objects.length > 0 ? (
          catalog.objects.map((obj) => (
            <TreeNode
              key={obj.id}
              object={obj}
              level={0}
              instanceId={instanceId}
              onPreview={onPreview}
            />
          ))
        ) : (
          <div className="text-center py-8 text-archive">
            No objects found in catalog
          </div>
        )}
      </div>
    </div>
  );
}
