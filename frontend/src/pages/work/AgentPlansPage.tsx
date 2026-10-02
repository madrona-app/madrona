/**
 * AgentPlansPage — the Guide Studio plan inbox (§5).
 *
 * A list of the user's plans, flagging the ones awaiting them. Each row LINKS to
 * the dedicated detail surface (PlanDetailPage) — the timeline + all actions live
 * there, not inline. Backed by live data (the list polls while any plan is
 * active), so status is never stale.
 */

import { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Hourglass, RefreshCw, ChevronRight } from 'lucide-react';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { StudioWordmark } from '../../components/studio/StudioWordmark';
import { StudioLauncherCard } from '../../components/studio/StudioLauncherCard';
import { StartProcedure } from '../../components/studio/StartProcedure';
import { useActiveProduct, workBasePath } from '../../hooks/useActiveProduct';
import {
  listAgentPlans,
  type AgentPlanSummary,
  type PlanStatus,
} from '../../lib/api/agentPlans';
import { formatDateTime } from '../../lib/formatters';
import { cn } from '../../lib/utils';

type Tab = 'needs_you' | 'active' | 'history';

const TAB_LABEL: Record<Tab, string> = {
  needs_you: 'Needs you',
  active: 'Active',
  history: 'History',
};

const ACTIVE_STATUSES = new Set<PlanStatus>(['pending', 'running', 'awaiting', 'paused']);

const STATUS_PILL: Record<PlanStatus, string> = {
  pending: 'bg-stone/60 text-ink',
  running: 'bg-bark/15 text-bark',
  paused: 'bg-semantic-warning/15 text-semantic-warning',
  awaiting: 'bg-semantic-warning/15 text-semantic-warning',
  completed: 'bg-semantic-success/15 text-semantic-success',
  failed: 'bg-semantic-error/15 text-semantic-error',
  cancelled: 'bg-stone/60 text-archive',
};

export default function AgentPlansPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeProductId } = useActiveProduct();
  const workBase = workBasePath(orgId as string, activeProductId);
  const [searchParams] = useSearchParams();
  // Back-compat: an old ?plan=<id> deep-link redirects to the detail route.
  const focusPlanId = searchParams.get('plan');
  const [userTab, setUserTab] = useState<Tab | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['agent-plans', orgId],
    queryFn: () => listAgentPlans(orgId as string),
    enabled: !!orgId,
    // Keep the list (status pills, "Needs you" counts) live while any plan is
    // active; idle once every plan is terminal.
    refetchInterval: (query) =>
      query.state.data?.plans?.some((p) => ACTIVE_STATUSES.has(p.status)) ? 5000 : false,
  });

  const plans = useMemo(() => data?.plans ?? [], [data]);
  const tab: Tab = userTab ?? 'needs_you';
  const buckets = useMemo(
    () => ({
      needs_you: plans.filter((p) => p.awaits_user),
      active: plans.filter((p) => ACTIVE_STATUSES.has(p.status)),
      history: plans.filter((p) => !ACTIVE_STATUSES.has(p.status)),
    }),
    [plans],
  );
  const visible = buckets[tab];

  if (focusPlanId) {
    return <Navigate to={`${workBase}/plans/${focusPlanId}`} replace />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Breadcrumb lockup (Studio brand spec §6). In-product short form drops
          the implicit "Madrona" parent (§2). Studio leads here as the primary
          nav element, so it takes full copper rather than the muted variant (§5). */}
      <div className="mb-4 flex items-center gap-2">
        <nav aria-label="Breadcrumb" className="flex items-baseline gap-2">
          <StudioWordmark className="text-2xl leading-none" />
          <span className="text-xl text-stone" aria-hidden>/</span>
          <h1 className="font-sans text-base font-medium tracking-wide text-archive">
            Plans
          </h1>
        </nav>
        <StartProcedure className="ml-auto !px-3 !py-1.5 text-xs" />
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark"
          title="Refresh"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} aria-hidden />
          Refresh
        </button>
      </div>

      <div className="mb-4 flex gap-1 border-b border-lichen" role="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setUserTab(t)}
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
              tab === t
                ? 'border-bark font-medium text-ink'
                : 'border-transparent text-archive hover:text-ink',
            )}
          >
            {TAB_LABEL[t]}
            <span className="ml-1.5 text-[10px] text-archive">{buckets[t].length}</span>
          </button>
        ))}
      </div>

      {isLoading && <MadronaLoader variant="inline" label="Loading plans…" />}
      {isError && (
        <ErrorState variant="inline" title="Could not load plans." onRetry={() => refetch()} />
      )}
      {!isLoading && !isError && visible.length === 0 && (
        tab === 'needs_you'
          ? <EmptyState icon={Hourglass} title="Nothing is waiting on you." variant="compact" />
          : <StudioLauncherCard descriptor="Studio drafts plans across your collection — multi-step work it runs, cross-checks, and lands here for your review." />
      )}

      <ul className="space-y-2">
        {visible.map((plan) => (
          <PlanRow key={plan.plan_id} plan={plan} workBase={workBase} />
        ))}
      </ul>
    </div>
  );
}

function PlanRow({ plan, workBase }: { plan: AgentPlanSummary; workBase: string }) {
  return (
    <li className="rounded-md border border-lichen bg-parchment transition-colors hover:border-bark/40">
      <Link
        to={`${workBase}/plans/${plan.plan_id}`}
        className="block px-3 py-2.5 no-underline"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{plan.goal}</span>
          {plan.awaits_user && (
            <span className="shrink-0 rounded bg-semantic-warning/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-semantic-warning">
              Needs you
            </span>
          )}
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
              STATUS_PILL[plan.status],
            )}
          >
            {plan.status}
          </span>
          <ChevronRight size={15} className="shrink-0 text-archive" aria-hidden />
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-archive">
          <span>{plan.step_count} {plan.step_count === 1 ? 'step' : 'steps'}</span>
          {plan.created_at && <span>{formatDateTime(plan.created_at)}</span>}
          {plan.status === 'awaiting' && plan.awaiting_kind === 'workflow_transition' && (
            <span className="inline-flex items-center gap-1 text-semantic-warning">
              <Hourglass size={11} aria-hidden /> Resumes automatically
            </span>
          )}
          {plan.last_error && <span className="truncate text-semantic-error">{plan.last_error}</span>}
        </div>
      </Link>
    </li>
  );
}
