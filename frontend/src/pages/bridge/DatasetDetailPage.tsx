import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { getDatasets, queryEntities, exportEntities, getPipelines } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useOrganization } from '../../contexts/useOrganization';
import { usePermissions } from '../../hooks/usePermissions';
import { Tooltip } from '../../components/Tooltip';
import type { EntityCurrent, EntityExportFormat } from '../../lib/schemas';
import { useProjectionConfig } from '../../hooks/useProjectionConfig';
import { resolveEntityDisplayFields } from '../../lib/projectionResolver';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateTime } from '@/lib/formatters';

export default function DatasetDetailPage() {
  const { orgId, datasetId } = useParams<{ orgId: string; datasetId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const { showToast } = useToast();

  // Check permissions
  const { hasPermission } = usePermissions();
  const canExport = hasPermission('data.export');

  // Fetch org-level projection config for display field resolution
  const { config: orgProjectionConfig } = useProjectionConfig(organizationId ?? undefined);

  const [entities, setEntities] = useState<EntityCurrent[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [expandedEntityKey, setExpandedEntityKey] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<EntityExportFormat>('jsonl');

  const observerTarget = useRef<HTMLDivElement>(null);

  // Fetch dataset info
  const { data: datasets } = useQuery({
    queryKey: ['datasets', organizationId],
    queryFn: () => getDatasets(organizationId!),
    enabled: !!organizationId,
  });

  const dataset = datasets?.find(d => d.dataset_id === datasetId);

  // Fetch pipelines for this organization to show dependencies
  const { data: pipelines } = useQuery({
    queryKey: ['pipelines', organizationId],
    queryFn: () => getPipelines(organizationId!),
    enabled: !!organizationId,
  });

  // Filter pipelines that use this dataset
  const pipelinesUsingDataset = pipelines?.filter(p => p.dataset_id === datasetId) || [];

  // Load initial entities
  const { data: initialData, isLoading } = useQuery({
    queryKey: ['entities', organizationId, datasetId],
    queryFn: async () => {
      if (!organizationId || !datasetId) return null;
      return await queryEntities({
        organization_id: organizationId,
        dataset_id: [datasetId],
        limit: 50,
      });
    },
    enabled: !!organizationId && !!datasetId,
  });

  // Set initial data
  useEffect(() => {
    if (initialData) {
      setEntities(initialData.items);
      setCursor(initialData.next_cursor);
      setHasMore(!!initialData.next_cursor);
    }
  }, [initialData]);

  // Load more entities
  const loadMore = useCallback(async () => {
    if (!organizationId || !datasetId || !cursor || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const result = await queryEntities({
        organization_id: organizationId,
        dataset_id: [datasetId],
        limit: 50,
        cursor,
      });

      setEntities(prev => [...prev, ...result.items]);
      setCursor(result.next_cursor);
      setHasMore(!!result.next_cursor);
    } catch (err) {
      logger.error('Failed to load more entities:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [organizationId, datasetId, cursor, isLoadingMore]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [loadMore, hasMore, isLoadingMore]);

  const handleExport = async () => {
    if (!organizationId || !datasetId) return;

    try {
      const blob = await exportEntities({
        organization_id: organizationId,
        dataset_id: [datasetId],
        format: exportFormat,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset?.name || 'dataset'}-export.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setShowExportModal(false);
    } catch (err) {
      logger.error('Export failed:', err);
      showToast({ type: 'error', title: 'Error', message: `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
  };

  const toggleExpand = (entityKey: string) => {
    setExpandedEntityKey(expandedEntityKey === entityKey ? null : entityKey);
  };

  // Get display fields for an entity using projection resolver
  // This replaces hardcoded LOC/Smithsonian-specific paths with configurable resolution
  // Get display fields using org-level canonical display config
  const getEntityDisplay = useMemo(() => {
    return (entity: EntityCurrent) => {
      return resolveEntityDisplayFields(entity, 'entities_list', null, orgProjectionConfig);
    };
  }, [orgProjectionConfig]);

  const getEntityTitle = (entity: EntityCurrent): string => {
    // Use projection resolver for title
    return getEntityDisplay(entity).title;
  };

  const getEntitySubtitle = (entity: EntityCurrent): string | undefined => {
    // Use projection resolver for subtitle (controlled by org config)
    return getEntityDisplay(entity).subtitle;
  };

  const formatDate = (dateString: string) => formatDateTime(dateString);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="space-y-6">
        <div className="text-archive">Dataset not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to={`/organizations/${organizationId}/bridge/datasets`}
            className="text-archive hover:text-ink"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-ink">{dataset.name}</h1>
            {dataset.description && (
              <p className="mt-1 text-sm text-accessible-gray">{dataset.description}</p>
            )}
            <p className="mt-1 text-xs text-archive">Canonical dataset and record state</p>
          </div>
        </div>
                {/* Export Button */}
        <Tooltip
          content="You need the 'data.export' permission to export data"
          disabled={!canExport}
        >
          <button
            onClick={() => setShowExportModal(true)}
            disabled={!canExport}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              border: '1px solid #D8D2C8',
              background: 'transparent',
              color: !canExport ? 'rgb(var(--color-archive))' : 'rgb(var(--color-archive))',
              fontSize: '13px',
              fontWeight: 400,
              borderRadius: '4px',
              cursor: !canExport ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              opacity: !canExport ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (canExport) {
                e.currentTarget.style.background = 'rgb(var(--color-parchment))';
                e.currentTarget.style.borderColor = 'rgb(var(--color-archive))';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgb(var(--color-stone))';
            }}
          >
            <Download className="h-4 w-4" />
            Export snapshot
          </button>
        </Tooltip>
      </div>

      {/* Used by Pipelines */}
      <div className="bg-parchment border border-lichen rounded-lg p-4">
        <h3 className="text-sm font-medium text-ink mb-3">Used by Pipelines</h3>
        {pipelinesUsingDataset.length > 0 ? (
          <div className="space-y-2">
            {pipelinesUsingDataset.map((pipeline) => (
                <Link
                  key={pipeline.pipeline_id}
                  to={`/organizations/${organizationId}/pipelines/${pipeline.pipeline_id}`}
                  className="flex items-center justify-between p-2 hover:bg-stone rounded-md border border-lichen text-sm"
                >
                  <span className="text-ink">{pipeline.name}</span>
                  <span className="text-archive">→</span>
                </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-archive italic">Not used by any pipelines</p>
        )}
      </div>

      {/* Data Grid */}
      <div className="bg-parchment shadow overflow-hidden sm:rounded-lg">
        <div className="border-b border-lichen">
          <div className="px-6 py-3 bg-stone">
            <div className="grid grid-cols-12 gap-4 text-xs font-medium text-archive uppercase tracking-wider">
              <div className="col-span-5">Title</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-2">Source</div>
              <div className="col-span-2">Updated</div>
              <div className="col-span-1"></div>
            </div>
          </div>
        </div>

        <div className="divide-y divide-lichen">
          {entities.map((entity, _index) => {
            const isExpanded = expandedEntityKey === entity.entity_key;

            return (
              <div key={entity.entity_key}>
                <div className="px-6 py-4 hover:bg-stone">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-5 min-w-0">
                      <Link
                        to={`/organizations/${organizationId}/bridge/entities/${encodeURIComponent(entity.entity_key)}`}
                        style={{ textDecoration: 'none' }}
                        className="text-sm font-medium text-ink hover:text-bark truncate block"
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        {getEntityTitle(entity)}
                      </Link>
                      <p className="text-xs text-archive truncate">
                        {entity.entity_key}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-stone text-ink">
                        {getEntitySubtitle(entity) || entity.entity_type}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm text-ink">{entity.source_system}</p>
                      <p className="text-xs text-archive">{entity.source_id}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm text-ink">{formatDate(entity.updated_at)}</p>
                    </div>
                    <div className="col-span-1 text-right">
                      <button
                        onClick={() => toggleExpand(entity.entity_key)}
                        className="text-archive hover:text-ink"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5" />
                        ) : (
                          <ChevronDown className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded JSON View */}
                {isExpanded && (
                  <div className="px-6 py-4 bg-stone border-t border-lichen">
                    <pre className="text-xs overflow-auto max-h-96 p-4 bg-ink text-semantic-success rounded">
                      {JSON.stringify(entity.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Loading Indicator */}
        {isLoadingMore && (
          <div className="px-6 py-4 text-center text-sm text-archive">
            <MadronaLoader variant="dots" label="Loading more..." />
          </div>
        )}

        {/* Intersection Observer Target */}
        <div ref={observerTarget} className="h-4" />

        {/* End Message */}
        {!hasMore && entities.length > 0 && (
          <div className="px-6 py-4 text-center text-sm text-archive">
            Showing all {entities.length} records
          </div>
        )}

        {/* Empty State */}
        {entities.length === 0 && !isLoading && (
          <div className="px-6 py-12 text-center text-sm text-archive">
            No records found
          </div>
        )}
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-stone0 bg-opacity-75 transition-opacity"
              onClick={() => setShowExportModal(false)}
            />

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

            <div className="inline-block align-bottom bg-parchment rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div>
                <div className="mt-3 text-center sm:mt-0 sm:text-left">
                  <h3 className="text-lg leading-6 font-medium text-ink">
                    Export Dataset
                  </h3>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-ink mb-2">
                        Export Format
                      </label>
                      <select
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as EntityExportFormat)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-lichen focus-visible:outline-none focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark/30 sm:text-sm rounded-md"
                      >
                        <option value="jsonl">JSONL (Newline-delimited JSON)</option>
                        <option value="json">JSON (Array format, max 10k records)</option>
                      </select>
                      <p className="mt-2 text-sm text-archive">
                        {exportFormat === 'jsonl'
                          ? 'Newline-delimited format - one record per line'
                          : 'Standard JSON array format, limited to 10,000 records'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                <button
                  type="button"
                  onClick={handleExport}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-bark text-base font-medium text-parchment hover:bg-bark/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-bark/30 sm:col-start-2 sm:text-sm"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-lichen shadow-sm px-4 py-2 bg-parchment text-base font-medium text-ink hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-bark/30 sm:mt-0 sm:col-start-1 sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
