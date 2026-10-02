import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  FileSpreadsheet,
  X,
} from 'lucide-react';
import { MadronaLoader } from '../ui/MadronaLoader';
import { useOrganization } from '../../contexts/useOrganization';
import { useToast } from '../../contexts/ToastContext';
import { getReportRuns, downloadReport, cancelReportRun, dismissReportRun } from '../../lib/api/on-demand-reports';
import type { ReportRun } from '../../lib/api/on-demand-reports';
import { ApiError } from '../../lib/apiClient';
import { formatRelativeTime, formatNumber } from '@/lib/formatters';

export interface ReportRunsPanelProps {
  /** Refetch trigger - increment to force refresh */
  refreshKey?: number;
}

const STATUS_CONFIG: Record<string, {
  icon: typeof Loader2 | null;
  className: string;
  label: string;
}> = {
  pending: { icon: Clock, className: 'text-semantic-warning', label: 'Pending' },
  running: { icon: null, className: 'text-semantic-info', label: 'Generating...' },
  completed: { icon: CheckCircle, className: 'text-semantic-success', label: 'Ready' },
  failed: { icon: AlertCircle, className: 'text-semantic-error', label: 'Failed' },
  cancelled: { icon: AlertCircle, className: 'text-archive', label: 'Cancelled' },
};


function ReportRunRow({ run }: { run: ReportRun }) {
  const { activeOrganizationId } = useOrganization();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const isActive = run.status === 'pending' || run.status === 'running';
  const config = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  const handleDownload = useCallback(async () => {
    if (!activeOrganizationId || !run.has_download) return;
    setIsDownloading(true);
    try {
      await downloadReport(activeOrganizationId, run.run_id);
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Download failed',
        message: error instanceof Error ? error.message : 'Could not download report. Please try again.',
      });
    } finally {
      setIsDownloading(false);
    }
  }, [activeOrganizationId, run.run_id, run.has_download, showToast]);

  const handleRemove = useCallback(async () => {
    if (!activeOrganizationId) return;
    setIsRemoving(true);
    try {
      if (isActive) {
        await cancelReportRun(activeOrganizationId, run.run_id);
      } else {
        await dismissReportRun(activeOrganizationId, run.run_id);
      }
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Could not reach the server. Please check your connection and try again.';
      showToast({
        type: 'error',
        title: isActive ? 'Cancel failed' : 'Dismiss failed',
        message,
      });
    } finally {
      queryClient.invalidateQueries({ queryKey: ['on-demand-reports', 'runs'] });
      setIsRemoving(false);
    }
  }, [activeOrganizationId, run.run_id, isActive, queryClient, showToast]);

  // Build a human-readable report name from the key
  const reportName = run.report_key
    ? run.report_key
        .replace(/_tabular$/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Report';

  return (
    <div className="flex items-center gap-3 p-3 border border-lichen rounded-institutional hover:bg-stone/20 transition-colors">
      {StatusIcon ? (
        <StatusIcon size={18} className={config.className} />
      ) : (
        <MadronaLoader variant="dots" dotSize={4} />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{reportName}</p>
        <div className="flex items-center gap-2 text-xs text-archive">
          <span>{config.label}</span>
          {run.export_format && (
            <>
              <span className="text-lichen">|</span>
              <span>{run.export_format.toUpperCase()}</span>
            </>
          )}
          {run.row_count !== null && run.status === 'completed' && (
            <>
              <span className="text-lichen">|</span>
              <span>{formatNumber(run.row_count)} rows</span>
            </>
          )}
          {run.created_at && (
            <>
              <span className="text-lichen">|</span>
              <span>{formatRelativeTime(run.created_at)}</span>
            </>
          )}
        </div>
        {run.error_message && (
          <p className="text-xs text-semantic-error mt-1 truncate">{run.error_message}</p>
        )}
      </div>

      {run.has_download && (
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="p-2 text-bark hover:text-copper-dark hover:bg-bark/5 rounded-institutional transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          title="Download report"
          aria-label="Download report"
        >
          {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        </button>
      )}

      <button
        type="button"
        onClick={handleRemove}
        disabled={isRemoving}
        className="p-2 text-archive hover:text-semantic-error hover:bg-semantic-error/5 rounded-institutional transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        title={isActive ? 'Cancel report' : 'Dismiss'}
        aria-label={isActive ? 'Cancel report' : 'Dismiss'}
      >
        {isRemoving ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
      </button>
    </div>
  );
}

export function ReportRunsPanel({ refreshKey }: ReportRunsPanelProps) {
  const { activeOrganizationId } = useOrganization();

  const { data, isLoading, error } = useQuery({
    queryKey: ['on-demand-reports', 'runs', activeOrganizationId, refreshKey],
    queryFn: () => getReportRuns(activeOrganizationId!, { limit: 20 }),
    enabled: !!activeOrganizationId,
    // Poll while there are pending/running reports
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const runs = query.state.data?.items;
      if (runs?.some((r) => r.status === 'pending' || r.status === 'running')) {
        return 5000;
      }
      return false;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle size={28} className="mx-auto text-semantic-error mb-2" />
        <p className="text-sm text-semantic-error">Failed to load reports</p>
        <p className="text-xs text-archive mt-1">Please try again later.</p>
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <div className="text-center py-8">
        <FileSpreadsheet size={28} className="mx-auto text-archive mb-2" />
        <p className="text-sm text-archive">No recent reports.</p>
        <p className="text-xs text-archive mt-1">
          Generate a report from search results, a workspace, or a record.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.items.map((run) => (
        <ReportRunRow key={run.run_id} run={run} />
      ))}
    </div>
  );
}

export default ReportRunsPanel;
