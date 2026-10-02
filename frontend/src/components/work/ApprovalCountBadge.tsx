/**
 * ApprovalCountBadge - Shows pending approval count in navigation
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../../contexts/useOrganization';
import { apiFetch } from '../../lib/apiClient';
import { cn } from '../../lib/utils';

export function ApprovalCountBadge({ className }: { className?: string }) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;

  const { data } = useQuery({
    queryKey: ['approval-count', orgId, 'mine'],
    queryFn: () =>
      apiFetch<{ count: number }>(
        `/organizations/${orgId}/approvals/count?mine=true`
      ),
    enabled: !!orgId,
    refetchInterval: 60000,
  });

  const count = data?.count ?? 0;

  if (count === 0) return null;

  return (
    <span
      className={cn(
        'inline-grid place-items-center min-w-[1.125rem] h-[1.125rem] px-1',
        'text-[0.625rem] font-semibold leading-none bg-archive text-parchment rounded-full',
        className
      )}
      aria-label={`${count} approval${count !== 1 ? 's' : ''} awaiting you`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
