import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { getMediaProcessingStatus, retryProcessingJob } from '../../lib/api';
import type { ProcessingStep } from '../../lib/schemas';
import { cn } from '../../lib/utils';
import { MadronaLoader } from '../ui/MadronaLoader';
import { formatDateTime } from '@/lib/formatters';

interface ProcessingHistoryTabProps {
  organizationId: string;
  mediaId: string;
}

const JOB_TYPE_LABELS: Record<string, string> = {
  derivatives: 'Image Processing',
  transcode: 'Video Transcoding',
  model_3d_process: '3D Model Processing',
  metadata_extract: 'Metadata Extraction',
  regenerate: 'Derivative Regeneration',
  watermark: 'Watermark Application',
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  completed: { icon: CheckCircle2, color: 'text-semantic-success', bg: 'bg-semantic-success/10', label: 'Completed' },
  processing: { icon: RefreshCw, color: 'text-semantic-info', bg: 'bg-semantic-info/10', label: 'Processing' },
  pending: { icon: Clock, color: 'text-archive', bg: 'bg-stone/30', label: 'Pending' },
  failed: { icon: XCircle, color: 'text-semantic-error', bg: 'bg-semantic-error/10', label: 'Failed' },
};

const STEP_STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  completed: { icon: CheckCircle2, color: 'text-semantic-success' },
  started: { icon: RefreshCw, color: 'text-semantic-info' },
  skipped: { icon: SkipForward, color: 'text-archive' },
  failed: { icon: XCircle, color: 'text-semantic-error' },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  return formatDateTime(dateString);
}

/** Threshold beyond which a still-"processing" job is considered stale (15 min). */
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

function getJobDuration(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
  status: string,
): { text: string; stale: boolean } | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (completedAt) {
    return { text: formatDuration(new Date(completedAt).getTime() - start), stale: false };
  }
  // Job is still open — check if it looks abandoned
  const elapsed = Date.now() - start;
  if (status === 'processing' && elapsed > STALE_THRESHOLD_MS) {
    return { text: 'stalled', stale: true };
  }
  return { text: formatDuration(elapsed), stale: false };
}

/** Deduplicate steps: for each name keep only the final (completed/failed/skipped) entry */
function collapseSteps(steps: ProcessingStep[]): ProcessingStep[] {
  const seen = new Map<string, ProcessingStep>();
  for (const step of steps) {
    const existing = seen.get(step.name);
    // Keep the terminal status, or the latest entry
    if (!existing || step.status !== 'started') {
      seen.set(step.name, step);
    }
  }
  return Array.from(seen.values());
}

export function ProcessingHistoryTab({
  organizationId,
  mediaId,
}: ProcessingHistoryTabProps) {
  const queryClient = useQueryClient();
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['media-processing-status', organizationId, mediaId],
    queryFn: () => getMediaProcessingStatus(organizationId, mediaId),
    enabled: !!organizationId && !!mediaId,
    refetchInterval: (query) => {
      // Auto-refresh every 5s while any job is still processing
      const status = query.state.data?.processing_status;
      if (status === 'processing' || status === 'transcoding' || status === 'pending') {
        return 5000;
      }
      return false;
    },
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => retryProcessingJob(organizationId, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-processing-status', organizationId, mediaId] });
    },
  });

  const toggleJob = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded text-semantic-error text-sm">
        Error loading processing history: {(error as Error).message}
      </div>
    );
  }

  const jobs = data?.jobs || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium font-serif text-ink flex items-center gap-2">
          <Activity size={16} className="text-bark" />
          Processing History
        </h4>
        {data?.processing_status && (
          <span className={cn(
            'px-2.5 py-1 rounded-full text-xs font-medium font-serif',
            STATUS_CONFIG[data.processing_status]?.bg || 'bg-stone/30',
            STATUS_CONFIG[data.processing_status]?.color || 'text-archive',
          )}>
            {STATUS_CONFIG[data.processing_status]?.label || data.processing_status}
          </span>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-8">
          <Activity className="h-8 w-8 text-archive mx-auto mb-2" />
          <p className="text-sm text-archive font-serif">No processing jobs found</p>
          <p className="text-xs text-archive font-serif mt-1">
            Processing steps will appear here when media is uploaded or reprocessed
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isExpanded = expandedJobs.has(job.job_id);
            const steps: ProcessingStep[] = (job.result as Record<string, unknown>)?.steps as ProcessingStep[] || [];
            const collapsedSteps = collapseSteps(steps);
            const hasSteps = collapsedSteps.length > 0;
            const duration = getJobDuration(job.started_at, job.completed_at, job.status);
            const isStale = duration?.stale ?? false;

            // Override status display for stale "processing" jobs
            const displayStatus = isStale ? 'stalled' : job.status;
            const STALLED_CONFIG = { icon: AlertCircle, color: 'text-semantic-warning', bg: 'bg-semantic-warning/10', label: 'Stalled' } as const;
            const config = isStale ? STALLED_CONFIG : (STATUS_CONFIG[job.status] || STATUS_CONFIG.pending);
            const StatusIcon = config.icon;

            return (
              <div
                key={job.job_id}
                className="border border-lichen rounded-lg overflow-hidden"
              >
                {/* Job header */}
                <button
                  onClick={() => hasSteps && toggleJob(job.job_id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 text-left transition-colors',
                    hasSteps && 'cursor-pointer hover:bg-stone/20',
                    !hasSteps && 'cursor-default',
                  )}
                >
                  {hasSteps ? (
                    isExpanded ? (
                      <ChevronDown size={14} className="text-archive shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-archive shrink-0" />
                    )
                  ) : (
                    <div className="w-3.5 shrink-0" />
                  )}

                  <StatusIcon
                    size={16}
                    className={cn(
                      config.color,
                      'shrink-0',
                      displayStatus === 'processing' && 'animate-spin',
                    )}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium font-serif text-ink text-sm">
                        {JOB_TYPE_LABELS[job.job_type] || job.job_type}
                      </span>
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium font-serif',
                        config.bg, config.color,
                      )}>
                        {config.label}
                      </span>
                    </div>
                    <div className="text-xs text-archive font-serif mt-0.5 flex items-center gap-2 flex-wrap">
                      {job.created_at && <span>{formatDate(job.created_at)}</span>}
                      {duration && (
                        <>
                          <span className="text-lichen">•</span>
                          <span className={duration.stale ? 'text-semantic-warning' : undefined}>
                            {duration.text}
                          </span>
                        </>
                      )}
                      {job.retry_count != null && job.retry_count > 0 && (
                        <>
                          <span className="text-lichen">•</span>
                          <span className="text-semantic-warning">
                            {job.retry_count} {job.retry_count === 1 ? 'retry' : 'retries'}
                          </span>
                        </>
                      )}
                      {hasSteps && (
                        <>
                          <span className="text-lichen">•</span>
                          <span>{collapsedSteps.length} steps</span>
                        </>
                      )}
                    </div>
                  </div>

                  {(job.status === 'failed' || isStale) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        retryMutation.mutate(job.job_id);
                      }}
                      disabled={retryMutation.isPending}
                      className={cn(
                        'px-2.5 py-1 border rounded-sm text-xs font-serif cursor-pointer transition-colors flex items-center gap-1 shrink-0',
                        isStale
                          ? 'border-semantic-warning/30 bg-semantic-warning/10 text-semantic-warning hover:bg-semantic-warning/20'
                          : 'border-semantic-error/30 bg-semantic-error/10 text-semantic-error hover:bg-semantic-error/20',
                      )}
                    >
                      <RefreshCw size={12} className={retryMutation.isPending ? 'animate-spin' : ''} />
                      Retry
                    </button>
                  )}
                </button>

                {/* Error message */}
                {job.error_message && (
                  <div className="mx-3 mb-3 px-3 py-2 bg-semantic-error/5 border border-semantic-error/20 rounded text-xs text-semantic-error font-mono">
                    {job.error_message}
                  </div>
                )}

                {/* Step timeline */}
                {isExpanded && hasSteps && (
                  <div className="border-t border-lichen bg-parchment/50">
                    <div className="px-4 py-2">
                      {collapsedSteps.map((step, idx) => {
                        const stepConfig = STEP_STATUS_CONFIG[step.status] || STEP_STATUS_CONFIG.started;
                        const StepIcon = stepConfig.icon;
                        const isLast = idx === collapsedSteps.length - 1;

                        return (
                          <div key={`${step.name}-${idx}`} className="flex items-start gap-3">
                            {/* Timeline line */}
                            <div className="flex flex-col items-center pt-0.5">
                              <StepIcon
                                size={14}
                                className={cn(
                                  stepConfig.color,
                                  step.status === 'started' && 'animate-spin',
                                )}
                              />
                              {!isLast && (
                                <div className="w-px h-full min-h-[20px] bg-lichen mt-1" />
                              )}
                            </div>

                            {/* Step content */}
                            <div className={cn('flex-1 min-w-0 pb-3', isLast && 'pb-1')}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-serif text-ink">
                                  {step.label}
                                </span>
                                {step.duration_ms != null && (
                                  <span className="text-[10px] font-mono text-archive bg-stone/40 px-1.5 py-0.5 rounded">
                                    {formatDuration(step.duration_ms)}
                                  </span>
                                )}
                              </div>

                              {/* Detail chips */}
                              {step.details && Object.keys(step.details).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {Object.entries(step.details).map(([key, value]) => (
                                    <span
                                      key={key}
                                      className="text-[10px] font-mono text-archive bg-lichen/50 px-1.5 py-0.5 rounded"
                                    >
                                      {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
