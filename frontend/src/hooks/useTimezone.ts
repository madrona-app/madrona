/**
 * Hook for accessing user timezone settings.
 */

import { useAuth } from './useAuth';

export interface UseTimezoneResult {
  timezone: string;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to get the current user's timezone setting.
 * Falls back to 'America/New_York' if not available.
 */
export function useTimezone(): UseTimezoneResult {
  const { user, isLoading } = useAuth();
  
  return {
    timezone: user?.timezone || 'America/New_York',
    isLoading,
    error: null,
  };
}
