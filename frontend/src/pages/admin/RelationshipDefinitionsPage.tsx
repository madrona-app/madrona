import { useState } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Plus, Trash2, Play, Eye, ChevronDown, ChevronUp, BarChart3, Settings } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { RelationshipAnalyticsDashboard } from '../../components/RelationshipAnalyticsDashboard';
import { formatDateShort } from '@/lib/formatters';
import {
  getRelationshipDefinitions,
  createRelationshipDefinition,
  updateRelationshipDefinition,
  deleteRelationshipDefinition,
  evaluateRelationshipDefinition,
  getDatasets,
  type RelationshipDefinition,
  type RelationshipDefinitionCreateRequest,
} from '../../lib/api';

interface FormData {
  name: string;
  description: string;
  relationship_type: string;
  source_dataset_id: string;
  source_entity_type: string;
  source_field_path: string;
  target_dataset_id: string;
  target_entity_type: string;
  target_field_path: string;
  match_transform: 'exact' | 'lowercase' | 'trim' | 'normalize_whitespace' | 'normalize_id';
  case_sensitive: boolean;
  enabled: boolean;
  auto_link_on_ingest: boolean;
  bidirectional: boolean;
  inverse_relationship_type: string;
}

const initialFormData: FormData = {
  name: '',
  description: '',
  relationship_type: '',
  source_dataset_id: '',
  source_entity_type: '',
  source_field_path: '',
  target_dataset_id: '',
  target_entity_type: '',
  target_field_path: '',
  match_transform: 'exact',
  case_sensitive: true,
  enabled: true,
  auto_link_on_ingest: false,
  bidirectional: false,
  inverse_relationship_type: '',
};

export default function RelationshipDefinitionsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();
  const { user, applications } = useAuth();
  const { showToast } = useToast();

  // Check for platform.admin permission. The authorization gate is applied
  // AFTER all hooks are declared — React's rules-of-hooks require every
  // hook to run in the same order on every render, so early-return above
  // hook calls is a bug.
  const hasPlatformAdmin = user?.permissions?.includes('platform.admin');

  // State
  const [activeTab, setActiveTab] = useState<'definitions' | 'analytics'>('definitions');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [deleteConfirm, setDeleteConfirm] = useState<RelationshipDefinition | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evaluateResult, setEvaluateResult] = useState<{ id: string; created: number; skipped: number } | null>(null);

  // Queries
  const { data: definitions, isLoading } = useQuery({
    queryKey: ['relationship-definitions', organizationId],
    queryFn: () => getRelationshipDefinitions(),
    enabled: !!organizationId,
  });

  const { data: datasets } = useQuery({
    queryKey: ['datasets', organizationId],
    queryFn: () => getDatasets(organizationId!),
    enabled: !!organizationId,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: RelationshipDefinitionCreateRequest) => createRelationshipDefinition(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationship-definitions'] });
      setShowCreateForm(false);
      setFormData(initialFormData);
    },
    onError: (error) => {
      showToast({ type: 'error', title: 'Failed to create definition', message: error instanceof Error ? error.message : undefined });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRelationshipDefinition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationship-definitions'] });
      setDeleteConfirm(null);
    },
    onError: (error) => {
      showToast({ type: 'error', title: 'Failed to delete definition', message: error instanceof Error ? error.message : undefined });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateRelationshipDefinition(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationship-definitions'] });
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: (id: string) => evaluateRelationshipDefinition(id),
    onSuccess: (result, id) => {
      setEvaluateResult({ id, created: result.created, skipped: result.skipped });
      setTimeout(() => setEvaluateResult(null), 5000);
    },
    onError: (error) => {
      showToast({ type: 'error', title: 'Failed to evaluate definition', message: error instanceof Error ? error.message : undefined });
    },
  });

  const handleCreate = () => {
    if (!formData.name || !formData.relationship_type || !formData.source_field_path || !formData.target_field_path) {
      showToast({ type: 'warning', title: 'Please fill in all required fields' });
      return;
    }

    const request: RelationshipDefinitionCreateRequest = {
      name: formData.name,
      description: formData.description || undefined,
      relationship_type: formData.relationship_type,
      source_dataset_id: formData.source_dataset_id || undefined,
      source_entity_type: formData.source_entity_type || undefined,
      source_field_path: formData.source_field_path,
      target_dataset_id: formData.target_dataset_id || undefined,
      target_entity_type: formData.target_entity_type || undefined,
      target_field_path: formData.target_field_path,
      match_transform: formData.match_transform,
      case_sensitive: formData.case_sensitive,
      enabled: formData.enabled,
      auto_link_on_ingest: formData.auto_link_on_ingest,
      bidirectional: formData.bidirectional,
      inverse_relationship_type: formData.bidirectional ? formData.inverse_relationship_type || undefined : undefined,
    };

    createMutation.mutate(request);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm) {
      deleteMutation.mutate(deleteConfirm.definition_id);
    }
  };

  if (!hasPlatformAdmin) {
    return <Navigate to={organizationId ? getDefaultLandingPath(organizationId, applications) : '/'} replace />;
  }

  return (
    <div className="p-8">
      <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <GitBranch className="w-8 h-8 text-forest" />
            <h1 className="text-2xl font-semibold text-ink">Relationships</h1>
          </div>
          <p className="text-sm text-archive mt-1">
            Manage relationship definitions and view analytics
          </p>
        </div>
        {activeTab === 'definitions' && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-bark/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Definition
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-lichen mb-6">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('definitions')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'definitions'
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink hover:border-stone'
            }`}
          >
            <Settings className="w-4 h-4" />
            Definitions
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'analytics'
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink hover:border-stone'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Analytics
          </button>
        </nav>
      </div>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && organizationId && (
        <RelationshipAnalyticsDashboard organizationId={organizationId} />
      )}

      {/* Definitions Tab */}
      {activeTab === 'definitions' && (
        <>
          {/* Create Form */}
          {showCreateForm && (
        <div className="bg-parchment border border-lichen rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Create Relationship Definition</h2>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Name <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-lichen rounded-md px-3 py-2"
                placeholder="e.g., Objects to Media"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Relationship Type <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={formData.relationship_type}
                onChange={(e) => setFormData({ ...formData, relationship_type: e.target.value })}
                className="w-full border border-lichen rounded-md px-3 py-2"
                placeholder="e.g., hasMedia, relatedTo"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-ink mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full border border-lichen rounded-md px-3 py-2"
              rows={2}
              placeholder="Describe what this relationship represents"
            />
          </div>

          <div className="border-t pt-4 mb-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Source Entity</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-archive mb-1">Dataset (optional)</label>
                <select
                  value={formData.source_dataset_id}
                  onChange={(e) => setFormData({ ...formData, source_dataset_id: e.target.value })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                >
                  <option value="">Any dataset</option>
                  {datasets?.map((ds) => (
                    <option key={ds.dataset_id} value={ds.dataset_id}>{ds.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-archive mb-1">Entity Type (optional)</label>
                <input
                  type="text"
                  value={formData.source_entity_type}
                  onChange={(e) => setFormData({ ...formData, source_entity_type: e.target.value })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                  placeholder="e.g., object"
                />
              </div>
              <div>
                <label className="block text-sm text-archive mb-1">
                  Field Path <span className="text-semantic-error">*</span>
                </label>
                <input
                  type="text"
                  value={formData.source_field_path}
                  onChange={(e) => setFormData({ ...formData, source_field_path: e.target.value })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                  placeholder="e.g., payload.media_refs[*].id"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mb-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Target Entity</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-archive mb-1">Dataset (optional)</label>
                <select
                  value={formData.target_dataset_id}
                  onChange={(e) => setFormData({ ...formData, target_dataset_id: e.target.value })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                >
                  <option value="">Any dataset</option>
                  {datasets?.map((ds) => (
                    <option key={ds.dataset_id} value={ds.dataset_id}>{ds.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-archive mb-1">Entity Type (optional)</label>
                <input
                  type="text"
                  value={formData.target_entity_type}
                  onChange={(e) => setFormData({ ...formData, target_entity_type: e.target.value })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                  placeholder="e.g., media"
                />
              </div>
              <div>
                <label className="block text-sm text-archive mb-1">
                  Field Path <span className="text-semantic-error">*</span>
                </label>
                <input
                  type="text"
                  value={formData.target_field_path}
                  onChange={(e) => setFormData({ ...formData, target_field_path: e.target.value })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                  placeholder="e.g., payload.identifiers[scheme=source].value"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mb-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Matching Options</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-archive mb-1">Transform</label>
                <select
                  value={formData.match_transform}
                  onChange={(e) => setFormData({ ...formData, match_transform: e.target.value as FormData['match_transform'] })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                >
                  <option value="exact">Exact match</option>
                  <option value="lowercase">Lowercase</option>
                  <option value="trim">Trim whitespace</option>
                  <option value="normalize_whitespace">Normalize whitespace</option>
                  <option value="normalize_id">Normalize ID</option>
                </select>
              </div>
              <div className="flex items-center gap-4 pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={formData.case_sensitive}
                    onChange={(e) => setFormData({ ...formData, case_sensitive: e.target.checked })}
                  />
                  <span className="text-sm text-ink">Case sensitive</span>
                </label>
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mb-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Behavior</h3>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                />
                <span className="text-sm text-ink">Enabled</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.auto_link_on_ingest}
                  onChange={(e) => setFormData({ ...formData, auto_link_on_ingest: e.target.checked })}
                />
                <span className="text-sm text-ink">Auto-link on ingest</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.bidirectional}
                  onChange={(e) => setFormData({ ...formData, bidirectional: e.target.checked })}
                />
                <span className="text-sm text-ink">Bidirectional</span>
              </label>
            </div>
            {formData.bidirectional && (
              <div className="mt-3">
                <label className="block text-sm text-archive mb-1">Inverse Relationship Type</label>
                <input
                  type="text"
                  value={formData.inverse_relationship_type}
                  onChange={(e) => setFormData({ ...formData, inverse_relationship_type: e.target.value })}
                  className="w-64 border border-lichen rounded-md px-3 py-2"
                  placeholder="e.g., mediaOf"
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="btn-primary disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Definition'}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setFormData(initialFormData);
              }}
              className="btn-tertiary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Definitions List */}
      {isLoading ? (
        <div className="text-center py-12 text-archive">Loading definitions...</div>
      ) : definitions?.items && definitions.items.length > 0 ? (
        <div className="space-y-4">
          {definitions.items.map((def, _index) => (
            <div
              key={def.definition_id}
              className="bg-parchment border border-lichen rounded-lg hover:border-stone transition-colors"
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-ink">{def.name}</h3>
                      <span
                        className={def.enabled ? 'badge-success-subtle' : 'badge-neutral'}
                      >
                        {def.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {def.auto_link_on_ingest && (
                        <span className="badge-info-subtle">
                          Auto-link
                        </span>
                      )}
                    </div>
                    {def.description && (
                      <p className="text-sm text-archive mt-1">{def.description}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span className="font-mono bg-lichen px-2 py-1 rounded text-xs">
                        {def.source_field_path}
                      </span>
                      <span className="text-archive">--[{def.relationship_type}]--&gt;</span>
                      <span className="font-mono bg-lichen px-2 py-1 rounded text-xs">
                        {def.target_field_path}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => evaluateMutation.mutate(def.definition_id)}
                      disabled={evaluateMutation.isPending}
                      className="p-2 text-archive hover:text-semantic-success hover:bg-semantic-success/10 rounded"
                      title="Run evaluation"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleEnabledMutation.mutate({ id: def.definition_id, enabled: !def.enabled })}
                      className={`p-2 rounded ${
                        def.enabled
                          ? 'text-archive hover:text-semantic-warning hover:bg-semantic-warning/10'
                          : 'text-stone hover:text-semantic-success hover:bg-semantic-success/10'
                      }`}
                      title={def.enabled ? 'Disable' : 'Enable'}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExpandedId(expandedId === def.definition_id ? null : def.definition_id)}
                      className="p-2 text-archive hover:text-ink hover:bg-lichen rounded"
                    >
                      {expandedId === def.definition_id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(def)}
                      className="p-2 text-archive hover:text-semantic-error hover:bg-semantic-error/10 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Evaluation result toast */}
                {evaluateResult?.id === def.definition_id && (
                  <div className="mt-3 p-3 bg-semantic-success/10 border border-semantic-success/20 rounded text-sm text-semantic-success">
                    Created {evaluateResult.created} relationships, skipped {evaluateResult.skipped}
                  </div>
                )}

                {/* Expanded details */}
                {expandedId === def.definition_id && (
                  <div className="mt-4 pt-4 border-t border-lichen">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-archive">Source Dataset:</span>{' '}
                        <span className="text-ink">
                          {datasets?.find((d) => d.dataset_id === def.source_dataset_id)?.name || 'Any'}
                        </span>
                      </div>
                      <div>
                        <span className="text-archive">Target Dataset:</span>{' '}
                        <span className="text-ink">
                          {datasets?.find((d) => d.dataset_id === def.target_dataset_id)?.name || 'Any'}
                        </span>
                      </div>
                      <div>
                        <span className="text-archive">Source Entity Type:</span>{' '}
                        <span className="text-ink">{def.source_entity_type || 'Any'}</span>
                      </div>
                      <div>
                        <span className="text-archive">Target Entity Type:</span>{' '}
                        <span className="text-ink">{def.target_entity_type || 'Any'}</span>
                      </div>
                      <div>
                        <span className="text-archive">Match Transform:</span>{' '}
                        <span className="text-ink">{def.match_transform}</span>
                      </div>
                      <div>
                        <span className="text-archive">Case Sensitive:</span>{' '}
                        <span className="text-ink">{def.case_sensitive ? 'Yes' : 'No'}</span>
                      </div>
                      <div>
                        <span className="text-archive">Bidirectional:</span>{' '}
                        <span className="text-ink">
                          {def.bidirectional ? `Yes (${def.inverse_relationship_type || 'N/A'})` : 'No'}
                        </span>
                      </div>
                      <div>
                        <span className="text-archive">Created:</span>{' '}
                        <span className="text-ink">
                          {formatDateShort(def.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-parchment border border-lichen rounded-lg">
          <GitBranch className="w-12 h-12 text-stone mx-auto mb-3" />
          <h3 className="text-lg font-medium text-ink mb-1">No relationship definitions</h3>
          <p className="text-archive mb-4">
            Create rules to automatically link entities based on field matching.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create First Definition
          </button>
        </div>
      )}

        </>
      )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Relationship Definition"
        message={`Are you sure you want to delete "${deleteConfirm?.name}"? This will not remove existing relationships created by this definition.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
