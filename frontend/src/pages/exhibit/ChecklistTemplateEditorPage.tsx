import { useState, useEffect, useCallback } from 'react';
import Checkbox from '../../components/Checkbox';
import { Link, useParams } from 'react-router-dom';
import {
  ClipboardList,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Edit3,
  Trash2,
  History,
  Upload,
  Lock,
  Loader2,
  GripVertical,
  AlertTriangle,
  CheckCircle2,
  Copy,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { usePermissions } from '../../hooks/usePermissions';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SlideOver } from '../../components/ui/SlideOver';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

// Types
type ChecklistPhase = 'planning' | 'pre_install' | 'install' | 'open' | 'close' | 'deinstall' | 'travel';
type ChecklistRole = 'curator' | 'registrar' | 'exhibitions_manager' | 'preparator' | 'conservation' | 'marketing' | 'education' | 'security' | 'facilities';

interface ChecklistTemplateItem {
  template_item_id: string;
  phase: ChecklistPhase;
  title: string;
  description: string | null;
  responsible_role: ChecklistRole;
  default_due_offset_days: number | null;
  sort_order: number;
  is_required: boolean;
}

interface ChecklistTemplateVersion {
  version_id: string;
  version_number: number;
  is_published: boolean;
  is_locked: boolean;
  change_notes: string | null;
  created_at: string;
  items: ChecklistTemplateItem[];
  item_count: number;
}

interface ChecklistTemplate {
  template_id: string;
  name: string;
  description: string | null;
  exhibition_type: string;
  is_archived: boolean;
  created_at: string;
  versions: ChecklistTemplateVersion[];
}

// Constants
const PHASE_ORDER: ChecklistPhase[] = ['planning', 'pre_install', 'install', 'open', 'close', 'deinstall', 'travel'];

const PHASE_CONFIG: Record<ChecklistPhase, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'bg-semantic-info/10 text-semantic-info' },
  pre_install: { label: 'Pre-Install', color: 'bg-forest/10 text-forest' },
  install: { label: 'Install', color: 'bg-semantic-warning/10 text-semantic-warning' },
  open: { label: 'Open', color: 'bg-semantic-success/10 text-semantic-success' },
  close: { label: 'Close', color: 'bg-semantic-warning/10 text-semantic-warning' },
  deinstall: { label: 'Deinstall', color: 'bg-semantic-error/10 text-semantic-error' },
  travel: { label: 'Travel', color: 'bg-bark/10 text-bark' },
};

const ROLE_OPTIONS: { value: ChecklistRole; label: string }[] = [
  { value: 'curator', label: 'Curator' },
  { value: 'registrar', label: 'Registrar' },
  { value: 'exhibitions_manager', label: 'Exhibitions Manager' },
  { value: 'preparator', label: 'Preparator' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'education', label: 'Education' },
  { value: 'security', label: 'Security' },
  { value: 'facilities', label: 'Facilities' },
];

const EXHIBITION_TYPE_LABELS: Record<string, string> = {
  general: 'General',
  in_house: 'In-House',
  incoming_traveling: 'Incoming Traveling',
  outgoing_traveling: 'Outgoing Traveling',
};

// Item Editor Component
interface ItemEditorProps {
  item: Partial<ChecklistTemplateItem>;
  onChange: (item: Partial<ChecklistTemplateItem>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
}

function ItemEditor({ item, onChange, onSave, onCancel, saving, isNew }: ItemEditorProps) {
  return (
    <div className="bg-stone/30 border border-lichen rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-ink mb-1">
            Title <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={item.title || ''}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
            placeholder="Task title..."
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            autoFocus
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <textarea
            value={item.description || ''}
            onChange={(e) => onChange({ ...item, description: e.target.value })}
            placeholder="Optional details..."
            rows={2}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Responsible Role <span className="text-semantic-error">*</span>
          </label>
          <select
            value={item.responsible_role || 'curator'}
            onChange={(e) => onChange({ ...item, responsible_role: e.target.value as ChecklistRole })}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Due Date Offset (days)
          </label>
          <input
            type="number"
            value={item.default_due_offset_days ?? ''}
            onChange={(e) =>
              onChange({
                ...item,
                default_due_offset_days: e.target.value ? parseInt(e.target.value) : null,
              })
            }
            placeholder="e.g., -30 for 30 days before opening"
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
          <p className="text-xs text-archive mt-1">
            Negative = before exhibition opens, Positive = after
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={item.is_required !== false}
            onChange={(e) => onChange({ ...item, is_required: e.target.checked })}
          />
          <span className="text-sm text-ink">Required item</span>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-archive hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!item.title?.trim() || saving}
          className="flex items-center gap-2 px-3 py-1.5 bg-bark text-parchment text-sm rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {isNew ? 'Add Item' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// Phase Group Component
interface PhaseGroupProps {
  phase: ChecklistPhase;
  items: ChecklistTemplateItem[];
  isExpanded: boolean;
  onToggle: () => void;
  onAddItem: () => void;
  onEditItem: (item: ChecklistTemplateItem) => void;
  onDeleteItem: (item: ChecklistTemplateItem) => void;
  isLocked: boolean;
  editingItemId: string | null;
  editingItem: Partial<ChecklistTemplateItem> | null;
  onEditingItemChange: (item: Partial<ChecklistTemplateItem>) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  saving: boolean;
  newItemPhase: ChecklistPhase | null;
  newItem: Partial<ChecklistTemplateItem>;
  onNewItemChange: (item: Partial<ChecklistTemplateItem>) => void;
  onSaveNew: () => void;
  onCancelNew: () => void;
}

function PhaseGroup({
  phase,
  items,
  isExpanded,
  onToggle,
  onAddItem,
  onEditItem,
  onDeleteItem,
  isLocked,
  editingItemId,
  editingItem,
  onEditingItemChange,
  onSaveEdit,
  onCancelEdit,
  saving,
  newItemPhase,
  newItem,
  onNewItemChange,
  onSaveNew,
  onCancelNew,
}: PhaseGroupProps) {
  const config = PHASE_CONFIG[phase];
  const sortedItems = [...items].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="border border-lichen rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-parchment border-b border-lichen cursor-pointer hover:bg-stone/30"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-archive" />
          ) : (
            <ChevronRight className="w-5 h-5 text-archive" />
          )}
          <span className={`px-2.5 py-1 text-sm font-medium rounded-full ${config.color}`}>
            {config.label}
          </span>
          <span className="text-sm text-archive">{items.length} items</span>
        </div>
        {!isLocked && isExpanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddItem();
            }}
            className="flex items-center gap-1 px-2 py-1 text-sm text-bark hover:text-copper-dark"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="bg-parchment/50">
          {sortedItems.length === 0 && newItemPhase !== phase ? (
            <div className="px-4 py-6 text-center text-archive">
              No items in this phase.
              {!isLocked && (
                <button
                  onClick={onAddItem}
                  className="ml-2 text-bark hover:text-copper-dark underline"
                >
                  Add one
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-lichen/50">
              {sortedItems.map((item) => (
                <div key={item.template_item_id} className="px-4 py-3">
                  {editingItemId === item.template_item_id && editingItem ? (
                    <ItemEditor
                      item={editingItem}
                      onChange={onEditingItemChange}
                      onSave={onSaveEdit}
                      onCancel={onCancelEdit}
                      saving={saving}
                      isNew={false}
                    />
                  ) : (
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {!isLocked && (
                          <GripVertical className="w-4 h-4 text-archive mt-1 cursor-move" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-ink">{item.title}</span>
                            {!item.is_required && (
                              <span className="text-xs text-archive">(Optional)</span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-sm text-archive mt-1">{item.description}</p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-archive">
                            <span>
                              Role:{' '}
                              {ROLE_OPTIONS.find((r) => r.value === item.responsible_role)?.label}
                            </span>
                            {item.default_due_offset_days !== null && (
                              <span>
                                Due:{' '}
                                {item.default_due_offset_days === 0
                                  ? 'On opening'
                                  : item.default_due_offset_days < 0
                                  ? `${Math.abs(item.default_due_offset_days)} days before`
                                  : `${item.default_due_offset_days} days after`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {!isLocked && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onEditItem(item)}
                            className="p-1 text-archive hover:text-ink rounded"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDeleteItem(item)}
                            className="p-1 text-archive hover:text-semantic-error rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {newItemPhase === phase && (
                <div className="px-4 py-3">
                  <ItemEditor
                    item={newItem}
                    onChange={onNewItemChange}
                    onSave={onSaveNew}
                    onCancel={onCancelNew}
                    saving={saving}
                    isNew={true}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Version History Slide-over
interface VersionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  versions: ChecklistTemplateVersion[];
  currentVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  onCreateVersion: (copyFromVersionId?: string) => void;
}

function VersionHistory({
  isOpen,
  onClose,
  versions,
  currentVersionId,
  onSelectVersion,
  onCreateVersion,
}: VersionHistoryProps) {
  const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number);

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Version History"
      subtitle="View and manage template versions"
      width="md"
    >
      <div className="space-y-4">
        <button
          onClick={() => onCreateVersion()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-lichen rounded-lg text-ink hover:bg-stone"
        >
          <Plus className="w-4 h-4" />
          Create New Version
        </button>

        <div className="space-y-2">
          {sortedVersions.map((version) => (
            <div
              key={version.version_id}
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                version.version_id === currentVersionId
                  ? 'border-bark bg-bark/5'
                  : 'border-lichen hover:bg-stone/30'
              }`}
              onClick={() => onSelectVersion(version.version_id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">Version {version.version_number}</span>
                  {version.is_published && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-semantic-success/10 text-semantic-success">
                      <CheckCircle2 className="w-3 h-3" />
                      Published
                    </span>
                  )}
                  {version.is_locked && !version.is_published && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-stone text-ink">
                      <Lock className="w-3 h-3" />
                      Locked
                    </span>
                  )}
                </div>
                <span className="text-xs text-archive">
                  {version.item_count || version.items?.length || 0} items
                </span>
              </div>
              {version.change_notes && (
                <p className="text-sm text-archive mt-2">{version.change_notes}</p>
              )}
              <div className="text-xs text-archive mt-2">
                {formatDateShort(version.created_at)}
              </div>
              {!version.is_locked && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateVersion(version.version_id);
                  }}
                  className="mt-2 flex items-center gap-1 text-xs text-bark hover:text-copper-dark"
                >
                  <Copy className="w-3 h-3" />
                  Create copy
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </SlideOver>
  );
}

// Main Component
export default function ChecklistTemplateEditorPage() {
  const { orgId, templateId } = useParams<{ orgId: string; templateId: string }>();
  const { hasPermission } = usePermissions();

  const [template, setTemplate] = useState<ChecklistTemplate | null>(null);
  const [currentVersion, setCurrentVersion] = useState<ChecklistTemplateVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit states
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedType, setEditedType] = useState('general');

  // Phase expansion
  const [expandedPhases, setExpandedPhases] = useState<Set<ChecklistPhase>>(new Set(PHASE_ORDER));

  // Item editing
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<Partial<ChecklistTemplateItem> | null>(null);
  const [newItemPhase, setNewItemPhase] = useState<ChecklistPhase | null>(null);
  const [newItem, setNewItem] = useState<Partial<ChecklistTemplateItem>>({});

  // Dialogs
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showDeleteItemConfirm, setShowDeleteItemConfirm] = useState<ChecklistTemplateItem | null>(null);
  const [showCreateVersionModal, setShowCreateVersionModal] = useState(false);
  const [newVersionNotes, setNewVersionNotes] = useState('');
  const [copyFromVersionId, setCopyFromVersionId] = useState<string | undefined>(undefined);

  const canEdit = hasPermission('exhibit.edit');

  const loadTemplate = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{ template: ChecklistTemplate }>(
        `/organizations/${orgId}/exhibit/checklist-templates/${templateId}`
      );
      setTemplate(data.template);

      // Select the latest unlocked version, or latest overall
      const versions = data.template.versions || [];
      const unlocked = versions.filter((v) => !v.is_locked);
      const selected = unlocked.length > 0
        ? unlocked[unlocked.length - 1]
        : versions[versions.length - 1];

      if (selected) {
        await loadVersion(selected.version_id);
      } else {
        setCurrentVersion(null);
      }

      // Initialize edit form
      setEditedName(data.template.name);
      setEditedDescription(data.template.description || '');
      setEditedType(data.template.exhibition_type);
    } catch (err) {
      logger.error('Failed to load template:', err);
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setLoading(false);
    }
  }, [orgId, templateId]);

  const loadVersion = async (versionId: string) => {
    try {
      const data = await apiFetch<{ version: ChecklistTemplateVersion }>(
        `/organizations/${orgId}/exhibit/checklist-templates/${templateId}/versions/${versionId}`
      );
      setCurrentVersion(data.version);
    } catch (err) {
      logger.error('Failed to load version:', err);
    }
  };

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  const handleSaveMetadata = async () => {
    if (!editedName.trim()) return;

    setSaving(true);
    try {
      await apiFetch(`/organizations/${orgId}/exhibit/checklist-templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editedName.trim(),
          description: editedDescription.trim() || null,
          exhibition_type: editedType,
        }),
      });
      await loadTemplate();
      setIsEditingMetadata(false);
    } catch (err) {
      logger.error('Failed to save metadata:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateVersion = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { change_notes: newVersionNotes || null };
      if (copyFromVersionId) {
        body.copy_from_version_id = copyFromVersionId;
      }

      const data = await apiFetch<{ version: ChecklistTemplateVersion }>(
        `/organizations/${orgId}/exhibit/checklist-templates/${templateId}/versions`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      await loadTemplate();
      setCurrentVersion(data.version);
      setShowCreateVersionModal(false);
      setShowVersionHistory(false);
      setNewVersionNotes('');
      setCopyFromVersionId(undefined);
    } catch (err) {
      logger.error('Failed to create version:', err);
      setError(err instanceof Error ? err.message : 'Failed to create version');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishVersion = async () => {
    if (!currentVersion) return;

    setSaving(true);
    try {
      await apiFetch(
        `/organizations/${orgId}/exhibit/checklist-templates/${templateId}/versions/${currentVersion.version_id}/publish`,
        { method: 'POST' }
      );
      await loadTemplate();
      setShowPublishConfirm(false);
    } catch (err) {
      logger.error('Failed to publish version:', err);
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!currentVersion || !newItem.title?.trim()) return;

    setSaving(true);
    try {
      await apiFetch(
        `/organizations/${orgId}/exhibit/checklist-templates/${templateId}/versions/${currentVersion.version_id}/items`,
        {
          method: 'POST',
          body: JSON.stringify({
            phase: newItemPhase,
            title: newItem.title.trim(),
            description: newItem.description?.trim() || null,
            responsible_role: newItem.responsible_role || 'curator',
            default_due_offset_days: newItem.default_due_offset_days,
            is_required: newItem.is_required !== false,
          }),
        }
      );
      await loadVersion(currentVersion.version_id);
      setNewItemPhase(null);
      setNewItem({});
    } catch (err) {
      logger.error('Failed to add item:', err);
      setError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateItem = async () => {
    if (!currentVersion || !editingItemId || !editingItem?.title?.trim()) return;

    setSaving(true);
    try {
      await apiFetch(
        `/organizations/${orgId}/exhibit/checklist-templates/${templateId}/versions/${currentVersion.version_id}/items/${editingItemId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: editingItem.title.trim(),
            description: editingItem.description?.trim() || null,
            responsible_role: editingItem.responsible_role,
            default_due_offset_days: editingItem.default_due_offset_days,
            is_required: editingItem.is_required,
          }),
        }
      );
      await loadVersion(currentVersion.version_id);
      setEditingItemId(null);
      setEditingItem(null);
    } catch (err) {
      logger.error('Failed to update item:', err);
      setError(err instanceof Error ? err.message : 'Failed to update item');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!currentVersion || !showDeleteItemConfirm) return;

    setSaving(true);
    try {
      await apiFetch(
        `/organizations/${orgId}/exhibit/checklist-templates/${templateId}/versions/${currentVersion.version_id}/items/${showDeleteItemConfirm.template_item_id}`,
        { method: 'DELETE' }
      );
      await loadVersion(currentVersion.version_id);
      setShowDeleteItemConfirm(null);
    } catch (err) {
      logger.error('Failed to delete item:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    } finally {
      setSaving(false);
    }
  };

  const togglePhase = (phase: ChecklistPhase) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  const startAddItem = (phase: ChecklistPhase) => {
    setNewItemPhase(phase);
    setNewItem({ phase, responsible_role: 'curator', is_required: true });
    setEditingItemId(null);
    setEditingItem(null);
  };

  const startEditItem = (item: ChecklistTemplateItem) => {
    setEditingItemId(item.template_item_id);
    setEditingItem({ ...item });
    setNewItemPhase(null);
    setNewItem({});
  };

  // Group items by phase
  const itemsByPhase: Record<ChecklistPhase, ChecklistTemplateItem[]> = PHASE_ORDER.reduce(
    (acc, phase) => {
      acc[phase] = (currentVersion?.items || []).filter((item) => item.phase === phase);
      return acc;
    },
    {} as Record<ChecklistPhase, ChecklistTemplateItem[]>
  );

  const isLocked = currentVersion?.is_locked || false;
  const totalItems = currentVersion?.items?.length || 0;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-center py-12">
          <MadronaLoader />
        </div>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-parchment border border-lichen rounded-lg text-center py-12">
          <AlertTriangle className="w-12 h-12 mx-auto text-semantic-error mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">Failed to load template</h3>
          <p className="text-archive mb-4">{error}</p>
          <Link
            to={`/organizations/${orgId}/collections/exhibitions/settings/checklist-templates`}
            className="text-bark hover:text-copper-dark no-underline"
          >
            Back to templates
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Back Navigation */}
      <Link
        to={`/organizations/${orgId}/collections/exhibitions/settings/checklist-templates`}
        className="inline-flex items-center gap-1 text-sm text-archive hover:text-bark no-underline"
      >
        <ChevronLeft size={16} />
        Back to Templates
      </Link>

      {/* Header */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-bark/10 rounded-lg">
              <ClipboardList className="w-8 h-8 text-bark" />
            </div>
            <div>
              {isEditingMetadata ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="text-2xl font-semibold text-ink border-b-2 border-forest focus-visible:outline-none bg-transparent w-full"
                  />
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    placeholder="Description..."
                    rows={2}
                    className="w-full px-2 py-1 text-sm border border-lichen rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                  <select
                    value={editedType}
                    onChange={(e) => setEditedType(e.target.value)}
                    className="px-2 py-1 text-sm border border-lichen rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    {Object.entries(EXHIBITION_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setIsEditingMetadata(false);
                        setEditedName(template.name);
                        setEditedDescription(template.description || '');
                        setEditedType(template.exhibition_type);
                      }}
                      className="px-3 py-1 text-sm text-archive hover:text-ink"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveMetadata}
                      disabled={!editedName.trim() || saving}
                      className="flex items-center gap-1 px-3 py-1 bg-bark text-parchment text-sm rounded hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
                    >
                      {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-semibold text-ink">{template.name}</h1>
                    {canEdit && !template.is_archived && (
                      <button
                        onClick={() => setIsEditingMetadata(true)}
                        className="p-1 text-archive hover:text-ink rounded"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {template.description && (
                    <p className="text-archive mt-1">{template.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-sm text-archive">
                      {EXHIBITION_TYPE_LABELS[template.exhibition_type]}
                    </span>
                    {template.is_archived && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-stone text-accessible-gray">
                        Archived
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowVersionHistory(true)}
              className="flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone"
            >
              <History className="w-4 h-4" />
              Versions
            </button>
            {canEdit && currentVersion && !currentVersion.is_published && !currentVersion.is_locked && (
              <button
                onClick={() => setShowPublishConfirm(true)}
                disabled={totalItems === 0}
                className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
                title={totalItems === 0 ? 'Add items before publishing' : undefined}
              >
                <Upload className="w-4 h-4" />
                Publish
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Version Info Bar */}
      {currentVersion && (
        <div className="bg-parchment border border-lichen rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-medium text-ink">Version {currentVersion.version_number}</span>
            {currentVersion.is_published ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-semantic-success/10 text-semantic-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Published
              </span>
            ) : currentVersion.is_locked ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-stone text-ink">
                <Lock className="w-3.5 h-3.5" />
                Locked (in use)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-semantic-warning/10 text-semantic-warning">
                Draft
              </span>
            )}
            <span className="text-sm text-archive">{totalItems} items</span>
          </div>
          {isLocked && canEdit && (
            <button
              onClick={() => {
                setCopyFromVersionId(currentVersion.version_id);
                setShowCreateVersionModal(true);
              }}
              className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
            >
              <Copy className="w-4 h-4" />
              Create editable copy
            </button>
          )}
        </div>
      )}

      {/* No Version State */}
      {!currentVersion && (
        <div className="bg-parchment border border-lichen rounded-lg text-center py-12">
          <ClipboardList className="w-16 h-16 mx-auto text-archive/50 mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">No versions yet</h3>
          <p className="text-archive mb-6">Create your first version to start adding items.</p>
          {canEdit && (
            <button
              onClick={() => setShowCreateVersionModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
            >
              <Plus className="w-5 h-5" />
              Create Version
            </button>
          )}
        </div>
      )}

      {/* Phase Groups */}
      {currentVersion && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-ink">Checklist Items</h2>
            <button
              onClick={() => {
                if (expandedPhases.size === PHASE_ORDER.length) {
                  setExpandedPhases(new Set());
                } else {
                  setExpandedPhases(new Set(PHASE_ORDER));
                }
              }}
              className="px-3 py-1.5 text-sm text-archive hover:text-ink border border-lichen rounded-lg"
            >
              {expandedPhases.size === PHASE_ORDER.length ? 'Collapse All' : 'Expand All'}
            </button>
          </div>

          {PHASE_ORDER.map((phase) => (
            <PhaseGroup
              key={phase}
              phase={phase}
              items={itemsByPhase[phase]}
              isExpanded={expandedPhases.has(phase)}
              onToggle={() => togglePhase(phase)}
              onAddItem={() => startAddItem(phase)}
              onEditItem={startEditItem}
              onDeleteItem={(item) => setShowDeleteItemConfirm(item)}
              isLocked={isLocked}
              editingItemId={editingItemId}
              editingItem={editingItem}
              onEditingItemChange={setEditingItem}
              onSaveEdit={handleUpdateItem}
              onCancelEdit={() => {
                setEditingItemId(null);
                setEditingItem(null);
              }}
              saving={saving}
              newItemPhase={newItemPhase}
              newItem={newItem}
              onNewItemChange={setNewItem}
              onSaveNew={handleAddItem}
              onCancelNew={() => {
                setNewItemPhase(null);
                setNewItem({});
              }}
            />
          ))}
        </div>
      )}

      {/* Version History Slide-over */}
      <VersionHistory
        isOpen={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        versions={template.versions}
        currentVersionId={currentVersion?.version_id || null}
        onSelectVersion={loadVersion}
        onCreateVersion={(copyFrom) => {
          setCopyFromVersionId(copyFrom);
          setShowCreateVersionModal(true);
        }}
      />

      {/* Create Version Modal */}
      {showCreateVersionModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-ink/30" onClick={() => setShowCreateVersionModal(false)} />
            <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-lichen">
                <h2 className="text-lg font-semibold text-ink">Create New Version</h2>
              </div>
              <div className="p-6 space-y-4">
                {copyFromVersionId && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-semantic-info/10 text-semantic-info rounded-lg text-sm">
                    <Copy className="w-4 h-4" />
                    Copying items from version{' '}
                    {template.versions.find((v) => v.version_id === copyFromVersionId)?.version_number}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Change Notes (optional)
                  </label>
                  <textarea
                    value={newVersionNotes}
                    onChange={(e) => setNewVersionNotes(e.target.value)}
                    placeholder="What changed in this version..."
                    rows={3}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-lichen flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCreateVersionModal(false);
                    setCopyFromVersionId(undefined);
                    setNewVersionNotes('');
                  }}
                  className="px-4 py-2 text-sm text-archive hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateVersion}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment text-sm rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Version
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Publish Confirm */}
      <ConfirmDialog
        isOpen={showPublishConfirm}
        onClose={() => setShowPublishConfirm(false)}
        onConfirm={handlePublishVersion}
        title="Publish Version"
        message={`Publishing version ${currentVersion?.version_number} will make it available for use in exhibitions. Once published, this version cannot be edited. Are you sure?`}
        confirmText="Publish"
        confirmStyle="primary"
      />

      {/* Delete Item Confirm */}
      <ConfirmDialog
        isOpen={!!showDeleteItemConfirm}
        onClose={() => setShowDeleteItemConfirm(null)}
        onConfirm={handleDeleteItem}
        title="Delete Item"
        message={`Are you sure you want to delete "${showDeleteItemConfirm?.title}"?`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
