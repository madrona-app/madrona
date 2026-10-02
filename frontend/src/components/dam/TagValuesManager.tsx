import { useState, useMemo } from 'react';
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
import {
  Plus,
  GripVertical,
  Trash2,
  Loader2,
  RotateCcw,
  Check,
  X,
  Pencil,
} from 'lucide-react';
import {
  listTagValuesForDefinition,
  addTagValue,
  updateTagValue,
  deleteTagValue,
  reorderTagValues,
} from '../../lib/api';
import Checkbox from '../Checkbox';
import type { MediaTagDefinition, MediaTagValue } from '../../lib/schemas';
import { cn } from '../../lib/utils';

interface TagValuesManagerProps {
  organizationId: string;
  definition: MediaTagDefinition;
}

export function TagValuesManager({ organizationId, definition }: TagValuesManagerProps) {
  const queryClient = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newParentId, setNewParentId] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingParentId, setEditingParentId] = useState<string>('');

  const queryKey = ['tag-values-admin', organizationId, definition.definition_id, includeInactive];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      listTagValuesForDefinition(organizationId, definition.definition_id, {
        includeInactive,
        includeUsage: true,
      }),
  });

  const values = useMemo(() => data?.values ?? [], [data?.values]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tag-values-admin', organizationId, definition.definition_id] });
    queryClient.invalidateQueries({ queryKey: ['tag-values', organizationId, definition.definition_id] });
  };

  const addMutation = useMutation({
    mutationFn: (body: { value: string; parent_id?: string | null }) =>
      addTagValue(organizationId, definition.definition_id, body),
    onSuccess: () => {
      setNewValue('');
      setNewParentId('');
      invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; body: { value?: string; parent_id?: string | null; is_active?: boolean } }) =>
      updateTagValue(organizationId, definition.definition_id, args.id, args.body),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (args: { id: string; hard: boolean }) =>
      deleteTagValue(organizationId, definition.definition_id, args.id, args.hard),
    onSuccess: () => invalidate(),
  });

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) =>
      reorderTagValues(organizationId, definition.definition_id, order),
    onSuccess: () => invalidate(),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIndex = values.findIndex((v) => v.value_id === active.id);
      const newIndex = values.findIndex((v) => v.value_id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(values, oldIndex, newIndex);
        reorderMutation.mutate(newOrder.map((v) => v.value_id));
      }
    }
  };

  const handleAdd = () => {
    const v = newValue.trim();
    if (!v) return;
    addMutation.mutate({
      value: v,
      parent_id: newParentId || null,
    });
  };

  const handleStartEdit = (v: MediaTagValue) => {
    setEditingId(v.value_id);
    setEditingValue(v.value);
    setEditingParentId(v.parent_id ?? '');
  };

  const handleSaveEdit = (v: MediaTagValue) => {
    const body: { value?: string; parent_id?: string | null } = {};
    if (editingValue.trim() && editingValue.trim() !== v.value) {
      body.value = editingValue.trim();
    }
    if (definition.field_type === 'category_tree' && editingParentId !== (v.parent_id ?? '')) {
      body.parent_id = editingParentId || null;
    }
    if (Object.keys(body).length === 0) {
      setEditingId(null);
      return;
    }
    updateMutation.mutate({ id: v.value_id, body });
  };

  const isTree = definition.field_type === 'category_tree';

  return (
    <div className="pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink">Allowed values</h4>
        <label className="flex items-center gap-2 text-xs text-archive">
          <Checkbox
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show deprecated
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-archive py-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {values.length === 0 ? (
            <p className="text-sm text-archive italic py-1">No values yet.</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={values.map((v) => v.value_id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="border border-lichen rounded bg-parchment divide-y divide-lichen">
                  {values.map((v) => (
                    <SortableValueRow
                      key={v.value_id}
                      value={v}
                      values={values}
                      isTree={isTree}
                      isEditing={editingId === v.value_id}
                      editingValue={editingValue}
                      editingParentId={editingParentId}
                      setEditingValue={setEditingValue}
                      setEditingParentId={setEditingParentId}
                      onStartEdit={() => handleStartEdit(v)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={() => handleSaveEdit(v)}
                      onDeprecate={() => updateMutation.mutate({ id: v.value_id, body: { is_active: false } })}
                      onUndeprecate={() => updateMutation.mutate({ id: v.value_id, body: { is_active: true } })}
                      onHardDelete={() =>
                        deleteMutation.mutate({ id: v.value_id, hard: true })
                      }
                      pending={updateMutation.isPending || deleteMutation.isPending}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Add form */}
          <div className="flex items-start gap-2 pt-1">
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="Add a value…"
              className="flex-1 px-2 py-1.5 border border-lichen rounded text-sm bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
            />
            {isTree && values.length > 0 && (
              <select
                value={newParentId}
                onChange={(e) => setNewParentId(e.target.value)}
                className="px-2 py-1.5 border border-lichen rounded text-sm bg-parchment"
              >
                <option value="">Top-level</option>
                {values
                  .filter((v) => v.is_active)
                  .map((v) => (
                    <option key={v.value_id} value={v.value_id}>
                      {'—'.repeat(v.depth ?? 0)} {v.value}
                    </option>
                  ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newValue.trim() || addMutation.isPending}
              className="px-2.5 py-1.5 bg-forest text-parchment rounded text-sm hover:bg-forest/90 disabled:opacity-50 flex items-center gap-1"
            >
              {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add
            </button>
          </div>
          {addMutation.isError && (
            <p className="text-xs text-semantic-error">
              {(addMutation.error as Error)?.message || 'Failed to add value'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

interface SortableValueRowProps {
  value: MediaTagValue;
  values: MediaTagValue[];
  isTree: boolean;
  isEditing: boolean;
  editingValue: string;
  editingParentId: string;
  setEditingValue: (v: string) => void;
  setEditingParentId: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDeprecate: () => void;
  onUndeprecate: () => void;
  onHardDelete: () => void;
  pending: boolean;
}

function SortableValueRow({
  value,
  values,
  isTree,
  isEditing,
  editingValue,
  editingParentId,
  setEditingValue,
  setEditingParentId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeprecate,
  onUndeprecate,
  onHardDelete,
  pending,
}: SortableValueRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: value.value_id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  const depth = value.depth ?? 0;
  const inUse = (value.usage_count ?? 0) > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 px-2 py-1.5',
        !value.is_active && 'bg-stone-50/80',
      )}
    >
      <button
        type="button"
        className="p-1 cursor-grab text-stone-400 hover:bg-stone-100 rounded touch-none"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${value.value}`}
      >
        <GripVertical size={14} />
      </button>

      <div
        className="flex-1 min-w-0 flex items-center gap-2"
        style={{ paddingLeft: depth * 14 }}
      >
        {isEditing ? (
          <>
            <input
              type="text"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
              autoFocus
              className="flex-1 px-2 py-1 border border-lichen rounded text-sm bg-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:border-bark"
            />
            {isTree && (
              <select
                value={editingParentId}
                onChange={(e) => setEditingParentId(e.target.value)}
                className="px-2 py-1 border border-lichen rounded text-sm bg-parchment"
              >
                <option value="">Top-level</option>
                {values
                  .filter((v) => v.value_id !== value.value_id && v.is_active)
                  .map((v) => (
                    <option key={v.value_id} value={v.value_id}>
                      {'—'.repeat(v.depth ?? 0)} {v.value}
                    </option>
                  ))}
              </select>
            )}
          </>
        ) : (
          <>
            <span className={cn('text-sm', !value.is_active && 'italic text-archive line-through')}>
              {value.value}
            </span>
            {!value.is_active && (
              <span className="text-[10px] bg-semantic-warning/10 text-semantic-warning px-1.5 py-0.5 rounded">
                Deprecated
              </span>
            )}
            {inUse && (
              <span
                className="text-[10px] text-archive"
                title={`Used on ${value.usage_count} asset(s)`}
              >
                · {value.usage_count} in use
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        {isEditing ? (
          <>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={pending}
              className="p-1 text-semantic-success hover:bg-stone-100 rounded disabled:opacity-50"
              aria-label="Save"
              title="Save"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="p-1 text-archive hover:bg-stone-100 rounded"
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onStartEdit}
              className="p-1 text-archive hover:text-ink hover:bg-stone-100 rounded"
              aria-label="Edit"
              title="Edit"
            >
              <Pencil size={14} />
            </button>
            {value.is_active ? (
              <button
                type="button"
                onClick={onDeprecate}
                disabled={pending}
                className="p-1 text-archive hover:text-semantic-warning hover:bg-stone-100 rounded disabled:opacity-50"
                aria-label="Deprecate"
                title="Deprecate (hide from picker but keep on existing records)"
              >
                <Trash2 size={14} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onUndeprecate}
                  disabled={pending}
                  className="p-1 text-archive hover:text-semantic-success hover:bg-stone-100 rounded disabled:opacity-50"
                  aria-label="Reactivate"
                  title="Reactivate"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  type="button"
                  onClick={onHardDelete}
                  disabled={pending}
                  className="p-1 text-archive hover:text-semantic-error hover:bg-stone-100 rounded disabled:opacity-50"
                  aria-label="Delete permanently"
                  title={
                    inUse
                      ? 'Delete permanently — will also remove from all tagged assets'
                      : 'Delete permanently'
                  }
                >
                  <X size={14} />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
