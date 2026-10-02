import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDashboardSummary, type DashboardSummary } from '../../../lib/api';

const STALE_TIME = 60 * 1000;
const CACHE_TIME = 5 * 60 * 1000;

/**
 * One round-trip that warms every per-feature dashboard cache key.
 *
 * The leaf hooks (useGreeting, useSuggestions, useAttentionV2, usePulse,
 * useWorkshop, useActivityV2) keep their existing queryKeys; this hook
 * `setQueryData`s those keys with the bundled response so the leaves resolve
 * from cache without firing their own requests. Falls back to per-endpoint
 * fetches if the summary fails.
 */
export function useDashboardSummary(orgId: string | undefined) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<DashboardSummary, Error>({
    queryKey: ['dashboard', 'summary', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getDashboardSummary(orgId);
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  useEffect(() => {
    if (!data || !orgId) return;
    // Mirror the bundle into the keys each leaf hook reads. Note the keys
    // here must match exactly what useGreeting / useSuggestions / etc. use.
    queryClient.setQueryData(['dashboard', 'greeting', orgId], data.greeting);
    queryClient.setQueryData(
      ['dashboard', 'suggestions', orgId],
      data.suggestions,
    );
    queryClient.setQueryData(
      ['dashboard', 'attention-v2', orgId],
      data.attention,
    );
    queryClient.setQueryData(['dashboard', 'pulse', orgId], data.pulse);
    queryClient.setQueryData(['dashboard', 'workshop', orgId], data.workshop);
    queryClient.setQueryData(['dashboard', 'activity', orgId], data.activity);
  }, [data, orgId, queryClient]);

  return { isLoading, error };
}
