/**
 * PipelinesPage
 *
 * Displays pipelines - the execution abstraction for data flows in Madrona.
 */
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { GitBranch, Trash2, Plus } from 'lucide-react';
import { getPipelines, createPipeline, deletePipeline, getConnectorInstances, getDatasets, getRuns, getPipelineSchedule } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useOrganization } from '../../contexts/useOrganization';
import { usePermissions } from '../../hooks/usePermissions';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { PipelineSchedule } from '../../lib/api';
import type { ConnectorInstance } from '../../lib/schemas';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// Helper to format schedule frequency for display
function formatScheduleFrequency(schedule: PipelineSchedule | null | undefined): string {
  if (!schedule || !schedule.enabled) return 'Manual';

  if (schedule.type === 'interval') {
    const n = schedule.every_n || 1;
    const unit = schedule.unit || 'hours';
    const unitDisplay = n === 1 ? unit.slice(0, -1) : unit; // Remove 's' for singular
    return `Every ${n} ${unitDisplay}`;
  }

  if (schedule.type === 'time') {
    const hour = schedule.time_hour ?? 0;
    const minute = schedule.time_minute ?? 0;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    const displayMinute = minute.toString().padStart(2, '0');
    return `Daily at ${displayHour}:${displayMinute} ${period}`;
  }

  return 'Scheduled';
}

// Helper to validate JSON
function isValidJson(str: string): boolean {
  if (!str.trim()) return true; // Empty is valid (will default to {})
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export default function PipelinesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const { hasPermission } = usePermissions();
  const { showToast } = useToast();

  // Permissions
  const canDelete = hasPermission('pipelines.edit') || hasPermission('routes.edit');
  const canCreate = hasPermission('pipelines.edit') || hasPermission('routes.edit');

  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deleteConfirmPipeline, setDeleteConfirmPipeline] = useState<{ id: string; name: string } | null>(null);
  const [formData, setFormData] = useState({
    source_instance_id: '',
    target_instance_id: '',
    dataset_id: '',
    options: '{}',
  });

  // Fetch pipelines for current organization
  const {
    data: pipelines,
    isLoading: pipelinesLoading,
    error: pipelinesError
  } = useQuery({
    queryKey: ['pipelines', organizationId],
    queryFn: () => getPipelines(organizationId || undefined),
    enabled: !!organizationId,
  });

  // Fetch connector instances for current organization
  const {
    data: instances,
    isLoading: instancesLoading
  } = useQuery({
    queryKey: ['connector-instances', organizationId],
    queryFn: () => getConnectorInstances(organizationId || undefined),
    enabled: !!organizationId,
  });

  // Fetch datasets for current organization
  const {
    data: datasets,
    isLoading: datasetsLoading
  } = useQuery({
    queryKey: ['datasets', organizationId],
    queryFn: () => organizationId ? getDatasets(organizationId) : Promise.resolve([]),
    enabled: !!organizationId,
  });

  // Fetch runs for status display
  const { data: _runsData } = useQuery({
    queryKey: ['runs', organizationId],
    queryFn: () => organizationId ? getRuns({ organization_id: organizationId, limit: 200 }) : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 }),
    enabled: !!organizationId,
    refetchInterval: (query) => {
      const runs = query.state.data?.items;
      if (!runs || runs.length === 0) return false;
      const hasActiveRun = runs.some(run =>
        ['pending', 'queued', 'running', 'publishing'].includes(run.status)
      );
      return hasActiveRun ? 2000 : false;
    },
  });

  // Fetch schedules for all pipelines
  const scheduleQueries = useQueries({
    queries: (pipelines || []).map(pipeline => ({
      queryKey: ['schedule', pipeline.pipeline_id],
      queryFn: () => getPipelineSchedule(pipeline.pipeline_id),
      enabled: !!pipeline.pipeline_id,
    }))
  });

  // Filter instances by direction using the direction field from backend
  const sourceInstances = useMemo(() =>
    instances?.filter((inst: ConnectorInstance) =>
      inst.direction === 'source' || inst.direction === 'both'
    ) || [],
    [instances]
  );

  const targetInstances = useMemo(() =>
    instances?.filter((inst: ConnectorInstance) =>
      inst.direction === 'target' || inst.direction === 'both'
    ) || [],
    [instances]
  );

  const createMutation = useMutation({
    mutationFn: createPipeline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      setShowCreateForm(false);
      // Reset form but keep same org context
      setFormData({
        source_instance_id: '',
        target_instance_id: '',
        dataset_id: '',
        options: '{}',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePipeline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });

  const handleConfirmDelete = () => {
    if (deleteConfirmPipeline) {
      deleteMutation.mutate(deleteConfirmPipeline.id);
      setDeleteConfirmPipeline(null);
    }
  };

  const handleCreate = () => {
    if (!isValidJson(formData.options)) {
      showToast({ type: 'error', title: 'Error', message: 'Invalid JSON in options field' });
      return;
    }

    const options = formData.options.trim() ? JSON.parse(formData.options) : undefined;
    createMutation.mutate({
      organization_id: organizationId!,
      source_instance_id: formData.source_instance_id,
      target_instance_id: formData.target_instance_id || undefined,
      dataset_id: formData.dataset_id || undefined,
      options,
    });
  };

  // Check if options JSON is valid for real-time feedback
  const optionsJsonValid = isValidJson(formData.options);

  // Loading state
  const isLoading = pipelinesLoading || instancesLoading || datasetsLoading;

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center justify-center py-12">
          <MadronaLoader variant="dots" />
        </div>
      </div>
    );
  }

  // Error state
  if (pipelinesError) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-6 text-center">
          <h2 className="text-lg font-semibold text-semantic-error mb-2">Error loading pipelines</h2>
          <p className="text-semantic-error">{(pipelinesError as Error).message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <GitBranch className="w-6 h-6 text-forest" style={{ opacity: 0.6 }} />
              <h1 className="text-2xl font-semibold text-ink">Pipelines</h1>
            </div>
            <p className="text-sm text-archive">
              Pipelines define how data flows through Madrona.
            </p>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="btn-primary text-sm"
            >
              {showCreateForm ? 'Cancel' : 'Create Pipeline'}
            </button>
          )}
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <div className="bg-parchment p-6 rounded-lg border border-lichen">
            <h2 className="text-xl font-semibold text-ink mb-2">New Pipeline</h2>
            <p className="text-sm text-archive mb-4">
              A pipeline extracts data from inputs, writes to a canonical dataset, and optionally sends to outputs.
            </p>
            <div className="space-y-4">
              {/* Organization is auto-set from context - show read-only */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Organization</label>
                <div className="w-full border border-lichen bg-stone rounded-md px-3 py-2 text-archive">
                  {organizationId ? `Current organization` : 'No organization selected'}
                </div>
              </div>

              <div>
                <label htmlFor="pipeline-input-connector" className="block text-sm font-medium text-ink mb-1">
                  Input Connector
                </label>
                <select
                  id="pipeline-input-connector"
                  value={formData.source_instance_id}
                  onChange={(e) =>
                    setFormData({ ...formData, source_instance_id: e.target.value })
                  }
                  className="w-full border border-lichen rounded-md px-3 py-2"
                >
                  <option value="">Select input connector</option>
                  {sourceInstances.map((instance: ConnectorInstance) => (
                    <option key={instance.connector_instance_id} value={instance.connector_instance_id}>
                      {instance.name}
                    </option>
                  ))}
                </select>
                {sourceInstances.length === 0 && (
                  <p className="text-xs text-semantic-warning mt-1">
                    No input connectors found. Create an input connector first.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="pipeline-output-connector" className="block text-sm font-medium text-ink mb-1">
                  Output Connector <span className="text-archive">(optional)</span>
                </label>
                <select
                  id="pipeline-output-connector"
                  value={formData.target_instance_id}
                  onChange={(e) =>
                    setFormData({ ...formData, target_instance_id: e.target.value })
                  }
                  className="w-full border border-lichen rounded-md px-3 py-2"
                >
                  <option value="">None (dataset only)</option>
                  {targetInstances.map((instance: ConnectorInstance) => (
                    <option key={instance.connector_instance_id} value={instance.connector_instance_id}>
                      {instance.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-archive mt-1">
                  Optionally send data to an external system after writing to the dataset.
                </p>
              </div>

              <div>
                <label htmlFor="pipeline-target-dataset" className="block text-sm font-medium text-ink mb-1">
                  Target Dataset <span className="text-archive">(optional)</span>
                </label>
                <select
                  id="pipeline-target-dataset"
                  value={formData.dataset_id}
                  onChange={(e) =>
                    setFormData({ ...formData, dataset_id: e.target.value })
                  }
                  className="w-full border border-lichen rounded-md px-3 py-2"
                >
                  <option value="">Auto-match by input type</option>
                  {datasets?.map((dataset) => (
                    <option key={dataset.dataset_id} value={dataset.dataset_id}>
                      {dataset.name} ({dataset.key})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-archive mt-1">
                  Each pipeline writes to a canonical dataset. Leave empty to auto-match based on the input connector type.
                </p>
              </div>

              <div>
                <label htmlFor="pipeline-options" className="block text-sm font-medium text-ink mb-1">
                  Options (JSON, optional)
                </label>
                <textarea
                  id="pipeline-options"
                  value={formData.options}
                  onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                  rows={4}
                  className={`w-full border rounded-md px-3 py-2 font-mono text-sm ${
                    optionsJsonValid ? 'border-lichen' : 'border-semantic-error bg-semantic-error/10'
                  }`}
                  placeholder='{"max_records": 1000}'
                  aria-label="Options JSON"
                />
                {!optionsJsonValid && (
                  <p className="text-xs text-semantic-error mt-1">Invalid JSON format</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={
                    !organizationId ||
                    !formData.source_instance_id ||
                    !optionsJsonValid ||
                    createMutation.isPending
                  }
                  className="btn-primary text-sm"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Pipeline'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="btn-tertiary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pipelines List */}
        {pipelines && pipelines.length > 0 ? (
          <div className="space-y-4">
            {pipelines.map((pipeline, index) => {
              // Get first source and destination for display
              const firstSource = pipeline.sources?.[0];

              const sourceInstance = firstSource ? instances?.find(
                (i: ConnectorInstance) => i.connector_instance_id === firstSource.connector_instance_id
              ) : null;
              const dataset = pipeline.dataset_id ? datasets?.find((d) => d.dataset_id === pipeline.dataset_id) : null;

              // Get schedule data for this pipeline
              const scheduleData = scheduleQueries[index]?.data;
              const schedule = scheduleData?.schedule;

              // Create source display with count
              const sourceName = sourceInstance?.name || 'Unknown Source';
              const sourceCount = pipeline.sources?.length || 0;
              const sourceDisplay = sourceCount > 1 ? `${sourceName} +${sourceCount - 1}` : sourceName;

              // Format destination names
              const allDestNames = pipeline.destinations?.map(dest => {
                const inst = instances?.find((i: ConnectorInstance) => i.connector_instance_id === dest.connector_instance_id);
                return inst?.name || 'Unknown';
              }) || [];

              const destDisplayText = allDestNames.length === 0
                ? 'None configured'
                : allDestNames.length === 1
                  ? allDestNames[0]
                  : `${allDestNames[0]} +${allDestNames.length - 1}`;

              const displayName = pipeline.name || sourceName;

              return (
                <Link
                  key={pipeline.pipeline_id}
                  to={`/organizations/${organizationId}/bridge/setup/pipelines/${pipeline.pipeline_id}`}
                  className="block bg-parchment border border-lichen rounded-lg hover:border-stone-300 hover:bg-stone-50/50 transition-colors"
                >
                  <div className="p-5">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="flex-shrink-0 mt-0.5">
                        <GitBranch className="h-6 w-6 text-forest" style={{ opacity: 0.5 }} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-ink">
                            {displayName}
                          </h3>
                          <span className={
                            pipeline.status === 'active' ? 'badge-success-subtle' : 'badge-neutral'
                          }>
                            {pipeline.status}
                          </span>
                        </div>

                        {/* Description */}
                        <p className="mt-1 text-sm text-archive">
                          {dataset ? `Writes to ${dataset.name}` : 'Auto-match dataset by input type'}
                        </p>

                        {/* Metadata row */}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-archive">
                          {/* Input */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-archive">Input:</span>
                            <span className="text-ink font-medium">{sourceDisplay}</span>
                          </div>

                          {/* Output */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-archive">Output:</span>
                            {allDestNames.length === 0 ? (
                              <span className="italic text-archive">None</span>
                            ) : (
                              <span className="text-ink font-medium">{destDisplayText}</span>
                            )}
                          </div>

                          {/* Schedule */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-archive">Schedule:</span>
                            <span className="text-ink">{formatScheduleFrequency(schedule)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Delete action */}
                      {canDelete && (
                        <div className="flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteConfirmPipeline({ id: pipeline.pipeline_id, name: displayName });
                            }}
                            className="text-archive hover:text-semantic-error text-sm"
                            aria-label={`Delete pipeline ${displayName}`}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="bg-parchment border border-lichen rounded-lg p-8 text-center">
            <GitBranch size={48} className="text-archive mx-auto mb-4" />
            <h3 className="font-medium text-ink mb-6">No pipelines yet.</h3>
            {canCreate && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Plus size={16} />
                Create Pipeline
              </button>
            )}
          </div>
        )}

        {/* Info footer */}
        {pipelines && pipelines.length > 0 && (
          <div className="text-xs text-archive border-t border-lichen pt-4">
            Pipelines extract data from input connectors, transform it to canonical format, and write to datasets.
            Each run creates a versioned snapshot of the data.
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmPipeline !== null}
        onClose={() => setDeleteConfirmPipeline(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Pipeline"
        message={`Delete pipeline "${deleteConfirmPipeline?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
