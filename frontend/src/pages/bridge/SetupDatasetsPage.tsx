/**
 * Datasets Page
 *
 * Displays canonical datasets produced by pipelines.
 * Datasets are durable collections of canonical entities that can be
 * reused across multiple outputs and applications.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { GitBranch, Clock, Database } from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import { getDatasets, getPipelines, createDataset } from '../../lib/api';
import { useOrganization } from '../../contexts/useOrganization';
import type { Dataset, Pipeline } from '../../lib/schemas';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatRelativeTime, formatNumber } from '@/lib/formatters';

export default function SetupDatasetsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', key: '', description: '', source_type: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Fetch datasets
  const { data: datasets, isLoading: datasetsLoading } = useQuery({
    queryKey: ['datasets', organizationId],
    queryFn: () => getDatasets(organizationId!),
    enabled: !!organizationId,
  });

  // Fetch pipelines to show which pipeline produces each dataset
  const { data: pipelines } = useQuery({
    queryKey: ['pipelines', organizationId],
    queryFn: () => getPipelines(organizationId || undefined),
    enabled: !!organizationId,
  });

  // Create a map of dataset IDs to their producing pipelines
  const datasetPipelines = new Map<string, Pipeline[]>();
  pipelines?.forEach((pipeline) => {
    if (pipeline.dataset_id) {
      const existing = datasetPipelines.get(pipeline.dataset_id) || [];
      datasetPipelines.set(pipeline.dataset_id, [...existing, pipeline]);
    }
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: createDataset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      setShowCreateForm(false);
      setFormData({ name: '', key: '', description: '', source_type: '' });
      setFormErrors({});
    },
    onError: (error: any) => {
      setFormErrors({ submit: error?.message || 'Failed to create dataset' });
    },
  });

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = 'Name is required';
    if (!formData.key.trim()) errors.key = 'Key is required';
    if (!formData.source_type.trim()) errors.source_type = 'Source type is required';
    if (formData.key && !/^[a-z0-9_-]+$/.test(formData.key)) {
      errors.key = 'Key must be lowercase alphanumeric with hyphens or underscores';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateSubmit = () => {
    if (!validateForm()) return;
    createMutation.mutate({
      organization_id: organizationId!,
      name: formData.name,
      key: formData.key,
      description: formData.description || undefined,
      source_type: formData.source_type,
    });
  };

  const formatDate = (dateString: string) => formatRelativeTime(dateString);

  const isLoading = datasetsLoading;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <FaDatabase className="w-6 h-6 text-forest" style={{ opacity: 0.6 }} />
              <h1 className="text-2xl font-semibold text-ink">Canonical Collections</h1>
            </div>
            <p className="text-sm text-archive">
              Canonical collections of entities produced by your pipelines. They are stable, versioned stores that power search, publishing, and downstream integrations.
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="btn-primary text-sm"
          >
            {showCreateForm ? 'Cancel' : 'Create Collection'}
          </button>
        </div>

        {/* Create Form - Inline Expansion */}
        {showCreateForm && (
          <div className="bg-parchment p-6 rounded-lg border border-lichen">
            <h2 className="text-xl font-semibold text-ink mb-2">New Dataset</h2>
            <p className="text-sm text-archive mb-4">
              Create a dataset to store canonical entities. Datasets are typically populated by pipelines.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="setup-dataset-name" className="block text-sm font-medium text-ink mb-1">
                    Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    id="setup-dataset-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-1 ${
                      formErrors.name ? 'border-semantic-error focus-visible:ring-semantic-error focus-visible:ring-offset-2' : 'border-lichen focus-visible:ring-bark/30 focus-visible:ring-offset-2'
                    }`}
                    placeholder="Museum Collection"
                    aria-label="Dataset name"
                  />
                  {formErrors.name && (
                    <p className="mt-1 text-sm text-semantic-error">{formErrors.name}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="setup-dataset-key" className="block text-sm font-medium text-ink mb-1">
                    Key <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    id="setup-dataset-key"
                    type="text"
                    value={formData.key}
                    onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase() })}
                    className={`w-full border rounded-md px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 ${
                      formErrors.key ? 'border-semantic-error focus-visible:ring-semantic-error focus-visible:ring-offset-2' : 'border-lichen focus-visible:ring-bark/30 focus-visible:ring-offset-2'
                    }`}
                    placeholder="museum-collection"
                    aria-label="Dataset key"
                  />
                  <p className="mt-1 text-xs text-archive">Lowercase, alphanumeric, hyphens, underscores only</p>
                  {formErrors.key && (
                    <p className="mt-1 text-sm text-semantic-error">{formErrors.key}</p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="setup-dataset-source-type" className="block text-sm font-medium text-ink mb-1">
                  Source Type <span className="text-semantic-error">*</span>
                </label>
                <input
                  id="setup-dataset-source-type"
                  type="text"
                  value={formData.source_type}
                  onChange={(e) => setFormData({ ...formData, source_type: e.target.value })}
                  className={`w-full border rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-1 ${
                    formErrors.source_type ? 'border-semantic-error focus-visible:ring-semantic-error focus-visible:ring-offset-2' : 'border-lichen focus-visible:ring-bark/30 focus-visible:ring-offset-2'
                  }`}
                  placeholder="smithsonian, salesforce, etc."
                  aria-label="Dataset source type"
                />
                <p className="mt-1 text-xs text-archive">Must match connector type</p>
                {formErrors.source_type && (
                  <p className="mt-1 text-sm text-semantic-error">{formErrors.source_type}</p>
                )}
              </div>

              <div>
                <label htmlFor="setup-dataset-description" className="block text-sm font-medium text-ink mb-1">
                  Description <span className="text-archive">(optional)</span>
                </label>
                <textarea
                  id="setup-dataset-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full border border-lichen rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  placeholder="Optional description..."
                  aria-label="Dataset description"
                />
              </div>

              {formErrors.submit && (
                <div className="p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-md">
                  <p className="text-sm text-semantic-error">{formErrors.submit}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleCreateSubmit}
                  disabled={createMutation.isPending}
                  className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Dataset'}
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

        {/* Datasets List */}
        {isLoading ? (
          <MadronaLoader variant="dots" />
        ) : datasets && datasets.length > 0 ? (
          <div className="space-y-4">
            {datasets.map((dataset: Dataset, _index: number) => {
              const producingPipelines = datasetPipelines.get(dataset.dataset_id) || [];
              const pipelineNames = producingPipelines.map(p => p.name || 'Unnamed Pipeline');

              return (
                <Link
                  key={dataset.dataset_id}
                  to={`/organizations/${organizationId}/bridge/datasets/${dataset.dataset_id}`}
                  className="block bg-parchment border border-lichen rounded-lg hover:border-stone hover:bg-lichen/50 transition-colors"
                >
                  <div className="p-5">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="flex-shrink-0 mt-0.5">
                        <FaDatabase className="h-6 w-6 text-forest" style={{ opacity: 0.5 }} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-ink">
                            {dataset.name}
                          </h3>
                          {dataset.role && dataset.role !== 'canonical' && (
                            <span className="badge-neutral">
                              {dataset.role}
                            </span>
                          )}
                        </div>

                        {/* Description or default */}
                        <p className="mt-1 text-sm text-archive">
                          {dataset.description || `Canonical entities of type "${dataset.source_type || dataset.key}"`}
                        </p>

                        {/* Metadata row */}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-archive">
                          {/* Producing pipeline(s) */}
                          <div className="flex items-center gap-1.5">
                            <GitBranch size={12} className="text-stone" />
                            {pipelineNames.length > 0 ? (
                              <span>
                                Produced by:{' '}
                                <span className="text-ink font-medium">
                                  {pipelineNames.length === 1
                                    ? pipelineNames[0]
                                    : `${pipelineNames[0]} +${pipelineNames.length - 1}`}
                                </span>
                              </span>
                            ) : (
                              <span className="italic text-stone">No pipeline configured</span>
                            )}
                          </div>

                          {/* Last updated */}
                          <div className="flex items-center gap-1.5">
                            <Clock size={12} className="text-stone" />
                            <span>Updated {formatDate(dataset.updated_at)}</span>
                          </div>

                          {/* Entity count if available */}
                          {dataset.entity_count !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <Database size={12} className="text-stone" />
                              <span>
                                {formatNumber(dataset.entity_count)} {dataset.entity_count === 1 ? 'entity' : 'entities'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Key badge */}
                      <div className="flex-shrink-0">
                        <code className="px-2 py-1 text-xs font-mono bg-lichen text-archive rounded">
                          {dataset.key}
                        </code>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="bg-parchment border border-lichen rounded-lg p-8 text-center">
            <FaDatabase size={48} className="text-stone mx-auto mb-4" />
            <h3 className="font-medium text-ink mb-2">No datasets yet</h3>
            <p className="text-archive text-sm mb-4 max-w-md mx-auto">
              Datasets are created when you configure a pipeline. Each pipeline writes canonical
              entities to a dataset, which serves as a stable store for your data.
            </p>
            <Link
              to={`/organizations/${organizationId}/bridge/setup/pipelines`}
              className="btn-primary inline-flex items-center gap-2"
            >
              <GitBranch size={16} />
              Configure a Pipeline
            </Link>
          </div>
        )}

        {/* Info footer */}
        {datasets && datasets.length > 0 && (
          <div className="text-xs text-archive border-t border-lichen pt-4">
            Datasets contain canonical entities that are deduplicated and versioned. Changes are tracked
            over time, enabling audit trails and incremental updates.
          </div>
        )}
      </div>
    </div>
  );
}
