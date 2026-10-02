/**
 * PlanDetailPage — the dedicated home for one orchestration plan (§5).
 *
 * The inbox (AgentPlansPage) lists plans and links here. This surface hosts the
 * full timeline in a bounded scroll viewport so the active DECISION gate can pin
 * to the top (pinActiveGate) regardless of how many completed phases sit above —
 * the scroll-trap that an inline-expand row couldn't support. All plan actions
 * (run, decide a branch, mark a form submitted) live here; approvals link out.
 */
import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, ListChecks } from 'lucide-react';
import {
  getAgentPlan,
  runAgentPlan,
  decideAgentPlanStep,
  submitAgentPlanForm,
  type PlanStatus,
} from '../../lib/api/agentPlans';
import { PlanTimeline } from '../../components/agent/PlanTimeline';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { ErrorState } from '../../components/ui/ErrorState';
import { StudioSessionHeader } from '../../components/studio/StudioSessionHeader';
import { StudioWordmark } from '../../components/studio/StudioWordmark';
import { personaLabel } from '../../lib/agentPersonas';
import { useActiveProduct, workBasePath } from '../../hooks/useActiveProduct';
import { cn } from '../../lib/utils';

const ACTIVE_STATUSES = new Set<PlanStatus>(['pending', 'running', 'awaiting', 'paused']);

// The Studio session-header label for each active state (spec §6). Terminal
// states get no session header — Studio is no longer working the plan.
const SESSION_LABEL: Partial<Record<PlanStatus, string>> = {
  pending: 'Ready to run',
  running: 'Currently drafting',
  awaiting: 'Awaiting your input',
  paused: 'Paused',
};

const STATUS_PILL: Record<PlanStatus, string> = {
  pending: 'bg-stone/60 text-ink',
  running: 'bg-bark/15 text-bark',
  paused: 'bg-semantic-warning/15 text-semantic-warning',
  awaiting: 'bg-semantic-warning/15 text-semantic-warning',
  completed: 'bg-semantic-success/15 text-semantic-success',
  failed: 'bg-semantic-error/15 text-semantic-error',
  cancelled: 'bg-stone/60 text-archive',
};

export default function PlanDetailPage() {
  const { orgId, planId } = useParams<{ orgId: string; planId: string }>();
  const { activeProductId } = useActiveProduct();
  const workBase = workBasePath(orgId as string, activeProductId);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['agent-plan', orgId, planId],
    queryFn: () => getAgentPlan(orgId as string, planId as string),
    enabled: !!orgId && !!planId,
    // Live while active — a run burst, or a gate a human may resolve any moment
    // (incl. an approval resolved on the Approvals page, which advances here on
    // the next poll). Idles at a terminal state.
    refetchInterval: (query) =>
      ACTIVE_STATUSES.has(query.state.data?.status as PlanStatus) ? 3000 : false,
  });

  // Back-nav freshness: refresh the inbox on leave so a plan that transitioned
  // here isn't shown stale there.
  useEffect(
    () => () => {
      queryClient.invalidateQueries({ queryKey: ['agent-plans', orgId] });
    },
    [queryClient, orgId],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-plan', orgId, planId] });
    queryClient.invalidateQueries({ queryKey: ['agent-plans', orgId] });
  };
  const runMutation = useMutation({
    mutationFn: () => runAgentPlan(orgId as string, planId as string),
    onSuccess: invalidate,
  });
  const decideMutation = useMutation({
    mutationFn: (v: { stepId: string; chosen: string }) =>
      decideAgentPlanStep(orgId as string, planId as string, v.stepId, v.chosen),
    onSuccess: invalidate,
  });
  const formMutation = useMutation({
    mutationFn: (stepId: string) =>
      submitAgentPlanForm(orgId as string, planId as string, stepId),
    onSuccess: invalidate,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Breadcrumb (§6) — 'Plans' links back to the inbox; the goal is the h1
          below, so it's not repeated here. Muted: secondary to the goal. */}
      <nav aria-label="Breadcrumb" className="mb-3 flex items-baseline gap-1.5 text-sm">
        <StudioWordmark muted className="text-base leading-none" />
        <span className="text-stone" aria-hidden>/</span>
        <Link to={`${workBase}/plans`} className="text-bark hover:text-copper-dark">
          Plans
        </Link>
      </nav>

      {isLoading && <MadronaLoader variant="inline" label="Loading plan…" />}
      {isError && (
        <ErrorState variant="inline" title="Could not load this plan." onRetry={() => refetch()} />
      )}

      {data && (
        <>
          {/* Studio session header (§6) — while Studio is working the plan.
              Agents/roles derived from the distinct specialist personas the
              plan delegates to; omitted when it runs without specialists. */}
          {SESSION_LABEL[data.status] && (() => {
            const roles = Array.from(
              new Set((data.steps ?? []).map((s) => s.persona).filter(Boolean) as string[]),
            ).map(personaLabel);
            return (
              <StudioSessionHeader
                label={SESSION_LABEL[data.status]!}
                agentCount={roles.length || undefined}
                roles={roles}
                className="mb-3"
              />
            );
          })()}

          <div className="mb-3 flex items-start gap-2">
            <ListChecks size={20} className="mt-0.5 text-bark" aria-hidden />
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-lg font-semibold text-ink">{data.goal}</h1>
              <div className="mt-1 flex items-center gap-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', STATUS_PILL[data.status])}>
                  {data.status}
                </span>
                <span className="text-[11px] text-archive">
                  {data.step_count} {data.step_count === 1 ? 'step' : 'steps'}
                </span>
              </div>
            </div>
            {data.status === 'pending' && (
              <button
                type="button"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
                className="inline-flex items-center gap-1 rounded bg-bark px-2.5 py-1 text-xs text-parchment transition-colors hover:bg-copper-dark disabled:opacity-60"
              >
                <Play size={12} aria-hidden /> Run
              </button>
            )}
          </div>

          {/* Bounded scroll viewport → the active decision gate pins to the top. */}
          <div className="max-h-[70vh] overflow-y-auto rounded-md border border-lichen bg-parchment p-3">
            <PlanTimeline
              detail={data}
              workBase={workBase}
              approvalsHref={`/organizations/${orgId}/collections/work/approvals`}
              pinActiveGate
              onDecide={(stepId, chosen) => decideMutation.mutate({ stepId, chosen })}
              decidePending={decideMutation.isPending}
              onSubmitForm={(stepId) => formMutation.mutate(stepId)}
              formPending={formMutation.isPending}
            />
          </div>
        </>
      )}
    </div>
  );
}
