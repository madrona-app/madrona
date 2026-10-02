import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, MessageSquare, ExternalLink } from 'lucide-react';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type Notification,
} from '../lib/api';
import { cn } from '../lib/utils';
import { useNotifications } from '../hooks/useNotifications';
import { MadronaLoader } from './ui/MadronaLoader';
import { formatRelativeTime } from '../lib/formatters';

// Entity type to URL path mapping
const ENTITY_PATHS: Record<string, string> = {
  // Core entities
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
  // procedures
  condition_report: 'collections/condition-reports',
  conservation_treatment: 'collections/conservation',
  movement: 'collections/movements',
  object_entry: 'collections/entries',
  object_exit: 'collections/exits',
  deaccession: 'collections/deaccessions',
  use_request: 'collections/use-requests',
  reproduction_request: 'collections/reproduction-requests',
  incident_report: 'collections/incidents',
  // Planning & documentation
  documentation_plan: 'collections/documentation-plans',
  emergency_plan: 'collections/emergency-plans',
  // Logistics & insurance
  shipment: 'collections/shipments',
  insurance_policy: 'collections/insurance/policies',
  insurance_claim: 'collections/insurance/claims',
  indemnity: 'collections/insurance/indemnities',
  // Exhibition sub-entities
  event: 'collections/events',
  checklist_item: 'collections/exhibitions',
};

function getEntityUrl(orgId: string, entityType: string, entityId: string): string | null {
  const path = ENTITY_PATHS[entityType];
  if (!path) return null;
  // Tasks don't have individual detail pages — link to the work page
  if (entityType.startsWith('task')) return `/organizations/${orgId}/${path}`;
  return `/organizations/${orgId}/${path}/${entityId}`;
}

export function NotificationBell() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Refresh bell instantly when a WebSocket notification arrives
  useNotifications({
    onNotification: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['notification-count', orgId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', orgId] });
    }, [queryClient, orgId]),
  });

  // Fetch unread count for badge (poll every 60 seconds)
  const { data: countData } = useQuery({
    queryKey: ['notification-count', orgId],
    queryFn: () => getUnreadNotificationCount(orgId!),
    enabled: !!orgId,
    refetchInterval: 60000, // Poll every minute
    staleTime: 30000,
  });

  // Fetch notifications when dropdown is open
  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['notifications', orgId],
    queryFn: () => getNotifications(orgId!, { limit: 10 }),
    enabled: !!orgId && isOpen,
  });

  // Mark as read mutation
  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markNotificationAsRead(orgId!, notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', orgId] });
      queryClient.invalidateQueries({ queryKey: ['notification-count', orgId] });
    },
  });

  // Mark all as read mutation
  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsAsRead(orgId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', orgId] });
      queryClient.invalidateQueries({ queryKey: ['notification-count', orgId] });
    },
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const unreadCount = countData?.unread_count ?? 0;
  const notifications = notificationsData?.items ?? [];

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markReadMutation.mutate(notification.notification_id);
    }
    setIsOpen(false);
  };

  if (!orgId) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          isOpen ? 'bg-stone/50' : 'hover:bg-stone/30'
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell size={20} className="text-archive" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-parchment bg-semantic-error rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-parchment rounded-lg shadow-lg border border-lichen z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-lichen">
            <h3 className="font-medium text-ink">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="text-xs text-bark hover:text-copper-dark flex items-center gap-1"
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications list */}
          <div className="max-h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-archive">
                <MadronaLoader variant="dots" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell size={32} className="mx-auto text-lichen mb-2" />
                <p className="text-sm text-archive">No notifications yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-lichen/50">
                {notifications.map((notification) => {
                  const entityUrl =
                    notification.entity_type && notification.entity_id
                      ? getEntityUrl(orgId, notification.entity_type, notification.entity_id)
                      : null;

                  return (
                    <li key={notification.notification_id}>
                      <div
                        className={cn(
                          'px-4 py-3 hover:bg-stone/30 transition-colors',
                          !notification.is_read && 'bg-bark/5'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {/* Icon */}
                          <div
                            className={cn(
                              'mt-0.5 p-1.5 rounded-full',
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
                              <p className="text-xs text-archive mt-0.5 line-clamp-2">
                                {notification.message}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-archive">
                                {formatRelativeTime(notification.created_at)}
                              </span>
                              {entityUrl && (
                                <Link
                                  to={entityUrl}
                                  onClick={() => handleNotificationClick(notification)}
                                  className="text-xs text-bark hover:text-copper-dark flex items-center gap-0.5"
                                >
                                  View
                                  <ExternalLink size={10} />
                                </Link>
                              )}
                            </div>
                          </div>

                          {/* Mark as read button */}
                          {!notification.is_read && (
                            <button
                              onClick={() => markReadMutation.mutate(notification.notification_id)}
                              className="p-1 text-archive hover:text-bark rounded transition-colors"
                              title="Mark as read"
                            >
                              <Check size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && notificationsData?.has_more && (
            <div className="px-4 py-2 border-t border-lichen text-center">
              <Link
                to={`/organizations/${orgId}/notifications`}
                onClick={() => setIsOpen(false)}
                className="text-xs text-bark hover:text-copper-dark"
              >
                View all notifications
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
