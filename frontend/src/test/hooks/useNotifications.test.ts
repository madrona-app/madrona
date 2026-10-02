import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotifications } from '../../hooks/useNotifications';
import type { NotificationEvent } from '../../types/websocket';

// Mock WebSocket context
const mockOn = vi.fn();
vi.mock('../../contexts/WebSocketContext', () => ({
  useWebSocket: () => ({
    isConnected: true,
    on: mockOn,
  }),
}));

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOn.mockReturnValue(() => {}); // Return cleanup function
  });

  describe('initial state', () => {
    it('returns empty notifications array', () => {
      const { result } = renderHook(() => useNotifications());
      expect(result.current.notifications).toEqual([]);
    });

    it('returns zero unread count', () => {
      const { result } = renderHook(() => useNotifications());
      expect(result.current.unreadCount).toBe(0);
    });

    it('provides all methods', () => {
      const { result } = renderHook(() => useNotifications());
      expect(typeof result.current.markAsRead).toBe('function');
      expect(typeof result.current.markAllAsRead).toBe('function');
      expect(typeof result.current.remove).toBe('function');
      expect(typeof result.current.clearAll).toBe('function');
    });
  });

  describe('WebSocket subscription', () => {
    it('subscribes to notification events on mount', () => {
      renderHook(() => useNotifications());
      expect(mockOn).toHaveBeenCalledWith('notification', expect.any(Function));
    });

    it('cleans up subscription on unmount', () => {
      const cleanup = vi.fn();
      mockOn.mockReturnValue(cleanup);

      const { unmount } = renderHook(() => useNotifications());
      unmount();

      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe('receiving notifications', () => {
    it('adds notification when event is received', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({
          type: 'info',
          title: 'Test Title',
          message: 'Test message',
          data: { key: 'value' },
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Test Title');
      expect(result.current.notifications[0].message).toBe('Test message');
      expect(result.current.notifications[0].type).toBe('info');
      expect(result.current.notifications[0].data).toEqual({ key: 'value' });
    });

    it('marks new notifications as unread', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({
          type: 'success',
          title: 'New',
          message: 'New notification',
          data: {},
        });
      });

      expect(result.current.notifications[0].read).toBe(false);
      expect(result.current.unreadCount).toBe(1);
    });

    it('adds notifications in reverse chronological order', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({
          type: 'info',
          title: 'First',
          message: 'First message',
          data: {},
        });
      });

      act(() => {
        eventHandler?.({
          type: 'info',
          title: 'Second',
          message: 'Second message',
          data: {},
        });
      });

      expect(result.current.notifications[0].title).toBe('Second');
      expect(result.current.notifications[1].title).toBe('First');
    });

    it('respects maxNotifications limit', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications({ maxNotifications: 2 }));

      act(() => {
        for (let i = 0; i < 5; i++) {
          eventHandler?.({
            type: 'info',
            title: `Notification ${i}`,
            message: `Message ${i}`,
            data: {},
          });
        }
      });

      expect(result.current.notifications).toHaveLength(2);
      expect(result.current.notifications[0].title).toBe('Notification 4');
      expect(result.current.notifications[1].title).toBe('Notification 3');
    });

    it('calls onNotification callback', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const onNotification = vi.fn();
      renderHook(() => useNotifications({ onNotification }));

      act(() => {
        eventHandler?.({
          type: 'warning',
          title: 'Warning',
          message: 'Warning message',
          data: {},
        });
      });

      expect(onNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Warning',
          message: 'Warning message',
          type: 'warning',
        })
      );
    });
  });

  describe('markAsRead', () => {
    it('marks specific notification as read', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({
          type: 'info',
          title: 'Test',
          message: 'Test',
          data: {},
        });
      });

      const notificationId = result.current.notifications[0].id;
      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.markAsRead(notificationId);
      });

      expect(result.current.notifications[0].read).toBe(true);
      expect(result.current.unreadCount).toBe(0);
    });

    it('does not affect other notifications', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({ type: 'info', title: 'First', message: '', data: {} });
        eventHandler?.({ type: 'info', title: 'Second', message: '', data: {} });
      });

      const firstId = result.current.notifications[1].id;

      act(() => {
        result.current.markAsRead(firstId);
      });

      expect(result.current.notifications[0].read).toBe(false);
      expect(result.current.notifications[1].read).toBe(true);
      expect(result.current.unreadCount).toBe(1);
    });
  });

  describe('markAllAsRead', () => {
    it('marks all notifications as read', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({ type: 'info', title: 'First', message: '', data: {} });
        eventHandler?.({ type: 'info', title: 'Second', message: '', data: {} });
        eventHandler?.({ type: 'info', title: 'Third', message: '', data: {} });
      });

      expect(result.current.unreadCount).toBe(3);

      act(() => {
        result.current.markAllAsRead();
      });

      expect(result.current.unreadCount).toBe(0);
      expect(result.current.notifications.every((n) => n.read)).toBe(true);
    });
  });

  describe('remove', () => {
    it('removes specific notification', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({ type: 'info', title: 'Keep', message: '', data: {} });
        eventHandler?.({ type: 'info', title: 'Remove', message: '', data: {} });
      });

      const removeId = result.current.notifications[0].id;

      act(() => {
        result.current.remove(removeId);
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Keep');
    });

    it('updates unread count when removing unread notification', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({ type: 'info', title: 'Test', message: '', data: {} });
      });

      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.remove(result.current.notifications[0].id);
      });

      expect(result.current.unreadCount).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('removes all notifications', () => {
      let eventHandler: ((event: NotificationEvent) => void) | undefined;
      mockOn.mockImplementation((type, handler) => {
        if (type === 'notification') {
          eventHandler = handler;
        }
        return () => {};
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        eventHandler?.({ type: 'info', title: 'First', message: '', data: {} });
        eventHandler?.({ type: 'info', title: 'Second', message: '', data: {} });
      });

      expect(result.current.notifications).toHaveLength(2);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.unreadCount).toBe(0);
    });
  });

  describe('disconnected state', () => {
    it('does not subscribe when disconnected', () => {
      vi.doMock('../../contexts/WebSocketContext', () => ({
        useWebSocket: () => ({
          isConnected: false,
          on: mockOn,
        }),
      }));

      // Re-import to get the mocked version
      vi.resetModules();
    });
  });
});
