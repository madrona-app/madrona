import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  Bell,
  Check,
  CheckCheck,
  MessageSquare,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
} from '../../lib/api';
import type { Notification } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useNotifications } from '../../hooks/useNotifications';
import { formatRelativeTime as fmtRelativeTime } from '@/lib/formatters';

const PAGE_SIZE = 25;

// Entity type to URL path mapping (shared with NotificationBell)
const ENTITY_PATHS: Record<string, string> = {
  collection_object: 'collections/objects',
  acquisition: 'collections/acquisitions',
  loan_in: 'collections/loans-in',
  loan_out: 'collections/loans-out',
  exhibition: 'collections/exhibitions',
  media: 'media',
  media_rights: 'media',
  task: 'collections/work',
  task_collections: 'collections/work',
  task_media: 'media/work',
  condition_report: 'collections/condition-reports',
  conservation_treatment: 'collections/conservation',
  movement: 'collections/movements',
  object_entry: 'collections/entries',
  object_exit: 'collections/exits',
  deaccession: 'collections/deaccessions',
  use_request: 'collections/use-requests',
  reproduction_request: 'collections/reproduction-requests',
  incident_report: 'collections/incidents',
  documentation_plan: 'collections/documentation-plans',
  emergency_plan: 'collections/emergency-plans',
  shipment: 'collections/shipments',
  insurance_policy: 'collections/insurance/policies',
  insurance_claim: 'collections/insurance/claims',
  indemnity: 'collections/insurance/indemnities',
  event: 'collections/events',
  checklist_item: 'collections/exhibitions',
};

function getEntityUrl(orgId: string, entityType: string, entityId: string): string | null {
  const path = ENTITY_PATHS[entityType];
  if (!path) return null;
  if (entityType.startsWith('task')) return `/organizations/${orgId}/${path}`;
  return `/organizations/${orgId}/${path}/${entityId}`;
}

function formatRelativeTime(dateString: string): string {
  return fmtRelativeTime(dateString);
}

type FilterMode = 'all' | 'unread';

export default function NotificationsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterMode>('all');

  // Live updates via WebSocket
  useNotifications({
    onNotification: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications-page', orgId] });
      queryClient.invalidateQueries({ queryKey: ['notification-count', orgId] });
    }, [queryClient, orgId]),
  });

  // Paginated notifications
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications-page', orgId, filter],
    queryFn: ({ pageParam = 0 }) =>
      getNotifications(orgId!, {
        limit: PAGE_SIZE,
        offset: pageParam as number,
        unread_only: filter === 'unread',
      }),
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return lastPage.has_more ? totalFetched : undefined;
    },
    initialPageParam: 0,
    enabled: !!orgId,
  });

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markNotificationAsRead(orgId!, notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-page', orgId] });
      queryClient.invalidateQueries({ queryKey: ['notification-count', orgId] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsAsRead(orgId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-page', orgId] });
      queryClient.invalidateQueries({ queryKey: ['notification-count', orgId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (notificationId: string) => deleteNotification(orgId!, notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-page', orgId] });
      queryClient.invalidateQueries({ queryKey: ['notification-count', orgId] });
    },
  });

  const allNotifications = data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = data?.pages[0]?.unread_count ?? 0;

  if (!orgId) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-archive mt-1">
              {unreadCount} unread
            </p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="btn-secondary text-sm flex items-center gap-1.5 px-3 py-1.5"
          >
            <CheckCheck size={16} />
            Mark all read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-lichen">
        {(['all', 'unread'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              filter === mode
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink'
            )}
          >
            {mode === 'all' ? 'All' : 'Unread'}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      {isLoading ? (
        <div className="py-12 text-center text-archive">
          <div className="animate-pulse">Loading notifications...</div>
        </div>
      ) : allNotifications.length === 0 ? (
        <div className="py-16 text-center">
          <Bell size={40} className="mx-auto text-lichen mb-3" />
          <p className="text-archive">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
        </div>
      ) : (
        <>
          <div className="border border-lichen rounded-lg divide-y divide-lichen/50 bg-parchment">
            {allNotifications.map((notification) => (
              <NotificationRow
                key={notification.notification_id}
                notification={notification}
                orgId={orgId}
                onMarkRead={(id) => markReadMutation.mutate(id)}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
          </div>

          {hasNextPage && (
            <div className="mt-4 text-center">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="btn-secondary text-sm px-4 py-2"
              >
                {isFetchingNextPage ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  orgId,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  orgId: string;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const entityUrl =
    notification.entity_type && notification.entity_id
      ? getEntityUrl(orgId, notification.entity_type, notification.entity_id)
      : null;

  return (
    <div
      className={cn(
        'px-4 py-3 flex items-start gap-3 transition-colors',
        !notification.is_read && 'bg-bark/5'
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'mt-0.5 p-1.5 rounded-full shrink-0',
          notification.notification_type === 'comment'
            ? 'bg-bark/10 text-bark'
            : 'bg-stone/50 text-archive'
        )}
      >
        <MessageSquare size={14} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm',
            notification.is_read ? 'text-archive' : 'text-ink font-medium'
          )}
        >
          {notification.title}
        </p>
        {notification.message && (
          <p className="text-xs text-archive mt-0.5">{notification.message}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-archive">
            {formatRelativeTime(notification.created_at)}
          </span>
          {entityUrl && (
            <Link
              to={entityUrl}
              className="text-xs text-bark hover:text-copper-dark flex items-center gap-0.5"
            >
              View
              <ExternalLink size={10} />
            </Link>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {!notification.is_read && (
          <button
            onClick={() => onMarkRead(notification.notification_id)}
            className="p-1.5 text-archive hover:text-bark rounded transition-colors"
            title="Mark as read"
          >
            <Check size={14} />
          </button>
        )}
        <button
          onClick={() => onDelete(notification.notification_id)}
          className="p-1.5 text-archive hover:text-semantic-error rounded transition-colors"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
