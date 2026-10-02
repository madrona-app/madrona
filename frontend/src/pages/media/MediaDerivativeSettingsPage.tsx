import { useState, useMemo } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Trash2, Star, MoreHorizontal, Lock } from 'lucide-react';
import { getDerivativeSizes, createDerivativeSize, deleteDerivativeSize } from '../../lib/api/media-dam';
import type { DerivativeSizeConfig } from '../../lib/api/media-dam';
import ConfirmDialog from '../../components/ConfirmDialog';

const FORMAT_OPTIONS = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'mp4', label: 'MP4' },
];

const MEDIA_TYPE_OPTIONS = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'Document' },
  { value: 'model_3d', label: '3D Model' },
];

const MEDIA_TYPE_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  document: 'Document',
  model_3d: '3D Model',
};

function CreateDerivativeSizeForm({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    label: '',
    media_type: 'image',
    max_width: 800,
    max_height: 800,
    format: 'jpeg',
    quality: 85,
    is_default: false,
    sort_order: 0,
  });

  const mutation = useMutation({
    mutationFn: () => createDerivativeSize(orgId, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-sizes', orgId] });
      onClose();
    },
  });

  return (
    <div className="card p-6 border-2 border-bark/20">
      <h3 className="text-lg font-semibold mb-4">New Derivative Size</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Name (internal)</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. web_large"
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Label (display)</label>
          <input
            type="text"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="e.g. Web Large"
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Media Type</label>
          <select
            value={form.media_type}
            onChange={(e) => setForm({ ...form, media_type: e.target.value })}
            className="input w-full"
          >
            {MEDIA_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Format</label>
          <select
            value={form.format}
            onChange={(e) => setForm({ ...form, format: e.target.value })}
            className="input w-full"
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Max Width (px)</label>
          <input
            type="number"
            min={1}
            value={form.max_width}
            onChange={(e) => setForm({ ...form, max_width: parseInt(e.target.value) || 0 })}
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Max Height (px)</label>
          <input
            type="number"
            min={1}
            value={form.max_height}
            onChange={(e) => setForm({ ...form, max_height: parseInt(e.target.value) || 0 })}
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Quality ({form.quality}%)</label>
          <input
            type="range"
            min={1}
            max={100}
            value={form.quality}
            onChange={(e) => setForm({ ...form, quality: parseInt(e.target.value) })}
            className="w-full accent-bark mt-2"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Sort Order</label>
          <input
            type="number"
            min={0}
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
            className="input w-full"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            />
            <span className="text-sm">Default size</span>
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.name || !form.label}
          className="btn btn-primary"
        >
          {mutation.isPending ? 'Creating...' : 'Create'}
        </button>
      </div>
      {mutation.isError && (
        <p className="text-sm text-semantic-error mt-2">
          Error: {(mutation.error as Error).message}
        </p>
      )}
    </div>
  );
}

function DerivativeCard({
  config,
  onDelete,
}: {
  config: DerivativeSizeConfig;
  onDelete: (c: DerivativeSizeConfig) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isSystem = config.is_system;

  return (
    <div className={`card p-4 relative ${isSystem ? 'border-dashed' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded ${isSystem ? 'bg-forest/10' : 'bg-bark/10'}`}>
            <Layers className={`h-5 w-5 ${isSystem ? 'text-forest' : 'text-bark'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{config.label}</h3>
              {config.is_default && (
                <Star className="h-4 w-4 text-copper fill-copper" />
              )}
              {isSystem && (
                <span title="System default"><Lock className="h-3.5 w-3.5 text-archive" /></span>
              )}
            </div>
            <p className="text-sm text-archive font-mono">{config.name}</p>
          </div>
        </div>
        {!isSystem && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 hover:bg-stone/30 rounded"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 bg-parchment border rounded-lg shadow-lg py-1 w-40">
                  <button
                    onClick={() => { onDelete(config); setMenuOpen(false); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-stone/30 flex items-center gap-2 text-semantic-error"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Badges */}
      {isSystem && (
        <div className="mb-3">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-forest/10 text-forest">
            System default
          </span>
        </div>
      )}

      {/* Config details */}
      <div className="text-sm space-y-1 pt-3 border-t border-lichen">
        <p className="text-archive">
          {config.max_width || '∞'} × {config.max_height || '∞'} px
        </p>
        <p className="text-archive uppercase">
          {config.format}
          {config.quality != null && ` · ${config.quality}%`}
        </p>
      </div>
    </div>
  );
}

export default function MediaDerivativeSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<DerivativeSizeConfig | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['derivative-sizes', orgId],
    queryFn: () => getDerivativeSizes(orgId!),
    enabled: !!orgId,
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: string) => deleteDerivativeSize(orgId!, configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-sizes', orgId] });
      setShowDeleteDialog(false);
      setConfigToDelete(null);
    },
  });

  const configs = data?.derivative_sizes || [];

  // Group by media_type
  const grouped = useMemo(() => {
    const groups: Record<string, DerivativeSizeConfig[]> = {};
    for (const c of configs) {
      const key = c.media_type || 'other';
      (groups[key] ??= []).push(c);
    }
    return groups;
  }, [configs]);

  const mediaTypes = useMemo(() => Object.keys(grouped).sort(), [grouped]);
  const visibleType = activeTab ?? mediaTypes[0] ?? 'image';
  const visibleConfigs = grouped[visibleType] || [];

  const handleDelete = (config: DerivativeSizeConfig) => {
    setConfigToDelete(config);
    setShowDeleteDialog(true);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 bg-stone rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded p-4 text-semantic-error">
          Error loading derivative sizes: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Derivative Sizes</h1>
          <p className="text-archive">
            Processing pipeline and download size profiles for each media type
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Size Profile
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6">
          <CreateDerivativeSizeForm orgId={orgId!} onClose={() => setShowCreate(false)} />
        </div>
      )}

      {/* Media type tabs */}
      <div className="flex gap-1 mb-6 border-b border-lichen">
        {mediaTypes.map((mt) => (
          <button
            key={mt}
            onClick={() => setActiveTab(mt)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              visibleType === mt
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink hover:border-stone'
            }`}
          >
            {MEDIA_TYPE_LABELS[mt] || mt}
            <span className="ml-1.5 text-xs text-archive">({grouped[mt]?.length || 0})</span>
          </button>
        ))}
      </div>

      {/* Configs grid */}
      {visibleConfigs.length === 0 ? (
        <div className="card p-12 text-center">
          <Layers className="h-12 w-12 text-archive mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No profiles for {MEDIA_TYPE_LABELS[visibleType] || visibleType}</h3>
          <p className="text-archive max-w-md mx-auto mb-6">
            System defaults will be used for processing. Add custom profiles to override.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary">
            Add Profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleConfigs.map((config) => (
            <DerivativeCard
              key={config.config_id}
              config={config}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setConfigToDelete(null);
        }}
        onConfirm={() => {
          if (configToDelete) {
            deleteMutation.mutate(configToDelete.config_id);
          }
        }}
        title="Delete Derivative Size"
        message={`Are you sure you want to delete "${configToDelete?.label}"? Existing derivatives using this size will not be affected.`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        confirmStyle="danger"
      />
    </div>
  );
}
