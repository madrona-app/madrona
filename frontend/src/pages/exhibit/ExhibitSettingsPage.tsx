import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  ChevronLeft,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Frame,
  Box,
  MoreVertical,
  Lock,
} from 'lucide-react';
import {
  getFrameStyles,
  createFrameStyle,
  updateFrameStyle,
  deleteFrameStyle,
  getMountConfigs,
  createMountConfig,
  updateMountConfig,
  deleteMountConfig,
  type FrameStyle,
  type MountConfig,
} from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import ConfirmDialog from '../../components/ConfirmDialog';
import SlideOver from '../../components/ui/SlideOver';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const PROFILE_TYPES = [
  { value: 'flat', label: 'Flat' },
  { value: 'stepped', label: 'Stepped' },
  { value: 'ornate', label: 'Ornate' },
  { value: 'float', label: 'Float' },
  { value: 'shadowbox', label: 'Shadowbox' },
];

const MOUNT_TYPES = [
  { value: 'wall', label: 'Wall Mount' },
  { value: 'plinth', label: 'Plinth/Pedestal' },
  { value: 'vitrine', label: 'Vitrine/Case' },
  { value: 'hanging', label: 'Hanging' },
  { value: 'floor', label: 'Floor' },
];

export default function ExhibitSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('exhibit.edit');

  const [activeTab, setActiveTab] = useState<'frames' | 'mounts'>('frames');

  // Frame Styles state
  const [showFrameEditor, setShowFrameEditor] = useState(false);
  const [editingFrame, setEditingFrame] = useState<FrameStyle | null>(null);
  const [deleteFrame, setDeleteFrame] = useState<FrameStyle | null>(null);
  const [frameMenuOpen, setFrameMenuOpen] = useState<string | null>(null);

  // Mount Configs state
  const [showMountEditor, setShowMountEditor] = useState(false);
  const [editingMount, setEditingMount] = useState<MountConfig | null>(null);
  const [deleteMount, setDeleteMount] = useState<MountConfig | null>(null);
  const [mountMenuOpen, setMountMenuOpen] = useState<string | null>(null);

  // Fetch data
  const { data: frameData, isLoading: framesLoading } = useQuery({
    queryKey: ['frame-styles', orgId],
    queryFn: () => getFrameStyles(orgId!),
    enabled: !!orgId,
  });

  const { data: mountData, isLoading: mountsLoading } = useQuery({
    queryKey: ['mount-configs', orgId],
    queryFn: () => getMountConfigs(orgId!),
    enabled: !!orgId,
  });

  // Delete mutations
  const deleteFrameMutation = useMutation({
    mutationFn: (styleId: string) => deleteFrameStyle(orgId!, styleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frame-styles', orgId] });
      setDeleteFrame(null);
    },
  });

  const deleteMountMutation = useMutation({
    mutationFn: (configId: string) => deleteMountConfig(orgId!, configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mount-configs', orgId] });
      setDeleteMount(null);
    },
  });

  const frames = frameData?.frame_styles || [];
  const mounts = mountData?.mount_configs || [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Back Navigation */}
      <Link
        to={`/organizations/${orgId}/collections/exhibitions`}
        className="inline-flex items-center gap-1 text-sm text-archive hover:text-bark no-underline"
      >
        <ChevronLeft size={16} />
        Back to exhibitions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink flex items-center gap-2">
            <Settings className="w-6 h-6" />
            Exhibit Settings
          </h1>
          <p className="text-archive mt-1">
            Configure frame styles and mount configurations for exhibitions
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-lichen">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('frames')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'frames'
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink'
            }`}
          >
            <Frame className="w-4 h-4 inline-block mr-2" />
            Frame Styles
          </button>
          <button
            onClick={() => setActiveTab('mounts')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'mounts'
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink'
            }`}
          >
            <Box className="w-4 h-4 inline-block mr-2" />
            Mount Configurations
          </button>
        </nav>
      </div>

      {/* Frame Styles Tab */}
      {activeTab === 'frames' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-archive">
              Define frame profiles for artworks in exhibitions
            </p>
            {canEdit && (
              <button
                onClick={() => {
                  setEditingFrame(null);
                  setShowFrameEditor(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
              >
                <Plus size={16} />
                New Frame Style
              </button>
            )}
          </div>

          {framesLoading ? (
            <div className="flex items-center justify-center py-12">
              <MadronaLoader variant="dots" />
            </div>
          ) : frames.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-lichen rounded-lg">
              <Frame className="w-12 h-12 text-archive mx-auto mb-4" />
              <h3 className="text-lg font-medium text-ink mb-2">No frame styles</h3>
              <p className="text-archive">Create custom frame styles for your exhibitions</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {frames.map((frame) => (
                <div
                  key={frame.frame_style_id}
                  className="bg-parchment border border-lichen rounded-lg p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-ink">{frame.name}</h3>
                        {frame.is_system && (
                          <span title="System default"><Lock size={12} className="text-archive" /></span>
                        )}
                      </div>
                      <p className="text-sm text-archive mt-1">
                        {PROFILE_TYPES.find((t) => t.value === frame.profile_type)?.label || frame.profile_type}
                      </p>
                    </div>

                    {canEdit && !frame.is_system && (
                      <div className="relative">
                        <button
                          onClick={() => setFrameMenuOpen(frameMenuOpen === frame.frame_style_id ? null : frame.frame_style_id)}
                          className="p-1 text-archive hover:text-ink rounded"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {frameMenuOpen === frame.frame_style_id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setFrameMenuOpen(null)} />
                            <div className="absolute right-0 top-8 w-32 bg-parchment border border-lichen rounded-lg shadow-lg z-20">
                              <button
                                onClick={() => {
                                  setEditingFrame(frame);
                                  setShowFrameEditor(true);
                                  setFrameMenuOpen(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center gap-2"
                              >
                                <Edit size={14} />
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteFrame(frame);
                                  setFrameMenuOpen(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center gap-2 text-semantic-error"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-lichen grid grid-cols-2 gap-2 text-xs text-archive">
                    <div>
                      <span className="text-ink/50">Width:</span> {frame.default_width_cm} cm
                    </div>
                    <div>
                      <span className="text-ink/50">Depth:</span> {frame.default_depth_cm} cm
                    </div>
                    {frame.color && (
                      <div className="flex items-center gap-1">
                        <span className="text-ink/50">Color:</span>
                        <span
                          className="w-3 h-3 rounded border border-lichen"
                          style={{ backgroundColor: frame.color }}
                        />
                        {frame.color}
                      </div>
                    )}
                    {frame.material && (
                      <div>
                        <span className="text-ink/50">Material:</span> {frame.material}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mount Configurations Tab */}
      {activeTab === 'mounts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-archive">
              Define mount configurations for different object types
            </p>
            {canEdit && (
              <button
                onClick={() => {
                  setEditingMount(null);
                  setShowMountEditor(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
              >
                <Plus size={16} />
                New Mount Config
              </button>
            )}
          </div>

          {mountsLoading ? (
            <div className="flex items-center justify-center py-12">
              <MadronaLoader variant="dots" />
            </div>
          ) : mounts.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-lichen rounded-lg">
              <Box className="w-12 h-12 text-archive mx-auto mb-4" />
              <h3 className="text-lg font-medium text-ink mb-2">No mount configurations</h3>
              <p className="text-archive">Create custom mount configurations for exhibitions</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mounts.map((mount) => (
                <div
                  key={mount.mount_config_id}
                  className="bg-parchment border border-lichen rounded-lg p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-ink">{mount.name}</h3>
                        {mount.is_system && (
                          <span title="System default"><Lock size={12} className="text-archive" /></span>
                        )}
                      </div>
                      <p className="text-sm text-archive mt-1">
                        {MOUNT_TYPES.find((t) => t.value === mount.mount_type)?.label || mount.mount_type}
                      </p>
                    </div>

                    {canEdit && !mount.is_system && (
                      <div className="relative">
                        <button
                          onClick={() => setMountMenuOpen(mountMenuOpen === mount.mount_config_id ? null : mount.mount_config_id)}
                          className="p-1 text-archive hover:text-ink rounded"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {mountMenuOpen === mount.mount_config_id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMountMenuOpen(null)} />
                            <div className="absolute right-0 top-8 w-32 bg-parchment border border-lichen rounded-lg shadow-lg z-20">
                              <button
                                onClick={() => {
                                  setEditingMount(mount);
                                  setShowMountEditor(true);
                                  setMountMenuOpen(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center gap-2"
                              >
                                <Edit size={14} />
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteMount(mount);
                                  setMountMenuOpen(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-stone/50 flex items-center gap-2 text-semantic-error"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {mount.config && Object.keys(mount.config).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-lichen text-xs text-archive">
                      <pre className="bg-stone/30 p-2 rounded overflow-auto max-h-20">
                        {JSON.stringify(mount.config, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Frame Style Editor */}
      <FrameStyleEditor
        isOpen={showFrameEditor}
        organizationId={orgId!}
        frame={editingFrame}
        onClose={() => {
          setShowFrameEditor(false);
          setEditingFrame(null);
        }}
        onSuccess={() => {
          setShowFrameEditor(false);
          setEditingFrame(null);
        }}
      />

      {/* Mount Config Editor */}
      <MountConfigEditor
        isOpen={showMountEditor}
        organizationId={orgId!}
        mount={editingMount}
        onClose={() => {
          setShowMountEditor(false);
          setEditingMount(null);
        }}
        onSuccess={() => {
          setShowMountEditor(false);
          setEditingMount(null);
        }}
      />

      {/* Delete Confirmations */}
      <ConfirmDialog
        isOpen={!!deleteFrame}
        onClose={() => setDeleteFrame(null)}
        onConfirm={() => {
          if (deleteFrame) {
            deleteFrameMutation.mutate(deleteFrame.frame_style_id);
          }
        }}
        title="Delete Frame Style"
        message={`Are you sure you want to delete "${deleteFrame?.name}"? This cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />

      <ConfirmDialog
        isOpen={!!deleteMount}
        onClose={() => setDeleteMount(null)}
        onConfirm={() => {
          if (deleteMount) {
            deleteMountMutation.mutate(deleteMount.mount_config_id);
          }
        }}
        title="Delete Mount Configuration"
        message={`Are you sure you want to delete "${deleteMount?.name}"? This cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}

// Frame Style Editor Component
function FrameStyleEditor({
  isOpen,
  organizationId,
  frame,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  organizationId: string;
  frame: FrameStyle | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditMode = !!frame;

  const [name, setName] = useState(frame?.name || '');
  const [description, setDescription] = useState(frame?.description || '');
  const [profileType, setProfileType] = useState(frame?.profile_type || 'flat');
  const [widthCm, setWidthCm] = useState(frame?.default_width_cm?.toString() || '5');
  const [depthCm, setDepthCm] = useState(frame?.default_depth_cm?.toString() || '2');
  const [color, setColor] = useState(frame?.color || '');
  const [material, setMaterial] = useState(frame?.material || '');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createFrameStyle(organizationId, {
        name,
        description: description || undefined,
        profile_type: profileType as FrameStyle['profile_type'],
        default_width_cm: Number(widthCm),
        default_depth_cm: Number(depthCm),
        color: color || undefined,
        material: material || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frame-styles', organizationId] });
      onSuccess();
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateFrameStyle(organizationId, frame!.frame_style_id, {
        name,
        description: description || undefined,
        profile_type: profileType as FrameStyle['profile_type'],
        default_width_cm: Number(widthCm),
        default_depth_cm: Number(depthCm),
        color: color || undefined,
        material: material || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frame-styles', organizationId] });
      onSuccess();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (isEditMode) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Frame Style' : 'Create Frame Style'}
      subtitle="Configure frame profile settings"
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
          >
            {isPending && <Loader2 size={16} className="animate-spin" />}
            {isEditMode ? 'Save Changes' : 'Create Style'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Name <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Gallery Black"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Profile Type</label>
          <select
            value={profileType}
            onChange={(e) => setProfileType(e.target.value as "flat" | "stepped" | "ornate" | "float" | "shadowbox")}
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            {PROFILE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Width (cm)</label>
            <input
              type="number"
              value={widthCm}
              onChange={(e) => setWidthCm(e.target.value)}
              step="0.5"
              min="0"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Depth (cm)</label>
            <input
              type="number"
              value={depthCm}
              onChange={(e) => setDepthCm(e.target.value)}
              step="0.5"
              min="0"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Color</label>
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g., Black, Gold"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Material</label>
            <input
              type="text"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder="e.g., Wood, Metal"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

// Mount Config Editor Component
function MountConfigEditor({
  isOpen,
  organizationId,
  mount,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  organizationId: string;
  mount: MountConfig | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditMode = !!mount;

  const [name, setName] = useState(mount?.name || '');
  const [mountType, setMountType] = useState(mount?.mount_type || 'wall');
  const [configJson, setConfigJson] = useState(
    mount?.config ? JSON.stringify(mount.config, null, 2) : '{}'
  );
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => {
      let config;
      try {
        config = JSON.parse(configJson);
      } catch {
        throw new Error('Invalid JSON configuration');
      }
      return createMountConfig(organizationId, {
        name,
        mount_type: mountType as MountConfig['mount_type'],
        config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mount-configs', organizationId] });
      onSuccess();
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      let config;
      try {
        config = JSON.parse(configJson);
      } catch {
        throw new Error('Invalid JSON configuration');
      }
      return updateMountConfig(organizationId, mount!.mount_config_id, {
        name,
        mount_type: mountType as MountConfig['mount_type'],
        config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mount-configs', organizationId] });
      onSuccess();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (isEditMode) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Mount Configuration' : 'Create Mount Configuration'}
      subtitle="Configure mount settings for objects"
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
          >
            {isPending && <Loader2 size={16} className="animate-spin" />}
            {isEditMode ? 'Save Changes' : 'Create Config'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Name <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Standard Plinth"
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Mount Type</label>
          <select
            value={mountType}
            onChange={(e) => setMountType(e.target.value as "hanging" | "floor" | "wall" | "plinth" | "vitrine")}
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            {MOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Configuration (JSON)
          </label>
          <textarea
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 border border-lichen rounded-lg text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            placeholder='{"height_cm": 100, "width_cm": 50}'
          />
          <p className="mt-1 text-xs text-archive">
            Define mount-specific settings like dimensions, materials, etc.
          </p>
        </div>
      </div>
    </SlideOver>
  );
}
