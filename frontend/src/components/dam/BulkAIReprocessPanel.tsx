import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Zap,
} from 'lucide-react';
import { bulkReprocessAITags, type AITaggingStats } from '../../lib/api';

interface BulkAIReprocessPanelProps {
  organizationId: string;
  stats: AITaggingStats;
  canEdit: boolean;
}

/**
 * Bulk AI Reprocessing Panel
 *
 * Provides controls for bulk reprocessing media with AI tagging,
 * including status filters and batch size options.
 */
export function BulkAIReprocessPanel({
  organizationId,
  stats,
  canEdit,
}: BulkAIReprocessPanelProps) {
  const queryClient = useQueryClient();

  // State
  const [statusFilter, setStatusFilter] = useState<'pending' | 'failed' | 'all'>('pending');
  const [batchSize, setBatchSize] = useState<number>(50);
  const [lastResult, setLastResult] = useState<{ queued: number; taskId: string } | null>(null);

  // Reprocess mutation
  const reprocessMutation = useMutation({
    mutationFn: () =>
      bulkReprocessAITags(organizationId, {
        status_filter: statusFilter === 'all' ? undefined : statusFilter,
        limit: batchSize,
      }),
    onSuccess: (data) => {
      setLastResult({ queued: data.queued_count, taskId: data.task_id });
      queryClient.invalidateQueries({ queryKey: ['ai-tagging-stats', organizationId] });
    },
  });

  const handleProcess = () => {
    setLastResult(null);
    reprocessMutation.mutate();
  };

  // Calculate counts for each filter
  const pendingCount = stats.pending_count || 0;
  const failedCount = stats.failed_count || 0;
  const totalToProcess = statusFilter === 'pending' ? pendingCount : statusFilter === 'failed' ? failedCount : pendingCount + failedCount;

  if (!canEdit) {
    return null;
  }

  if (totalToProcess === 0 && statusFilter !== 'all') {
    return null;
  }

  return (
    <div className="mt-6 p-4 bg-stone/20 border border-lichen rounded-lg">
      <div className="flex items-center gap-2 mb-4">
        <Zap size={18} className="text-forest" />
        <h4 className="font-medium text-ink">Bulk Processing</h4>
      </div>

      <div className="space-y-4">
        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-accessible-gray">Process:</label>
            <div className="flex rounded-lg border border-lichen overflow-hidden">
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-3 py-1.5 text-sm ${
                  statusFilter === 'pending'
                    ? 'bg-forest text-parchment'
                    : 'bg-parchment text-ink hover:bg-stone/20'
                }`}
              >
                <Clock size={12} className="inline mr-1" />
                Pending ({pendingCount})
              </button>
              <button
                onClick={() => setStatusFilter('failed')}
                className={`px-3 py-1.5 text-sm border-l border-lichen ${
                  statusFilter === 'failed'
                    ? 'bg-forest text-parchment'
                    : 'bg-parchment text-ink hover:bg-stone/20'
                }`}
              >
                <AlertCircle size={12} className="inline mr-1" />
                Failed ({failedCount})
              </button>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 text-sm border-l border-lichen ${
                  statusFilter === 'all'
                    ? 'bg-forest text-parchment'
                    : 'bg-parchment text-ink hover:bg-stone/20'
                }`}
              >
                All ({pendingCount + failedCount})
              </button>
            </div>
          </div>

          {/* Batch Size */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-accessible-gray">Batch size:</label>
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(parseInt(e.target.value))}
              className="px-2 py-1.5 text-sm border border-lichen rounded bg-parchment"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </div>
        </div>

        {/* Process Button & Status */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleProcess}
            disabled={reprocessMutation.isPending || totalToProcess === 0}
            className="flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reprocessMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Queueing...
              </>
            ) : (
              <>
                <Play size={16} />
                Process {Math.min(batchSize, totalToProcess)} Items
              </>
            )}
          </button>

          {totalToProcess > batchSize && (
            <span className="text-sm text-accessible-gray">
              {totalToProcess - batchSize} more items remaining after this batch
            </span>
          )}
        </div>

        {/* Result Message */}
        {lastResult && reprocessMutation.isSuccess && (
          <div className="flex items-center gap-2 p-3 bg-semantic-success/10 border border-semantic-success/20 rounded-lg">
            <CheckCircle size={16} className="text-semantic-success" />
            <span className="text-sm text-semantic-success">
              Successfully queued {lastResult.queued} items for processing
            </span>
          </div>
        )}

        {reprocessMutation.isError && (
          <div className="flex items-center gap-2 p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-lg">
            <AlertCircle size={16} className="text-semantic-error" />
            <span className="text-sm text-semantic-error">
              {reprocessMutation.error instanceof Error
                ? reprocessMutation.error.message
                : 'Failed to queue items for processing'}
            </span>
          </div>
        )}

        {/* Info */}
        <p className="text-xs text-accessible-gray">
          Items are processed in the background. Refresh this page to see updated stats.
          Processing speed depends on the number of enabled detection features.
        </p>
      </div>
    </div>
  );
}
