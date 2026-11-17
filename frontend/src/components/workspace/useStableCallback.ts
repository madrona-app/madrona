import { useCallback, useEffect, useRef } from 'react';

/**
 * Return a function with a stable identity that always calls the latest `fn`.
 *
 * useAccessibleModal re-runs its focus effect whenever `onClose` changes
 * identity, which moves focus back to the first focusable element. Pass it a
 * stable callback when the close handler is an inline or per-render function,
 * otherwise every re-render (e.g. each keystroke in a field) steals focus.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
