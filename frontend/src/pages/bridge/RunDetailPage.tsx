import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { getRun, getRunChanges, executeRun, republishRun, getDatasets, getPipelines, getConnectorInstances, checkRollbackFeasibility, rollbackRun } from '../../lib/api';
import type { RollbackCheckResult, RollbackResult } from '../../lib/api';
import {
  diffObjectKeys,
  isObject,
  formatDiffValue,
  normalizeCanonicalType,
  resolveChangeSource,
  getFieldDiffType,
  isFieldVisibleByDefault,
  diffMediaArray,
  summarizeMediaChanges,
  getMediaEntryLabel,
} from '../../lib/runDetailHelpers';
import { useOrganization } from '../../contexts/useOrganization';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateWithTimezone } from '../../lib/timezone';
import { useRunUpdates } from '../../hooks/useRunUpdates';
import type { RunUpdate } from '../../hooks/useRunUpdates';
import { useWebSocket } from '../../contexts/WebSocketContext';
import type { Run } from '../../lib/schemas';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatNumber } from '@/lib/formatters';

const STATUS_TIMELINE = [
  'pending',
  'queued',
  'running',
  'publishing',
  'success',
] as const;

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { activeOrganizationId } = useOrganization();
  const { timezone } = useTimezone();
  const [activeTab, setActiveTab] = useState<'changes' | 'raw'>('changes');
  const [changesPage, setChangesPage] = useState(0);
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set());
  const [showRawJson, setShowRawJson] = useState<Set<string>>(new Set()); // Track "show raw JSON" per diff
  const [showMetadataFields, setShowMetadataFields] = useState(false); // Toggle metadata field visibility
  const [updatedCounts, setUpdatedCounts] = useState<Set<string>>(new Set());
  // Rollback state
  const [showRollbackDrawer, setShowRollbackDrawer] = useState(false);
  const [rollbackCheck, setRollbackCheck] = useState<RollbackCheckResult | null>(null);
  const [isCheckingRollback, setIsCheckingRollback] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);
  const previousCountsRef = useRef<{
    processed: number;
    created: number;
    updated: number;
    noop: number;
    deleted: number;
  } | null>(null);
  const changesLimit = 50;
  
  // Helper to format field summary with array deltas from backend
  const getFieldSummary = (fieldName: string, arrayDelta: number | null | undefined): string => {
    if (arrayDelta !== null && arrayDelta !== undefined) {
      return arrayDelta > 0 ? `${fieldName}[+${arrayDelta}]` :
             arrayDelta < 0 ? `${fieldName}[${arrayDelta}]` :
             fieldName;
    }
    return fieldName;
  };

  const toggleExpanded = (changeId: string) => {
    setExpandedChanges(prev => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  };

  // Toggle "show raw JSON" for a specific field diff (keyed by changeId:fieldName)
  const toggleRawJson = (diffKey: string) => {
    setShowRawJson(prev => {
      const next = new Set(prev);
      if (next.has(diffKey)) {
        next.delete(diffKey);
      } else {
        next.add(diffKey);
      }
      return next;
    });
  };

  const { isConnected } = useWebSocket();

  const { data: run, refetch } = useQuery({
    queryKey: ['run', runId, activeOrganizationId],
    queryFn: () => getRun(runId!, activeOrganizationId!),
    enabled: !!runId && !!activeOrganizationId,
    // Only poll as fallback when WebSocket is not connected
    refetchInterval: (query) => {
      if (isConnected) return false; // WebSocket handles updates
      const data = query.state.data;
      if (!data) return false;
      const activeStatuses: Run['status'][] = ['pending', 'queued', 'running', 'publishing'];
      return activeStatuses.includes(data.status) ? 2000 : false;
    },
  });

  // Handle real-time run updates via WebSocket
  const handleRunUpdate = useCallback((_update: RunUpdate) => {
    // Refetch to get full run data when status changes
    refetch();
  }, [refetch]);

  // Subscribe to WebSocket updates for this specific run
  useRunUpdates({
    runId,
    onRunProgress: handleRunUpdate,
    onRunCompleted: handleRunUpdate,
    onRunFailed: handleRunUpdate,
    onRunStarted: handleRunUpdate,
  });

  // Fetch context data (datasets, pipelines, connectors)
  const { data: datasets } = useQuery({
    queryKey: ['datasets', activeOrganizationId],
    queryFn: () => getDatasets(activeOrganizationId!),
    enabled: !!activeOrganizationId,
  });

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines', activeOrganizationId],
    queryFn: () => getPipelines(activeOrganizationId!),
    enabled: !!activeOrganizationId,
  });

  const { data: connectors } = useQuery({
    queryKey: ['connectors', activeOrganizationId],
    queryFn: () => getConnectorInstances(activeOrganizationId!),
    enabled: !!activeOrganizationId,
  });

  const { data: changesData } = useQuery({
    queryKey: ['run-changes', runId, activeOrganizationId, changesPage],
    queryFn: () =>
      getRunChanges(runId!, activeOrganizationId!, {
        limit: changesLimit,
        offset: changesPage * changesLimit,
      }),
    enabled: !!runId && !!activeOrganizationId && activeTab === 'changes',
  });

  // Track count updates for animation
  useEffect(() => {
    if (run?.counts) {
      const currentCounts = {
        processed: run.counts.processed,
        created: run.counts.created,
        updated: run.counts.updated,
        noop: run.counts.noop,
        deleted: run.counts.deleted ?? 0,
      };

      const previousCounts = previousCountsRef.current;
      if (previousCounts) {
        const updated = new Set<string>();
        if (currentCounts.processed > previousCounts.processed) updated.add('processed');
        if (currentCounts.created > previousCounts.created) updated.add('created');
        if (currentCounts.updated > previousCounts.updated) updated.add('updated');
        if (currentCounts.noop > previousCounts.noop) updated.add('noop');
        if (currentCounts.deleted > previousCounts.deleted) updated.add('deleted');

        if (updated.size > 0) {
           
          setUpdatedCounts(updated);
          setTimeout(() => setUpdatedCounts(new Set()), 1000);
        }
      }

      previousCountsRef.current = currentCounts;
    }
  }, [run?.counts]);

  // Validate counts alignment between Changes tab and summary cards
  useEffect(() => {
    if (changesData && run && run.counts && changesData.total > 0) {
      const expectedCreated = run.counts.created;
      const expectedUpdated = run.counts.updated;

      // Total change events should equal created + updated
      // (noop records do NOT create change events - they're skipped/unchanged)
      const expectedTotal = expectedCreated + expectedUpdated;

      if (changesData.total !== expectedTotal) {
        logger.warn(
          `[Changes Tab] Count mismatch detected:\n` +
          `  Total change events: ${changesData.total}\n` +
          `  Expected (Created + Updated): ${expectedTotal}\n` +
          `  Created: ${expectedCreated}, Updated: ${expectedUpdated}, Noop: ${run.counts.noop}`
        );
      }
    }
  }, [changesData, run]);

  const handleExecute = async () => {
    if (runId && activeOrganizationId) {
      await executeRun(runId, activeOrganizationId);
      refetch();
    }
  };

  const handleRepublish = async () => {
    if (runId && activeOrganizationId) {
      await republishRun(runId, activeOrganizationId);
      refetch();
    }
  };

  const canExecute = (status: Run['status']) => {
    return status === 'pending' || status === 'queued';
  };

  const canRepublish = (run: Run) => {
    // Republish is only available for runs with a target connector (not source-only pipelines)
    const hasTarget = !!run.target_connector_instance_id;
    // Allow republish for explicit publish failure statuses
    const isRepublishableStatus = run.status === 'failed_publish' || run.status === 'publishing' || run.status === 'failed_finalize';
    // Also allow for generic 'failed' status if the error was in the publish stage
    const failedDuringPublish = run.status === 'failed' && run.error_stage === 'publish';
    return hasTarget && (isRepublishableStatus || failedDuringPublish);
  };

  const canRollback = (status: Run['status'], rollbackOfRunId: string | null | undefined) => {
    // Rollback is available for success or warning runs that are not themselves rollback runs
    const isRollbackableStatus = status === 'success' || status === 'warning';
    const isNotRollbackRun = !rollbackOfRunId;
    return isRollbackableStatus && isNotRollbackRun;
  };

  const handleOpenRollbackDrawer = async () => {
    if (!runId || !activeOrganizationId) return;

    setShowRollbackDrawer(true);
    setRollbackError(null);
    setRollbackResult(null);
    setIsCheckingRollback(true);

    try {
      const check = await checkRollbackFeasibility(runId, activeOrganizationId);
      setRollbackCheck(check);
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : 'Failed to check rollback feasibility');
    } finally {
      setIsCheckingRollback(false);
    }
  };

  const handleRollback = async (forcePartial: boolean = false) => {
    if (!runId || !activeOrganizationId) return;

    setIsRollingBack(true);
    setRollbackError(null);

    try {
      const result = await rollbackRun(runId, activeOrganizationId, { force_partial: forcePartial });
      setRollbackResult(result);
      refetch(); // Refresh run data to show rolled_back status
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setIsRollingBack(false);
    }
  };

  const closeRollbackDrawer = () => {
    setShowRollbackDrawer(false);
    setRollbackCheck(null);
    setRollbackError(null);
    setRollbackResult(null);
  };

  const getStatusIndex = (status: Run['status'], timeline: readonly string[]) => {
    const failedStatuses: Run['status'][] = ['failed', 'failed_publish', 'failed_finalize'];
    if (failedStatuses.includes(status)) {
      return timeline.indexOf('running');
    }
    return timeline.indexOf(status as string);
  };

  if (!run) {
    return <div role="status" aria-live="polite" className="text-center py-12"><MadronaLoader /></div>;
  }

  // For source-only pipelines, filter out the 'publishing' step
  const isSourceOnly = !run.target_connector_instance_id;
  const displayTimeline = isSourceOnly 
    ? STATUS_TIMELINE.filter(status => status !== 'publishing')
    : STATUS_TIMELINE;
  
  const currentStatusIndex = getStatusIndex(run.status, displayTimeline);

  // Check if run is in active state (for LIVE indicator)
  const isRunActive = run && ['pending', 'queued', 'running', 'publishing'].includes(run.status);
  // Show LIVE indicator when run is active AND we have real-time updates (WebSocket or polling fallback)
  const isLive = isRunActive && (isConnected || true);

  // Get context info
  const pipeline = pipelines?.find(p => p.pipeline_id === run?.pipeline_id);
  const dataset = datasets?.find(d => d.dataset_id === pipeline?.dataset_id);
  const sourceConnector = connectors?.find(c => pipeline?.sources?.some(s => s.connector_instance_id === c.connector_instance_id));

  return (
    <div className="space-y-6 max-w-7xl mx-auto pt-6">
      {/* Header */}
      <div className="bg-parchment rounded-lg shadow-sm border border-lichen p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-ink">Pipeline Run</h1>
              <span className="px-3 py-1 text-sm font-medium rounded-full bg-stone/30 text-accessible-gray">
                #{runId?.substring(0, 8)}
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-semantic-info/10 text-semantic-info animate-pulse">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-semantic-info/60 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-semantic-info"></span>
                  </span>
                  LIVE
                </span>
              )}
            </div>
            {dataset && (
              <div className="mb-2">
                <span className="text-sm text-archive">Dataset: </span>
                <span className="text-sm font-semibold text-ink">{dataset.name}</span>
                {sourceConnector && (
                  <>
                    <span className="text-sm text-stone mx-2">•</span>
                    <span className="text-sm text-archive">Source: </span>
                    <span className="text-sm font-medium text-accessible-gray">{sourceConnector.name}</span>
                  </>
                )}
              </div>
            )}
            <p className="text-archive">Reflects the state of this pipeline run</p>
          </div>
          <div className="flex gap-2">
            {canExecute(run.status) && (
              <button
                onClick={handleExecute}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Execute
              </button>
            )}
            {canRepublish(run) && (
              <button
                onClick={handleRepublish}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Retry publish
              </button>
            )}
            {canRollback(run.status, run.rollback_of_run_id) && (
              <button
                onClick={handleOpenRollbackDrawer}
                className="px-4 py-2 border border-archive bg-transparent text-archive text-sm font-medium rounded cursor-pointer hover:bg-stone/30 transition-colors"
              >
                Rollback
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-parchment rounded-lg shadow-sm border border-lichen p-8">
        <h2 className="text-lg font-semibold mb-6 text-forest font-serif">Entity Alignment State</h2>
        <div className="flex items-center justify-between">
          {displayTimeline.map((status, index) => {
            const isActive = index <= currentStatusIndex;
            const isCurrent = run.status === status;
            const isFailed =
              index === currentStatusIndex &&
              (run.status === 'failed' ||
                run.status === 'failed_publish' ||
                run.status === 'failed_finalize');
            
            const statusLabels: Record<string, string> = {
              pending: 'Pending',
              in_progress: 'In progress',
              needs_attention: 'Needs attention',
              failed: 'Failed',
              success: 'All set'
            };

            const isLastStatus = status === 'success';
            const showTooltip = isLastStatus && run.parameters?.sync_type === 'incremental';

            return (
              <div key={status} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-3 h-3 rounded-full transition-all ${
                      isFailed ? 'bg-semantic-error' : isActive ? 'bg-semantic-success' : 'bg-stone'
                    }`}
                  />
                  <p
                    className={`mt-3 text-xs relative ${
                      isCurrent ? 'font-semibold text-ink' : 'font-medium text-archive'
                    }`}
                    title={showTooltip ? "All records from this run have been processed.\nIncremental runs do not detect deletions from the source." : undefined}
                  >
                    {statusLabels[status] || status}
                  </p>
                </div>
                {index < displayTimeline.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 transition-all ${
                      isActive && index < currentStatusIndex ? 'bg-stone' : 'bg-lichen'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        {run.error && ['failed', 'failed_publish', 'failed_finalize'].includes(run.status) && (
          <div className="mt-6 p-4 bg-semantic-error/5 border-l-4 border-semantic-error rounded-r-lg">
            <div className="flex items-start gap-3">
              <div>
                <p className="font-semibold text-semantic-error mb-1">Error encountered</p>
                <p className="text-sm text-semantic-error/90">{run.error}</p>
              </div>
            </div>
          </div>
        )}
        {/* Show destination step errors when status is failed_publish but no top-level error */}
        {!run.error && run.status === 'failed_publish' && run.destinations && run.destinations.length > 0 && (
          <div className="mt-6 p-4 bg-semantic-error/5 border-l-4 border-semantic-error rounded-r-lg">
            <div className="flex items-start gap-3">
              <div className="w-full">
                <p className="font-semibold text-semantic-error mb-1">
                  {run.destinations.filter(d => d.status === 'failed').length === 1
                    ? 'Destination publish failed'
                    : 'All destination publishes failed'}
                </p>
                {run.destinations.filter(d => d.status === 'failed').map((dest, idx) => (
                  <p key={dest.step_id || idx} className="text-sm text-semantic-error/90">
                    {dest.error || 'Unknown error occurred during publish'}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Warning banner for runs that completed with warnings */}
        {run.status === 'warning' && (
          <div className="mt-6 p-4 bg-semantic-warning/5 border-l-4 border-semantic-warning rounded-r-lg">
            <div className="flex items-start gap-3">
              <div className="w-full">
                <p className="font-semibold text-semantic-warning mb-1">
                  {run.rollback_of_run_id ? 'Partial rollback completed' : 'Completed with warnings'}
                </p>
                {run.rollback_of_run_id ? (
                  <p className="text-sm text-semantic-warning/90">
                    {(run.counts?.noop ?? 0) > 0
                      ? `${run.counts?.noop} entities were skipped because they were modified by subsequent runs after the original run completed.`
                      : 'Some entities could not be rolled back due to subsequent modifications.'}
                  </p>
                ) : run.destinations && run.destinations.filter(d => d.status === 'failed').length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-sm text-semantic-warning/90">
                      {run.destinations.filter(d => d.status === 'failed').length} of {run.destinations.length} destination{run.destinations.length > 1 ? 's' : ''} failed:
                    </p>
                    {run.destinations.filter(d => d.status === 'failed').map((dest, idx) => (
                      <p key={dest.step_id || idx} className="text-sm text-semantic-warning/80 ml-2">
                        • {dest.error || 'Unknown error occurred'}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-semantic-warning/90">
                    Some destination publishes may have failed. Check the destination systems for details.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Run Mode Information */}
      {run.parameters?.sync_type && (
        <div className="bg-parchment rounded-lg shadow-sm border border-lichen p-6">
          <h2 className="text-lg font-semibold mb-4 text-forest font-serif">
            Run Mode
          </h2>
          <div className="flex items-start gap-3 mb-4">
            <div className="inline-block px-4 py-2 rounded-lg bg-semantic-info/5 border border-semantic-info/20">
              <span className="font-semibold text-semantic-info">
                {run.parameters.sync_type === 'incremental' ? 'Incremental' : 'Full'}
              </span>
              <span className="text-archive text-xs ml-2">
                {'\u2014'} {run.counts?.processed != null ? formatNumber(run.counts.processed) : '0'} processed
              </span>
            </div>
          </div>
          {run.parameters.sync_type === 'full' && run.finished_at && (
            <div className="mb-4">
              <p className="text-sm text-archive mb-1">
                <span className="font-medium text-ink">Snapshot as of:</span>{' '}
                {formatDateWithTimezone(run.finished_at, timezone)}
              </p>
              {run.parameters.force_full_sync === true && (
                <p className="text-xs text-archive italic">
                  Full run (manual trigger)
                </p>
              )}
            </div>
          )}
          {run.parameters.sync_type === 'incremental' && (
            <div className="mb-4">
              <p className="text-sm text-archive leading-relaxed">
                Only new or updated records since the last run are processed.
                Records removed from the source are not detected.
              </p>
            </div>
          )}
          {run.parameters.sync_type === 'incremental' && run.parameters.watermark_from && (
            <div className="mb-4">
              <p className="text-sm text-archive mb-1">
                <span className="font-medium text-ink">Processing changes since:</span>{' '}
                {formatDateWithTimezone(
                  new Date(parseInt(run.parameters.watermark_from) * 1000).toISOString(),
                  timezone
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${run.parameters?.sync_type === 'incremental' ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
        <div className={`bg-parchment rounded-lg p-5 transition-all duration-300 ${
          updatedCounts.has('processed') ? 'border-2 border-semantic-info shadow-[0_0_12px_rgba(74,90,107,0.3)]' : 'border border-lichen'
        }`}>
          <p className="text-xs text-archive mb-2">Processed</p>
          <p className={`text-2xl font-bold mb-1 transition-colors duration-300 ${
            updatedCounts.has('processed') ? 'text-semantic-info' : 'text-ink'
          }`}>{run.counts?.processed != null ? formatNumber(run.counts.processed) : '\u2014'}</p>
          <p className="text-xs text-archive">Total records examined</p>
        </div>

        <div className={`bg-parchment rounded-lg p-5 transition-all duration-300 ${
          updatedCounts.has('created') ? 'border-2 border-semantic-success shadow-[0_0_12px_rgba(74,107,79,0.3)]' : 'border border-lichen'
        }`}>
          <p className="text-xs text-archive mb-2">Created</p>
          <p className={`text-2xl font-bold mb-1 transition-colors duration-300 ${
            updatedCounts.has('created') ? 'text-semantic-success' : 'text-ink'
          }`}>{run.counts ? formatNumber(run.counts.created) : 0}</p>
          <p className="text-xs text-archive">New entities</p>
        </div>

        <div className={`bg-parchment rounded-lg p-5 transition-all duration-300 ${
          updatedCounts.has('updated') ? 'border-2 border-semantic-warning shadow-[0_0_12px_rgba(142,107,59,0.3)]' : 'border border-lichen'
        }`}>
          <p className="text-xs text-archive mb-2">Updated</p>
          <p className={`text-2xl font-bold mb-1 transition-colors duration-300 ${
            updatedCounts.has('updated') ? 'text-semantic-warning' : 'text-ink'
          }`}>{run.counts ? formatNumber(run.counts.updated) : 0}</p>
          <p className="text-xs text-archive">Updated entities</p>
        </div>

        <div className={`bg-parchment rounded-lg p-5 transition-all duration-300 ${
          updatedCounts.has('skipped') ? 'border-2 border-archive shadow-[0_0_12px_rgba(107,122,126,0.3)]' : 'border border-lichen'
        }`}>
          <p className="text-xs text-archive mb-2">Unchanged</p>
          <p className={`text-2xl font-bold mb-1 transition-colors duration-300 ${
            updatedCounts.has('skipped') ? 'text-archive' : 'text-ink'
          }`}>{run.counts ? formatNumber(run.counts.noop) : 0}</p>
          <p className="text-xs text-archive">Unchanged entities</p>
        </div>

        <div className={`bg-parchment rounded-lg p-5 transition-all duration-300 ${
          updatedCounts.has('deleted') ? 'border-2 border-semantic-error shadow-[0_0_12px_rgba(142,59,59,0.3)]' : 'border border-lichen'
        }`}>
          <p className="text-xs text-archive mb-2">Deleted</p>
          <p className={`text-2xl font-bold mb-1 transition-colors duration-300 ${
            updatedCounts.has('deleted') ? 'text-semantic-error' : 'text-ink'
          }`}>{run.counts?.deleted != null ? formatNumber(run.counts.deleted) : 0}</p>
          <p className="text-xs text-archive">Removed entities</p>
        </div>

        {run.parameters?.sync_type === 'incremental' && (
          <div className="bg-parchment border border-stone rounded p-5 opacity-70">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-xs font-semibold text-archive">Stale</p>
              <div
                className="cursor-help inline-flex"
                title="Incremental runs only evaluate records changed since the last run."
              >
                <svg className="text-archive" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 1.33334C4.32 1.33334 1.33334 4.32 1.33334 8C1.33334 11.68 4.32 14.6667 8 14.6667C11.68 14.6667 14.6667 11.68 14.6667 8C14.6667 4.32 11.68 1.33334 8 1.33334ZM8.66668 11.3333H7.33334V7.33334H8.66668V11.3333ZM8.66668 6H7.33334V4.66668H8.66668V6Z" fill="currentColor"/>
                </svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-ink mb-1">{'\u2014'}</p>
            <p className="text-xs text-archive">Records not revalidated in this run</p>
          </div>
        )}
      </div>

      {/* Details Section */}
      <div className="bg-parchment rounded-lg shadow-sm border border-lichen">
        <div className="border-b border-lichen px-6">
          <nav className="flex gap-6 mt-4">
            <button
              onClick={() => setActiveTab('changes')}
              className={`py-3 bg-transparent border-none border-b-2 text-sm cursor-pointer transition-all ${
                activeTab === 'changes'
                  ? 'border-ink font-semibold text-ink'
                  : 'border-transparent font-normal text-archive'
              }`}
            >
              Changes
            </button>
            <button
              onClick={() => setActiveTab('raw')}
              title="Raw execution details and diagnostics"
              className={`py-3 bg-transparent border-none border-b-2 text-sm cursor-pointer transition-all ${
                activeTab === 'raw'
                  ? 'border-ink font-semibold text-ink'
                  : 'border-transparent font-normal text-archive'
              }`}
            >
              Technical
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'changes' && (
            <div className="space-y-4">
              {/* Scope clarification banner for incremental runs */}
              {run.parameters?.sync_type === 'incremental' && (
                <div className="px-3.5 py-2.5 bg-semantic-info/5 border border-semantic-info/20 rounded-md flex gap-2.5 items-start">
                  <svg
                    className="shrink-0 mt-px text-archive"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M8 1.33334C4.32 1.33334 1.33334 4.32 1.33334 8C1.33334 11.68 4.32 14.6667 8 14.6667C11.68 14.6667 14.6667 11.68 14.6667 8C14.6667 4.32 11.68 1.33334 8 1.33334ZM8.66668 11.3333H7.33334V7.33334H8.66668V11.3333ZM8.66668 6H7.33334V4.66668H8.66668V6Z"
                      fill="currentColor"
                    />
                  </svg>
                  <div className="text-xs text-archive leading-relaxed">
                    Showing entity-level changes detected during this run.
                    Entities removed from the source are not detected in incremental runs.
                  </div>
                </div>
              )}

              {!changesData || changesData.items.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-archive font-medium">
                    {run.status === 'success' && run.counts?.created === 0 && run.counts?.updated === 0
                      ? 'No new or updated entities detected in this run.'
                      : run.parameters?.sync_type === 'incremental'
                        ? 'No new or updated entities detected in this run.'
                        : 'No entity-level changes identified.'}
                  </p>
                  {run.status === 'success' && run.counts?.created === 0 && run.counts?.updated === 0 ? (
                    <p className="text-sm text-archive mt-1">All evaluated entities were unchanged.</p>
                  ) : run.parameters?.sync_type === 'incremental' ? (
                    <p className="text-sm text-archive mt-1">Unchanged entities and records outside this window are not shown.</p>
                  ) : (
                    <p className="text-sm text-archive mt-1">Entity-level changes will appear once the run completes</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                {changesData.items.map((change) => {
                  // Only show Created and Updated changes
                  const changeLabels: Record<string, { label: string; color: string }> = {
                    created: { label: 'Created', color: 'green' },
                    updated: { label: 'Updated', color: 'neutral' }
                  };
                  const changeInfo = changeLabels[change.change_type] || { label: change.change_type, color: 'gray' };
                  
                  // Generate field summaries with array deltas from backend
                  const fieldSummaries = change.field_diffs?.map(diff => 
                    getFieldSummary(diff.field_name, diff.array_delta)
                  ) || [];
                  
                  const isExpanded = expandedChanges.has(change.change_id);
                  
                  return (
                    <div key={change.change_id} className="border border-lichen rounded p-2 hover:border-stone transition-colors bg-parchment">
                      <div className="flex items-start justify-between mb-1">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded ${
                                changeInfo.color === 'green'
                                  ? 'bg-semantic-success/10 text-semantic-success'
                                  : 'bg-stone/30 text-accessible-gray'
                              }`}
                            >
                              {changeInfo.label}
                            </span>
                            <Link
                              to={`/organizations/${activeOrganizationId}/bridge/entities/${encodeURIComponent(change.entity_key)}`}
                              className="text-xs font-medium text-bark no-underline hover:underline"
                            >
                              {change.entity_key}
                            </Link>
                          </div>

                          {/* Context for Created entities */}
                          {change.change_type === 'created' && change.entity_type && (
                            <div className="text-[11px] text-archive mt-1 ml-0.5">
                              Type: {normalizeCanonicalType(change.entity_type)}
                            </div>
                          )}

                          {/* Field summary for Updated entities */}
                          {change.change_type === 'updated' && fieldSummaries.length > 0 && (
                            <div className="text-[11px] text-archive mt-1 flex items-center gap-2">
                              <span>Changed: {fieldSummaries.slice(0, 3).join(', ')}</span>
                              {fieldSummaries.length > 3 && (
                                <span className="text-stone">+{fieldSummaries.length - 3} more</span>
                              )}
                              {change.field_diffs && change.field_diffs.length > 0 && (
                                <button
                                  onClick={() => toggleExpanded(change.change_id)}
                                  className="text-[11px] text-bark bg-transparent border-none cursor-pointer p-0 underline ml-auto"
                                >
                                  {isExpanded ? 'Hide details' : 'Show details'}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Change source indicator for Updated entities */}
                          {change.change_type === 'updated' && (
                            <div className="text-[10px] text-stone mt-0.5 ml-0.5 flex items-center gap-1">
                              <span className="inline-flex items-center gap-0.5 px-1 py-px rounded-sm bg-parchment border border-lichen text-[9px] font-medium text-archive uppercase tracking-wide">
                                {resolveChangeSource(change)}
                              </span>
                              {change.pipeline_name && (
                                <span className="text-lichen">{'\u2022'}</span>
                              )}
                              {change.pipeline_name && (
                                <span className="italic text-stone">{change.pipeline_name}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] text-stone whitespace-nowrap ml-4">
                          {formatDateWithTimezone(change.occurred_at, timezone)}
                        </span>
                      </div>

                      {/* Field diffs - only show when expanded */}
                      {isExpanded && change.field_diffs && change.field_diffs.length > 0 && (
                        <div className="mt-2 space-y-1.5 pl-11">
                          {/* Filter and render field diffs based on type */}
                          {(() => {
                            const visibleDiffs = change.field_diffs.filter(diff =>
                              showMetadataFields || isFieldVisibleByDefault(diff.field_name)
                            );
                            const hiddenCount = change.field_diffs.length - visibleDiffs.length;

                            return (
                              <>
                                {visibleDiffs.map((diff, idx) => {
                                  const diffKey = `${change.change_id}:${diff.field_name}`;
                                  const showingRaw = showRawJson.has(diffKey);
                                  const fieldType = getFieldDiffType(diff.field_name);

                                  // Determine rendering strategy
                                  const isStructured = fieldType === 'structured' && isObject(diff.old_value) && isObject(diff.new_value);
                                  const isMedia = fieldType === 'media' && Array.isArray(diff.old_value) && Array.isArray(diff.new_value);

                                  return (
                                    <div key={idx} className="text-sm bg-parchment border border-lichen/50 rounded p-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                          <span
                                            className="font-medium text-accessible-gray text-xs"
                                          >
                                            {diff.field_name}
                                          </span>
                                          {/* Field type badge for non-scalar fields */}
                                          {fieldType !== 'scalar' && (
                                            <span className={`text-[9px] px-1 py-px rounded-sm font-medium uppercase tracking-wide ${
                                              fieldType === 'metadata'
                                                ? 'bg-semantic-warning/10 text-semantic-warning'
                                                : 'bg-stone/30 text-archive'
                                            }`}>
                                              {fieldType}
                                            </span>
                                          )}
                                        </div>
                                        {(isStructured || isMedia) && (
                                          <button
                                            onClick={() => toggleRawJson(diffKey)}
                                            className="text-[10px] text-archive bg-transparent border-none cursor-pointer px-1 py-px"
                                          >
                                            {showingRaw ? '\u2190 semantic' : 'raw \u2192'}
                                          </button>
                                        )}
                                      </div>

                                      {/* STRUCTURED: Key-level diffs for objects */}
                                      {isStructured && !showingRaw ? (
                                        <div className="font-mono text-[11px] leading-relaxed">
                                          {(() => {
                                            const { added, removed, changed } = diffObjectKeys(
                                              diff.old_value as Record<string, unknown>,
                                              diff.new_value as Record<string, unknown>
                                            );
                                            const afterObj = diff.new_value as Record<string, unknown>;
                                            const beforeObj = diff.old_value as Record<string, unknown>;

                                            if (added.length === 0 && removed.length === 0 && changed.length === 0) {
                                              return <span className="text-stone italic text-[11px]">No key changes</span>;
                                            }

                                            return (
                                              <div className="space-y-0">
                                                {added.map(key => (
                                                  <div key={`add-${key}`} className="text-semantic-success py-px">
                                                    <span className="font-semibold">+</span> {key}: {formatDiffValue(afterObj[key])}
                                                  </div>
                                                ))}
                                                {removed.map(key => (
                                                  <div key={`rem-${key}`} className="text-semantic-error py-px">
                                                    <span className="font-semibold">{'\u2212'}</span> {key}: {formatDiffValue(beforeObj[key])}
                                                  </div>
                                                ))}
                                                {changed.map(({ key, oldVal, newVal }) => (
                                                  <div key={`chg-${key}`} className="text-semantic-warning py-px">
                                                    <span className="font-semibold">~</span> {key}: {formatDiffValue(oldVal)} {'\u2192'} {formatDiffValue(newVal)}
                                                  </div>
                                                ))}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      ) : isMedia && !showingRaw ? (
                                        /* MEDIA: Add/remove/changed summary */
                                        <div className="text-[11px]">
                                          {(() => {
                                            const mediaDiff = diffMediaArray(
                                              diff.old_value as Array<{ url?: string; role?: string; type?: string }>,
                                              diff.new_value as Array<{ url?: string; role?: string; type?: string }>
                                            );
                                            const summary = summarizeMediaChanges(mediaDiff);

                                            return (
                                              <div>
                                                <div className="text-archive mb-1">{summary}</div>
                                                {mediaDiff.added.length > 0 && (
                                                  <div className="text-semantic-success font-mono">
                                                    {mediaDiff.added.map((entry, i) => (
                                                      <div key={`add-${i}`}>+ {getMediaEntryLabel(entry)}</div>
                                                    ))}
                                                  </div>
                                                )}
                                                {mediaDiff.removed.length > 0 && (
                                                  <div className="text-semantic-error font-mono">
                                                    {mediaDiff.removed.map((entry, i) => (
                                                      <div key={`rem-${i}`}>{'\u2212'} {getMediaEntryLabel(entry)}</div>
                                                    ))}
                                                  </div>
                                                )}
                                                {mediaDiff.changed.length > 0 && (
                                                  <div className="text-semantic-warning font-mono">
                                                    {mediaDiff.changed.map(({ before, changedFields }, i) => (
                                                      <div key={`chg-${i}`}>~ {getMediaEntryLabel(before)} ({changedFields.join(', ')})</div>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      ) : (
                                        /* SCALAR & RAW: Before/After view */
                                        <div className="space-y-0.5">
                                          <div className="flex items-start gap-2 text-semantic-error/80 bg-semantic-error/5 px-1.5 py-0.5 rounded text-[11px]">
                                            <span className="font-medium min-w-[38px] text-semantic-error">Before</span>
                                            <span className="break-all font-mono">
                                              {JSON.stringify(diff.old_value, null, showingRaw ? 2 : undefined)}
                                            </span>
                                          </div>
                                          <div className="flex items-start gap-2 text-semantic-success bg-semantic-success/5 px-1.5 py-0.5 rounded text-[11px]">
                                            <span className="font-medium min-w-[38px] text-semantic-success">After</span>
                                            <span className="break-all font-mono">
                                              {JSON.stringify(diff.new_value, null, showingRaw ? 2 : undefined)}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {/* Show hidden metadata fields toggle */}
                                {hiddenCount > 0 && !showMetadataFields && (
                                  <button
                                    onClick={() => setShowMetadataFields(true)}
                                    className="text-[10px] text-archive bg-transparent border-none cursor-pointer py-1 px-0"
                                  >
                                    + {hiddenCount} metadata field{hiddenCount > 1 ? 's' : ''} hidden
                                  </button>
                                )}
                                {showMetadataFields && hiddenCount > 0 && (
                                  <button
                                    onClick={() => setShowMetadataFields(false)}
                                    className="text-[10px] text-archive bg-transparent border-none cursor-pointer py-1 px-0"
                                  >
                                    Hide metadata fields
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              )}

              {/* Pagination */}
              {changesData && changesData.total > 0 && (
                <div className="pt-6 mt-6 border-t border-lichen">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-archive">
                        Viewing <span className="font-semibold">{changesData.offset + 1}</span> to{' '}
                        <span className="font-semibold">{changesData.offset + changesData.items.length}</span> of{' '}
                        <span className="font-semibold">{formatNumber(changesData.total)}</span> changes from this run
                      </p>
                      {changesData.total > 1000 && (
                        <p className="text-xs text-archive mt-1">
                          Large dataset detected. Use pagination to navigate through changes.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setChangesPage(Math.max(0, changesPage - 1))}
                        disabled={changesPage === 0}
                        className="px-4 py-2 border border-lichen rounded-lg text-sm font-medium hover:bg-parchment disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        ← Previous
                      </button>
                      <button
                        onClick={() => setChangesPage(changesPage + 1)}
                        disabled={changesData.items.length < changesLimit}
                        className="px-4 py-2 border border-lichen rounded-lg text-sm font-medium hover:bg-parchment disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <div>
              <div className="mb-4 p-4 bg-parchment border border-lichen rounded-lg">
                <p className="text-sm text-accessible-gray">
                  <span className="font-semibold">Technical data</span>
                </p>
                <p className="text-xs text-archive mt-1">
                  Execution metadata associated with this run. Entity state is derived from, but not identical to, execution status.
                </p>
              </div>
              <pre className="bg-forest text-parchment p-6 rounded-lg overflow-x-auto text-sm font-mono border border-forest/50 shadow-inner">
                {JSON.stringify(run, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Rollback Drawer - rendered via portal to ensure fixed positioning works correctly */}
      {showRollbackDrawer && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="drawer-backdrop fixed inset-0 bg-ink/50 z-[999]"
            onClick={closeRollbackDrawer}
          />

          {/* Drawer Panel */}
          <div
            className="drawer fixed top-0 right-0 bottom-0 w-[400px] max-w-[90vw] bg-parchment shadow-[-4px_0_12px_rgba(0,0,0,0.15)] z-[1000] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-lichen flex justify-between items-center">
              <h2 className="text-lg font-semibold text-ink">
                Rollback Run
              </h2>
              <button
                onClick={closeRollbackDrawer}
                className="bg-transparent border-none cursor-pointer p-1 text-archive"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Success state */}
              {rollbackResult && (
                <div
                  className={`p-4 rounded-lg mb-5 border ${
                    rollbackResult.status === 'success'
                      ? 'bg-semantic-success/10 border-semantic-success/30'
                      : 'bg-semantic-warning/10 border-semantic-warning/30'
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    {rollbackResult.status === 'success' ? (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-semantic-success">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-semantic-warning">
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    <span
                      className={`font-semibold ${
                        rollbackResult.status === 'success' ? 'text-semantic-success' : 'text-semantic-warning'
                      }`}
                    >
                      {rollbackResult.status === 'success' ? 'Rollback Complete' : 'Partial Rollback'}
                    </span>
                  </div>
                  <div className="text-sm text-ink leading-relaxed">
                    <div className="grid grid-cols-2 gap-2">
                      <div>Reverted creates:</div>
                      <div className="font-medium">{rollbackResult.reverted_creates}</div>
                      <div>Reverted updates:</div>
                      <div className="font-medium">{rollbackResult.reverted_updates}</div>
                      <div>Reverted deletes:</div>
                      <div className="font-medium">{rollbackResult.reverted_deletes}</div>
                      {rollbackResult.skipped_conflicts > 0 && (
                        <>
                          <div>Skipped (conflicts):</div>
                          <div className="font-medium text-semantic-warning">
                            {rollbackResult.skipped_conflicts}
                          </div>
                        </>
                      )}
                    </div>
                    {rollbackResult.republish_status && (
                      <div className="mt-3 pt-3 border-t border-lichen">
                        <span className="font-medium">Republish status: </span>
                        <span
                          className={
                            rollbackResult.republish_status === 'success'
                              ? 'text-semantic-success'
                              : rollbackResult.republish_status === 'skipped'
                              ? 'text-archive'
                              : 'text-semantic-error'
                          }
                        >
                          {rollbackResult.republish_status}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-4">
                    <Link
                      to={`/organizations/${activeOrganizationId}/bridge/runs/${rollbackResult.rollback_run_id}`}
                      className="text-xs text-bark no-underline"
                    >
                      View rollback run →
                    </Link>
                  </div>
                </div>
              )}

              {/* Error state */}
              {rollbackError && !rollbackResult && (
                <div className="p-4 bg-semantic-error/5 border border-semantic-error/30 rounded-lg mb-5">
                  <div className="flex items-start gap-2.5">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="shrink-0 mt-0.5 text-semantic-error">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div>
                      <p className="font-semibold text-semantic-error mb-1">Error</p>
                      <p className="text-xs text-semantic-error">{rollbackError}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading state */}
              {isCheckingRollback && (
                <div className="text-center py-10">
                  <MadronaLoader variant="dots" label="Checking rollback feasibility..." />
                </div>
              )}

              {/* Rollback check result */}
              {rollbackCheck && !rollbackResult && !isCheckingRollback && (
                <div>
                  {/* Warning about rollback */}
                  <div className="p-4 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg mb-5">
                    <div className="flex items-start gap-2.5">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="shrink-0 mt-0.5 text-semantic-warning">
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <div>
                        <p className="font-semibold text-semantic-warning mb-1">
                          This action will reverse changes
                        </p>
                        <p className="text-xs text-semantic-warning leading-normal">
                          Rolling back this run will undo entity creates, updates, and deletes
                          that were made. A new rollback run will be created for audit purposes.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="p-4 bg-parchment border border-lichen rounded-lg mb-5">
                    <h3 className="text-sm font-semibold text-ink mb-3">
                      Rollback Summary
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-archive">Total changes:</div>
                      <div className="font-medium">{rollbackCheck.total_changes}</div>
                      <div className="text-archive">Can be rolled back:</div>
                      <div className="font-medium text-semantic-success">{rollbackCheck.rollbackable_changes}</div>
                      {rollbackCheck.conflict_entities.length > 0 && (
                        <>
                          <div className="text-archive">Conflicts:</div>
                          <div className="font-medium text-semantic-error">
                            {rollbackCheck.conflict_entities.length}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Conflicts warning */}
                  {rollbackCheck.conflict_entities.length > 0 && (
                    <div className="p-4 bg-semantic-error/5 border border-semantic-error/30 rounded-lg mb-5">
                      <p className="font-semibold text-semantic-error mb-2">
                        Conflicts Detected
                      </p>
                      <p className="text-xs text-semantic-error mb-3">
                        {rollbackCheck.conflict_entities.length} entities have been modified by
                        subsequent runs. These cannot be cleanly rolled back.
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-semantic-error font-medium">
                          Show conflicting entities
                        </summary>
                        <ul className="mt-2 pl-5 text-semantic-error max-h-[120px] overflow-auto">
                          {rollbackCheck.conflict_entities.slice(0, 20).map((key) => (
                            <li key={key} className="font-mono text-[11px]">
                              {key}
                            </li>
                          ))}
                          {rollbackCheck.conflict_entities.length > 20 && (
                            <li className="italic">
                              ...and {rollbackCheck.conflict_entities.length - 20} more
                            </li>
                          )}
                        </ul>
                      </details>
                    </div>
                  )}

                  {/* Cannot rollback reason */}
                  {!rollbackCheck.can_rollback && rollbackCheck.reason && (
                    <div className="p-4 bg-semantic-error/5 border border-semantic-error/30 rounded-lg mb-5">
                      <p className="font-semibold text-semantic-error mb-1">
                        Cannot Rollback
                      </p>
                      <p className="text-xs text-semantic-error">{rollbackCheck.reason}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {rollbackCheck && !rollbackResult && (
              <div className="px-6 py-4 border-t border-lichen flex gap-3 justify-end">
                <button
                  onClick={closeRollbackDrawer}
                  className="px-5 py-2.5 border border-lichen bg-parchment text-ink text-sm font-medium rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                {rollbackCheck.can_rollback && !rollbackCheck.partial && (
                  <button
                    onClick={() => handleRollback(false)}
                    disabled={isRollingBack}
                    className={`px-5 py-2.5 border-none text-parchment text-sm font-medium rounded-md ${
                      isRollingBack
                        ? 'bg-archive cursor-not-allowed'
                        : 'bg-semantic-error cursor-pointer'
                    }`}
                  >
                    {isRollingBack ? 'Rolling back...' : 'Rollback Run'}
                  </button>
                )}
                {rollbackCheck.partial && rollbackCheck.rollbackable_changes > 0 && (
                  <button
                    onClick={() => handleRollback(true)}
                    disabled={isRollingBack}
                    className={`px-5 py-2.5 border-none text-parchment text-sm font-medium rounded-md ${
                      isRollingBack
                        ? 'bg-archive cursor-not-allowed'
                        : 'bg-semantic-warning cursor-pointer'
                    }`}
                  >
                    {isRollingBack
                      ? 'Rolling back...'
                      : `Partial Rollback (${rollbackCheck.rollbackable_changes} changes)`}
                  </button>
                )}
              </div>
            )}

            {/* Close button for completed rollback */}
            {rollbackResult && (
              <div className="px-6 py-4 border-t border-lichen flex justify-end">
                <button
                  onClick={closeRollbackDrawer}
                  className="px-5 py-2.5 border-none bg-bark text-parchment text-sm font-medium rounded-md cursor-pointer"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Rolled back banner */}
      {run.status === 'rolled_back' && (
        <div className="fixed top-[72px] left-1/2 -translate-x-1/2 z-40 px-6 py-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg shadow-lg flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-semantic-warning">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <span className="font-semibold text-semantic-warning">This run has been rolled back</span>
            {run.rolled_back_by_run_id && (
              <span className="ml-2">
                <Link
                  to={`/organizations/${activeOrganizationId}/bridge/runs/${run.rolled_back_by_run_id}`}
                  className="text-bark text-xs"
                >
                  View rollback run →
                </Link>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Rollback run indicator */}
      {run.rollback_of_run_id && (
        <div className="fixed top-[72px] left-1/2 -translate-x-1/2 z-40 px-6 py-3 bg-semantic-info/10 border border-semantic-info/30 rounded-lg shadow-lg flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-semantic-info">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm.707-10.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L9.414 11H13a1 1 0 100-2H9.414l1.293-1.293z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <span className="font-semibold text-semantic-info">This is a rollback run</span>
            <span className="ml-2">
              <Link
                to={`/organizations/${activeOrganizationId}/bridge/runs/${run.rollback_of_run_id}`}
                className="text-bark text-xs"
              >
                View original run →
              </Link>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
