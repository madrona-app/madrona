import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../hooks/useAuth';
import type {
  WebSocketEvent,
  EventHandler,
} from '../types/websocket';
import { logger } from '../lib/logger';

// Re-export types for convenience
export type {
  RunStartedEvent,
  RunProgressEvent,
  RunCompletedEvent,
  RunFailedEvent,
  JobStatusEvent,
  NotificationEvent,
  WebSocketEvent,
  EventHandler,
} from '../types/websocket';

/**
 * WebSocket context value
 */
interface WebSocketContextValue {
  /** Whether the socket is connected */
  isConnected: boolean;
  /** Subscribe to run updates for a specific run */
  subscribeToRun: (runId: string) => void;
  /** Unsubscribe from run updates */
  unsubscribeFromRun: (runId: string) => void;
  /** Subscribe to pipeline updates */
  subscribeToPipeline: (pipelineId: string) => void;
  /** Unsubscribe from pipeline updates */
  unsubscribeFromPipeline: (pipelineId: string) => void;
  /** Add event listener */
  on: <T extends WebSocketEvent>(event: string, handler: EventHandler<T>) => () => void;
  /** Remove event listener */
  off: (event: string, handler: EventHandler<unknown>) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/**
 * Get the WebSocket server URL based on the current environment
 */
function getSocketUrl(): string {
  // In development, connect to the backend server
  // In production, the WebSocket is served from the same origin
  if (import.meta.env.DEV) {
    // 8000 — the port run_dev.py, the Makefile, docker compose and the vite
    // proxy all use. This said 5000, the Flask-era port, so websockets in dev
    // reached nothing while plain HTTP went through the proxy and worked.
    return 'http://localhost:8000';
  }
  return window.location.origin;
}

/**
 * WebSocket Provider - Manages Socket.IO connection with authentication
 */
export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, activeOrganizationId } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const eventHandlersRef = useRef<Map<string, Set<EventHandler<unknown>>>>(new Map());

  // Connect when authenticated
  useEffect(() => {
    if (!isAuthenticated || !activeOrganizationId) {
      // Disconnect if not authenticated
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    // Create socket connection with credentials (cookies)
    const socket = io(getSocketUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socketRef.current = socket;

    // Connection event handlers
    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      logger.error('[WebSocket] Connection error:', error.message);
      setIsConnected(false);
    });

    socket.on('connected', () => {
      // Server-side confirmation of connection
    });

    // Forward all run/job/notification events to registered handlers
    const forwardEvent = (eventName: string) => {
      socket.on(eventName, (data: unknown) => {
        const handlers = eventHandlersRef.current.get(eventName);
        if (handlers) {
          handlers.forEach((handler) => handler(data));
        }
      });
    };

    // Register event forwarding for all event types
    forwardEvent('run:started');
    forwardEvent('run:progress');
    forwardEvent('run:completed');
    forwardEvent('run:failed');
    forwardEvent('job:status');
    forwardEvent('notification');

    // Cleanup on unmount or when auth changes
    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [isAuthenticated, activeOrganizationId]);

  /**
   * Subscribe to updates for a specific run
   */
  const subscribeToRun = useCallback((runId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe:run', { run_id: runId });
    }
  }, []);

  /**
   * Unsubscribe from updates for a specific run
   */
  const unsubscribeFromRun = useCallback((runId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe:run', { run_id: runId });
    }
  }, []);

  /**
   * Subscribe to updates for a specific pipeline
   */
  const subscribeToPipeline = useCallback((pipelineId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe:pipeline', { pipeline_id: pipelineId });
    }
  }, []);

  /**
   * Unsubscribe from updates for a specific pipeline
   */
  const unsubscribeFromPipeline = useCallback((pipelineId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe:pipeline', { pipeline_id: pipelineId });
    }
  }, []);

  /**
   * Add an event listener for a specific event type
   */
  const on = useCallback(<T extends WebSocketEvent>(
    event: string,
    handler: EventHandler<T>
  ): (() => void) => {
    if (!eventHandlersRef.current.has(event)) {
      eventHandlersRef.current.set(event, new Set());
    }
    eventHandlersRef.current.get(event)!.add(handler as EventHandler<unknown>);

    // Return cleanup function
    return () => {
      eventHandlersRef.current.get(event)?.delete(handler as EventHandler<unknown>);
    };
  }, []);

  /**
   * Remove an event listener
   */
  const off = useCallback((event: string, handler: EventHandler<unknown>) => {
    eventHandlersRef.current.get(event)?.delete(handler);
  }, []);

  const value: WebSocketContextValue = {
    isConnected,
    subscribeToRun,
    unsubscribeFromRun,
    subscribeToPipeline,
    unsubscribeFromPipeline,
    on,
    off,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

/**
 * Hook to access WebSocket context
 */
export function useWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
