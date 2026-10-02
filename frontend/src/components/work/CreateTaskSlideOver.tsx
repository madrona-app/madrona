/**
 * TaskSlideOver - Slide-over panel for creating and editing tasks
 *
 * Can be used:
 * 1. Globally from the Work page (user picks an entity type and searches)
 * 2. Contextually from entity pages (entity pre-selected)
 * 3. Edit mode when a task is provided
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Loader2,
  Search,
  Frame,
  Package,
  Image,
  Link2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  createTask,
  updateTask,
  getOrganizationUsers,
  searchExhibitExhibitions,
  getCollectionObjects,
  searchMedia,
  type Task,
  type TaskPriority,
  type CreateTaskInput,
  type UpdateTaskInput,
  type RelatedEntityType,
} from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';

// Entity type labels and icons
const ENTITY_TYPE_CONFIG: Record<string, { label: string; icon: typeof Frame; product?: string }> = {
  exhibition: { label: 'Exhibition', icon: Frame, product: 'collections' },
  collection_object: { label: 'Collection Object', icon: Package, product: 'collections' },
  media: { label: 'Media Asset', icon: Image, product: 'media' },
};

// Entity search result type
interface EntitySearchResult {
  id: string;
  label: string;
  sublabel?: string;
}

export interface CreateTaskSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  task?: Task; // If provided, edit mode
  initialEntityType?: RelatedEntityType;
  initialEntityId?: string;
  initialEntityLabel?: string;
  activeProductId?: string | null; // Filters entity type options by product
}

export function CreateTaskSlideOver({
  isOpen,
  onClose,
  orgId,
  task,
  initialEntityType,
  initialEntityId,
  initialEntityLabel,
  activeProductId,
}: CreateTaskSlideOverProps) {
  const isEditMode = !!task;
  const queryClient = useQueryClient();
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'create-task',
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [relatedEntityType, setRelatedEntityType] = useState<RelatedEntityType | ''>(initialEntityType || '');
  const [relatedEntityId, setRelatedEntityId] = useState(initialEntityId || '');
  const [selectedEntityLabel, setSelectedEntityLabel] = useState(initialEntityLabel || '');
  const [entitySearchQuery, setEntitySearchQuery] = useState('');
  const [showEntityDropdown, setShowEntityDropdown] = useState(false);
  const entitySearchRef = useRef<HTMLInputElement>(null);

  // Fetch users for assignment dropdown
  const { data: usersData } = useQuery({
    queryKey: ['organization-users', orgId],
    queryFn: () => getOrganizationUsers(orgId),
    enabled: isOpen && !!orgId,
  });

  // Search for entities based on type and query
  const { data: entitySearchResults, isLoading: isSearching } = useQuery({
    queryKey: ['entity-search', orgId, relatedEntityType, entitySearchQuery],
    queryFn: async (): Promise<EntitySearchResult[]> => {
      if (relatedEntityType === 'exhibition') {
        const result = await searchExhibitExhibitions(orgId, { q: entitySearchQuery, limit: 10 });
        return result.exhibitions.map((e) => ({
          id: e.exhibition_id,
          label: e.title,
          sublabel: e.exhibition_number || undefined,
        }));
      } else if (relatedEntityType === 'collection_object') {
        const result = await getCollectionObjects(orgId, { search: entitySearchQuery, limit: 10 });
        return result.items.map((o) => ({
          id: o.object_id,
          label: o.object_number || o.object_name || 'Untitled',
          sublabel: o.object_name || undefined,
        }));
      } else if (relatedEntityType === 'media') {
        const result = await searchMedia(orgId, { q: entitySearchQuery, limit: 10 });
        return result.hits.map((m) => ({
          id: m.media_id,
          label: m.title || m.filename,
          sublabel: m.title ? m.filename : undefined,
        }));
      }
      return [];
    },
    enabled: isOpen && !!relatedEntityType && entitySearchQuery.length > 0,
    staleTime: 1000,
  });

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(orgId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      resetForm();
      onClose();
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: (input: UpdateTaskInput) => updateTask(orgId, task!.task_id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      onClose();
    },
  });

  // Populate form when opening (edit mode uses task values, create mode uses initial values)
  useEffect(() => {
    if (isOpen) {
      if (task) {
        // Edit mode - populate from task
        setTitle(task.title);
        setDescription(task.description || '');
        setPriority(task.priority as TaskPriority);
        setDueDate(task.due_date || '');
        setAssignedUserId(task.assigned_user_id || '');
        setRelatedEntityType((task.related_entity_type as RelatedEntityType) || '');
        setRelatedEntityId(task.related_entity_id || '');
        setSelectedEntityLabel(task.related_entity_label || '');
      } else {
        // Create mode - use initial values
        setTitle('');
        setDescription('');
        setPriority('normal');
        setDueDate('');
        setAssignedUserId('');
        setRelatedEntityType(initialEntityType || '');
        setRelatedEntityId(initialEntityId || '');
        setSelectedEntityLabel(initialEntityLabel || '');
      }
      setEntitySearchQuery('');
      setShowEntityDropdown(false);
    }
  }, [isOpen, task, initialEntityType, initialEntityId, initialEntityLabel]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('normal');
    setDueDate('');
    setAssignedUserId('');
    setRelatedEntityType(initialEntityType || '');
    setRelatedEntityId(initialEntityId || '');
    setSelectedEntityLabel(initialEntityLabel || '');
    setEntitySearchQuery('');
    setShowEntityDropdown(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (isEditMode) {
      updateTaskMutation.mutate({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || null,
        assigned_user_id: assignedUserId || null,
        related_entity_type: relatedEntityType || null,
        related_entity_id: relatedEntityId || null,
      });
    } else {
      createTaskMutation.mutate({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
        assigned_user_id: assignedUserId || undefined,
        app_context: activeProductId || undefined,
        related_entity_type: relatedEntityType || undefined,
        related_entity_id: relatedEntityId || undefined,
      });
    }
  };

  const isSaving = createTaskMutation.isPending || updateTaskMutation.isPending;
  const saveError = createTaskMutation.isError || updateTaskMutation.isError;

  const handleSelectEntity = (entity: EntitySearchResult) => {
    setRelatedEntityId(entity.id);
    setSelectedEntityLabel(entity.label);
    setEntitySearchQuery('');
    setShowEntityDropdown(false);
  };

  const handleClearEntity = () => {
    setRelatedEntityId('');
    setSelectedEntityLabel('');
    setEntitySearchQuery('');
  };

  const handleEntityTypeChange = (type: RelatedEntityType | '') => {
    setRelatedEntityType(type);
    setRelatedEntityId('');
    setSelectedEntityLabel('');
    setEntitySearchQuery('');
  };

  if (!isOpen) return null;

  // If we have a pre-selected entity, don't show the type selector
  const hasInitialEntity = !!initialEntityType && !!initialEntityId;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/30 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div
          ref={modalRef}
          className="w-screen max-w-md bg-parchment shadow-xl"
          {...getModalAriaProps(titleId)}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-lichen">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {isEditMode ? 'Edit Task' : 'New Task'}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 text-archive hover:text-ink rounded transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col h-[calc(100%-73px)]">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Pre-selected entity indicator */}
              {hasInitialEntity && (() => {
                const config = ENTITY_TYPE_CONFIG[initialEntityType];
                const EntityIcon = config?.icon;
                return (
                  <div className="flex items-center gap-2 px-3 py-2 border border-bark/30 rounded-lg bg-bark/5">
                    {EntityIcon && <EntityIcon size={16} className="text-bark" />}
                    <div className="flex-1">
                      <div className="text-xs text-archive">
                        Linked to {config?.label}
                      </div>
                      <div className="text-sm font-medium text-ink">{initialEntityLabel}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Title */}
              <div>
                <label htmlFor="task-title" className="block text-sm font-medium text-ink mb-1">
                  Title <span className="text-semantic-error">*</span>
                </label>
                <input
                  id="task-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent"
                  required
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="task-description" className="block text-sm font-medium text-ink mb-1">
                  Description
                </label>
                <textarea
                  id="task-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add more details..."
                  rows={3}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent resize-none"
                />
              </div>

              {/* Priority */}
              <div>
                <label htmlFor="task-priority" className="block text-sm font-medium text-ink mb-1">
                  Priority
                </label>
                <select
                  id="task-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent bg-parchment"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Due Date */}
              <div>
                <label htmlFor="task-due-date" className="block text-sm font-medium text-ink mb-1">
                  Due Date
                </label>
                <input
                  id="task-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent"
                />
              </div>

              {/* Assign To */}
              <div>
                <label htmlFor="task-assignee" className="block text-sm font-medium text-ink mb-1">
                  Assign To
                </label>
                <select
                  id="task-assignee"
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent bg-parchment"
                >
                  <option value="">Unassigned</option>
                  {usersData?.users.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.name || user.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Related Entity (only show if not pre-selected) */}
              {!hasInitialEntity && (
                <div className="border-t border-lichen pt-4 mt-4">
                  <label className="block text-sm font-medium text-ink mb-1">
                    <span className="flex items-center gap-1.5">
                      <Link2 size={14} />
                      Link to Record
                    </span>
                  </label>
                  <p className="text-xs text-archive mb-2">
                    Optionally link this task to a record
                  </p>

                  {/* Entity Type Selector — filtered by product */}
                  <div className="flex gap-2 mb-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleEntityTypeChange('')}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                        relatedEntityType === ''
                          ? 'border-azurite bg-azurite/10 text-azurite'
                          : 'border-lichen text-archive hover:border-bark/50'
                      )}
                    >
                      None
                    </button>
                    {Object.entries(ENTITY_TYPE_CONFIG)
                      .filter(([, config]) => !activeProductId || !config.product || config.product === activeProductId)
                      .map(([type, config]) => {
                      const Icon = config.icon;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => handleEntityTypeChange(type as RelatedEntityType)}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors',
                            relatedEntityType === type
                              ? 'border-azurite bg-azurite/10 text-azurite'
                              : 'border-lichen text-archive hover:border-bark/50'
                          )}
                        >
                          <Icon size={14} />
                          {config.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Entity Search (only show when type is selected) */}
                  {relatedEntityType && (() => {
                    const config = ENTITY_TYPE_CONFIG[relatedEntityType];
                    const EntityIcon = config?.icon;
                    return (
                      <div className="relative">
                        {selectedEntityLabel ? (
                          <div className="flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment/50">
                            {EntityIcon && <EntityIcon size={16} className="text-bark" />}
                            <span className="flex-1 text-ink">{selectedEntityLabel}</span>
                            <button
                              type="button"
                              onClick={handleClearEntity}
                              className="p-1 text-archive hover:text-ink rounded transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="relative">
                              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
                              <input
                                ref={entitySearchRef}
                                type="text"
                                value={entitySearchQuery}
                                onChange={(e) => {
                                  setEntitySearchQuery(e.target.value);
                                  setShowEntityDropdown(true);
                                }}
                                onFocus={() => setShowEntityDropdown(true)}
                                placeholder={`Search ${config?.label.toLowerCase()}s...`}
                                className="w-full pl-9 pr-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent"
                              />
                            </div>

                          {/* Search Results Dropdown */}
                          {showEntityDropdown && entitySearchQuery.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-parchment border border-lichen rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {isSearching ? (
                                <div className="flex items-center justify-center py-4">
                                  <Loader2 size={16} className="animate-spin text-archive" />
                                </div>
                              ) : entitySearchResults && entitySearchResults.length > 0 ? (
                                entitySearchResults.map((entity) => (
                                  <button
                                    key={entity.id}
                                    type="button"
                                    onClick={() => handleSelectEntity(entity)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-parchment/50 transition-colors"
                                  >
                                    {EntityIcon && <EntityIcon size={14} className="text-archive shrink-0" />}
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm text-ink truncate">{entity.label}</div>
                                      {entity.sublabel && (
                                        <div className="text-xs text-archive truncate">{entity.sublabel}</div>
                                      )}
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <div className="py-4 text-center text-sm text-archive">
                                  No results found
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Error message */}
              {saveError && (
                <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
                  Failed to {isEditMode ? 'update' : 'create'} task. Please try again.
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-lichen flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-archive hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || isSaving}
                className="px-4 py-2 text-sm font-medium text-parchment bg-bark hover:bg-bark/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSaving && <Loader2 size={14} className="animate-spin" />}
                {isEditMode ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default CreateTaskSlideOver;
