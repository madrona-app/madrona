import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';

describe('useUnsavedGuard', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  describe('beforeunload handler', () => {
    it('registers beforeunload handler when mounted', () => {
      renderHook(() => useUnsavedGuard(true));

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
    });

    it('prevents default when isDirty is true', () => {
      renderHook(() => useUnsavedGuard(true));

      const handler = addEventListenerSpy.mock.calls.find(
        call => call[0] === 'beforeunload'
      )?.[1] as EventListener;

      const event = new Event('beforeunload') as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      handler(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('does not prevent default when isDirty is false', () => {
      renderHook(() => useUnsavedGuard(false));

      const handler = addEventListenerSpy.mock.calls.find(
        call => call[0] === 'beforeunload'
      )?.[1] as EventListener;

      const event = new Event('beforeunload') as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      handler(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes beforeunload handler on unmount', () => {
      const { unmount } = renderHook(() => useUnsavedGuard(true));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
    });

    it('removes old handler and adds new one when isDirty changes', () => {
      const { rerender } = renderHook(
        ({ isDirty }) => useUnsavedGuard(isDirty),
        { initialProps: { isDirty: false } }
      );

      const initialCallCount = addEventListenerSpy.mock.calls.filter(
        c => c[0] === 'beforeunload'
      ).length;

      rerender({ isDirty: true });

      // Should have removed the old handler and added a new one
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
      expect(addEventListenerSpy.mock.calls.filter(c => c[0] === 'beforeunload').length)
        .toBeGreaterThan(initialCallCount);
    });
  });

  describe('return value', () => {
    it('returns an idle blocker', () => {
      const { result } = renderHook(() => useUnsavedGuard(false));

      expect(result.current.state).toBe('unblocked');
    });
  });
});
