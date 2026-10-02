import { useQuery } from '@tanstack/react-query';
import { getSuggestions } from '../../../lib/api';

const STALE_TIME = 5 * 60 * 1000;
const CACHE_TIME = 10 * 60 * 1000;

/**
 * Returns up to 3 Guide-hero suggestion chips. Empty array while loading or on
 * error so the chip wrapper hides gracefully (it already gates on length>0).
 */
export function useSuggestions(orgId: string | undefined): string[] {
  const { data } = useQuery({
    queryKey: ['dashboard', 'suggestions', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getSuggestions(orgId);
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  return data?.suggestions ?? [];
}
