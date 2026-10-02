import { useQuery } from '@tanstack/react-query';
import { getAttentionV2, type AttentionItemV2 } from '../../../lib/api';
import type { AttentionItem } from './types';

const STALE_TIME = 60 * 1000;
const CACHE_TIME = 5 * 60 * 1000;

function toAttentionItem(item: AttentionItemV2, orgId: string): AttentionItem {
  const href = item.href ? `/organizations/${orgId}${item.href}` : '#';
  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    refNumber: item.ref_number,
    title: item.title,
    context: item.context,
    href,
  };
}

export function useAttentionV2(orgId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'attention-v2', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getAttentionV2(orgId);
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  const items: AttentionItem[] = data && orgId
    ? data.items.map((i) => toAttentionItem(i, orgId))
    : [];

  return {
    items,
    isLoading,
    error: error ?? null,
  };
}
