import { useState, useEffect } from 'react';

/**
 * Hook to detect if the device supports touch interactions.
 * Useful for adjusting UI for touch vs. pointer devices.
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(false);

  useEffect(() => {
    const checkTouch = () => {
      const hasTouch =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        // @ts-expect-error - msMaxTouchPoints is IE-specific
        navigator.msMaxTouchPoints > 0;
      setIsTouch(hasTouch);
    };

    checkTouch();

    // Listen for touch events to handle hybrid devices
    const handleTouchStart = () => {
      setIsTouch(true);
      window.removeEventListener('touchstart', handleTouchStart);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
    };
  }, []);

  return isTouch;
}
