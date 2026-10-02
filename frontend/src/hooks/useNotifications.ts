import { useEffect, useState, useCallback, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import type { NotificationEvent } from '../types/websocket';

/**
 * In-app notification
 */
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: Date;
  read: boolean;
}

/**
 * Options for useNotifications hook
 */
interface UseNotificationsOptions {
  /** Maximum number of notifications to keep in memory */
  maxNotifications?: number;
  /** Callback when a new notification arrives */
  onNotification?: (notification: Notification) => void;
}

/**
 * Return value for useNotifications hook
 */
interface UseNotificationsReturn {
  /** List of notifications (newest first) */
  notifications: Notification[];
  /** Number of unread notifications */
  unreadCount: number;
  /** Mark a notification as read */
  markAsRead: (id: string) => void;
  /** Mark all notifications as read */
  markAllAsRead: () => void;
  /** Remove a notification */
  remove: (id: string) => void;
  /** Clear all notifications */
  clearAll: () => void;
}

/**
 * Hook to receive and manage in-app notifications via WebSocket.
 *
 * @example
 * const { notifications, unreadCount, markAsRead } = useNotifications({
 *   onNotification: (n) => showToast(n),
 * });
 */
export function useNotifications(
  options: UseNotificationsOptions = {}
): UseNotificationsReturn {
  const { maxNotifications = 50, onNotification } = options;

  const { isConnected, on } = useWebSocket();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Use ref for callback to avoid re-subscribing
  const onNotificationRef = useRef(onNotification);
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  // Generate unique ID for notifications
  const generateId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Subscribe to notification events
  useEffect(() => {
    if (!isConnected) return;

    const handleNotification = (event: NotificationEvent) => {
      const notification: Notification = {
        id: generateId(),
        type: event.type,
        title: event.title,
        message: event.message,
        data: event.data,
        timestamp: new Date(),
        read: false,
      };

      setNotifications((prev) => {
        const newList = [notification, ...prev];
        // Keep only maxNotifications
        return newList.slice(0, maxNotifications);
      });

      onNotificationRef.current?.(notification);
    };

    const cleanup = on<NotificationEvent>('notification', handleNotification);
    return cleanup;
  }, [isConnected, on, generateId, maxNotifications]);

  // Calculate unread count
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Mark a single notification as read
  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  // Remove a notification
  const remove = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    remove,
    clearAll,
  };
}
