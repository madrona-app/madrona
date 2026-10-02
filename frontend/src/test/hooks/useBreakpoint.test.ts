import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreakpoint } from '../../hooks/useBreakpoint';

describe('useBreakpoint', () => {
  const originalInnerWidth = window.innerWidth;
  let resizeCallback: () => void;

  beforeEach(() => {
    // Mock addEventListener to capture resize callback
    vi.spyOn(window, 'addEventListener').mockImplementation((event, callback) => {
      if (event === 'resize') {
        resizeCallback = callback as () => void;
      }
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    vi.restoreAllMocks();
  });

  function setWindowWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
  }

  describe('breakpoint detection', () => {
    it('returns mobile for width < 640', () => {
      setWindowWidth(500);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('mobile');
      expect(result.current.isMobile).toBe(true);
      expect(result.current.isTablet).toBe(false);
      expect(result.current.isDesktop).toBe(false);
    });

    it('returns tablet for width 640-1024', () => {
      setWindowWidth(800);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('tablet');
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isTablet).toBe(true);
      expect(result.current.isDesktop).toBe(false);
    });

    it('returns desktop for width > 1024', () => {
      setWindowWidth(1200);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('desktop');
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isTablet).toBe(false);
      expect(result.current.isDesktop).toBe(true);
    });

    it('returns width value', () => {
      setWindowWidth(1000);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.width).toBe(1000);
    });
  });

  describe('edge cases', () => {
    it('returns mobile at exactly 639px', () => {
      setWindowWidth(639);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('mobile');
    });

    it('returns tablet at exactly 640px', () => {
      setWindowWidth(640);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('tablet');
    });

    it('returns tablet at exactly 1023px', () => {
      setWindowWidth(1023);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('tablet');
    });

    it('returns desktop at exactly 1024px', () => {
      setWindowWidth(1024);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('desktop');
    });
  });

  describe('resize handling', () => {
    it('adds resize listener on mount', () => {
      setWindowWidth(1200);
      renderHook(() => useBreakpoint());

      expect(window.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('removes resize listener on unmount', () => {
      setWindowWidth(1200);
      const { unmount } = renderHook(() => useBreakpoint());

      unmount();

      expect(window.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('updates breakpoint on resize', () => {
      setWindowWidth(1200);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.breakpoint).toBe('desktop');

      // Simulate resize to mobile
      act(() => {
        setWindowWidth(500);
        resizeCallback();
      });

      expect(result.current.breakpoint).toBe('mobile');
      expect(result.current.width).toBe(500);
    });

    it('updates from mobile to desktop', () => {
      setWindowWidth(400);
      const { result } = renderHook(() => useBreakpoint());

      expect(result.current.isMobile).toBe(true);

      act(() => {
        setWindowWidth(1100);
        resizeCallback();
      });

      expect(result.current.isDesktop).toBe(true);
    });
  });
});
