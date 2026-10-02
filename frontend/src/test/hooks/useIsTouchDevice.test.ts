import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';

describe('useIsTouchDevice', () => {
  let touchStartCallback: EventListener | null = null;
  const originalNavigator = { ...navigator };
  const originalOntouchstart = window.ontouchstart;

  beforeEach(() => {
    touchStartCallback = null;

    vi.spyOn(window, 'addEventListener').mockImplementation((event, callback) => {
      if (event === 'touchstart') {
        touchStartCallback = callback as EventListener;
      }
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});

    // Reset touch detection properties
    // @ts-expect-error - Resetting for testing
    delete window.ontouchstart;
    Object.defineProperty(navigator, 'maxTouchPoints', {
      writable: true,
      configurable: true,
      value: 0,
    });
    Object.defineProperty(navigator, 'msMaxTouchPoints', {
      writable: true,
      configurable: true,
      value: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original values
    if (originalOntouchstart !== undefined) {
      window.ontouchstart = originalOntouchstart;
    }
    Object.defineProperty(navigator, 'maxTouchPoints', {
      writable: true,
      configurable: true,
      value: originalNavigator.maxTouchPoints,
    });
  });

  describe('initial detection', () => {
    it('returns false when no touch support', () => {
      const { result } = renderHook(() => useIsTouchDevice());
      expect(result.current).toBe(false);
    });

    it('returns true when ontouchstart exists', () => {
      // @ts-expect-error - Setting for testing
      window.ontouchstart = () => {};

      const { result } = renderHook(() => useIsTouchDevice());
      expect(result.current).toBe(true);
    });

    it('returns true when maxTouchPoints > 0', () => {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        writable: true,
        configurable: true,
        value: 5,
      });

      const { result } = renderHook(() => useIsTouchDevice());
      expect(result.current).toBe(true);
    });

    it('returns true when msMaxTouchPoints > 0', () => {
      Object.defineProperty(navigator, 'msMaxTouchPoints', {
        writable: true,
        configurable: true,
        value: 2,
      });

      const { result } = renderHook(() => useIsTouchDevice());
      expect(result.current).toBe(true);
    });
  });

  describe('event listeners', () => {
    it('adds touchstart listener on mount', () => {
      renderHook(() => useIsTouchDevice());

      expect(window.addEventListener).toHaveBeenCalledWith(
        'touchstart',
        expect.any(Function),
        { passive: true }
      );
    });

    it('removes touchstart listener on unmount', () => {
      const { unmount } = renderHook(() => useIsTouchDevice());

      unmount();

      expect(window.removeEventListener).toHaveBeenCalledWith(
        'touchstart',
        expect.any(Function)
      );
    });

    it('sets isTouch to true when touchstart fires', () => {
      const { result } = renderHook(() => useIsTouchDevice());

      expect(result.current).toBe(false);

      // Simulate touchstart event
      act(() => {
        if (touchStartCallback) {
          touchStartCallback(new Event('touchstart'));
        }
      });

      expect(result.current).toBe(true);
    });

    it('removes listener after touchstart fires', () => {
      renderHook(() => useIsTouchDevice());

      // Should have been called initially
      const addCalls = vi.mocked(window.addEventListener).mock.calls.filter(
        (call) => call[0] === 'touchstart'
      );
      expect(addCalls.length).toBe(1);

      // Simulate touchstart
      act(() => {
        if (touchStartCallback) {
          touchStartCallback(new Event('touchstart'));
        }
      });

      // Listener should be removed after first touch
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'touchstart',
        expect.any(Function)
      );
    });
  });

  describe('hybrid devices', () => {
    it('detects touch on hybrid device after touch event', () => {
      // Start with no touch indicators (desktop mode)
      const { result } = renderHook(() => useIsTouchDevice());

      expect(result.current).toBe(false);

      // User touches screen (hybrid laptop in tablet mode)
      act(() => {
        if (touchStartCallback) {
          touchStartCallback(new Event('touchstart'));
        }
      });

      expect(result.current).toBe(true);
    });
  });
});
