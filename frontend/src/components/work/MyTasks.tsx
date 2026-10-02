/**
 * MyTasks - Task inbox with object linkage
 *
 * Per specification:
 * - Shows pending tasks with object context
 * - Tasks MUST show which object they pertain to
 * - Tasks must show owning group (Care & Risk, Transactions, etc.)
 * - Displays urgency indicators
 * - Shows assignee and allows task assignment
 */

import { useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  AlertTriangle,
  Package,
  ClipboardCheck,
  ArrowRightLeft,
  Upload,
  Download,
  AlertCircle,
  Hammer,
  FileQuestion,
  Inbox,
  PackageOpen,
  User,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { cn } from '../../lib/utils';
import { formatTaskLabel } from '../../contexts/WorkContext';
import { getWorkTasks, getAssignableUsers, assignWorkTask, listTasks, type WorkTask } from '../../lib/api';
import { useActiveProduct } from '../../hooks/useActiveProduct';
import { AuthContext } from '../../contexts/AuthContext';
import { formatDateShort } from '../../lib/formatters';

// Icon mapping for record types
const RECORD_TYPE_ICONS: Record<string, LucideIcon> = {
  condition_report: ClipboardCheck,
  movement: ArrowRightLeft,
  loan_out: Upload,
  loan_in: Download,
  incident: AlertCircle,
  conservation: Hammer,
  use_request: FileQuestion,
  object_entry: PackageOpen,
};

// Priority colors
const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-semantic-error/10 text-semantic-error border-semantic-error/30',
  high: 'bg-semantic-warning/10 text-semantic-warning border-semantic-warning/30',
  normal: 'bg-stone/50 text-archive border-lichen',
  low: 'bg-stone/30 text-archive/70 border-lichen',
};

interface MyTasksProps {
  /** Limit number of tasks shown */
  limit?: number;
  /** Show as compact list or full cards */
  variant?: 'compact' | 'cards';
  /** Show completed tasks toggle */
  showCompletedToggle?: boolean;
  /** Filter by assignee: 'me', 'unassigned', or specific user_id */
  assignedTo?: string;
  /** Show filters UI */
  showFilters?: boolean;
  /** Allow task assignment */
  allowAssignment?: boolean;
  className?: string;
}

export function MyTasks({
  limit = 10,
  variant = 'cards',
  showCompletedToggle: _showCompletedToggle = false,
  assignedTo,
  showFilters = false,
  allowAssignment = false,
  className,
}: MyTasksProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const queryClient = useQueryClient();
  const [assigneeFilter, setAssigneeFilter] = useState<string | undefined>(assignedTo);
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);

  // Fetch tasks from the backend
  const { data, isLoading } = useQuery({
    queryKey: ['my-tasks', orgId, limit, assigneeFilter],
    queryFn: () => getWorkTasks(orgId!, { limit, assigned_to: assigneeFilter }),
    enabled: !!orgId,
  });

  // Fetch assignable users
  const { data: assignableUsersData } = useQuery({
    queryKey: ['assignable-users', orgId],
    queryFn: () => getAssignableUsers(orgId!),
    enabled: !!orgId && allowAssignment,
  });

  // Assignment mutation
  const assignMutation = useMutation({
    mutationFn: ({ recordType, recordId, userId }: { recordType: string; recordId: string; userId: string | null }) =>
      assignWorkTask(orgId!, recordType, recordId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      setAssigningTaskId(null);
    },
  });

  const tasks = data?.items ?? [];

  if (isLoading) {
    return (
      <div className={cn('animate-pulse space-y-3', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-stone/50 rounded-lg" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <Inbox size={32} className="mx-auto text-archive mb-3" />
        <p className="text-sm font-medium text-ink">No pending tasks</p>
        <p className="text-xs text-archive mt-1">
          Tasks assigned to you will appear here
        </p>
      </div>
    );
  }

  const tasksToShow = tasks.slice(0, limit);

  const formatDueDate = (dateStr?: string) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: 'Overdue', urgent: true };
    if (diffDays === 0) return { label: 'Due today', urgent: true };
    if (diffDays === 1) return { label: 'Due tomorrow', urgent: false };
    if (diffDays <= 7) return { label: `Due in ${diffDays} days`, urgent: false };
    return { label: formatDateShort(date), urgent: false };
  };

  // Build the correct path for each record type
  const buildRecordPath = (task: WorkTask) => {
    if (!orgId) return '#';
    // Agent drafts aren't a record workspace — they live in the Drafts inbox.
    // (Same special-case as the Approvals queue; avoids a dead /collections/agent-drafts route.)
    if (task.record_type === 'agent_draft') {
      return `/organizations/${orgId}/collections/work/drafts?draft=${task.record_id}`;
    }
    const typeMap: Record<string, string> = {
      condition_report: 'condition-reports',
      loan_in: 'loans-in',
      loan_out: 'loans-out',
      conservation: 'conservation',
      object_entry: 'entries',
      object_exit: 'exits',
      movement: 'movements',
      use_request: 'use-requests',
      incident: 'incidents',
    };
    const pathSegment = typeMap[task.record_type] || `${task.record_type}s`;
    return `/organizations/${orgId}/collections/${pathSegment}/${task.record_id}`;
  };

  if (variant === 'compact') {
    return (
      <div className={cn('space-y-1', className)}>
        {tasksToShow.map((task) => {
          const Icon = RECORD_TYPE_ICONS[task.record_type] || ClipboardCheck;
          const due = formatDueDate(task.due_date);
          const path = buildRecordPath(task);

          return (
            <Link
              key={task.id}
              to={path}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-stone/30 transition-colors"
            >
              <div className={cn('p-1 rounded', PRIORITY_COLORS[task.priority])}>
                <Icon size={12} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{task.title}</p>
                {task.accession_number && (
                  <p className="text-xs text-archive truncate">
                    {task.accession_number}
                  </p>
                )}
              </div>
              {due && (
                <span className={cn(
                  'text-xs',
                  due.urgent ? 'text-semantic-error' : 'text-archive'
                )}>
                  {due.label}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    );
  }

  const assignableUsers = assignableUsersData?.users ?? [];

  const handleAssign = (task: WorkTask, userId: string | null) => {
    assignMutation.mutate({
      recordType: task.record_type,
      recordId: task.record_id,
      userId,
    });
  };

  // Cards variant
  return (
    <div className={cn('space-y-3', className)}>
      {/* Filter controls */}
      {showFilters && (
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-lichen">
          <label className="text-sm text-archive">Filter by:</label>
          <select
            value={assigneeFilter || ''}
            onChange={(e) => setAssigneeFilter(e.target.value || undefined)}
            className="text-sm border border-lichen rounded px-2 py-1 bg-parchment"
          >
            <option value="">All tasks</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {assignableUsers.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {tasksToShow.map((task) => {
        const Icon = RECORD_TYPE_ICONS[task.record_type] || ClipboardCheck;
        const { groupLabel } = formatTaskLabel(
          task.title,
          task.record_type,
          task.accession_number,
          task.object_title,
          task.record_number,
          task.object_count
        );
        const due = formatDueDate(task.due_date);
        const path = buildRecordPath(task);
        const isAssigning = assigningTaskId === task.id;

        return (
          <div
            key={task.id}
            className={cn(
              'p-4 rounded-lg border transition-colors',
              task.priority === 'urgent'
                ? 'border-semantic-error/30 bg-semantic-error/5'
                : 'border-lichen bg-parchment'
            )}
          >
            {/* Header with priority and due date */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className={cn('p-1.5 rounded', PRIORITY_COLORS[task.priority])}>
                  <Icon size={14} />
                </div>
                <div>
                  <span className="text-xs font-medium text-archive uppercase tracking-wide">
                    {groupLabel}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {due && (
                  <div className={cn(
                    'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
                    due.urgent
                      ? 'bg-semantic-error/10 text-semantic-error'
                      : 'bg-stone/50 text-archive'
                  )}>
                    {due.urgent ? <AlertTriangle size={10} /> : <Clock size={10} />}
                    {due.label}
                  </div>
                )}
              </div>
            </div>

            {/* Task title with link */}
            <Link to={path} className="font-medium text-ink hover:text-copper-dark">
              {task.title}
            </Link>

            {/* Object linkage (per specification: tasks MUST show which object) */}
            {task.accession_number && (
              <div className="flex items-center gap-1.5 mt-2 text-sm text-bark">
                <Package size={12} />
                <span className="font-medium">{task.accession_number}</span>
                {task.object_title && (
                  <span className="text-archive truncate">
                    — {task.object_title.length > 40
                      ? task.object_title.slice(0, 40) + '...'
                      : task.object_title}
                  </span>
                )}
                {task.object_count && task.object_count > 1 && (
                  <span className="text-archive">
                    (+{task.object_count - 1} more)
                  </span>
                )}
              </div>
            )}

            {/* Assignee row */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-lichen/50">
              <div className="flex items-center gap-2 text-sm">
                <User size={14} className="text-archive" />
                {task.assigned_to_name ? (
                  <span className="text-ink">{task.assigned_to_name}</span>
                ) : (
                  <span className="text-archive italic">Unassigned</span>
                )}
              </div>

              {/* Assignment dropdown */}
              {allowAssignment && (
                <div className="relative">
                  {isAssigning ? (
                    <select
                      autoFocus
                      value={task.assigned_to_user_id || ''}
                      onChange={(e) => {
                        handleAssign(task, e.target.value || null);
                      }}
                      onBlur={() => setAssigningTaskId(null)}
                      className="text-xs border border-bark rounded px-2 py-1 bg-parchment"
                    >
                      <option value="">Unassigned</option>
                      {assignableUsers.map((user) => (
                        <option key={user.user_id} value={user.user_id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setAssigningTaskId(task.id)}
                      className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark"
                    >
                      <UserPlus size={12} />
                      {task.assigned_to_user_id ? 'Reassign' : 'Assign'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {tasks.length > limit && (
        <p className="text-xs text-archive text-center">
          Showing {limit} of {tasks.length} tasks
        </p>
      )}
    </div>
  );
}

function countTasksForProductAndUser(
  tasks: Array<{ app_context?: string | null; related_entity_type?: string | null; assigned_user_id?: string | null }>,
  productId: string | null,
  userId: string | null,
): number {
  return tasks.filter(task => {
    // Only count tasks assigned to the current user
    if (!userId || task.assigned_user_id !== userId) return false;
    // Product filter
    if (!productId) return true;
    if (task.app_context) return task.app_context === productId;
    if (!task.related_entity_type) return productId === 'collections';
    if (productId === 'media') return task.related_entity_type === 'media';
    return task.related_entity_type !== 'media';
  }).length;
}

/**
 * Task count badge for navigation
 */
export function TaskCountBadge({ className }: { className?: string }) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const { activeProductId } = useActiveProduct();
  const authContext = useContext(AuthContext);
  const user = authContext?.user;

  const { data } = useQuery({
    queryKey: ['tasks', orgId, 'badge-count', false],
    queryFn: () => listTasks(orgId!, {}),
    enabled: !!orgId,
    refetchInterval: 60000,
  });

  const count = countTasksForProductAndUser(data?.items ?? [], activeProductId, user?.user_id ?? null);

  if (count === 0) return null;

  return (
    <span
      className={cn(
        'inline-grid place-items-center min-w-[1.125rem] h-[1.125rem] px-1',
        'text-[0.625rem] font-semibold leading-none bg-archive text-parchment rounded-full',
        className
      )}
      aria-label={`${count} task${count !== 1 ? 's' : ''}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
