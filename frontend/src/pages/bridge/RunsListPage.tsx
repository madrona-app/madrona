import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRuns, getDatasets, deleteRun, getPipelines } from '../../lib/api';
import { getStatusLabel, getStatusColor } from '../../lib/utils';
import type { Dataset, Pipeline } from '../../lib/schemas';
import { useOrganization } from '../../contexts/useOrganization';
import { usePermissions } from '../../hooks/usePermissions';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateWithTimezone } from '../../lib/timezone';
import { useRunUpdates } from '../../hooks/useRunUpdates';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { Trash2, X } from 'lucide-react';
import { logger } from '../../lib/logger';
import { formatNumber } from '@/lib/formatters';

export default function RunsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { timezone } = useTimezone();
  const queryClient = useQueryClient();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [datasetFilter, setDatasetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [limit] = useState(9);
  const [offset, setOffset] = useState(0);
  const [deleteConfirmRunId, setDeleteConfirmRunId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canDeleteRuns = hasPermission('runs.delete');
  const { isConnected } = useWebSocket();

  // Use React Query for runs with polling fallback
  const { data: runsData, isLoading: loading, refetch } = useQuery({
    queryKey: ['runs', organizationId, datasetFilter, statusFilter, limit, offset],
    queryFn: () => getRuns({
      organization_id: organizationId!,
      dataset_id: datasetFilter || undefined,
      status: statusFilter || undefined,
      limit,
      offset,
    }),
    enabled: !!organizationId,
    // Only poll as fallback when WebSocket is not connected
    refetchInterval: (query) => {
      if (isConnected) return false; // WebSocket handles updates
      const runs = query.state.data?.items;
      if (!runs || runs.length === 0) return false;
      // Poll every 2 seconds if any run is actively processing
      const hasActiveRun = runs.some(run =>
        ['pending', 'queued', 'running', 'publishing'].includes(run.status)
      );
      return hasActiveRun ? 2000 : false;
    },
  });

  // Handle real-time run updates via WebSocket
  const handleRunUpdate = useCallback(() => {
    // Refetch runs list when any run updates
    refetch();
  }, [refetch]);

  // Subscribe to all run updates (no specific filter for list page)
  useRunUpdates({
    onUpdate: handleRunUpdate,
  });

  const runs = runsData?.items || [];
  const totalCount = runsData?.total || 0;
  const totalPages = Math.ceil(totalCount / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  // Load datasets and pipelines for context
  useEffect(() => {
    const fetchContext = async () => {
      if (!organizationId) return;
      try {
        const [datasetsData, pipelinesData] = await Promise.all([
          getDatasets(organizationId),
          getPipelines(organizationId)
        ]);
        setDatasets(datasetsData);
        setPipelines(pipelinesData);
      } catch (err) {
        logger.error('Failed to fetch context:', err);
      }
    };
    fetchContext();
  }, [organizationId]);

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  const handleNextPage = () => {
    if (offset + limit < totalCount) {
      setOffset(offset + limit);
    }
  };

  const handleDatasetFilterChange = (value: string) => {
    setDatasetFilter(value);
    setOffset(0);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setOffset(0);
  };

  const handleDeleteRun = async (runId: string) => {
    if (!organizationId) return;

    setDeleting(true);
    try {
      await deleteRun(runId, organizationId);
      setDeleteConfirmRunId(null);
      queryClient.invalidateQueries({ queryKey: ['runs', organizationId] });
    } catch (err) {
      logger.error('Failed to delete run:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete run');
    } finally {
      setDeleting(false);
    }
  };

  const formatDuration = (durationMs: number | null | undefined) => {
    if (!durationMs) return '\u2014';
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const handleRowClick = (runId: string) => {
    navigate(`/organizations/${organizationId}/bridge/runs/${runId}`);
  };

  return (
    <div>
      {/* Content */}
      <div className="max-w-screen-xl mx-auto">
        <div className="mb-8">
          <h2 className="m-0 text-2xl font-bold text-forest font-serif">Run History</h2>
          <p className="mt-2 mb-0 text-archive text-[15px]">
            Execution history for your pipelines
          </p>
        </div>

        {/* Filters */}
        <div className="flex gap-5 mb-8 bg-parchment p-6 border border-lichen rounded-xl shadow-sm">
          <div className="flex-1">
            <label htmlFor="runs-dataset-filter" className="block text-xs font-semibold text-ink mb-2.5">Filter by Dataset</label>
            <select
              id="runs-dataset-filter"
              value={datasetFilter}
              onChange={(e) => handleDatasetFilterChange(e.target.value)}
              className="w-full px-3.5 py-2.5 border-2 border-lichen rounded-lg text-sm bg-parchment cursor-pointer transition-colors focus-visible:outline-none focus-visible:border-bark focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">All Datasets</option>
              {datasets.map((dataset) => (
                <option key={dataset.dataset_id} value={dataset.dataset_id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="runs-status-filter" className="block text-xs font-semibold text-ink mb-2.5">Filter by Status</label>
            <select
              id="runs-status-filter"
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className="w-full px-3.5 py-2.5 border-2 border-lichen rounded-lg text-sm bg-parchment cursor-pointer transition-colors focus-visible:outline-none focus-visible:border-bark focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">All Statuses</option>
              <option value="success">All set</option>
              <option value="running">In Progress</option>
              <option value="pending">Waiting</option>
              <option value="queued">Queued</option>
              <option value="publishing">Publishing</option>
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="p-5 bg-semantic-error/5 border-2 border-semantic-error/20 rounded-xl mb-6 flex items-start gap-3">
            <div>
              <p className="m-0 mb-1 text-semantic-error text-[15px] font-semibold">Unable to Load Runs</p>
              <p className="m-0 text-semantic-error text-sm">{error}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 bg-parchment rounded-xl border border-lichen">
            <p className="m-0 text-archive text-[15px] font-medium">Loading history...</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-16 px-8 bg-parchment border border-lichen rounded-xl">
            <p className="m-0 mb-2 text-ink text-lg font-semibold">No Runs Yet</p>
            <p className="m-0 text-archive text-sm">
              Pipeline runs will appear here once you run your first pipeline.
            </p>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="bg-parchment border border-lichen rounded-xl overflow-hidden shadow-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gradient-to-b from-parchment to-stone/30 border-b-2 border-lichen">
                    <th className="px-5 py-4 text-left text-xs font-semibold text-archive">
                      Dataset
                    </th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-archive">
                      When
                    </th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-archive">
                      Status
                    </th>
                    <th className="px-5 py-4 text-right text-xs font-semibold text-archive">
                      Duration
                    </th>
                    <th className="px-5 py-4 text-right text-xs font-semibold text-archive">
                      New
                    </th>
                    <th className="px-5 py-4 text-right text-xs font-semibold text-archive">
                      Updated
                    </th>
                    <th className="px-5 py-4 text-right text-xs font-semibold text-archive">
                      Unchanged
                    </th>
                    <th className="px-5 py-4 text-left text-xs font-semibold text-archive">
                      Published
                    </th>
                    {canDeleteRuns && (
                      <th className="px-5 py-4 text-center text-xs font-semibold text-archive w-20">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run, index) => {
                    const statusColor = getStatusColor(run.status);
                    const pipeline = pipelines.find(p => p.pipeline_id === run.pipeline_id);
                    const dataset = datasets.find(d => d.dataset_id === pipeline?.dataset_id);
                    const isRunActive = ['queued', 'running', 'publishing'].includes(run.status);
                    return (
                      <tr
                        key={run.run_id}
                        onClick={() => handleRowClick(run.run_id)}
                        className={`cursor-pointer transition-colors hover:bg-stone/30 ${
                          index < runs.length - 1 ? 'border-b border-lichen/50' : ''
                        }`}
                      >
                        <td className="px-5 py-4.5 text-sm text-ink font-semibold">
                          {dataset?.name || 'Unknown Dataset'}
                        </td>
                        <td className="px-5 py-4.5 text-sm text-ink font-medium">
                          {run.started_at ? formatDateWithTimezone(run.started_at, timezone) : '\u2014'}
                        </td>
                        <td className="px-5 py-4.5">
                          <span
                            className={`status-badge status-${statusColor} inline-block px-3.5 py-1.5 rounded-2xl text-xs font-semibold tracking-wide`}
                          >
                            {getStatusLabel(run.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4.5 text-right text-sm text-archive font-medium">
                          {formatDuration(run.duration_ms)}
                        </td>
                        <td className="px-5 py-4.5 text-right text-sm text-ink font-medium">
                          {run.counts ? formatNumber(run.counts.created) : '\u2014'}
                        </td>
                        <td className="px-5 py-4.5 text-right text-sm text-ink font-medium">
                          {run.counts ? formatNumber(run.counts.updated) : '\u2014'}
                        </td>
                        <td className="px-5 py-4.5 text-right text-sm text-archive font-medium">
                          {run.counts ? formatNumber(run.counts.noop) : '\u2014'}
                        </td>
                        <td className="px-5 py-4.5 text-sm text-archive">
                          {run.published_at ? formatDateWithTimezone(run.published_at, timezone) : '\u2014'}
                        </td>
                        {canDeleteRuns && (
                          <td
                            className="px-5 py-4.5 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => setDeleteConfirmRunId(run.run_id)}
                              disabled={isRunActive}
                              className={`p-1.5 bg-transparent border-none rounded inline-flex items-center justify-center transition-all ${
                                isRunActive
                                  ? 'cursor-not-allowed text-lichen opacity-50'
                                  : 'cursor-pointer text-semantic-error hover:bg-semantic-error/10'
                              }`}
                              title={isRunActive ? 'Cannot delete running runs' : 'Delete run'}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-lichen">
                <div className="text-sm text-archive">
                  Showing <span className="text-ink font-medium">{offset + 1}</span>{'\u2013'}<span className="text-ink font-medium">{Math.min(offset + limit, totalCount)}</span> of{" "}
                  <span className="text-ink font-medium">{totalCount}</span> runs
                </div>

                <div className="flex items-center gap-3 text-sm">
                  {/* Previous Link */}
                  <button
                    onClick={handlePrevPage}
                    disabled={offset === 0}
                    aria-label="Previous page"
                    className={`px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
                      offset === 0
                        ? 'text-archive opacity-40 cursor-not-allowed'
                        : 'text-archive hover:text-ink hover:underline underline-offset-4'
                    }`}
                  >
                    Previous
                  </button>

                  {/* Page Numbers */}
                  <div className="flex items-center gap-2">
                    {/* First page */}
                    {currentPage > 2 && (
                      <>
                        <button
                          onClick={() => setOffset(0)}
                          aria-label="Page 1"
                          className="px-1.5 py-0.5 rounded text-archive hover:text-ink hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        >
                          1
                        </button>
                        {currentPage > 3 && <span className="text-stone px-1">...</span>}
                      </>
                    )}

                    {/* Pages around current */}
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(page =>
                        page === currentPage ||
                        page === currentPage - 1 ||
                        page === currentPage + 1
                      )
                      .map(page => (
                        <button
                          key={page}
                          onClick={() => setOffset((page - 1) * limit)}
                          aria-label={`Page ${page}`}
                          aria-current={page === currentPage ? "page" : undefined}
                          className={`px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
                            page === currentPage
                              ? 'text-ink font-medium underline underline-offset-4 decoration-ink decoration-1'
                              : 'text-archive hover:text-ink hover:underline underline-offset-4'
                          }`}
                        >
                          {page}
                        </button>
                      ))}

                    {/* Last page */}
                    {currentPage < totalPages - 1 && (
                      <>
                        {currentPage < totalPages - 2 && <span className="text-stone px-1">...</span>}
                        <button
                          onClick={() => setOffset((totalPages - 1) * limit)}
                          aria-label={`Page ${totalPages}`}
                          className="px-1.5 py-0.5 rounded text-archive hover:text-ink hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        >
                          {totalPages}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Next Link */}
                  <button
                    onClick={handleNextPage}
                    disabled={offset + limit >= totalCount}
                    aria-label="Next page"
                    className={`px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
                      offset + limit >= totalCount
                        ? 'text-archive opacity-40 cursor-not-allowed'
                        : 'text-archive hover:text-ink hover:underline underline-offset-4'
                    }`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmRunId && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-center justify-center z-[1000]"
          onClick={() => !deleting && setDeleteConfirmRunId(null)}
        >
          <div
            className="bg-parchment rounded-xl p-6 max-w-[480px] w-[90%] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start mb-4">
              <div className="shrink-0 w-12 h-12 rounded-full bg-semantic-error/10 flex items-center justify-center mr-4">
                <Trash2 size={24} className="text-semantic-error" />
              </div>
              <div className="flex-1">
                <h3 className="m-0 mb-2 text-lg font-semibold text-ink">
                  Delete Run
                </h3>
                <p className="m-0 text-sm text-archive leading-relaxed">
                  Are you sure you want to delete this run? This action cannot be undone. All associated data will be permanently removed.
                </p>
              </div>
              <button
                onClick={() => setDeleteConfirmRunId(null)}
                disabled={deleting}
                className={`p-1 bg-transparent border-none rounded flex items-center justify-center ml-3 text-archive hover:text-ink ${
                  deleting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex gap-3 ml-16">
              <button
                onClick={() => setDeleteConfirmRunId(null)}
                disabled={deleting}
                className={`flex-1 py-2.5 px-4 bg-parchment border border-lichen rounded-lg text-sm font-medium text-ink transition-all hover:bg-stone/30 ${
                  deleting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteRun(deleteConfirmRunId)}
                disabled={deleting}
                className={`flex-1 py-2.5 px-4 border-none rounded-lg text-sm font-medium text-parchment transition-all ${
                  deleting
                    ? 'bg-semantic-error/70 cursor-not-allowed'
                    : 'bg-semantic-error cursor-pointer hover:bg-semantic-error/90'
                }`}
              >
                {deleting ? 'Deleting...' : 'Delete Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
