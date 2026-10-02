import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link2,
  Plus,
  Edit2,
  Trash2,
  GripVertical,
  AlertCircle,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  listFieldInheritanceConfig,
  createFieldInheritanceConfig,
  updateFieldInheritanceConfig,
  deleteFieldInheritanceConfig,
  seedFieldInheritanceConfig,
} from '../../lib/api';
import type { MediaFieldInheritanceConfig } from '../../lib/schemas';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const DISPLAY_CONTEXT_OPTIONS = [
  { value: 'both', label: 'Detail & List' },
  { value: 'detail', label: 'Detail Only' },
  { value: 'list', label: 'List Only' },
];

const TRANSFORM_TYPE_OPTIONS = [
  { value: null, label: 'None (use raw value)' },
  { value: 'array_first', label: 'First Item' },
  { value: 'array_join', label: 'Join Items' },
  { value: 'array_concat_field', label: 'Concat Field from Items' },
];

const AVAILABLE_SOURCE_FIELDS = [
  { value: 'object_number', label: 'Object Number' },
  { value: 'titles', label: 'Titles', isArray: true },
  { value: 'creators', label: 'Creators', isArray: true },
  { value: 'creation_date_display', label: 'Creation Date Display' },
  { value: 'materials_display', label: 'Materials Display' },
  { value: 'dimensions_display', label: 'Dimensions Display' },
  { value: 'copyright_status', label: 'Copyright Status' },
  { value: 'credit_line', label: 'Credit Line' },
  { value: 'classification_display', label: 'Classification' },
  { value: 'object_type', label: 'Object Type' },
  { value: 'period_display', label: 'Period' },
  { value: 'culture_display', label: 'Culture' },
];

export default function MediaFieldInheritanceSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string; confirmStyle: 'danger' | 'primary'} | null>(null);
  const [newConfig, setNewConfig] = useState({
    source_field: '',
    display_label: '',
    display_context: 'both' as 'detail' | 'list' | 'both',
    transform_type: null as string | null,
    transform_config: null as Record<string, unknown> | null,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['field-inheritance-config', orgId],
    queryFn: () => listFieldInheritanceConfig(orgId!),
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createFieldInheritanceConfig>[1]) =>
      createFieldInheritanceConfig(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-inheritance-config', orgId] });
      setIsAddingNew(false);
      resetNewConfig();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ configId, data }: { configId: string; data: Parameters<typeof updateFieldInheritanceConfig>[2] }) =>
      updateFieldInheritanceConfig(orgId!, configId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-inheritance-config', orgId] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: string) => deleteFieldInheritanceConfig(orgId!, configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-inheritance-config', orgId] });
    },
  });

  const seedMutation = useMutation({
    mutationFn: () => seedFieldInheritanceConfig(orgId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-inheritance-config', orgId] });
    },
  });

  const resetNewConfig = () => {
    setNewConfig({
      source_field: '',
      display_label: '',
      display_context: 'both',
      transform_type: null,
      transform_config: null,
    });
  };

  const handleCreate = () => {
    if (!newConfig.source_field || !newConfig.display_label) return;

    const sortOrder = (data?.configs?.length || 0);

    createMutation.mutate({
      source_field: newConfig.source_field,
      display_label: newConfig.display_label,
      display_context: newConfig.display_context,
      transform_type: newConfig.transform_type as 'array_first' | 'array_join' | 'array_concat_field' | null,
      transform_config: newConfig.transform_config,
      sort_order: sortOrder,
    });
  };

  const handleToggleActive = (config: MediaFieldInheritanceConfig) => {
    updateMutation.mutate({
      configId: config.config_id,
      data: { is_active: !config.is_active },
    });
  };

  const handleDelete = (configId: string) => {
    setConfirmState({
      action: () => deleteMutation.mutate(configId),
      title: 'Delete Field Mapping',
      message: 'Delete this field mapping? This cannot be undone.',
      confirmStyle: 'danger',
    });
  };

  const handleSeedDefaults = () => {
    setConfirmState({
      action: () => seedMutation.mutate(),
      title: 'Add Default Mappings',
      message: 'This will add the default field mappings. Continue?',
      confirmStyle: 'primary',
    });
  };

  if (!orgId) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error">
          Organization ID is required
        </div>
      </div>
    );
  }

  const configs = (data?.configs as MediaFieldInheritanceConfig[]) || [];
  const usedFields = new Set(configs.map((c) => c.source_field));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-forest/10 rounded-lg">
          <Link2 size={24} className="text-forest" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Field Inheritance</h1>
          <p className="text-stone-500">
            Configure which Collection object fields are shown on linked Media items
          </p>
        </div>
      </div>

      {/* Help Text */}
      <div className="bg-parchment border border-stone-200 rounded-lg p-4">
        <h3 className="font-medium text-stone-900 mb-2">How Field Inheritance Works</h3>
        <ul className="text-sm text-stone-600 space-y-1">
          <li>- When Media is linked to Collection objects, you can display metadata from the objects</li>
          <li>- Configure which fields to show and how to display them</li>
          <li>- Array fields (like Titles, Creators) can be transformed to display a single value or joined list</li>
          <li>- Inherited fields appear read-only and don't overwrite the Media's own metadata</li>
        </ul>
      </div>

      {/* Config List */}
      <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-medium text-stone-900">Field Mappings</h3>
          <div className="flex items-center gap-2">
            {configs.length === 0 && (
              <button
                onClick={handleSeedDefaults}
                disabled={seedMutation.isPending}
                className="px-3 py-1.5 border border-stone-300 rounded-md text-sm text-stone-700 hover:bg-stone-50 flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                <Sparkles size={14} />
                Add Defaults
              </button>
            )}
            <button
              onClick={() => setIsAddingNew(true)}
              className="px-3 py-1.5 bg-forest text-parchment rounded-md text-sm hover:bg-forest/90 flex items-center gap-1 transition-colors"
            >
              <Plus size={14} />
              Add Field
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center"><MadronaLoader variant="dots" /></div>
        ) : error ? (
          <div className="p-4 text-semantic-error flex items-center gap-2">
            <AlertCircle size={16} />
            <span>Failed to load configuration</span>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {/* Add New Row */}
            {isAddingNew && (
              <div className="p-4 bg-semantic-info/10 border-b border-semantic-info/30">
                <div className="grid grid-cols-12 gap-4 items-end">
                  <div className="col-span-3">
                    <label className="block text-xs text-stone-600 mb-1">Source Field</label>
                    <select
                      value={newConfig.source_field}
                      onChange={(e) => {
                        const field = AVAILABLE_SOURCE_FIELDS.find((f) => f.value === e.target.value);
                        setNewConfig({
                          ...newConfig,
                          source_field: e.target.value,
                          display_label: field?.label || e.target.value,
                        });
                      }}
                      className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                    >
                      <option value="">Select field...</option>
                      {AVAILABLE_SOURCE_FIELDS.filter((f) => !usedFields.has(f.value)).map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="block text-xs text-stone-600 mb-1">Display Label</label>
                    <input
                      type="text"
                      value={newConfig.display_label}
                      onChange={(e) => setNewConfig({ ...newConfig, display_label: e.target.value })}
                      className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                      placeholder="Label shown in UI"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-stone-600 mb-1">Show In</label>
                    <select
                      value={newConfig.display_context}
                      onChange={(e) =>
                        setNewConfig({ ...newConfig, display_context: e.target.value as 'detail' | 'list' | 'both' })
                      }
                      className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                    >
                      {DISPLAY_CONTEXT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-stone-600 mb-1">Transform</label>
                    <select
                      value={newConfig.transform_type || ''}
                      onChange={(e) =>
                        setNewConfig({
                          ...newConfig,
                          transform_type: e.target.value || null,
                        })
                      }
                      className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                    >
                      {TRANSFORM_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value || 'none'} value={opt.value || ''}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2 flex gap-2">
                    <button
                      onClick={handleCreate}
                      disabled={!newConfig.source_field || !newConfig.display_label || createMutation.isPending}
                      className="flex-1 px-3 py-1.5 bg-forest text-parchment rounded text-sm hover:bg-forest/90 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      <Check size={14} />
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setIsAddingNew(false);
                        resetNewConfig();
                      }}
                      className="px-3 py-1.5 border border-stone-300 rounded text-sm hover:bg-stone-50"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Config Rows */}
            {configs.length === 0 && !isAddingNew ? (
              <div className="p-8 text-center text-stone-500">
                No field mappings configured. Add fields or click "Add Defaults" to get started.
              </div>
            ) : (
              configs.map((config) => (
                <ConfigRow
                  key={config.config_id}
                  config={config}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  updateMutation={updateMutation}
                />
              ))
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle={confirmState?.confirmStyle ?? 'danger'}
      />
    </div>
  );
}

interface ConfigRowProps {
  config: MediaFieldInheritanceConfig;
  onToggleActive: (config: MediaFieldInheritanceConfig) => void;
  onDelete: (configId: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  updateMutation: ReturnType<typeof useMutation<unknown, Error, { configId: string; data: Parameters<typeof updateFieldInheritanceConfig>[2] }>>;
}

function ConfigRow({
  config,
  onToggleActive,
  onDelete,
  editingId,
  setEditingId,
  updateMutation,
}: ConfigRowProps) {
  const isEditing = editingId === config.config_id;
  const [editData, setEditData] = useState({
    display_label: config.display_label,
    display_context: config.display_context,
    transform_type: config.transform_type,
  });

  const handleSave = () => {
    updateMutation.mutate(
      {
        configId: config.config_id,
        data: {
          display_label: editData.display_label,
          display_context: editData.display_context,
          transform_type: editData.transform_type as 'array_first' | 'array_join' | 'array_concat_field' | null,
        },
      },
      {
        onSuccess: () => setEditingId(null),
      }
    );
  };

  if (isEditing) {
    return (
      <div className="p-4 bg-semantic-warning/10 border-b border-semantic-warning/30">
        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-3">
            <label className="block text-xs text-stone-600 mb-1">Source Field</label>
            <div className="px-2 py-1.5 bg-stone-100 border border-stone-200 rounded text-sm text-stone-600">
              {config.source_field}
            </div>
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-stone-600 mb-1">Display Label</label>
            <input
              type="text"
              value={editData.display_label}
              onChange={(e) => setEditData({ ...editData, display_label: e.target.value })}
              className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-600 mb-1">Show In</label>
            <select
              value={editData.display_context}
              onChange={(e) =>
                setEditData({ ...editData, display_context: e.target.value as 'detail' | 'list' | 'both' })
              }
              className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
            >
              {DISPLAY_CONTEXT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-600 mb-1">Transform</label>
            <select
              value={editData.transform_type || ''}
              onChange={(e) =>
                setEditData({ ...editData, transform_type: (e.target.value || null) as "array_first" | "array_join" | "array_concat_field" | null })
              }
              className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
            >
              {TRANSFORM_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value || 'none'} value={opt.value || ''}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex gap-2">
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex-1 px-3 py-1.5 bg-forest text-parchment rounded text-sm hover:bg-forest/90 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Check size={14} />
              Save
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="px-3 py-1.5 border border-stone-300 rounded text-sm hover:bg-stone-50"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`px-4 py-3 flex items-center gap-4 hover:bg-stone-50 transition-colors ${
        !config.is_active ? 'opacity-50' : ''
      }`}
    >
      <GripVertical size={14} className="text-stone-300 cursor-grab" />

      <div className="flex-1 grid grid-cols-12 gap-4 items-center">
        <div className="col-span-3">
          <div className="text-sm font-medium text-stone-700">{config.source_field}</div>
        </div>
        <div className="col-span-3">
          <div className="text-sm text-stone-600">{config.display_label}</div>
        </div>
        <div className="col-span-2">
          <span className="text-xs px-2 py-0.5 bg-stone-100 rounded text-stone-600">
            {DISPLAY_CONTEXT_OPTIONS.find((o) => o.value === config.display_context)?.label}
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-xs text-stone-500">
            {config.transform_type
              ? TRANSFORM_TYPE_OPTIONS.find((o) => o.value === config.transform_type)?.label
              : 'None'}
          </span>
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <button
            onClick={() => onToggleActive(config)}
            className={`p-1.5 rounded transition-colors ${
              config.is_active
                ? 'text-semantic-success hover:bg-semantic-success/10'
                : 'text-stone-400 hover:bg-stone-100'
            }`}
            title={config.is_active ? 'Active - click to disable' : 'Disabled - click to enable'}
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => {
              setEditData({
                display_label: config.display_label,
                display_context: config.display_context,
                transform_type: config.transform_type,
              });
              setEditingId(config.config_id);
            }}
            className="p-1.5 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors"
            title="Edit"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onDelete(config.config_id)}
            className="p-1.5 text-semantic-error hover:text-semantic-error hover:bg-semantic-error/10 rounded transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
