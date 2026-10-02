import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tag, Plus, Pencil, Trash2, GripVertical, Loader2, X, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import Checkbox from '../Checkbox';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import {
  listTagDefinitions,
  createTagDefinition,
  updateTagDefinition,
  deleteTagDefinition,
  reorderTagDefinitions,
} from '../../lib/api';
import type { MediaTagDefinition, MediaTagFieldType } from '../../lib/schemas';
import ConfirmDialog from '../ConfirmDialog';
import { ModalPortal } from '../ModalPortal';
import { TagValuesManager } from './TagValuesManager';

const FIELD_TYPE_LABELS: Record<MediaTagFieldType, string> = {
  text: 'Text',
  dropdown: 'Dropdown',
  multi_select: 'Multi-select',
  category_tree: 'Category tree',
  dynamic_keywords: 'Keywords',
  date: 'Date',
};

const CONTROLLED_TYPES = new Set<MediaTagFieldType>([
  'dropdown',
  'multi_select',
  'category_tree',
  'dynamic_keywords',
]);

function fieldTypeLabel(t: MediaTagFieldType | undefined): string {
  return t ? FIELD_TYPE_LABELS[t] ?? t : 'Text';
}

interface TagDefinitionsManagerProps {
  organizationId: string;
}

interface EditingDefinition {
  definition_id?: string;
  tag_key: string;
  display_name: string;
  description: string;
  field_type: MediaTagFieldType;
  allow_multiple: boolean;
  is_required: boolean;
}

// Sortable row component for drag and drop
interface SortableTagRowProps {
  definition: MediaTagDefinition;
  organizationId: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onHardDelete: () => void;
  updatePending: boolean;
  deletePending: boolean;
}

function SortableTagRow({
  definition,
  organizationId,
  expanded,
  onToggleExpand,
  onEdit,
  onDeactivate,
  onReactivate,
  onHardDelete,
  updatePending,
  deletePending,
}: SortableTagRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: definition.definition_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const isControlled = CONTROLLED_TYPES.has(definition.field_type);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${!definition.is_active ? 'bg-stone-50' : ''} ${isDragging ? 'bg-stone-100' : ''}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="p-1 cursor-grab hover:bg-stone-100 rounded transition-colors touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} className="text-stone-400" />
        </button>

        {isControlled ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="p-1 text-archive hover:text-ink hover:bg-stone-100 rounded"
            aria-label={expanded ? 'Collapse values' : 'Manage values'}
            title={expanded ? 'Collapse values' : 'Manage values'}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-[24px]" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-stone-900">{definition.display_name}</span>
            <code className="text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{definition.tag_key}</code>
            <span className="text-xs bg-forest/10 text-forest px-1.5 py-0.5 rounded">
              {fieldTypeLabel(definition.field_type)}
            </span>
            {definition.allow_multiple && (
              <span className="text-xs bg-stone-100 text-archive px-1.5 py-0.5 rounded">Multi</span>
            )}
            {definition.is_required && (
              <span className="text-xs bg-semantic-warning/10 text-semantic-warning px-1.5 py-0.5 rounded">Required</span>
            )}
            {!definition.is_active && (
              <span className="text-xs bg-semantic-error/10 text-semantic-error px-1.5 py-0.5 rounded">Inactive</span>
            )}
          </div>
          {definition.description && (
            <p className="text-sm text-archive truncate">{definition.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!definition.is_active ? (
            <>
              <button
                onClick={onReactivate}
                disabled={updatePending}
                className="p-2 text-stone-400 hover:text-semantic-success hover:bg-stone-100 rounded disabled:opacity-50"
                title="Reactivate"
              >
                <RotateCcw size={16} />
              </button>
              <button
                onClick={onHardDelete}
                disabled={deletePending}
                className="p-2 text-stone-400 hover:text-semantic-error hover:bg-stone-100 rounded disabled:opacity-50"
                title="Delete permanently"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="p-2 text-stone-400 hover:text-ink hover:bg-stone-100 rounded"
                title="Edit"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={onDeactivate}
                className="p-2 text-stone-400 hover:text-semantic-warning hover:bg-stone-100 rounded"
                title="Deactivate"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && isControlled && (
        <div className="px-4 pb-4 pl-12 bg-stone-50/60 border-t border-stone-200">
          <TagValuesManager
            organizationId={organizationId}
            definition={definition}
          />
        </div>
      )}
    </div>
  );
}

export function TagDefinitionsManager({ organizationId }: TagDefinitionsManagerProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EditingDefinition | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Focus into the dialog, a focus trap and Escape-to-close, all of which this
  // hand-rolled dialog lacked: the modal sweep found focus still on the page
  // behind it and Escape doing nothing.
  const { modalRef, titleId } = useAccessibleModal({
    isOpen: showForm && !!editing,
    onClose: () => setShowForm(false),
    titlePrefix: 'tag-definition-modal',
  });

  // Setup sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { data, isLoading } = useQuery({
    queryKey: ['tag-definitions', organizationId, includeInactive],
    queryFn: () => listTagDefinitions(organizationId, { includeInactive }),
  });

  const createMutation = useMutation({
    mutationFn: (def: { tag_key: string; display_name: string; description?: string; field_type?: MediaTagFieldType; allow_multiple?: boolean; is_required?: boolean }) =>
      createTagDefinition(organizationId, def),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-definitions', organizationId] });
      setShowForm(false);
      setEditing(null);
      setFormError(null);
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409 || error.message?.includes('409') || error.message?.toLowerCase().includes('conflict')) {
        // Show inactive tags so user can see the conflicting tag
        setIncludeInactive(true);
        setShowForm(false);
        setEditing(null);
        setFormError('A tag with this key already exists. It may be inactive - you can reactivate it instead of creating a new one.');
      } else {
        setFormError(error.message || 'Failed to create tag definition');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { display_name?: string; description?: string; field_type?: MediaTagFieldType; allow_multiple?: boolean; is_required?: boolean; sort_order?: number; is_active?: boolean } }) =>
      updateTagDefinition(organizationId, id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-definitions', organizationId] });
      setShowForm(false);
      setEditing(null);
      setFormError(null);
    },
    onError: (error: Error) => {
      setFormError(error.message || 'Failed to update tag definition');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deleteTagDefinition(organizationId, id, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-definitions', organizationId] });
      setFormError(null);
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => deleteTagDefinition(organizationId, id, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-definitions', organizationId] });
      setFormError(null);
    },
    onError: (error: Error) => {
      // Backend returns error if tag is in use
      if (error.message?.toLowerCase().includes('in use') || error.message?.toLowerCase().includes('referenced')) {
        setFormError('This tag cannot be deleted because it is being used by media items. Remove the tag from all media first.');
      } else {
        setFormError(error.message || 'Failed to delete tag definition');
      }
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => reorderTagDefinitions(organizationId, order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tag-definitions', organizationId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    if (editing.definition_id) {
      updateMutation.mutate({
        id: editing.definition_id,
        updates: {
          display_name: editing.display_name,
          description: editing.description || undefined,
          field_type: editing.field_type,
          allow_multiple: editing.allow_multiple,
          is_required: editing.is_required,
        },
      });
    } else {
      createMutation.mutate({
        tag_key: editing.tag_key,
        display_name: editing.display_name,
        description: editing.description || undefined,
        field_type: editing.field_type,
        allow_multiple: editing.allow_multiple,
        is_required: editing.is_required,
      });
    }
  };

  const handleEdit = (def: MediaTagDefinition) => {
    setEditing({
      definition_id: def.definition_id,
      tag_key: def.tag_key,
      display_name: def.display_name,
      description: def.description || '',
      field_type: def.field_type ?? 'text',
      allow_multiple: def.allow_multiple ?? false,
      is_required: def.is_required,
    });
    setFormError(null);
    setShowForm(true);
  };

  const handleDeactivate = (def: MediaTagDefinition) => {
    setConfirmState({
      action: () => deactivateMutation.mutate(def.definition_id),
      title: 'Deactivate Tag',
      message: `Are you sure you want to deactivate the "${def.display_name}" tag? It can be reactivated later.`,
    });
  };

  const handleHardDelete = (def: MediaTagDefinition) => {
    setConfirmState({
      action: () => hardDeleteMutation.mutate(def.definition_id),
      title: 'Delete Tag',
      message: `Are you sure you want to permanently delete the "${def.display_name}" tag? This cannot be undone.`,
    });
  };

  const handleReactivate = (def: MediaTagDefinition) => {
    updateMutation.mutate({
      id: def.definition_id,
      updates: { is_active: true },
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const definitions = data?.definitions || [];
      const oldIndex = definitions.findIndex((d) => d.definition_id === active.id);
      const newIndex = definitions.findIndex((d) => d.definition_id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(definitions, oldIndex, newIndex);
        reorderMutation.mutate(newOrder.map((d) => d.definition_id));
      }
    }
  };

  const definitions = data?.definitions || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={20} className="text-stone-600" />
          <h3 className="text-lg font-medium text-stone-900">Tag Definitions</h3>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button
            onClick={() => {
              setEditing({
                tag_key: '',
                display_name: '',
                description: '',
                field_type: 'text',
                allow_multiple: false,
                is_required: false,
              });
              setFormError(null);
              setShowForm(true);
            }}
            className="px-3 py-1.5 bg-forest text-parchment rounded-md text-sm flex items-center gap-1 hover:bg-forest/90 transition-colors"
          >
            <Plus size={16} />
            Add Tag
          </button>
        </div>
      </div>

      {formError && !showForm && (
        <div className="p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-md text-semantic-warning text-sm flex items-center justify-between">
          <span>{formError}</span>
          <button
            onClick={() => setFormError(null)}
            className="p-1 hover:bg-semantic-warning/10 rounded"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showForm && editing && (
        <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
          onClick={() => setShowForm(false)}
        >
          <div
            ref={modalRef}
            {...getModalAriaProps(titleId)}
            className="bg-parchment rounded-lg shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <h4 id={titleId} className="font-medium text-stone-900">
                {editing.definition_id ? 'Edit Tag Definition' : 'New Tag Definition'}
              </h4>
              <button
                onClick={() => setShowForm(false)}
                className="p-1 hover:bg-stone-100 rounded text-archive hover:text-ink"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Tag Key</label>
                <input
                  type="text"
                  value={editing.tag_key}
                  onChange={(e) => setEditing({ ...editing, tag_key: e.target.value })}
                  disabled={!!editing.definition_id}
                  placeholder="e.g., location, project, event"
                  className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:text-archive"
                  required
                />
                {!editing.definition_id && (
                  <p className="text-xs text-archive mt-1">
                    Unique identifier (cannot be changed later)
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Display Name</label>
                <input
                  type="text"
                  value={editing.display_name}
                  onChange={(e) => setEditing({ ...editing, display_name: e.target.value })}
                  placeholder="e.g., Location, Project Name"
                  className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Description (optional)</label>
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Help text for users"
                  className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Field type</label>
                <select
                  value={editing.field_type}
                  onChange={(e) => {
                    const ft = e.target.value as MediaTagFieldType;
                    // multi_select / category_tree are inherently multi-valued.
                    const forcedMulti = ft === 'multi_select' || ft === 'category_tree';
                    setEditing({
                      ...editing,
                      field_type: ft,
                      allow_multiple: forcedMulti ? true : editing.allow_multiple,
                    });
                  }}
                  className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <option value="text">Text — free-form value</option>
                  <option value="date">Date — single date</option>
                  <option value="dropdown">Dropdown — pick one from a fixed list</option>
                  <option value="multi_select">Multi-select — pick multiple from a fixed list</option>
                  <option value="dynamic_keywords">Keywords — autocomplete, users can add new</option>
                  <option value="category_tree">Category tree — hierarchical values</option>
                </select>
                <p className="text-xs text-archive mt-1">
                  Controls how users enter values. Controlled types (dropdown, multi-select, tree,
                  keywords) let you define a list of allowed values below.
                </p>
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={editing.allow_multiple}
                    disabled={editing.field_type === 'multi_select' || editing.field_type === 'category_tree'}
                    onChange={(e) => setEditing({ ...editing, allow_multiple: e.target.checked })}
                  />
                  <span className="text-sm text-ink">Allow multiple values per asset</span>
                </label>
                <p className="text-xs text-archive mt-1">
                  Multi-select and category tree fields are always multi-valued.
                </p>
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={editing.is_required}
                    onChange={(e) => setEditing({ ...editing, is_required: e.target.checked })}
                  />
                  <span className="text-sm text-ink">Required tag</span>
                </label>
                <p className="text-xs text-archive mt-1">
                  If checked, media items should have a value for this tag
                </p>
              </div>
              {formError && (
                <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-md text-semantic-error text-sm">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-lichen rounded-md text-sm text-ink hover:bg-stone-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-forest text-parchment rounded-md text-sm hover:bg-forest/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  {editing.definition_id ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
          </ModalPortal>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-stone-400" />
        </div>
      ) : definitions.length === 0 ? (
        <div className="text-center py-8 text-archive">
          <Tag size={40} className="mx-auto mb-2 opacity-50" />
          <p>No tag definitions yet</p>
          <p className="text-sm">Create tag definitions to organize your media</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={definitions.map((d) => d.definition_id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="border border-stone-200 rounded-lg divide-y divide-stone-200">
              {definitions.map((def) => (
                <SortableTagRow
                  key={def.definition_id}
                  definition={def}
                  organizationId={organizationId}
                  expanded={expandedId === def.definition_id}
                  onToggleExpand={() =>
                    setExpandedId((prev) => (prev === def.definition_id ? null : def.definition_id))
                  }
                  onEdit={() => handleEdit(def)}
                  onDeactivate={() => handleDeactivate(def)}
                  onReactivate={() => handleReactivate(def)}
                  onHardDelete={() => handleHardDelete(def)}
                  updatePending={updateMutation.isPending}
                  deletePending={hardDeleteMutation.isPending}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />
    </div>
  );
}
