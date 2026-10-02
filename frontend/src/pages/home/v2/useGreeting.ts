import { useQuery } from '@tanstack/react-query';
import { getGreeting } from '../../../lib/api';

const STALE_TIME = 5 * 60 * 1000;
const CACHE_TIME = 10 * 60 * 1000;
const FALLBACK = "Welcome back. Here's where things stand.";

/**
 * Returns the editorial greeting subtitle. Falls back to a static line while
 * the query is loading so the page doesn't flash an empty subtitle.
 */
export function useGreeting(orgId: string | undefined): string {
  const { data } = useQuery({
    queryKey: ['dashboard', 'greeting', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getGreeting(orgId);
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  return data?.subtitle ?? FALLBACK;
}
