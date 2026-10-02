/**
 * PlanCountBadge — count of the user's plans awaiting their action, shown on the
 * Work → Plans nav entry. Mirrors DraftsCountBadge/ApprovalCountBadge; the "needs
 * you" signal so an awaiting plan is visible from anywhere, not just the Plans page.
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../../contexts/useOrganization';
import { useAuth } from '../../hooks/useAuth';
import { getAgentPlanAwaitingCount } from '../../lib/api/agentPlans';
import { cn } from '../../lib/utils';

export function PlanCountBadge({ className }: { className?: string }) {
  const { activeOrganization } = useOrganization();
  const { hasAppAccess } = useAuth();
  const orgId = activeOrganization?.organization_id;

  // The endpoint is agent-gated and 503s when Guide is off or unconfigured.
  // The nav section carrying this badge is gated too, but the poll is what
  // does the damage — a 503 and an error log every 60s — so guard it here as
  // well rather than relying on where the badge happens to be mounted.
  const guideEnabled = hasAppAccess('guide');

  const { data } = useQuery({
    queryKey: ['plan-awaiting-count', orgId],
    queryFn: () => getAgentPlanAwaitingCount(orgId as string),
    enabled: !!orgId && guideEnabled,
    refetchInterval: 60000,
  });

  const count = data?.count ?? 0;
  if (count === 0) return null;

  return (
    <span
      className={cn(
        'inline-grid place-items-center min-w-[1.125rem] h-[1.125rem] px-1',
        'text-[0.625rem] font-semibold leading-none bg-archive text-parchment rounded-full',
        className,
      )}
      aria-label={`${count} plan${count !== 1 ? 's' : ''} awaiting you`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
