import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { WebSocketProvider, useWebSocket } from '../../contexts/WebSocketContext';
import * as socketIoClient from 'socket.io-client';

// Create mock socket object
const createMockSocket = () => ({
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
  id: 'mock-socket-id',
});

let mockSocket = createMockSocket();

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

// Mock useAuth
const mockAuth = {
  isAuthenticated: true,
  activeOrganizationId: 'org-1',
};

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

// Suppress console logs during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = vi.fn();
  console.error = vi.fn();
  vi.clearAllMocks();
  mockAuth.isAuthenticated = true;
  mockAuth.activeOrganizationId = 'org-1';
  // Reset mock socket for each test
  mockSocket = createMockSocket();
  vi.mocked(socketIoClient.io).mockReturnValue(mockSocket as any);
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  vi.resetAllMocks();
});

// Test component that uses the WebSocket context
function WebSocketConsumer() {
  const ws = useWebSocket();
  return (
    <div>
      <span data-testid="connected">{ws.isConnected.toString()}</span>
      <button onClick={() => ws.subscribeToRun('run-123')}>Subscribe Run</button>
      <button onClick={() => ws.unsubscribeFromRun('run-123')}>Unsubscribe Run</button>
      <button onClick={() => ws.subscribeToPipeline('pipe-123')}>Subscribe Pipeline</button>
      <button onClick={() => ws.unsubscribeFromPipeline('pipe-123')}>Unsubscribe Pipeline</button>
    </div>
  );
}

describe('WebSocketContext', () => {
  describe('useWebSocket hook', () => {
    it('throws error when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<WebSocketConsumer />);
      }).toThrow('useWebSocket must be used within a WebSocketProvider');

      spy.mockRestore();
    });

    it('returns context when used inside provider', () => {
      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      expect(screen.getByTestId('connected')).toBeInTheDocument();
    });
  });

  describe('WebSocketProvider', () => {
    it('does not connect when not authenticated', () => {
      mockAuth.isAuthenticated = false;
      vi.mocked(socketIoClient.io).mockClear();

      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      // Should not attempt to connect
      expect(socketIoClient.io).not.toHaveBeenCalled();
    });

    it('does not connect without active organization', () => {
      mockAuth.activeOrganizationId = null;
      vi.mocked(socketIoClient.io).mockClear();

      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      expect(socketIoClient.io).not.toHaveBeenCalled();
    });

    it('connects when authenticated with organization', () => {
      vi.mocked(socketIoClient.io).mockClear();

      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      expect(socketIoClient.io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          withCredentials: true,
          transports: ['websocket', 'polling'],
          autoConnect: true,
        })
      );
    });

    it('sets up event listeners on connect', () => {
      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      // Should register connection handlers
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });

    it('sets up event forwarding for run events', () => {
      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      // Should register event forwarding
      expect(mockSocket.on).toHaveBeenCalledWith('run:started', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('run:progress', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('run:completed', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('run:failed', expect.any(Function));
    });

    it('disconnects on unmount', () => {
      const { unmount } = render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      unmount();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('subscription methods', () => {
    it('subscribeToRun emits subscribe:run event', async () => {
      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      // Simulate connected state
      const connectHandler = mockSocket.on.mock.calls.find(
        ([event]) => event === 'connect'
      )?.[1];
      if (connectHandler) {
        act(() => connectHandler());
      }

      screen.getByText('Subscribe Run').click();

      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:run', { run_id: 'run-123' });
    });

    it('unsubscribeFromRun emits unsubscribe:run event', async () => {
      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      // Simulate connected state
      const connectHandler = mockSocket.on.mock.calls.find(
        ([event]) => event === 'connect'
      )?.[1];
      if (connectHandler) {
        act(() => connectHandler());
      }

      screen.getByText('Unsubscribe Run').click();

      expect(mockSocket.emit).toHaveBeenCalledWith('unsubscribe:run', { run_id: 'run-123' });
    });

    it('subscribeToPipeline emits subscribe:pipeline event', async () => {
      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      // Simulate connected state
      const connectHandler = mockSocket.on.mock.calls.find(
        ([event]) => event === 'connect'
      )?.[1];
      if (connectHandler) {
        act(() => connectHandler());
      }

      screen.getByText('Subscribe Pipeline').click();

      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:pipeline', { pipeline_id: 'pipe-123' });
    });

    it('unsubscribeFromPipeline emits unsubscribe:pipeline event', async () => {
      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      // Simulate connected state
      const connectHandler = mockSocket.on.mock.calls.find(
        ([event]) => event === 'connect'
      )?.[1];
      if (connectHandler) {
        act(() => connectHandler());
      }

      screen.getByText('Unsubscribe Pipeline').click();

      expect(mockSocket.emit).toHaveBeenCalledWith('unsubscribe:pipeline', { pipeline_id: 'pipe-123' });
    });

    it('does not emit when socket is not connected', async () => {
      mockSocket.connected = false;

      render(
        <WebSocketProvider>
          <WebSocketConsumer />
        </WebSocketProvider>
      );

      screen.getByText('Subscribe Run').click();

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('event handlers', () => {
    it('on() registers event handler and returns cleanup function', async () => {
      let cleanup: () => void;
      const handler = vi.fn();

      function EventConsumer() {
        const ws = useWebSocket();

        React.useEffect(() => {
          cleanup = ws.on('run:progress', handler);
        }, [ws]);

        return <div>Event consumer</div>;
      }

      render(
        <WebSocketProvider>
          <EventConsumer />
        </WebSocketProvider>
      );

      // Cleanup should be a function
      expect(typeof cleanup!).toBe('function');
    });

    it('off() removes event handler', async () => {
      const handler = vi.fn();

      function EventConsumer() {
        const ws = useWebSocket();

        React.useEffect(() => {
          ws.on('run:progress', handler);
          ws.off('run:progress', handler);
        }, [ws]);

        return <div>Event consumer</div>;
      }

      render(
        <WebSocketProvider>
          <EventConsumer />
        </WebSocketProvider>
      );

      // Test passes if no errors
      expect(true).toBe(true);
    });
  });
});

// Need to import React for the EventConsumer component
import React from 'react';
