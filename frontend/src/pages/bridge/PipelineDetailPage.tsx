import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getPipeline, getConnectorInstances, getDatasets, createRun, executeRun, getRuns, updatePipeline, deletePipeline, getProfiles } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useOrganization } from '../../contexts/useOrganization';
import { usePermissions } from '../../hooks/usePermissions';
import { useRunUpdates } from '../../hooks/useRunUpdates';
import { useWebSocket } from '../../contexts/WebSocketContext';
import ScheduleCard from '../../components/ScheduleCard.tsx';
import JobHistoryDrawer from '../../components/JobHistoryDrawer';
import ConfirmDialog from '../../components/ConfirmDialog';
import AddConnectorModal from '../../components/AddConnectorModal';
import { Plus, ArrowRight, Trash2, Settings } from 'lucide-react';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort, formatDateTime, formatNumber } from '@/lib/formatters';

export default function PipelineDetailPage() {
  const { pipelineId, orgId } = useParams<{ pipelineId: string; orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const { hasPermission } = usePermissions();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showJobHistory, setShowJobHistory] = useState(false);
  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [showAddDestinationModal, setShowAddDestinationModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'source' | 'destination' | 'pipeline'; id: string; name: string } | null>(null);

  const canEdit = hasPermission('pipelines.edit') || hasPermission('routes.edit');
  const canManageSchedules = hasPermission('schedules.manage');
  const canTriggerRun = hasPermission('runs.create');

  // Can delete if user has pipelines.edit permission (admin or registrar)
  const canDelete = canEdit;
  const { isConnected } = useWebSocket();

  // Fetch pipeline details
  const { data: pipeline, isLoading: pipelineLoading } = useQuery({
    queryKey: ['pipeline', pipelineId, activeOrganizationId],
    queryFn: () => getPipeline(pipelineId!, activeOrganizationId!),
    enabled: !!pipelineId && !!activeOrganizationId,
  });

  // Fetch connectors and datasets for display
  const { data: connectors } = useQuery({
    queryKey: ['connectors', activeOrganizationId],
    queryFn: () => getConnectorInstances(activeOrganizationId!),
    enabled: !!activeOrganizationId,
  });

  const { data: datasets } = useQuery({
    queryKey: ['datasets', activeOrganizationId],
    queryFn: () => getDatasets(activeOrganizationId!),
    enabled: !!activeOrganizationId,
  });

  // Fetch recent runs
  const { data: runsData, refetch: refetchRuns } = useQuery({
    queryKey: ['runs', activeOrganizationId, pipelineId],
    queryFn: () => getRuns({ organization_id: activeOrganizationId!, pipeline_id: pipelineId, limit: 5 }),
    enabled: !!activeOrganizationId && !!pipelineId,
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

  // Handle real-time run updates via WebSocket for this pipeline
  const handleRunUpdate = useCallback(() => {
    refetchRuns();
  }, [refetchRuns]);

  // Subscribe to run updates for this specific pipeline
  useRunUpdates({
    pipelineId: pipelineId,
    onUpdate: handleRunUpdate,
  });

  // Run Now mutation
  const runNowMutation = useMutation({
    mutationFn: async () => {
      if (!pipeline || !activeOrganizationId) return;

      // Create a new run
      const newRun = await createRun(pipeline.pipeline_id, activeOrganizationId);

      // Execute it immediately
      await executeRun(newRun.run_id, activeOrganizationId);

      return newRun;
    },
    onSuccess: (newRun) => {
      // Navigate to the run detail page
      window.location.href = `/organizations/${activeOrganizationId}/runs/${newRun?.run_id}`;
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to run pipeline: ${error.message}` });
    },
  });

  // Add Source/Destination mutations
  const addSourceMutation = useMutation({
    mutationFn: async (connectorInstanceId: string) => {
      if (!pipeline) throw new Error('Pipeline not found');

      // Add new source to the existing sources array
      const newSources = [
        ...(pipeline.sources || []).map(s => ({
          connector_instance_id: s.connector_instance_id,
          enabled: s.enabled,
          parameters: s.parameters,
          ordering: s.ordering,
        })),
        {
          connector_instance_id: connectorInstanceId,
          enabled: true,
          parameters: {},
          ordering: pipeline.sources?.length || 0,
        },
      ];

      return updatePipeline(pipeline.pipeline_id, { sources: newSources });
    },
    onSuccess: () => {
      // Refetch pipeline data
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to add source: ${error.message}` });
    },
  });

  const addDestinationMutation = useMutation({
    mutationFn: async (connectorInstanceId: string) => {
      if (!pipeline) throw new Error('Pipeline not found');

      // Add new destination to the existing destinations array
      const newDestinations = [
        ...(pipeline.destinations || []).map(d => ({
          connector_instance_id: d.connector_instance_id,
          enabled: d.enabled,
          parameters: d.parameters,
          ordering: d.ordering,
        })),
        {
          connector_instance_id: connectorInstanceId,
          enabled: true,
          parameters: {},
          ordering: pipeline.destinations?.length || 0,
        },
      ];

      return updatePipeline(pipeline.pipeline_id, { destinations: newDestinations });
    },
    onSuccess: () => {
      // Refetch pipeline data
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to add destination: ${error.message}` });
    },
  });

  // Delete Source/Destination mutations
  const deleteSourceMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      if (!pipeline) throw new Error('Pipeline not found');

      // Remove source from array and reindex ordering
      const newSources = (pipeline.sources || [])
        .filter(s => s.source_id !== sourceId)
        .map((s, idx) => ({
          connector_instance_id: s.connector_instance_id,
          enabled: s.enabled,
          parameters: s.parameters,
          ordering: idx,
        }));

      return updatePipeline(pipeline.pipeline_id, { sources: newSources });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to delete source: ${error.message}` });
    },
  });

  const deleteDestinationMutation = useMutation({
    mutationFn: async (destinationId: string) => {
      if (!pipeline) throw new Error('Pipeline not found');

      // Remove destination from array and reindex ordering
      const newDestinations = (pipeline.destinations || [])
        .filter(d => d.destination_id !== destinationId)
        .map((d, idx) => ({
          connector_instance_id: d.connector_instance_id,
          enabled: d.enabled,
          parameters: d.parameters,
          ordering: idx,
        }));

      return updatePipeline(pipeline.pipeline_id, { destinations: newDestinations });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to delete destination: ${error.message}` });
    },
  });

  // Delete entire pipeline mutation
  const deletePipelineMutation = useMutation({
    mutationFn: async () => {
      if (!pipeline) throw new Error('Pipeline not found');
      return deletePipeline(pipeline.pipeline_id);
    },
    onSuccess: () => {
      // Navigate back to pipelines list
      navigate(`/organizations/${orgId}/bridge/setup/pipelines`);
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to delete pipeline: ${error.message}` });
      setDeleteConfirm(null);
    },
  });

  // Delete detection settings state
  const [deleteDetectionEnabled, setDeleteDetectionEnabled] = useState(false);
  const [deleteDetectionMethod, setDeleteDetectionMethod] = useState<'full_sync' | 'incremental'>('full_sync');

  // Profile settings state
  const [targetProfile, setTargetProfile] = useState<string | null>(null);
  const [profileValidationMode, setProfileValidationMode] = useState<'strict' | 'warn' | 'none'>('warn');

  // Fetch available profiles
  const { data: profiles } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => getProfiles(),
  });

  // Sync state with pipeline data
  useEffect(() => {
    if (pipeline) {
      setDeleteDetectionEnabled(pipeline.delete_detection_enabled ?? false);
      setDeleteDetectionMethod(pipeline.delete_detection_method ?? 'full_sync');
      setTargetProfile(pipeline.target_profile ?? null);
      setProfileValidationMode(pipeline.profile_validation_mode ?? 'warn');
    }
  }, [pipeline]);

  // Update delete detection settings mutation
  const updateDeleteDetectionMutation = useMutation({
    mutationFn: async (settings: {
      delete_detection_enabled: boolean;
      delete_detection_method: 'full_sync' | 'incremental' | null;
    }) => {
      if (!pipeline) throw new Error('Pipeline not found');
      return updatePipeline(pipeline.pipeline_id, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to update settings: ${error.message}` });
    },
  });

  // Update destination delete settings mutation
  const updateDestinationDeleteSettingsMutation = useMutation({
    mutationFn: async (params: { destinationId: string; publishDeletes: boolean }) => {
      if (!pipeline) throw new Error('Pipeline not found');

      const newDestinations = (pipeline.destinations || []).map(d => ({
        connector_instance_id: d.connector_instance_id,
        enabled: d.enabled,
        parameters: d.parameters,
        ordering: d.ordering,
        publish_deletes: d.destination_id === params.destinationId ? params.publishDeletes : d.publish_deletes ?? false,
        delete_strategy: d.delete_strategy,
      }));

      return updatePipeline(pipeline.pipeline_id, { destinations: newDestinations });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to update destination settings: ${error.message}` });
    },
  });

  const handleDeleteDetectionToggle = () => {
    const newEnabled = !deleteDetectionEnabled;
    setDeleteDetectionEnabled(newEnabled);
    updateDeleteDetectionMutation.mutate({
      delete_detection_enabled: newEnabled,
      delete_detection_method: newEnabled ? deleteDetectionMethod : null,
    });
  };

  const handleDeleteDetectionMethodChange = (method: 'full_sync' | 'incremental') => {
    setDeleteDetectionMethod(method);
    updateDeleteDetectionMutation.mutate({
      delete_detection_enabled: true,
      delete_detection_method: method,
    });
  };

  // Update profile settings mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (settings: {
      target_profile: string | null;
      profile_validation_mode: 'strict' | 'warn' | 'none' | null;
    }) => {
      if (!pipeline) throw new Error('Pipeline not found');
      return updatePipeline(pipeline.pipeline_id, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to update profile settings: ${error.message}` });
    },
  });

  const handleProfileChange = (profileName: string | null) => {
    setTargetProfile(profileName);
    updateProfileMutation.mutate({
      target_profile: profileName,
      profile_validation_mode: profileName ? profileValidationMode : null,
    });
  };

  const handleValidationModeChange = (mode: 'strict' | 'warn' | 'none') => {
    setProfileValidationMode(mode);
    updateProfileMutation.mutate({
      target_profile: targetProfile,
      profile_validation_mode: mode,
    });
  };

  const handleRunNow = () => {
    setShowRunConfirm(true);
  };

  const handleConfirmRunNow = () => {
    runNowMutation.mutate();
    setShowRunConfirm(false);
  };

  if (pipelineLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-archive">Pipeline not found</div>
      </div>
    );
  }

  // Map sources/destinations with connector details
  const sources = (pipeline.sources || []).map(source => ({
    ...source,
    connector: connectors?.find(c => c.connector_instance_id === source.connector_instance_id),
  }));

  const destinations = (pipeline.destinations || []).map(dest => ({
    ...dest,
    connector: connectors?.find(c => c.connector_instance_id === dest.connector_instance_id),
    publish_deletes: dest.publish_deletes ?? false,
    delete_strategy: dest.delete_strategy ?? null,
  }));

  const dataset = pipeline.dataset_id
    ? datasets?.find((d) => d.dataset_id === pipeline.dataset_id)
    : null;

  // Determine health status
  const getHealthStatus = () => {
    if (!runsData?.items || runsData.items.length === 0) {
      return { emoji: '🟡', label: 'Idle', subtitle: 'No runs recently' };
    }
    const lastRun = runsData.items[0];
    if (lastRun.status === 'success') {
      return { emoji: '🟢', label: 'Healthy', subtitle: 'Recent successful runs' };
    }
    if (lastRun.status === 'failed') {
      return { emoji: '🔴', label: 'Attention', subtitle: 'Last run failed' };
    }
    return { emoji: '🟡', label: 'Idle', subtitle: 'No recent activity' };
  };

  const healthStatus = getHealthStatus();

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to={`/organizations/${orgId}/bridge/setup/pipelines`}
            className="text-sm text-archive hover:text-ink mb-2 inline-block"
          >
            ← Back to Pipelines
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">{pipeline.name}</h1>
            <div className="flex items-center gap-2 px-3 py-1 bg-stone rounded-full">
              <span className="text-lg" role="img" aria-label="status">{healthStatus.emoji}</span>
              <div className="text-xs">
                <div className="font-medium text-ink">{healthStatus.label}</div>
                <div className="text-archive">{healthStatus.subtitle}</div>
              </div>
            </div>
          </div>
          <p className="text-base text-archive mt-2">
            {sources.length > 0
              ? `Ingests data from ${sources.length} source${sources.length > 1 ? 's' : ''} into ${dataset?.name || 'canonical dataset'}`
              : 'Pipeline configuration'
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canTriggerRun && (
            <button
              onClick={handleRunNow}
              disabled={runNowMutation.isPending}
              className="btn-primary"
            >
              {runNowMutation.isPending ? 'Running...' : 'Run now'}
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteConfirm({ type: 'pipeline', id: pipeline.pipeline_id, name: pipeline.name ?? 'Unnamed Pipeline' })}
              className="px-4 py-2 border border-semantic-error text-semantic-error rounded-md hover:bg-semantic-error/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Pipeline
            </button>
          )}
        </div>
      </div>

      {/* FLOW SECTION */}
      <div className="bg-parchment shadow-sm rounded-lg border border-lichen p-6">
        <h2 className="text-lg font-semibold text-ink mb-6">Flow</h2>

        <div className="flex items-center gap-6">
          {/* Sources Column */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">Sources</h3>
              <span className="text-xs text-archive">{sources.length}</span>
            </div>
            <div className="space-y-2">
              {sources.length === 0 ? (
                <div className="p-4 border-2 border-dashed border-semantic-warning/30 rounded-lg bg-semantic-warning/10">
                  <div className="text-sm font-medium text-semantic-warning mb-1">
                    No sources configured
                  </div>
                  <div className="text-xs text-semantic-warning mb-3">
                    Add at least one source to extract data
                  </div>
                  {canEdit && (
                    <button
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-semantic-warning text-parchment text-xs font-medium rounded-md hover:bg-semantic-warning transition-colors"
                      onClick={() => setShowAddSourceModal(true)}
                    >
                      <Plus className="h-3 w-3" />
                      Add source
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {sources.map((source, idx) => (
                    <div key={source.source_id || idx} className="p-3 border border-lichen rounded-lg bg-stone hover:bg-stone transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-ink">
                            {source.connector?.name || 'Unnamed Source'}
                          </div>
                          <div className="text-xs text-archive mt-0.5">
                            Order: {source.ordering + 1}
                          </div>
                        </div>
                        <div className="ml-2 flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            source.enabled ? 'badge-success-subtle' : 'badge-neutral'
                          }`}>
                            {source.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          {canDelete && sources.length > 1 && (
                            <button
                              onClick={() => setDeleteConfirm({
                                type: 'source',
                                id: source.source_id,
                                name: source.connector?.name || 'this source'
                              })}
                              className="text-semantic-error hover:text-semantic-error p-1 rounded hover:bg-semantic-error/5 transition-colors"
                              title="Delete source"
                              aria-label={`Delete source ${source.connector?.name || ''}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {source.connector && (
                        <Link
                          to={`/organizations/${orgId}/bridge/setup/connectors/${source.connector.connector_instance_id}`}
                          className="text-xs link-subtle inline-flex items-center gap-1"
                        >
                          View connector →
                        </Link>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button
                      className="w-full p-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-stone hover:text-ink transition-colors flex items-center justify-center gap-1"
                      onClick={() => setShowAddSourceModal(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Add another source
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div className="flex-shrink-0 text-archive">
            <ArrowRight className="h-6 w-6" />
          </div>

          {/* Dataset Column */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">Dataset</h3>
            </div>
            <div className="space-y-2">
              {dataset ? (
                <Link
                  to={`/organizations/${orgId}/bridge/datasets/${dataset.dataset_id}`}
                  className="block p-4 border border-lichen rounded-lg bg-gradient-to-br from-semantic-info/10 to-bark/5 hover:from-semantic-info/20 hover:to-bark/10 transition-colors"
                >
                  <div className="text-sm font-semibold text-ink mb-2">
                    {dataset.name}
                  </div>
                  <div className="space-y-1">
                    {dataset.entity_count !== undefined && (
                      <div className="text-xs text-ink">
                        <span className="font-medium">{formatNumber(dataset.entity_count)}</span> records
                      </div>
                    )}
                    {dataset.updated_at && (
                      <div className="text-xs text-archive">
                        Updated {formatDateShort(dataset.updated_at)}
                      </div>
                    )}
                  </div>
                </Link>
              ) : (
                <div className="p-4 border-2 border-dashed border-lichen rounded-lg bg-stone">
                  <div className="text-sm text-archive mb-2">
                    No dataset assigned
                  </div>
                  <div className="text-xs text-archive mb-3">
                    Data will be auto-matched by source type
                  </div>
                  {canEdit && datasets && datasets.length > 0 && (
                    <select
                      className="input w-full"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          updatePipeline(pipeline.pipeline_id, { dataset_id: e.target.value })
                            .then(() => {
                              queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId, activeOrganizationId] });
                            })
                            .catch((err: any) => {
                              showToast({ type: 'error', title: 'Error', message: `Failed to assign dataset: ${err.message}` });
                            });
                        }
                      }}
                    >
                      <option value="">Select dataset...</option>
                      {datasets.map((ds) => (
                        <option key={ds.dataset_id} value={ds.dataset_id}>
                          {ds.name}{ds.entity_count !== undefined ? ` (${formatNumber(ds.entity_count)} records)` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div className="flex-shrink-0 text-archive">
            <ArrowRight className="h-6 w-6" />
          </div>

          {/* Destinations Column */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">Destinations</h3>
              <span className="text-xs text-archive">{destinations.length}</span>
            </div>
            <div className="space-y-2">
              {destinations.length === 0 ? (
                <div className="p-4 border-2 border-dashed border-lichen rounded-lg bg-stone">
                  <div className="text-sm font-medium text-ink mb-1">
                    No destinations
                  </div>
                  <div className="text-xs text-archive mb-3">
                    Data writes to canonical dataset only
                  </div>
                  {canEdit && (
                    <button
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-archive text-parchment text-xs font-medium rounded-md hover:bg-ink transition-colors"
                      onClick={() => setShowAddDestinationModal(true)}
                    >
                      <Plus className="h-3 w-3" />
                      Add destination
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {destinations.map((dest, idx) => (
                    <div key={dest.destination_id || idx} className="p-3 border border-lichen rounded-lg bg-stone hover:bg-stone transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-ink">
                            {dest.connector?.name || 'Unnamed Destination'}
                          </div>
                          <div className="text-xs text-archive mt-0.5">
                            Order: {dest.ordering + 1}
                          </div>
                        </div>
                        <div className="ml-2 flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            dest.enabled ? 'badge-success-subtle' : 'badge-neutral'
                          }`}>
                            {dest.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          {canDelete && (
                            <button
                              onClick={() => setDeleteConfirm({
                                type: 'destination',
                                id: dest.destination_id,
                                name: dest.connector?.name || 'this destination'
                              })}
                              className="text-semantic-error hover:text-semantic-error p-1 rounded hover:bg-semantic-error/5 transition-colors"
                              title="Delete destination"
                              aria-label={`Delete destination ${dest.connector?.name || ''}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {dest.connector && (
                        <Link
                          to={`/organizations/${orgId}/bridge/setup/connectors/${dest.connector.connector_instance_id}`}
                          className="text-xs link-subtle inline-flex items-center gap-1"
                        >
                          View connector →
                        </Link>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button
                      className="w-full p-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-stone hover:text-ink transition-colors flex items-center justify-center gap-1"
                      onClick={() => setShowAddDestinationModal(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Add another destination
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SETTINGS */}
      <div className="bg-parchment shadow-sm rounded-lg border border-lichen p-6">
        <div className="flex items-center gap-2 mb-6">
          <Settings className="h-5 w-5 text-archive" />
          <h2 className="text-lg font-semibold text-ink">Settings</h2>
        </div>

        {/* Delete Detection */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-ink mb-3">Delete Detection</h3>
            <p className="text-xs text-archive mb-4">
              When enabled, entities that are no longer present in the source will be marked as deleted in the canonical store.
            </p>

            <div className="flex items-center justify-between p-4 bg-stone rounded-lg">
              <div className="flex-1">
                <div className="text-sm font-medium text-ink">Enable delete detection</div>
                <div className="text-xs text-archive mt-1">
                  Detect and track entities removed from source systems
                </div>
              </div>
              <button
                onClick={handleDeleteDetectionToggle}
                disabled={!canEdit || updateDeleteDetectionMutation.isPending}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  deleteDetectionEnabled ? 'bg-bark' : 'bg-stone'
                } ${!canEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                role="switch"
                aria-checked={deleteDetectionEnabled}
                aria-label="Enable delete detection"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-parchment transition-transform ${
                    deleteDetectionEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {deleteDetectionEnabled && (
              <div className="mt-4 p-4 border border-lichen rounded-lg">
                <label htmlFor="delete-detection-method" className="block text-sm font-medium text-ink mb-2">
                  Detection Method
                </label>
                <select
                  id="delete-detection-method"
                  value={deleteDetectionMethod}
                  onChange={(e) => handleDeleteDetectionMethodChange(e.target.value as 'full_sync' | 'incremental')}
                  disabled={!canEdit || updateDeleteDetectionMutation.isPending}
                  className="block w-full px-3 py-2 border border-lichen rounded-md shadow-sm focus-visible:outline-none focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="full_sync">Full Sync (compare all records each run)</option>
                  <option value="incremental" disabled>Incremental (coming soon)</option>
                </select>
                <p className="mt-2 text-xs text-archive">
                  Full sync compares extracted entity keys against known entities to detect deletions.
                  Entities not seen in the current run will be marked as deleted.
                </p>
              </div>
            )}
          </div>

          {/* Destination Delete Settings */}
          {deleteDetectionEnabled && destinations.length > 0 && (
            <div className="mt-6 pt-6 border-t border-lichen">
              <h3 className="text-sm font-medium text-ink mb-3">Destination Settings</h3>
              <p className="text-xs text-archive mb-4">
                Configure how each destination handles deleted entities.
              </p>

              <div className="space-y-3">
                {destinations.map((dest) => (
                  <div key={dest.destination_id} className="flex items-center justify-between p-3 bg-stone rounded-lg">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-ink">
                        {dest.connector?.name || 'Unnamed Destination'}
                      </div>
                      <div className="text-xs text-archive mt-0.5">
                        {dest.publish_deletes ? 'Deletes will be published' : 'Deletes will not be published'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-archive">Publish deletes</span>
                      <button
                        onClick={() => updateDestinationDeleteSettingsMutation.mutate({
                          destinationId: dest.destination_id,
                          publishDeletes: !dest.publish_deletes,
                        })}
                        disabled={!canEdit || updateDestinationDeleteSettingsMutation.isPending}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          dest.publish_deletes ? 'bg-bark' : 'bg-stone'
                        } ${!canEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        role="switch"
                        aria-checked={dest.publish_deletes ?? false}
                        aria-label={`Publish deletes for ${dest.connector?.name || 'Unnamed Destination'}`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-parchment transition-transform ${
                            dest.publish_deletes ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Profile Configuration */}
          <div className="mt-6 pt-6 border-t border-lichen">
            <h3 className="text-sm font-medium text-ink mb-3">Data Profile</h3>
            <p className="text-xs text-archive mb-4">
              Assign a data profile to validate and enrich records during ingestion.
              Profiles define required fields and data standards for your domain.
            </p>

            <div className="space-y-4">
              <div>
                <label htmlFor="target-profile" className="block text-sm font-medium text-ink mb-2">
                  Target Profile
                </label>
                <select
                  id="target-profile"
                  value={targetProfile || ''}
                  onChange={(e) => handleProfileChange(e.target.value || null)}
                  disabled={!canEdit || updateProfileMutation.isPending}
                  className="block w-full px-3 py-2 border border-lichen rounded-md shadow-sm focus-visible:outline-none focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">No profile (skip validation)</option>
                  {profiles?.map((profile) => (
                    <option key={profile.name} value={profile.name}>
                      {profile.name.charAt(0).toUpperCase() + profile.name.slice(1)} - {profile.description}
                    </option>
                  ))}
                </select>
              </div>

              {targetProfile && (
                <div className="p-4 border border-lichen rounded-lg">
                  <label htmlFor="validation-mode" className="block text-sm font-medium text-ink mb-2">
                    Validation Mode
                  </label>
                  <select
                    id="validation-mode"
                    value={profileValidationMode}
                    onChange={(e) => handleValidationModeChange(e.target.value as 'strict' | 'warn' | 'none')}
                    disabled={!canEdit || updateProfileMutation.isPending}
                    className="block w-full px-3 py-2 border border-lichen rounded-md shadow-sm focus-visible:outline-none focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="warn">Warn (log issues, include all records)</option>
                    <option value="strict">Strict (reject invalid records)</option>
                    <option value="none">None (skip validation)</option>
                  </select>
                  <p className="mt-2 text-xs text-archive">
                    {profileValidationMode === 'strict' && 'Records that fail validation will be excluded from the canonical store.'}
                    {profileValidationMode === 'warn' && 'All records are included, but validation issues are logged for review.'}
                    {profileValidationMode === 'none' && 'No validation is performed. Profile metadata is still applied.'}
                  </p>

                  {/* Profile details */}
                  {profiles?.find(p => p.name === targetProfile) && (
                    <div className="mt-4 pt-4 border-t border-lichen">
                      <div className="text-xs text-archive">
                        <span className="font-medium">Required fields:</span>{' '}
                        {profiles.find(p => p.name === targetProfile)?.required_fields.map(f => f.name).join(', ') || 'None'}
                      </div>
                      <div className="text-xs text-archive mt-1">
                        <span className="font-medium">Recommended:</span>{' '}
                        {profiles.find(p => p.name === targetProfile)?.recommended_fields.slice(0, 5).map(f => f.name).join(', ') || 'None'}
                        {(profiles.find(p => p.name === targetProfile)?.recommended_fields.length || 0) > 5 && '...'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* EXECUTION */}
      <div className="bg-parchment shadow-sm rounded-lg border border-lichen p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Execution</h2>

        {/* Schedule */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink mb-3">Schedule</h3>
          <ScheduleCard pipelineId={pipeline.pipeline_id} canEdit={canManageSchedules} />
        </div>

        {/* Last Run Section */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink mb-3">Last Run</h3>
          {runsData?.items && runsData.items.length > 0 ? (
            <div className="flex items-center justify-between p-3 bg-stone rounded-md">
              <div>
                <div className="text-sm text-ink">
                  {formatDateTime(runsData.items[0].finished_at || runsData.items[0].started_at || '')}
                </div>
                <div className="text-xs text-archive mt-1">
                  Status: <span className={`font-medium ${
                    runsData.items[0].status === 'success' ? 'text-semantic-success' :
                    runsData.items[0].status === 'failed' ? 'text-semantic-error' :
                    'text-archive'
                  }`}>{runsData.items[0].status}</span>
                </div>
              </div>
              <Link
                to={`/organizations/${orgId}/bridge/runs/${runsData.items[0].run_id}`}
                className="text-sm link-subtle"
              >
                View details →
              </Link>
            </div>
          ) : (
            <p className="text-sm text-archive italic">No runs yet</p>
          )}
        </div>

        {/* Inline Run History Summary */}
        <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-ink">Recent Runs</h3>
              <Link
                to={`/organizations/${orgId}/bridge/runs?pipeline_id=${pipeline.pipeline_id}`}
                className="text-sm link-subtle"
              >
                View all runs →
              </Link>
            </div>
            {runsData?.items && runsData.items.length > 0 ? (
              <div className="space-y-2">
                {runsData.items.slice(0, 5).map((run) => (
                  <Link
                    key={run.run_id}
                    to={`/organizations/${orgId}/bridge/runs/${run.run_id}`}
                    className="flex items-center justify-between p-2 hover:bg-stone rounded-md border border-lichen"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="flex items-center gap-3">
                      <span className={
                        run.status === 'success' ? 'badge-success-subtle' :
                        run.status === 'failed' ? 'badge-error-subtle' :
                        run.status === 'running' ? 'badge-info-subtle' :
                        'badge-neutral'
                      }>
                        {run.status}
                      </span>
                      <span className="text-sm text-archive">
                        {formatDateTime(run.finished_at || run.started_at || '')}
                      </span>
                    </div>
                    {run.counts && (
                      <span className="text-xs text-archive">
                        {run.counts.created + run.counts.updated} processed
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-archive italic">No run history</p>
            )}
          </div>
      </div>

      {/* Job History Drawer (Admin/Engineer only) */}
      {canEdit && activeOrganizationId && (
        <JobHistoryDrawer
          isOpen={showJobHistory}
          onClose={() => setShowJobHistory(false)}
          pipelineId={pipeline.pipeline_id}
          organizationId={activeOrganizationId}
        />
      )}

      {/* Run Now Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showRunConfirm}
        onClose={() => setShowRunConfirm(false)}
        onConfirm={handleConfirmRunNow}
        title="Run Pipeline Now"
        message="Run this pipeline now? This will create a new job and execute it immediately."
        confirmText="Run now"
        confirmStyle="primary"
      />

      {/* Add Source Modal */}
      <AddConnectorModal
        isOpen={showAddSourceModal}
        onClose={() => setShowAddSourceModal(false)}
        onAdd={(connectorId) => addSourceMutation.mutate(connectorId)}
        title="Add Source"
        connectors={connectors || []}
        existingConnectorIds={(pipeline.sources || []).map(s => s.connector_instance_id)}
      />

      {/* Add Destination Modal */}
      <AddConnectorModal
        isOpen={showAddDestinationModal}
        onClose={() => setShowAddDestinationModal(false)}
        onAdd={(connectorId) => addDestinationMutation.mutate(connectorId)}
        title="Add Destination"
        connectors={connectors || []}
        existingConnectorIds={(pipeline.destinations || []).map(d => d.connector_instance_id)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm?.type === 'source') {
            deleteSourceMutation.mutate(deleteConfirm.id);
          } else if (deleteConfirm?.type === 'destination') {
            deleteDestinationMutation.mutate(deleteConfirm.id);
          } else if (deleteConfirm?.type === 'pipeline') {
            deletePipelineMutation.mutate();
          }
        }}
        title={deleteConfirm?.type === 'pipeline' ? 'Delete Pipeline' : `Delete ${deleteConfirm?.type === 'source' ? 'Source' : 'Destination'}`}
        message={
          deleteConfirm?.type === 'pipeline'
            ? `Delete pipeline "${deleteConfirm?.name}"? This will permanently remove the pipeline and all its configuration. This action cannot be undone.`
            : `Remove "${deleteConfirm?.name}" from this pipeline? This action cannot be undone.`
        }
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
