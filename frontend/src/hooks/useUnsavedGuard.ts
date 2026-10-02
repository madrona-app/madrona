import { useEffect } from 'react';
import type { Blocker } from 'react-router-dom';

/**
 * Idle blocker returned when no data router is available.
 */
const IDLE_BLOCKER: Blocker = {
  state: 'unblocked',
  reset: undefined,
  proceed: undefined,
  location: undefined,
} as unknown as Blocker;

/**
 * Warns users before navigating away from a page with unsaved changes.
 *
 * Currently guards via the browser's beforeunload event (tab close/refresh).
 *
 * NOTE: In-app SPA navigation blocking (useBlocker) requires a data router
 * (createBrowserRouter). The app currently uses BrowserRouter, so useBlocker
 * is not available. An idle blocker is returned for API compatibility with
 * NavigationBlockerDialog — it will simply never trigger.
 *
 * TODO: When the app migrates to createBrowserRouter, re-enable useBlocker
 * here so NavigationBlockerDialog can intercept in-app navigation.
 */
export function useUnsavedGuard(isDirty: boolean) {
  // Browser beforeunload — always works regardless of router type
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  return IDLE_BLOCKER;
}
