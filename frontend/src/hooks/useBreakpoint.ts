import { useState, useEffect, useCallback } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

interface UseBreakpointReturn {
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
}

const MOBILE_MAX = 640;
const TABLET_MAX = 1024;

/**
 * Hook for responsive breakpoint detection.
 * - mobile: <640px
 * - tablet: 640-1024px
 * - desktop: >1024px
 */
export function useBreakpoint(): UseBreakpointReturn {
  const getBreakpoint = useCallback((): Breakpoint => {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width < MOBILE_MAX) return 'mobile';
    if (width < TABLET_MAX) return 'tablet';
    return 'desktop';
  }, []);

  const getWidth = useCallback((): number => {
    if (typeof window === 'undefined') return 1280;
    return window.innerWidth;
  }, []);

  const [breakpoint, setBreakpoint] = useState<Breakpoint>(getBreakpoint);
  const [width, setWidth] = useState<number>(getWidth);

  useEffect(() => {
    const handleResize = () => {
      setBreakpoint(getBreakpoint());
      setWidth(getWidth());
    };

    // Set initial values
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getBreakpoint, getWidth]);

  return {
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    width,
  };
}
