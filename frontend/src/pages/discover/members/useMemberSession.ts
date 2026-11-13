import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getMemberSession } from '../../../lib/api/discoverMembers';
import type { MemberSessionState } from '../../../lib/api/discoverMembers';

export const memberSessionKey = (orgSlug: string) => ['discover-member-session', orgSlug] as const;
export const memberCollectionsKey = (orgSlug: string) => ['discover-member-collections', orgSlug] as const;

const OFF: MemberSessionState = { enabled: false, member: null };

/**
 * Whether this portal offers saved collections, and who is signed in.
 *
 * Any failure reads as "off": the member features stay hidden rather than
 * showing controls that cannot work.
 */
export function useMemberSession(orgSlug: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: memberSessionKey(orgSlug ?? ''),
    queryFn: async () => {
      try {
        return await getMemberSession(orgSlug!);
      } catch {
        return OFF;
      }
    },
    enabled: !!orgSlug,
    staleTime: 60_000,
    retry: false,
  });
  const refresh = useCallback(() => {
    if (!orgSlug) return Promise.resolve();
    return queryClient.invalidateQueries({ queryKey: memberSessionKey(orgSlug) });
  }, [orgSlug, queryClient]);

  const state = query.data ?? OFF;
  return {
    isLoading: query.isLoading,
    enabled: state.enabled,
    member: state.member,
    refresh,
  };
}
