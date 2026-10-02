import { useQuery } from '@tanstack/react-query';
import { getAttentionSummary, type AttentionSummary } from '../lib/api';

const STALE_TIME = 60 * 1000;
const CACHE_TIME = 5 * 60 * 1000;

export function useAttentionItems(orgId: string | undefined) {
  const { data, isLoading, error, refetch } = useQuery<AttentionSummary, Error>({
    queryKey: ['dashboard', 'attention', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getAttentionSummary(orgId);
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  return {
    summary: data ?? null,
    isLoading,
    error: error ?? null,
    refetch,
  };
}
