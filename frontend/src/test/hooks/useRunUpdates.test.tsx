import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunUpdates } from '../../hooks/useRunUpdates';
import type { RunStartedEvent, RunProgressEvent, RunCompletedEvent, RunFailedEvent } from '../../types/websocket';

// Mock WebSocket context
const mockSubscribeToRun = vi.fn();
const mockUnsubscribeFromRun = vi.fn();
const mockSubscribeToPipeline = vi.fn();
const mockUnsubscribeFromPipeline = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();

let mockIsConnected = true;

// Store registered event handlers for testing
const eventHandlers: Map<string, ((data: unknown) => void)[]> = new Map();

vi.mock('../../contexts/WebSocketContext', () => ({
  useWebSocket: () => ({
    isConnected: mockIsConnected,
    subscribeToRun: mockSubscribeToRun,
    unsubscribeFromRun: mockUnsubscribeFromRun,
    subscribeToPipeline: mockSubscribeToPipeline,
    unsubscribeFromPipeline: mockUnsubscribeFromPipeline,
    on: (event: string, handler: (data: unknown) => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);
      mockOn(event, handler);
      return () => {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index > -1) handlers.splice(index, 1);
        }
      };
    },
    off: mockOff,
  }),
}));

/**
 * Helper to emit a mock WebSocket event
 */
function emitEvent(eventName: string, data: unknown) {
  const handlers = eventHandlers.get(eventName);
  if (handlers) {
    handlers.forEach((handler) => handler(data));
  }
}

describe('useRunUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();
    mockIsConnected = true;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('subscription management', () => {
    it('subscribes to run when runId is provided and connected', () => {
      renderHook(() => useRunUpdates({ runId: 'run-123' }));

      expect(mockSubscribeToRun).toHaveBeenCalledWith('run-123');
    });

    it('unsubscribes from run on unmount', () => {
      const { unmount } = renderHook(() => useRunUpdates({ runId: 'run-123' }));

      unmount();

      expect(mockUnsubscribeFromRun).toHaveBeenCalledWith('run-123');
    });

    it('subscribes to pipeline when pipelineId is provided', () => {
      renderHook(() => useRunUpdates({ pipelineId: 'pipeline-456' }));

      expect(mockSubscribeToPipeline).toHaveBeenCalledWith('pipeline-456');
    });

    it('unsubscribes from pipeline on unmount', () => {
      const { unmount } = renderHook(() => useRunUpdates({ pipelineId: 'pipeline-456' }));

      unmount();

      expect(mockUnsubscribeFromPipeline).toHaveBeenCalledWith('pipeline-456');
    });

    it('does not subscribe when disconnected', () => {
      mockIsConnected = false;

      renderHook(() => useRunUpdates({ runId: 'run-123' }));

      expect(mockSubscribeToRun).not.toHaveBeenCalled();
    });

    it('registers event handlers when connected', () => {
      renderHook(() => useRunUpdates({}));

      expect(mockOn).toHaveBeenCalledWith('run:started', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('run:progress', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('run:completed', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('run:failed', expect.any(Function));
    });
  });

  describe('event handling', () => {
    it('calls onRunStarted when run:started event fires', () => {
      const onRunStarted = vi.fn();

      renderHook(() => useRunUpdates({ onRunStarted }));

      const event: RunStartedEvent = {
        run_id: 'run-1',
        pipeline_id: 'pipe-1',
        status: 'running',
      };

      act(() => {
        emitEvent('run:started', event);
      });

      expect(onRunStarted).toHaveBeenCalledWith({
        runId: 'run-1',
        pipelineId: 'pipe-1',
        status: 'running',
      });
    });

    it('calls onRunProgress with counts when run:progress event fires', () => {
      const onRunProgress = vi.fn();

      renderHook(() => useRunUpdates({ onRunProgress }));

      const event: RunProgressEvent = {
        run_id: 'run-1',
        pipeline_id: 'pipe-1',
        status: 'running',
        counts: {
          processed: 100,
          created: 50,
          updated: 30,
          skipped: 15,
          failed: 5,
        },
      };

      act(() => {
        emitEvent('run:progress', event);
      });

      expect(onRunProgress).toHaveBeenCalledWith({
        runId: 'run-1',
        pipelineId: 'pipe-1',
        status: 'running',
        counts: {
          processed: 100,
          created: 50,
          updated: 30,
          skipped: 15,
          failed: 5,
        },
      });
    });

    it('calls onRunCompleted with duration when run:completed event fires', () => {
      const onRunCompleted = vi.fn();

      renderHook(() => useRunUpdates({ onRunCompleted }));

      const event: RunCompletedEvent = {
        run_id: 'run-1',
        pipeline_id: 'pipe-1',
        status: 'success',
        counts: {
          processed: 100,
          created: 100,
          updated: 0,
          skipped: 0,
          failed: 0,
        },
        duration_ms: 5000,
      };

      act(() => {
        emitEvent('run:completed', event);
      });

      expect(onRunCompleted).toHaveBeenCalledWith({
        runId: 'run-1',
        pipelineId: 'pipe-1',
        status: 'success',
        counts: {
          processed: 100,
          created: 100,
          updated: 0,
          skipped: 0,
          failed: 0,
        },
        durationMs: 5000,
      });
    });

    it('calls onRunFailed with error when run:failed event fires', () => {
      const onRunFailed = vi.fn();

      renderHook(() => useRunUpdates({ onRunFailed }));

      const event: RunFailedEvent = {
        run_id: 'run-1',
        pipeline_id: 'pipe-1',
        status: 'failed',
        counts: {
          processed: 50,
          created: 40,
          updated: 0,
          skipped: 0,
          failed: 10,
        },
        error: 'Connection timeout',
        error_stage: 'extraction',
      };

      act(() => {
        emitEvent('run:failed', event);
      });

      expect(onRunFailed).toHaveBeenCalledWith({
        runId: 'run-1',
        pipelineId: 'pipe-1',
        status: 'failed',
        counts: {
          processed: 50,
          created: 40,
          updated: 0,
          skipped: 0,
          failed: 10,
        },
        error: 'Connection timeout',
        errorStage: 'extraction',
      });
    });

    it('calls onUpdate for any event type', () => {
      const onUpdate = vi.fn();

      renderHook(() => useRunUpdates({ onUpdate }));

      const startEvent: RunStartedEvent = {
        run_id: 'run-1',
        pipeline_id: 'pipe-1',
        status: 'running',
      };

      act(() => {
        emitEvent('run:started', startEvent);
      });

      expect(onUpdate).toHaveBeenCalledWith({
        runId: 'run-1',
        pipelineId: 'pipe-1',
        status: 'running',
      });
    });
  });

  describe('filtering', () => {
    it('filters events by runId when specified', () => {
      const onUpdate = vi.fn();

      renderHook(() => useRunUpdates({ runId: 'run-1', onUpdate }));

      // Event for subscribed run
      act(() => {
        emitEvent('run:started', {
          run_id: 'run-1',
          pipeline_id: 'pipe-1',
          status: 'running',
        });
      });

      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Event for different run - should be ignored
      act(() => {
        emitEvent('run:started', {
          run_id: 'run-2',
          pipeline_id: 'pipe-1',
          status: 'running',
        });
      });

      expect(onUpdate).toHaveBeenCalledTimes(1); // Still 1
    });

    it('filters events by pipelineId when specified', () => {
      const onUpdate = vi.fn();

      renderHook(() => useRunUpdates({ pipelineId: 'pipe-1', onUpdate }));

      // Event for subscribed pipeline
      act(() => {
        emitEvent('run:started', {
          run_id: 'run-1',
          pipeline_id: 'pipe-1',
          status: 'running',
        });
      });

      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Event for different pipeline - should be ignored
      act(() => {
        emitEvent('run:started', {
          run_id: 'run-2',
          pipeline_id: 'pipe-2',
          status: 'running',
        });
      });

      expect(onUpdate).toHaveBeenCalledTimes(1); // Still 1
    });

    it('receives all events when no filter is specified', () => {
      const onUpdate = vi.fn();

      renderHook(() => useRunUpdates({ onUpdate }));

      act(() => {
        emitEvent('run:started', {
          run_id: 'run-1',
          pipeline_id: 'pipe-1',
          status: 'running',
        });
        emitEvent('run:started', {
          run_id: 'run-2',
          pipeline_id: 'pipe-2',
          status: 'running',
        });
      });

      expect(onUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanup', () => {
    it('cleans up event handlers on unmount', () => {
      const onUpdate = vi.fn();
      const { unmount } = renderHook(() => useRunUpdates({ onUpdate }));

      // Verify handlers are registered
      expect(eventHandlers.get('run:started')?.length).toBeGreaterThan(0);

      unmount();

      // Verify handlers are cleaned up
      expect(eventHandlers.get('run:started')?.length).toBe(0);
    });

    it('does not call callbacks after unmount', () => {
      const onUpdate = vi.fn();
      const { unmount } = renderHook(() => useRunUpdates({ onUpdate }));

      unmount();

      // Try to emit event after unmount
      act(() => {
        emitEvent('run:started', {
          run_id: 'run-1',
          pipeline_id: 'pipe-1',
          status: 'running',
        });
      });

      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe('callback updates', () => {
    it('uses latest callback without re-subscribing', () => {
      const onUpdate1 = vi.fn();
      const onUpdate2 = vi.fn();

      const { rerender } = renderHook(
        ({ onUpdate }) => useRunUpdates({ onUpdate }),
        { initialProps: { onUpdate: onUpdate1 } }
      );

      // First event with original callback
      act(() => {
        emitEvent('run:started', {
          run_id: 'run-1',
          pipeline_id: 'pipe-1',
          status: 'running',
        });
      });

      expect(onUpdate1).toHaveBeenCalledTimes(1);
      expect(onUpdate2).not.toHaveBeenCalled();

      // Update callback
      rerender({ onUpdate: onUpdate2 });

      // Second event should use new callback
      act(() => {
        emitEvent('run:started', {
          run_id: 'run-2',
          pipeline_id: 'pipe-1',
          status: 'running',
        });
      });

      expect(onUpdate1).toHaveBeenCalledTimes(1); // Still 1
      expect(onUpdate2).toHaveBeenCalledTimes(1);
    });
  });
});
