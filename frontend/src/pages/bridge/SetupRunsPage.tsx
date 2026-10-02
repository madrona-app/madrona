/**
 * Pipeline Runs Page
 *
 * Operational monitor for pipeline execution history.
 * Shows recent runs across all pipelines with status, timing, and navigation.
 */
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Play, CheckCircle2, XCircle, Clock, AlertCircle, GitBranch } from 'lucide-react';
import { getRuns, getPipelines } from '../../lib/api';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { useOrganization } from '../../contexts/useOrganization';
import type { Run } from '../../lib/schemas';
import { formatDateTime } from '@/lib/formatters';

export default function SetupRunsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;

  // Fetch recent runs
  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['runs', organizationId],
    queryFn: () => organizationId ? getRuns({ organization_id: organizationId, limit: 20, offset: 0 }) : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 }),
    enabled: !!organizationId,
    refetchInterval: (query) => {
      const runs = query.state.data?.items;
      if (!runs || runs.length === 0) return false;
      const hasActiveRun = runs.some((run: Run) =>
        ['pending', 'queued', 'running', 'publishing'].includes(run.status)
      );
      return hasActiveRun ? 3000 : false;
    },
  });

  // Fetch pipelines to display names
  const { data: pipelines } = useQuery({
    queryKey: ['pipelines', organizationId],
    queryFn: () => getPipelines(organizationId || undefined),
    enabled: !!organizationId,
  });

  const runs = runsData?.items || [];

  // Create a map of pipeline IDs to names
  const pipelineNames = new Map<string, string>();
  pipelines?.forEach((pipeline) => {
    pipelineNames.set(pipeline.pipeline_id, pipeline.name || 'Unnamed Pipeline');
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 size={18} className="text-semantic-success" />;
      case 'failed':
      case 'failed_publish':
      case 'failed_finalize':
        return <XCircle size={18} className="text-semantic-error" />;
      case 'warning':
        return <AlertCircle size={18} className="text-semantic-warning" />;
      case 'running':
      case 'publishing':
        return <Clock size={18} className="text-semantic-info animate-spin" />;
      case 'pending':
      case 'queued':
        return <Clock size={18} className="text-stone-400" />;
      default:
        return <Clock size={18} className="text-stone-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'success': return 'Success';
      case 'failed': return 'Failed';
      case 'failed_publish': return 'Publish Failed';
      case 'failed_finalize': return 'Finalize Failed';
      case 'warning': return 'Warning';
      case 'running': return 'Running';
      case 'publishing': return 'Publishing';
      case 'pending': return 'Pending';
      case 'queued': return 'Queued';
      case 'canceled': return 'Canceled';
      default: return status;
    }
  };

  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const isLoading = runsLoading;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Play className="w-6 h-6 text-forest" style={{ opacity: 0.6 }} />
            <h1 className="text-2xl font-bold text-stone-900">Pipeline Runs</h1>
          </div>
          <p className="text-stone-600">Execution history for your pipelines.</p>
        </div>
        <Link
          to={`/organizations/${organizationId}/bridge/runs`}
          className="text-sm text-stone-600 hover:text-stone-800"
        >
          View full history →
        </Link>
      </div>

      {isLoading ? (
        <MadronaLoader variant="dots" label="Loading runs..." />
      ) : runs.length > 0 ? (
        <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
          {/* Table Header */}
          <div className="bg-stone-50 border-b border-stone-200 px-4 py-3">
            <div className="grid grid-cols-12 gap-4 items-center text-xs font-medium text-stone-500 uppercase tracking-wider">
              <div className="col-span-1">Status</div>
              <div className="col-span-4">Pipeline</div>
              <div className="col-span-3">Started</div>
              <div className="col-span-2">Duration</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-stone-200">
            {runs.map((run: Run, _index: number) => {
              const pipelineName = run.pipeline_id ? pipelineNames.get(run.pipeline_id) || 'Unknown Pipeline' : 'Manual Run';

              return (
                <div
                  key={run.run_id}
                  className="px-4 py-3 hover:bg-stone-50 transition-colors"
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Status */}
                    <div className="col-span-1 flex items-center gap-2">
                      {getStatusIcon(run.status)}
                    </div>

                    {/* Pipeline */}
                    <div className="col-span-4">
                      <div className="flex items-center gap-2">
                        <GitBranch size={14} className="text-stone-400" />
                        <span className="font-medium text-stone-900 truncate" title={pipelineName}>
                          {pipelineName}
                        </span>
                      </div>
                      <div className="text-xs text-stone-500 mt-0.5">
                        {getStatusLabel(run.status)}
                      </div>
                    </div>

                    {/* Started */}
                    <div className="col-span-3 text-sm text-stone-600">
                      {run.started_at ? formatDateTime(run.started_at) : 'Not started'}
                    </div>

                    {/* Duration */}
                    <div className="col-span-2 text-sm text-stone-600">
                      {formatDuration(run.duration_ms)}
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 text-right">
                      <Link
                        to={`/organizations/${organizationId}/bridge/runs/${run.run_id}`}
                        className="text-sm text-semantic-info hover:text-semantic-info"
                      >
                        View details
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-parchment border border-stone-200 rounded-lg p-8 text-center">
          <GitBranch size={48} className="text-stone-300 mx-auto mb-3" />
          <h3 className="font-medium text-stone-900 mb-2">No pipeline runs yet</h3>
          <p className="text-stone-600 mb-4 text-sm">
            Runs will appear here when your pipelines execute.
          </p>
          <Link
            to={`/organizations/${organizationId}/bridge/setup/pipelines`}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Play size={16} />
            Configure Pipelines
          </Link>
        </div>
      )}
    </div>
  );
}
