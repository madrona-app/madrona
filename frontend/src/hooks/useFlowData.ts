import { useEffect, useState, useCallback } from 'react';
import { getPipelines, getConnectorInstances, getDatasets, getRuns } from '../lib/api';
import type { Pipeline, ConnectorInstance, Dataset, Run } from '../lib/schemas';
import { useRunUpdates } from './useRunUpdates';
import type { RunUpdate } from './useRunUpdates';
import { logger } from '../lib/logger';

interface UseFlowDataOptions {
  organizationId: string | null | undefined;
}

interface UseFlowDataReturn {
  pipelines: Pipeline[];
  connectors: ConnectorInstance[];
  datasets: Dataset[];
  activeRunsByPipeline: Map<string, boolean>;
  runsByPipeline: Map<string, Run>;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook to manage flow data fetching and polling for active runs.
 * Consolidates data state management for FlowOverview.
 */
export function useFlowData({ organizationId }: UseFlowDataOptions): UseFlowDataReturn {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [connectors, setConnectors] = useState<ConnectorInstance[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeRunsByPipeline, setActiveRunsByPipeline] = useState<Map<string, boolean>>(new Map());
  const [runsByPipeline, setRunsByPipeline] = useState<Map<string, Run>>(new Map());

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      if (!organizationId) return;

      try {
        setLoading(true);
        setError(null);

        const [pipelinesData, connectorsData, datasetsData] = await Promise.all([
          getPipelines(organizationId),
          getConnectorInstances(organizationId),
          getDatasets(organizationId),
        ]);

        setPipelines(pipelinesData || []);
        setConnectors(connectorsData || []);
        setDatasets(datasetsData || []);
      } catch (err) {
        logger.error('Failed to fetch flow data:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch flow data'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [organizationId]);

  // Fetch initial runs on mount
  useEffect(() => {
    if (!organizationId) return;

    const fetchInitialRuns = async () => {
      try {
        const runs = await getRuns({ organization_id: organizationId, limit: 100 });
        const activeStatuses = ['running', 'queued', 'publishing', 'pending'];
        const activeByPipeline = new Map<string, boolean>();
        const runsByPipelineMap = new Map<string, Run>();

        runs.items.forEach((run) => {
          if (run.pipeline_id) {
            // Store latest run for each pipeline (runs are already sorted by created_at desc)
            if (!runsByPipelineMap.has(run.pipeline_id)) {
              runsByPipelineMap.set(run.pipeline_id, run);
            }

            // Track active runs
            if (activeStatuses.includes(run.status)) {
              activeByPipeline.set(run.pipeline_id, true);
            }
          }
        });

        setActiveRunsByPipeline(activeByPipeline);
        setRunsByPipeline(runsByPipelineMap);
      } catch (err) {
        logger.error('Failed to fetch runs:', err);
      }
    };

    fetchInitialRuns();
  }, [organizationId]);

  // Handle real-time run updates via WebSocket
  const handleRunUpdate = useCallback((update: RunUpdate) => {
    const activeStatuses = ['running', 'queued', 'publishing', 'pending'];
    const isActive = activeStatuses.includes(update.status);

    // Update active runs map
    setActiveRunsByPipeline((prev) => {
      const newMap = new Map(prev);
      if (isActive) {
        newMap.set(update.pipelineId, true);
      } else {
        newMap.delete(update.pipelineId);
      }
      return newMap;
    });

    // Update runs by pipeline map with partial run data
    setRunsByPipeline((prev) => {
      const newMap = new Map(prev);
      const existingRun = newMap.get(update.pipelineId);

      // Merge update into existing run or create partial run object
      const updatedRun: Run = {
        ...(existingRun || {
          run_id: update.runId,
          pipeline_id: update.pipelineId,
          organization_id: organizationId || '',
          triggered_by: 'unknown',
          created_at: new Date().toISOString(),
        }),
        status: update.status,
        processed_count: update.counts?.processed,
        created_count: update.counts?.created,
        updated_count: update.counts?.updated,
        skipped_count: update.counts?.skipped,
        failed_count: update.counts?.failed,
        duration_ms: update.durationMs,
      } as unknown as Run;

      newMap.set(update.pipelineId, updatedRun);
      return newMap;
    });
  }, [organizationId]);

  // Subscribe to all run updates for the organization (no specific run/pipeline filter)
  useRunUpdates({
    onUpdate: handleRunUpdate,
  });

  return {
    pipelines,
    connectors,
    datasets,
    activeRunsByPipeline,
    runsByPipeline,
    loading,
    error,
  };
}
