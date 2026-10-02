import { useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import type {
  RunStartedEvent,
  RunProgressEvent,
  RunCompletedEvent,
  RunFailedEvent,
} from '../types/websocket';

/**
 * Run update data combining all possible run events
 */
export interface RunUpdate {
  runId: string;
  pipelineId: string;
  status: string;
  counts?: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    deleted: number;
  };
  durationMs?: number;
  error?: string;
  errorStage?: string | null;
}

/**
 * Options for useRunUpdates hook
 */
interface UseRunUpdatesOptions {
  /** Specific run ID to subscribe to (for detail page) */
  runId?: string;
  /** Specific pipeline ID to subscribe to (for pipeline detail page) */
  pipelineId?: string;
  /** Callback when a run starts */
  onRunStarted?: (update: RunUpdate) => void;
  /** Callback when run progress updates */
  onRunProgress?: (update: RunUpdate) => void;
  /** Callback when a run completes (success or warning) */
  onRunCompleted?: (update: RunUpdate) => void;
  /** Callback when a run fails */
  onRunFailed?: (update: RunUpdate) => void;
  /** Callback for any run update (convenience) */
  onUpdate?: (update: RunUpdate) => void;
}

/**
 * Hook to subscribe to real-time run updates via WebSocket.
 *
 * Use this hook to get real-time updates for runs, replacing polling.
 *
 * @example
 * // Subscribe to a specific run (detail page)
 * useRunUpdates({
 *   runId: '123',
 *   onRunProgress: (update) => setRun(prev => ({ ...prev, ...update })),
 *   onRunCompleted: (update) => refetchRun(),
 * });
 *
 * @example
 * // Subscribe to all runs for a pipeline
 * useRunUpdates({
 *   pipelineId: '456',
 *   onUpdate: (update) => updateRunInList(update),
 * });
 *
 * @example
 * // Subscribe to all org-wide run updates (overview page)
 * useRunUpdates({
 *   onUpdate: (update) => setActiveRuns(prev => {
 *     const newMap = new Map(prev);
 *     if (['running', 'pending', 'queued'].includes(update.status)) {
 *       newMap.set(update.pipelineId, true);
 *     } else {
 *       newMap.delete(update.pipelineId);
 *     }
 *     return newMap;
 *   }),
 * });
 */
export function useRunUpdates(options: UseRunUpdatesOptions = {}): void {
  const {
    runId,
    pipelineId,
    onRunStarted,
    onRunProgress,
    onRunCompleted,
    onRunFailed,
    onUpdate,
  } = options;

  const {
    isConnected,
    subscribeToRun,
    unsubscribeFromRun,
    subscribeToPipeline,
    unsubscribeFromPipeline,
    on,
  } = useWebSocket();

  // Use refs for callbacks to avoid re-subscribing when they change
  const callbacksRef = useRef({
    onRunStarted,
    onRunProgress,
    onRunCompleted,
    onRunFailed,
    onUpdate,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onRunStarted,
      onRunProgress,
      onRunCompleted,
      onRunFailed,
      onUpdate,
    };
  }, [onRunStarted, onRunProgress, onRunCompleted, onRunFailed, onUpdate]);

  // Create update handler
  const createUpdate = useCallback(
    (
      event:
        | RunStartedEvent
        | RunProgressEvent
        | RunCompletedEvent
        | RunFailedEvent
    ): RunUpdate => {
      const base: RunUpdate = {
        runId: event.run_id,
        pipelineId: event.pipeline_id,
        status: event.status,
      };

      if ('counts' in event) {
        base.counts = event.counts;
      }

      if ('duration_ms' in event && event.duration_ms !== undefined) {
        base.durationMs = event.duration_ms;
      }

      if ('error' in event) {
        base.error = event.error;
        base.errorStage = event.error_stage;
      }

      return base;
    },
    []
  );

  // Subscribe to run-specific updates
  useEffect(() => {
    if (!isConnected || !runId) return;

    subscribeToRun(runId);
    return () => unsubscribeFromRun(runId);
  }, [isConnected, runId, subscribeToRun, unsubscribeFromRun]);

  // Subscribe to pipeline-specific updates
  useEffect(() => {
    if (!isConnected || !pipelineId) return;

    subscribeToPipeline(pipelineId);
    return () => unsubscribeFromPipeline(pipelineId);
  }, [isConnected, pipelineId, subscribeToPipeline, unsubscribeFromPipeline]);

  // Set up event handlers
  useEffect(() => {
    if (!isConnected) return;

    // Filter events based on runId/pipelineId if specified
    const shouldHandle = (eventRunId: string, eventPipelineId: string): boolean => {
      if (runId && eventRunId !== runId) return false;
      if (pipelineId && eventPipelineId !== pipelineId) return false;
      return true;
    };

    const handleStarted = (event: RunStartedEvent) => {
      if (!shouldHandle(event.run_id, event.pipeline_id)) return;
      const update = createUpdate(event);
      callbacksRef.current.onRunStarted?.(update);
      callbacksRef.current.onUpdate?.(update);
    };

    const handleProgress = (event: RunProgressEvent) => {
      if (!shouldHandle(event.run_id, event.pipeline_id)) return;
      const update = createUpdate(event);
      callbacksRef.current.onRunProgress?.(update);
      callbacksRef.current.onUpdate?.(update);
    };

    const handleCompleted = (event: RunCompletedEvent) => {
      if (!shouldHandle(event.run_id, event.pipeline_id)) return;
      const update = createUpdate(event);
      callbacksRef.current.onRunCompleted?.(update);
      callbacksRef.current.onUpdate?.(update);
    };

    const handleFailed = (event: RunFailedEvent) => {
      if (!shouldHandle(event.run_id, event.pipeline_id)) return;
      const update = createUpdate(event);
      callbacksRef.current.onRunFailed?.(update);
      callbacksRef.current.onUpdate?.(update);
    };

    // Subscribe to events
    const cleanups = [
      on<RunStartedEvent>('run:started', handleStarted),
      on<RunProgressEvent>('run:progress', handleProgress),
      on<RunCompletedEvent>('run:completed', handleCompleted),
      on<RunFailedEvent>('run:failed', handleFailed),
    ];

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [isConnected, runId, pipelineId, on, createUpdate]);
}
