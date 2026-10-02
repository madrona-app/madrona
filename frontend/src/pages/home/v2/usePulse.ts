import { useQuery } from '@tanstack/react-query';
import { getPulse } from '../../../lib/api';
import type { PulseData } from './types';

const STALE_TIME = 5 * 60 * 1000;
const CACHE_TIME = 10 * 60 * 1000;

const EMPTY: PulseData = { stats: [], recentObject: null };

export function usePulse(orgId: string | undefined): PulseData {
  const { data } = useQuery({
    queryKey: ['dashboard', 'pulse', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getPulse(orgId);
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  if (!data || !orgId) return EMPTY;

  return {
    stats: data.stats,
    recentObject: data.recent_object
      ? {
          name: data.recent_object.name,
          href: `/organizations/${orgId}${data.recent_object.href}`,
          updatedAgo: data.recent_object.updated_ago,
        }
      : null,
  };
}
