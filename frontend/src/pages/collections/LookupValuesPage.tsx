import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
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
  List,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  GripVertical,
  X,
  Check,
  Search,
} from 'lucide-react';
import {
  getAllLookups,
  createLookupValue,
  updateLookupValue,
  deleteLookupValue,
  toggleHideLookupValue,
  updateLookupSortOrder,
  type LookupCategoryWithValues,
  type LookupValue,
} from '../../lib/api';
import ConfirmDialog from '../../components/ConfirmDialog';

interface EditingValue {
  categoryKey: string;
  value: LookupValue | null; // null for new value
}

// Generate a snake_case key from label
const generateValueKey = (label: string): string => {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, '_'); // Replace spaces with underscores
};

// Sortable row component for drag and drop
interface SortableRowProps {
  value: LookupValue;
  isHiddenByOrg: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleHide: () => void;
  isSystem: boolean;
  hidePending: boolean;
  deletePending: boolean;
}

function SortableRow({
  value,
  isHiddenByOrg,
  onEdit,
  onDelete,
  onToggleHide,
  isSystem,
  hidePending,
  deletePending,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: value.value_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`hover:bg-stone/20 ${isHiddenByOrg ? 'opacity-50' : ''} ${isDragging ? 'bg-stone/30' : ''}`}
    >
      <td className="px-2 py-2.5 w-8">
        <button
          type="button"
          className="p-1 cursor-grab hover:bg-stone rounded transition-colors touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} className="text-archive" />
        </button>
      </td>
      <td className="px-4 py-2.5">
        {value.label}
        {value.description && (
          <span className="text-xs text-archive ml-2">
            - {value.description}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {isSystem ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-copper/10 text-copper">
            System
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-forest/10 text-forest">
            Custom
          </span>
        )}
        {isHiddenByOrg && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-archive/10 text-archive ml-1">
            Hidden
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {isSystem ? (
            <button
              type="button"
              onClick={onToggleHide}
              disabled={hidePending}
              className="p-1.5 hover:bg-stone rounded transition-colors"
              title={isHiddenByOrg ? 'Show' : 'Hide'}
            >
              {isHiddenByOrg ? (
                <Eye size={14} className="text-archive" />
              ) : (
                <EyeOff size={14} className="text-archive" />
              )}
            </button>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="p-1.5 hover:bg-stone rounded transition-colors"
                title="Edit"
              >
                <Pencil size={14} className="text-archive" />
              </button>
              <button
                onClick={onDelete}
                disabled={deletePending}
                className="p-1.5 hover:bg-semantic-error/10 rounded transition-colors"
                title="Delete"
              >
                <Trash2 size={14} className="text-semantic-error" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function LookupValuesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [editingValue, setEditingValue] = useState<EditingValue | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [valueToDelete, setValueToDelete] = useState<LookupValue | null>(null);
  const [formData, setFormData] = useState({
    label: '',
    description: '',
  });

  // Fetch all lookups with hidden values included for admin view
  const { data: categories = [], isLoading, error } = useQuery({
    queryKey: ['lookups', orgId, null, true],
    queryFn: () => getAllLookups(orgId!, { include_hidden: true }),
    enabled: !!orgId,
  });

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    if (!searchQuery) return categories;
    const query = searchQuery.toLowerCase();
    return categories.filter(
      (cat) =>
        cat.display_name.toLowerCase().includes(query) ||
        cat.category_key.toLowerCase().includes(query) ||
        cat.values.some(
          (v) =>
            v.label.toLowerCase().includes(query) ||
            v.value_key.toLowerCase().includes(query)
        )
    );
  }, [categories, searchQuery]);

  // Group categories by context (page)
  const categoriesByContext = useMemo(() => {
    const contextLabels: Record<string, string> = {
      acquisitions: 'Acquisitions',
      deaccessions: 'Deaccessions',
      loans: 'Loans',
      events: 'Events',
      conservation: 'Conservation',
      condition_reports: 'Condition Reports',
      movements: 'Movements',
      valuations: 'Valuations',
      objects: 'Collection Objects',
      rights: 'Rights',
      general: 'General',
    };

    const grouped: Record<string, typeof filteredCategories> = {};

    for (const cat of filteredCategories) {
      // Use the first applicable context, or 'general' if none
      const context = cat.applicable_contexts?.[0] || 'general';
      if (!grouped[context]) {
        grouped[context] = [];
      }
      grouped[context].push(cat);
    }

    // Sort contexts and return as array of [context, label, categories]
    return Object.entries(grouped)
      .sort(([a], [b]) => {
        // Put 'general' last
        if (a === 'general') return 1;
        if (b === 'general') return -1;
        return (contextLabels[a] || a).localeCompare(contextLabels[b] || b);
      })
      .map(([context, cats]) => ({
        context,
        label: contextLabels[context] || context.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        categories: cats,
      }));
  }, [filteredCategories]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: { categoryKey: string; label: string; description?: string }) =>
      createLookupValue(orgId!, data.categoryKey, {
        value_key: generateValueKey(data.label),
        label: data.label,
        description: data.description || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups', orgId] });
      setEditingValue(null);
      resetForm();
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: { valueId: string; label: string; description?: string }) =>
      updateLookupValue(orgId!, data.valueId, {
        label: data.label,
        description: data.description || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups', orgId] });
      setEditingValue(null);
      resetForm();
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (valueId: string) => deleteLookupValue(orgId!, valueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups', orgId] });
    },
  });

  // Hide/unhide mutation
  const hideMutation = useMutation({
    mutationFn: (data: { valueId: string; hidden: boolean }) =>
      toggleHideLookupValue(orgId!, data.valueId, data.hidden),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lookups', orgId] });
    },
  });

  // Sort order mutation with optimistic update
  const sortMutation = useMutation({
    mutationFn: (data: { categoryKey: string; valueIds: string[] }) =>
      updateLookupSortOrder(orgId!, data.categoryKey, data.valueIds),
    onError: () => {
      // Refetch on error to restore correct order
      queryClient.invalidateQueries({ queryKey: ['lookups', orgId] });
    },
    // Don't invalidate on success - we already updated optimistically
  });

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent, category: LookupCategoryWithValues) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const visibleValues = category.values.filter((v) => !(v.is_system === false && v.is_hidden));
      const oldIndex = visibleValues.findIndex((v) => v.value_id === active.id);
      const newIndex = visibleValues.findIndex((v) => v.value_id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(visibleValues, oldIndex, newIndex);

        // Optimistic update: immediately update the cache
        queryClient.setQueryData(
          ['lookups', orgId, null, true],
          (oldData: LookupCategoryWithValues[] | undefined) => {
            if (!oldData) return oldData;
            return oldData.map((cat) => {
              if (cat.category_key !== category.category_key) return cat;
              // Reorder the values based on newOrder
              const reorderedValues = newOrder.map((v, idx) => ({
                ...v,
                sort_order: idx,
              }));
              // Keep hidden org override records at the end
              const hiddenRecords = cat.values.filter(
                (v) => v.is_system === false && v.is_hidden
              );
              return {
                ...cat,
                values: [...reorderedValues, ...hiddenRecords],
              };
            });
          }
        );

        // Then sync with server
        sortMutation.mutate({
          categoryKey: category.category_key,
          valueIds: newOrder.map((v) => v.value_id),
        });
      }
    }
  };

  const resetForm = () => {
    setFormData({
      label: '',
      description: '',
    });
  };

  const toggleCategory = (categoryKey: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryKey)) {
        next.delete(categoryKey);
      } else {
        next.add(categoryKey);
      }
      return next;
    });
  };

  const startAddValue = (categoryKey: string) => {
    resetForm();
    setEditingValue({ categoryKey, value: null });
    // Auto-expand the category
    setExpandedCategories((prev) => new Set(prev).add(categoryKey));
  };

  const startEditValue = (categoryKey: string, value: LookupValue) => {
    setFormData({
      label: value.label,
      description: value.description || '',
    });
    setEditingValue({ categoryKey, value });
  };

  const handleSave = () => {
    if (!editingValue) return;

    if (editingValue.value) {
      // Update existing
      updateMutation.mutate({
        valueId: editingValue.value.value_id,
        label: formData.label,
        description: formData.description || undefined,
      });
    } else {
      // Create new
      createMutation.mutate({
        categoryKey: editingValue.categoryKey,
        label: formData.label,
        description: formData.description || undefined,
      });
    }
  };

  const handleDelete = (value: LookupValue) => {
    setValueToDelete(value);
    setShowDeleteConfirm(true);
  };

  const handleToggleHide = (value: LookupValue, hidden: boolean) => {
    hideMutation.mutate({ valueId: value.value_id, hidden });
  };

  if (!orgId) {
    return (
      <div className="max-w-4xl">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded p-4 text-semantic-error">
          Organization ID is required
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-stone rounded w-1/3" />
          <div className="h-4 bg-stone rounded w-2/3" />
          <div className="h-64 bg-stone rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded p-4 text-semantic-error">
          Failed to load lookup values: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-forest/10 rounded-lg">
            <List size={24} className="text-forest" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Lookup Values</h1>
            <p className="text-sm text-accessible-gray mt-1">
              Manage dropdown options across Collections
            </p>
          </div>
        </div>
      </div>

      {/* Help Text */}
      <div className="bg-stone/30 border border-lichen rounded-lg p-4 mb-6">
        <h3 className="font-medium text-ink mb-2">About Lookup Values</h3>
        <ul className="text-sm text-accessible-gray space-y-1">
          <li>- System default values are available to all organizations and cannot be deleted</li>
          <li>- You can hide system defaults if they don't apply to your organization</li>
          <li>- Create custom values specific to your organization's needs</li>
          <li>- Organization values can be edited or deleted at any time</li>
        </ul>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
          <input
            type="text"
            placeholder="Search categories or values..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
          />
        </div>
      </div>

      {/* Categories List - Grouped by Page/Context */}
      <div className="space-y-8">
        {categoriesByContext.map(({ context, label, categories: contextCategories }) => (
          <div key={context}>
            {/* Context/Page Header */}
            <h2 className="text-lg font-semibold text-forest mb-3 pb-2 border-b border-lichen">
              {label}
            </h2>
            <div className="space-y-3">
              {contextCategories.map((category) => {
                const isExpanded = expandedCategories.has(category.category_key);
                const systemValues = category.values.filter((v) => v.is_system);
                const orgValues = category.values.filter((v) => !v.is_system && !v.is_hidden);
                const hiddenCount = category.values.filter(
                  (v) => v.is_system && (v.is_hidden || category.values.some(
                    (ov) => !ov.is_system && ov.is_hidden && ov.value_key === v.value_key
                  ))
                ).length;

                return (
                  <div
                    key={category.category_id}
                    className="bg-parchment rounded-lg border border-lichen shadow-sm overflow-hidden"
                  >
              {/* Category Header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-stone/30 transition-colors"
                onClick={() => toggleCategory(category.category_key)}
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown size={18} className="text-archive" />
                  ) : (
                    <ChevronRight size={18} className="text-archive" />
                  )}
                  <div>
                    <h3 className="font-medium text-ink">{category.display_name}</h3>
                    <p className="text-xs text-archive">
                      {category.category_key} · {systemValues.length} system
                      {orgValues.length > 0 && ` · ${orgValues.length} custom`}
                      {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startAddValue(category.category_key);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-forest hover:bg-forest/10 rounded transition-colors"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="border-t border-lichen">
                  {/* Add/Edit Form */}
                  {editingValue?.categoryKey === category.category_key && (
                    <div className="bg-stone/20 px-4 py-4 border-b border-lichen">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-sm">
                          {editingValue.value ? 'Edit Value' : 'Add New Value'}
                        </h4>
                        <button
                          onClick={() => {
                            setEditingValue(null);
                            resetForm();
                          }}
                          className="p-1 hover:bg-stone rounded"
                        >
                          <X size={16} className="text-archive" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-archive mb-1">
                            Label *
                          </label>
                          <input
                            type="text"
                            value={formData.label}
                            onChange={(e) =>
                              setFormData((p) => ({ ...p, label: e.target.value }))
                            }
                            placeholder="My Custom Value"
                            className="w-full px-3 py-2 text-sm border border-lichen rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-archive mb-1">
                            Description
                          </label>
                          <input
                            type="text"
                            value={formData.description}
                            onChange={(e) =>
                              setFormData((p) => ({ ...p, description: e.target.value }))
                            }
                            placeholder="Optional description"
                            className="w-full px-3 py-2 text-sm border border-lichen rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-4">
                        <button
                          onClick={() => {
                            setEditingValue(null);
                            resetForm();
                          }}
                          className="px-3 py-1.5 text-sm text-archive hover:bg-stone rounded transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={
                            !formData.label ||
                            createMutation.isPending ||
                            updateMutation.isPending
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-forest text-parchment rounded hover:bg-forest/90 transition-colors disabled:opacity-50"
                        >
                          <Check size={14} />
                          {editingValue.value ? 'Update' : 'Create'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Values Table with Drag and Drop */}
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => handleDragEnd(event, category)}
                  >
                    <table className="w-full text-sm">
                      <thead className="bg-stone/30 text-xs text-archive uppercase">
                        <tr>
                          <th className="px-2 py-2 w-8"></th>
                          <th className="px-4 py-2 text-left font-medium">Label</th>
                          <th className="px-4 py-2 text-left font-medium">Type</th>
                          <th className="px-4 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-lichen/50">
                        <SortableContext
                          items={category.values
                            .filter((v) => !(v.is_system === false && v.is_hidden))
                            .map((v) => v.value_id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {category.values
                            .filter((v) => !(v.is_system === false && v.is_hidden))
                            .map((value) => {
                              const isHiddenByOrg = value.is_system && category.values.some(
                                (v) => !v.is_system && v.is_hidden && v.value_key === value.value_key
                              );
                              return (
                                <SortableRow
                                  key={value.value_id}
                                  value={value}
                                  isHiddenByOrg={isHiddenByOrg}
                                  isSystem={value.is_system}
                                  onEdit={() => startEditValue(category.category_key, value)}
                                  onDelete={() => handleDelete(value)}
                                  onToggleHide={() => handleToggleHide(value, !isHiddenByOrg)}
                                  hidePending={hideMutation.isPending}
                                  deletePending={deleteMutation.isPending}
                                />
                              );
                            })}
                        </SortableContext>
                      </tbody>
                    </table>
                  </DndContext>

                  {category.values.length === 0 && (
                    <div className="px-4 py-8 text-center text-archive text-sm">
                      No values in this category
                    </div>
                  )}
                </div>
              )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {categoriesByContext.length === 0 && (
        <div className="text-center py-12 text-archive">
          {searchQuery ? 'No categories match your search' : 'No lookup categories found'}
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setValueToDelete(null);
        }}
        onConfirm={() => {
          if (valueToDelete) {
            deleteMutation.mutate(valueToDelete.value_id);
          }
          setShowDeleteConfirm(false);
          setValueToDelete(null);
        }}
        title="Delete Lookup Value"
        message={`Are you sure you want to delete "${valueToDelete?.label}"? This cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
