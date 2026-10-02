import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import { getDatasets, createDataset, exportEntities, getOrganizationSettings } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useOrganization } from '../../contexts/useOrganization';
import { usePermissions } from '../../hooks/usePermissions';
import { Tooltip } from '../../components/Tooltip';
import type { EntityExportFormat } from '../../lib/schemas';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateTime, formatNumber } from '@/lib/formatters';

export default function DatasetsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
  // Check permissions
  const { hasPermission } = usePermissions();
  const canExport = hasPermission('data.export');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', key: '', description: '', source_type: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [exportingDatasetId, setExportingDatasetId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  // Fetch profile settings for export configuration
  const { data: exportSettings } = useQuery({
    queryKey: ['profile-settings', organizationId, 'export'],
    queryFn: () => getOrganizationSettings(organizationId!, 'export'),
    enabled: !!organizationId,
  });

  // Get enabled formats and default from profile settings
  const enabledFormats = (exportSettings?.['export.formats.enabled'] as string[]) || ['jsonl', 'json'];
  const defaultFormat = (exportSettings?.['export.formats.default'] as string) || 'jsonl';

  // Derive the initial format from settings, allowing user override
  const [exportFormatOverride, setExportFormatOverride] = useState<EntityExportFormat | null>(null);
  const exportFormat = exportFormatOverride ?? (enabledFormats.includes(defaultFormat) ? defaultFormat as EntityExportFormat : 'jsonl');
  const setExportFormat = setExportFormatOverride;

  // Fetch datasets (now includes entity_count)
  const { data: datasets, isLoading } = useQuery({
    queryKey: ['datasets', organizationId],
    queryFn: () => getDatasets(organizationId!),
    enabled: !!organizationId,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: createDataset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      setShowCreateModal(false);
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

  const handleExportClick = (datasetId: string) => {
    setExportingDatasetId(datasetId);
    setShowExportModal(true);
  };

  const handleExport = async () => {
    if (!organizationId || !exportingDatasetId) return;

    try {
      const blob = await exportEntities({
        organization_id: organizationId,
        dataset_id: [exportingDatasetId],
        format: exportFormat,
      });

      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dataset = datasets?.find(d => d.dataset_id === exportingDatasetId);
      const filename = `${dataset?.name || 'dataset'}-export.${exportFormat}`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setShowExportModal(false);
      setExportingDatasetId(null);
    } catch (err) {
      logger.error('Export failed:', err);
      showToast({ type: 'error', title: 'Error', message: `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
  };

  const formatDate = (dateString: string) => formatDateTime(dateString);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-ink">Datasets</h1>
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Datasets</h1>
          <p className="mt-2 text-sm text-archive">
            Canonical records, grouped by dataset
          </p>
        </div>

      {/* Datasets Grid */}
      <div className="grid grid-cols-1 gap-6">
        {datasets?.map((dataset, _index) => {
          return (
            <Link
              key={dataset.dataset_id}
              to={`/organizations/${organizationId}/bridge/datasets/${dataset.dataset_id}`}
              className="block bg-parchment overflow-hidden shadow-sm rounded-lg border border-lichen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              style={{
                textDecoration: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fafaf9';
                e.currentTarget.style.borderColor = '#a8a29e';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgb(var(--color-parchment-warm))';
                e.currentTarget.style.borderColor = 'rgb(var(--color-lichen))';
              }}
            >
              <div className="p-5">
                {/* Dataset Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center flex-1">
                    <div className="flex-shrink-0">
                      <FaDatabase className="h-6 w-6 text-forest" style={{ opacity: 0.4 }} />
                    </div>
                    <div className="ml-3 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-medium text-ink">
                          {dataset.name}
                        </h3>
                        {dataset.role && dataset.role !== 'canonical' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-semantic-error/10 text-semantic-error">
                            {dataset.role}
                          </span>
                        )}
                      </div>
                      {dataset.description && (
                        <p className="mt-1 text-sm text-archive">
                          {dataset.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="mt-4 text-sm text-archive">
                  {dataset.entity_count !== undefined
                    ? `${formatNumber(dataset.entity_count)} records`
                    : '0 records'}
                  {' · '}
                  Updated {formatDate(dataset.updated_at)}
                </div>

                {/* Export Button */}
                <div className="mt-5">
                  <Tooltip
                    content="You need the 'data.export' permission to export data"
                    disabled={!canExport}
                  >
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleExportClick(dataset.dataset_id);
                      }}
                      disabled={!canExport}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '6px 14px',
                        border: '1px solid #D8D2C8',
                        background: 'transparent',
                        color: !canExport ? 'rgb(var(--color-archive))' : 'rgb(var(--color-archive))',
                        fontSize: '13px',
                        fontWeight: 400,
                        borderRadius: '4px',
                        cursor: !canExport ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s',
                        opacity: !canExport ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (canExport) {
                          e.currentTarget.style.background = 'rgb(var(--color-parchment))';
                          e.currentTarget.style.borderColor = 'rgb(var(--color-archive))';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = 'rgb(var(--color-stone))';
                      }}
                    >
                    Export snapshot
                  </button>
                  </Tooltip>
                  <p className="mt-1 text-xs text-archive">Current canonical record state</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {datasets?.length === 0 && (
        <div className="text-center py-12">
          <FaDatabase className="mx-auto h-12 w-12 text-archive" />
          <h3 className="mt-2 text-sm font-medium text-ink">No datasets</h3>
          <p className="mt-1 text-sm text-archive">
            Create a route to start ingesting data into datasets.
          </p>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-ink/50 transition-opacity"
              onClick={() => setShowExportModal(false)}
            />

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

            <div className="inline-block align-bottom bg-parchment rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div>
                <div className="mt-3 text-center sm:mt-0 sm:text-left">
                  <h3 className="text-lg leading-6 font-medium text-ink">
                    Create Snapshot
                  </h3>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="snapshot-format-select" className="block text-sm font-medium text-ink mb-2">
                        Snapshot Format
                      </label>
                      <select
                        id="snapshot-format-select"
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as EntityExportFormat)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-lichen focus-visible:outline-none focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark sm:text-sm rounded-md"
                      >
                        {enabledFormats.includes('jsonl') && (
                          <option value="jsonl">JSONL (Newline-delimited JSON)</option>
                        )}
                        {enabledFormats.includes('json') && (
                          <option value="json">JSON (Array format, max 10k records)</option>
                        )}
                      </select>
                      <p className="mt-2 text-sm text-archive">
                        {exportFormat === 'jsonl'
                          ? 'Suitable for large datasets — one record per line'
                          : 'Standard JSON array format, limited to 10,000 records'}
                      </p>
                      <p className="mt-3 text-xs text-archive" style={{ fontStyle: 'normal' }}>
                        This snapshot reflects the current canonical record state of this dataset.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                <button
                  type="button"
                  onClick={handleExport}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-bark text-base font-medium text-parchment hover:bg-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-bark/30 sm:col-start-2 sm:text-sm"
                >
                  Create Snapshot
                </button>
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-lichen shadow-sm px-4 py-2 bg-parchment text-base font-medium text-ink hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-bark/30 sm:mt-0 sm:col-start-1 sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Dataset Modal */}
      {showCreateModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-ink/50 transition-opacity"
              onClick={() => setShowCreateModal(false)}
            />

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

            <div className="inline-block align-bottom bg-parchment rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div className="absolute top-0 right-0 pt-4 pr-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-archive hover:text-archive"
                >
                  <X size={20} />
                </button>
              </div>
              <div>
                <div className="mt-3 text-center sm:mt-0 sm:text-left">
                  <h3 className="text-lg leading-6 font-medium text-ink">
                    Create Dataset
                  </h3>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="datasets-page-name" className="block text-sm font-medium text-ink mb-1">
                        Name <span className="text-semantic-error">*</span>
                      </label>
                      <input
                        id="datasets-page-name"
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        aria-label="Dataset name"
                        className={`mt-1 block w-full border rounded-md px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 ${
                          formErrors.name ? 'border-semantic-error focus-visible:ring-semantic-error/30 focus-visible:ring-offset-2' : 'border-lichen focus-visible:ring-bark/30 focus-visible:ring-offset-2'
                        }`}
                        placeholder="Museum Collection"
                      />
                      {formErrors.name && (
                        <p className="mt-1 text-sm text-semantic-error">{formErrors.name}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="datasets-page-key" className="block text-sm font-medium text-ink mb-1">
                        Key <span className="text-semantic-error">*</span>
                      </label>
                      <input
                        id="datasets-page-key"
                        type="text"
                        value={formData.key}
                        onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase() })}
                        aria-label="Dataset key"
                        className={`mt-1 block w-full border rounded-md px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 ${
                          formErrors.key ? 'border-semantic-error focus-visible:ring-semantic-error/30 focus-visible:ring-offset-2' : 'border-lichen focus-visible:ring-bark/30 focus-visible:ring-offset-2'
                        }`}
                        placeholder="museum-collection"
                      />
                      <p className="mt-1 text-xs text-archive">Lowercase, alphanumeric, hyphens, underscores only</p>
                      {formErrors.key && (
                        <p className="mt-1 text-sm text-semantic-error">{formErrors.key}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="datasets-page-source-type" className="block text-sm font-medium text-ink mb-1">
                        Source Type <span className="text-semantic-error">*</span>
                      </label>
                      <input
                        id="datasets-page-source-type"
                        type="text"
                        value={formData.source_type}
                        onChange={(e) => setFormData({ ...formData, source_type: e.target.value })}
                        aria-label="Source type"
                        className={`mt-1 block w-full border rounded-md px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 ${
                          formErrors.source_type ? 'border-semantic-error focus-visible:ring-semantic-error/30 focus-visible:ring-offset-2' : 'border-lichen focus-visible:ring-bark/30 focus-visible:ring-offset-2'
                        }`}
                        placeholder="smithsonian, salesforce, etc."
                      />
                      <p className="mt-1 text-xs text-archive">Must match connector type</p>
                      {formErrors.source_type && (
                        <p className="mt-1 text-sm text-semantic-error">{formErrors.source_type}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="datasets-page-description" className="block text-sm font-medium text-ink mb-1">
                        Description
                      </label>
                      <textarea
                        id="datasets-page-description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        aria-label="Dataset description"
                        rows={3}
                        className="mt-1 block w-full border border-lichen rounded-md px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        placeholder="Optional description..."
                      />
                    </div>
                    {formErrors.submit && (
                      <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-md">
                        <p className="text-sm text-semantic-error">{formErrors.submit}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                <button
                  type="button"
                  onClick={handleCreateSubmit}
                  disabled={createMutation.isPending}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-bark text-base font-medium text-parchment hover:bg-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-bark/30 sm:col-start-2 sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Dataset'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-lichen shadow-sm px-4 py-2 bg-parchment text-base font-medium text-ink hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-bark/30 sm:mt-0 sm:col-start-1 sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
