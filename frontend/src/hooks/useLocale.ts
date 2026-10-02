/**
 * Hook for accessing the user's locale.
 *
 * Priority: user's saved preference > browser language > 'en-US'.
 */

import { useMemo } from 'react';
import { useAuth } from './useAuth';

export function useLocale(): string {
  const { user } = useAuth();

  return useMemo(
    () =>
      user?.locale ||
      (typeof navigator !== 'undefined' ? navigator.language : 'en-US'),
    [user?.locale],
  );
}
