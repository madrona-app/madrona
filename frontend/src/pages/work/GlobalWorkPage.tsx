/**
 * GlobalWorkPage - Task management hub
 *
 * Displays the user's tasks, scoped to the active product (Collections or Media).
 */

import { useState, useRef, useCallback } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  AlertCircle,
  Circle,
  Calendar,
  Flag,
  Plus,
  MoreHorizontal,
  UserPlus,
  Trash2,
  PlayCircle,
  PauseCircle,
  Pencil,
  Clock,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  listTasks,
  updateTask,
  deleteTask,
  type Task,
  type TaskStatus,
} from '../../lib/api';
import { useContext } from 'react';
import { useMenuNavigation } from '../../components/workspace/useMenuNavigation';
import { AuthContext } from '../../contexts/AuthContext';
import { CreateTaskSlideOver } from '../../components/work/CreateTaskSlideOver';
import ConfirmDialog from '../../components/ConfirmDialog';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { useActiveProduct } from '../../hooks/useActiveProduct';
import { formatDateShort } from '@/lib/formatters';

export default function GlobalWorkPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeProductId } = useActiveProduct();

  const productLabel = activeProductId === 'media' ? 'Media' : 'Collections';

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">My Tasks</h1>
        <p className="text-sm text-archive mt-1">
          {productLabel} tasks requiring your attention
        </p>
      </div>

      <TasksTab orgId={orgId} activeProductId={activeProductId} />
    </div>
  );
}

// Status icon component
const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={16} className="text-semantic-success" />;
    case 'in_progress':
      return <Clock size={16} className="text-semantic-info" />;
    case 'blocked':
      return <AlertCircle size={16} className="text-semantic-error" />;
    default:
      return <Circle size={16} className="text-archive" />;
  }
}

// Priority badge component
function PriorityBadge({ priority }: { priority: string }) {
  const config = {
    urgent: { bg: 'bg-semantic-error/10', text: 'text-semantic-error', icon: Flag },
    high: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning', icon: Flag },
    normal: { bg: 'bg-stone', text: 'text-accessible-gray', icon: null },
    low: { bg: 'bg-stone', text: 'text-archive', icon: null },
  }[priority] || { bg: 'bg-stone', text: 'text-accessible-gray', icon: null };

  if (priority === 'normal' || priority === 'low') return null;

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', config.bg, config.text)}>
      {config.icon && <config.icon size={10} />}
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

// Format due date with urgency styling
function DueDate({ date }: { date: string | null | undefined }) {
  if (!date) return null;

  const dueDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isOverdue = dueDate < today;
  const isDueToday = dueDate.getTime() === today.getTime();
  const isDueTomorrow = dueDate.getTime() === tomorrow.getTime();

  let label = formatDateShort(dueDate);
  if (isOverdue) label = 'Overdue';
  else if (isDueToday) label = 'Today';
  else if (isDueTomorrow) label = 'Tomorrow';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        isOverdue ? 'text-semantic-error font-medium' : isDueToday ? 'text-semantic-warning font-medium' : 'text-archive'
      )}
    >
      <Calendar size={12} />
      {label}
    </span>
  );
}

function filterTasksByProduct(tasks: Task[], productId: string | null): Task[] {
  if (!productId) return tasks;
  return tasks.filter(task => {
    // Use app_context if set (preferred), otherwise fall back to related_entity_type
    if (task.app_context) return task.app_context === productId;
    // Legacy tasks without app_context: use entity type as hint
    if (!task.related_entity_type) return productId === 'collections';
    if (productId === 'media') return task.related_entity_type === 'media';
    return task.related_entity_type !== 'media';
  });
}

function TasksTab({ orgId, activeProductId }: { orgId?: string; activeProductId: string | null }) {
  const queryClient = useQueryClient();
  const authContext = useContext(AuthContext);
  const user = authContext?.user;
  const [showCompleted, setShowCompleted] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const closeStatusMenu = useCallback(() => setOpenStatusId(null), []);
  const { onKeyDown: onStatusMenuKeyDown } = useMenuNavigation({
    isOpen: openStatusId !== null,
    menuRef: statusMenuRef,
    triggerRef: statusTriggerRef,
    onClose: closeStatusMenu,
  });
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const closeActionsMenu = useCallback(() => setOpenMenuId(null), []);
  const { onKeyDown: onActionsMenuKeyDown } = useMenuNavigation({
    isOpen: openMenuId !== null,
    menuRef: actionsMenuRef,
    triggerRef: actionsTriggerRef,
    onClose: closeActionsMenu,
  });
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tasks', orgId, 'all-tasks', showCompleted],
    queryFn: () => listTasks(orgId!, { includeCompleted: showCompleted }),
    enabled: !!orgId,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, updates }: { taskId: string; updates: Partial<{ status: TaskStatus; assigned_user_id: string | null }> }) =>
      updateTask(orgId!, taskId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      setOpenMenuId(null);
      setOpenStatusId(null);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(orgId!, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      setOpenMenuId(null);
    },
  });

  const handleStatusChange = (task: Task, newStatus: TaskStatus) => {
    updateTaskMutation.mutate({ taskId: task.task_id, updates: { status: newStatus } });
  };

  const handleAssignToMe = (task: Task) => {
    if (user?.user_id) {
      updateTaskMutation.mutate({ taskId: task.task_id, updates: { assigned_user_id: user.user_id } });
    }
  };

  const handleUnassign = (task: Task) => {
    updateTaskMutation.mutate({ taskId: task.task_id, updates: { assigned_user_id: null } });
  };

  const handleDelete = (task: Task) => {
    setDeletingTask(task);
  };

  const confirmDelete = () => {
    if (deletingTask) {
      deleteTaskMutation.mutate(deletingTask.task_id);
      setDeletingTask(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader variant="inline" label="Loading tasks…" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load tasks"
        description="The request didn't go through. Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  const allTasks = data?.items || [];
  const tasks = filterTasksByProduct(allTasks, activeProductId);

  return (
    <>
      <div className="space-y-4">
        {/* Header with New Task button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm text-archive">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
            <label htmlFor="global-work-show-completed" className="flex items-center gap-2 text-sm text-archive cursor-pointer">
              <Checkbox
                id="global-work-show-completed"
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
              />
              Show completed
            </label>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-parchment bg-bark hover:bg-bark/90 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New Task
          </button>
        </div>

        {/* Task list or empty state */}
        {tasks.length === 0 ? (
          <div className="bg-parchment border border-lichen rounded-lg">
            <EmptyState
              icon={CheckCircle2}
              title="All caught up"
              description="You have no pending tasks"
              action={{ label: 'Create your first task', onClick: () => setIsCreateOpen(true) }}
            />
          </div>
        ) : (
          <div className="bg-parchment border border-lichen rounded-lg divide-y divide-lichen">
            {tasks.map((task) => (
              <div
                key={task.task_id}
                className={cn(
                  'flex items-start gap-3 p-4 hover:bg-parchment/50 transition-colors',
                  task.status === 'done' && 'opacity-60'
                )}
              >
                {/* Status dropdown */}
                <div className="relative mt-0.5 flex-shrink-0">
                  <button
                    ref={openStatusId === task.task_id ? statusTriggerRef : undefined}
                    type="button"
                    onClick={() => setOpenStatusId(openStatusId === task.task_id ? null : task.task_id)}
                    className="hover:opacity-70 transition-opacity rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    disabled={updateTaskMutation.isPending}
                    title="Change status"
                    aria-label={`Status: ${STATUS_LABELS[task.status] ?? task.status}. Change status of ${task.title}`}
                    aria-haspopup="menu"
                    aria-expanded={openStatusId === task.task_id}
                  >
                    <StatusIcon status={task.status} />
                  </button>
                  {openStatusId === task.task_id && (
                    <>
                      <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setOpenStatusId(null)} />
                      <div
                        ref={statusMenuRef}
                        role="menu"
                        aria-label={`Status of ${task.title}`}
                        tabIndex={-1}
                        onKeyDown={onStatusMenuKeyDown}
                        className="absolute left-0 top-6 z-20 bg-parchment border border-lichen rounded-lg shadow-lg py-1 min-w-[140px]"
                      >
                        {[
                          { value: 'todo', label: 'To Do', icon: Circle },
                          { value: 'in_progress', label: 'In Progress', icon: PlayCircle },
                          { value: 'blocked', label: 'Blocked', icon: PauseCircle },
                          { value: 'done', label: 'Done', icon: CheckCircle2 },
                        ].map(({ value, label, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={task.status === value}
                            tabIndex={-1}
                            onClick={() => handleStatusChange(task, value as TaskStatus)}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-parchment/50 focus-visible:outline-none focus-visible:bg-stone/30',
                              task.status === value && 'bg-parchment/30 font-medium'
                            )}
                          >
                            <Icon size={14} aria-hidden="true" className={task.status === value ? 'text-bark' : 'text-archive'} />
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'font-medium text-ink',
                        task.status === 'done' && 'line-through text-archive'
                      )}
                    >
                      {task.title}
                    </span>
                    <PriorityBadge priority={task.priority} />
                  </div>

                  {task.description && (
                    <p className="text-sm text-archive mt-1 line-clamp-2">{task.description}</p>
                  )}

                  <div className="flex items-center gap-3 mt-2">
                    <DueDate date={task.due_date} />
                    {task.assigned_user_name ? (
                      <span className="text-xs text-archive">
                        Assigned to {task.assigned_user_name}
                      </span>
                    ) : (
                      <span className="text-xs text-semantic-warning">Unassigned</span>
                    )}
                    {task.related_entity_type && (
                      <span className="text-xs text-archive bg-parchment px-2 py-0.5 rounded">
                        {task.related_entity_type.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions menu */}
                <div className="relative flex-shrink-0">
                  <button
                    ref={openMenuId === task.task_id ? actionsTriggerRef : undefined}
                    type="button"
                    onClick={() => setOpenMenuId(openMenuId === task.task_id ? null : task.task_id)}
                    aria-label={`Actions for ${task.title}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === task.task_id}
                    className="p-1 text-archive hover:text-ink rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  {openMenuId === task.task_id && (
                    <>
                      <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                      <div
                        ref={actionsMenuRef}
                        role="menu"
                        aria-label={`Actions for ${task.title}`}
                        tabIndex={-1}
                        onKeyDown={onActionsMenuKeyDown}
                        className="absolute right-0 top-6 z-20 bg-parchment border border-lichen rounded-lg shadow-lg py-1 min-w-[160px]"
                      >
                        <button
                          onClick={() => {
                            setEditingTask(task);
                            setOpenMenuId(null);
                          }}
                          role="menuitem"
                          tabIndex={-1}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-parchment/50 focus-visible:outline-none focus-visible:bg-stone/30"
                        >
                          <Pencil size={14} className="text-archive" aria-hidden="true" />
                          Edit
                        </button>
                        {!task.assigned_user_id && (
                          <button
                            onClick={() => handleAssignToMe(task)}
                            role="menuitem"
                          tabIndex={-1}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-parchment/50 focus-visible:outline-none focus-visible:bg-stone/30"
                          >
                            <UserPlus size={14} className="text-archive" aria-hidden="true" />
                            Assign to me
                          </button>
                        )}
                        {task.assigned_user_id && task.assigned_user_id === user?.user_id && (
                          <button
                            onClick={() => handleUnassign(task)}
                            role="menuitem"
                          tabIndex={-1}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-parchment/50 focus-visible:outline-none focus-visible:bg-stone/30"
                          >
                            <UserPlus size={14} className="text-archive" aria-hidden="true" />
                            Unassign
                          </button>
                        )}
                        {(() => {
                          const isCreator = !task.created_by || task.created_by === user?.user_id;
                          return isCreator ? (
                            <button
                              onClick={() => handleDelete(task)}
                              role="menuitem"
                              tabIndex={-1}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-semantic-error hover:bg-semantic-error/5 focus-visible:outline-none focus-visible:bg-semantic-error/5"
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              Delete
                            </button>
                          ) : (
                            <div title={`Created by ${task.created_by_name || 'another user'}`}>
                              <button
                                type="button"
                                role="menuitem"
                                aria-disabled="true"
                                disabled
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-archive/50 cursor-not-allowed pointer-events-none"
                              >
                                <Trash2 size={14} aria-hidden="true" />
                                Delete
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Task Slide-over */}
      {orgId && (
        <CreateTaskSlideOver
          isOpen={isCreateOpen || !!editingTask}
          onClose={() => {
            setIsCreateOpen(false);
            setEditingTask(null);
          }}
          orgId={orgId}
          task={editingTask || undefined}
          activeProductId={activeProductId}
        />
      )}
      <ConfirmDialog
        isOpen={!!deletingTask}
        onClose={() => setDeletingTask(null)}
        onConfirm={confirmDelete}
        title="Delete task"
        message={`Are you sure you want to delete "${deletingTask?.title}"? This cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </>
  );
}

