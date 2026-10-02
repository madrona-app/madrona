/**
 * §2C / §4 — the orchestration timeline.
 *
 * A vertical rail, grouped into collapsible procedure phases when the plan is
 * template-authored (ad-hoc plans have no phases → flat rail). Two distinct gate
 * grammars: a DECISION (bark) acts in place; an APPROVAL (amber) links out to the
 * Approvals page. Effort is demoted — a plain-language bucket + time leads, raw
 * tokens/cost sit muted underneath. Not-taken branches collapse to one line.
 *
 * Reads the durable GET /plans/{id} shape (AgentPlanDetail). The richer sibling
 * of the one-shot chat PlanChecklist. (The sticky-pin lands with the detail
 * surface in §5; here it renders against the inline host.)
 */
import { useMemo, useState } from 'react';
import {
  Cog, Network, Hourglass, Split, Circle, CheckCircle2,
  Clock, ChevronRight, ChevronDown, ExternalLink, FileText, GitBranch,
  ClipboardCheck,
} from 'lucide-react';

import type {
  AgentPlanDetail,
  AgentPlanStepDetail,
} from '../../lib/api/agentPlans';
import {
  effortColor, effortLead, effortRaw, hasAiCost, relativeTime,
} from '../../lib/planEffort';
import { PlanSummaryHeader } from './PlanSummaryHeader';
import { SPECIALIST_LABELS } from '../../lib/agentPersonas';

const KIND_GLYPH: Record<string, { Icon: typeof Circle; klass: string }> = {
  tool_call: { Icon: Cog, klass: 'text-bark' },
  delegate: { Icon: Network, klass: 'text-moss' },
  await: { Icon: Hourglass, klass: 'text-semantic-warning' },
  decision: { Icon: Split, klass: 'text-bark' },
};

/** "AI → Registrar" / "→ Conservator" — replaces the old "AI WORKING". */
function routingLabel(step: AgentPlanStepDetail): string | null {
  const persona = step.persona
    ? SPECIALIST_LABELS[step.persona] ?? step.persona
    : null;
  if (step.kind === 'delegate') return persona ? `→ ${persona}` : 'Specialist';
  if (step.kind === 'tool_call') return persona ? `AI → ${persona}` : 'AI';
  return null;
}

const NODE: Record<string, string> = {
  pending: 'bg-stone',
  running: 'bg-bark animate-pulse',
  completed: 'bg-semantic-success',
  failed: 'bg-semantic-error',
  awaiting_user: 'bg-semantic-warning',
  awaiting_external: 'bg-semantic-warning',
  skipped: 'bg-stone',
};

interface Group {
  phase: string | null;
  steps: AgentPlanStepDetail[];
}

function buildGroups(steps: AgentPlanStepDetail[]): Group[] {
  // Consecutive runs of equal phase. Non-consecutive same label → separate
  // groups (never merge across a gap), which falls out of consecutive-run
  // grouping for free.
  const groups: Group[] = [];
  for (const s of steps) {
    const phase = s.phase ?? null;
    const last = groups[groups.length - 1];
    if (last && last.phase === phase) last.steps.push(s);
    else groups.push({ phase, steps: [s] });
  }
  return groups;
}

interface PlanTimelineProps {
  detail: AgentPlanDetail;
  variant?: 'inline' | 'full';
  /** Resolve a `decision` step's branch choice. Omit → read-only. */
  onDecide?: (stepId: string, chosen: string) => void;
  decidePending?: boolean;
  /** Where the amber approval gate links to. */
  approvalsHref?: string;
  /** Work-area base path for artifact links (view draft), e.g.
   * `/organizations/:id/collections/work`. Omit → fact renders as text. */
  workBase?: string;
  /** Detail surface only: dock the single open gate to the top of the scroll
   * viewport — but ONLY a decision (you can't act on an approval here, it links
   * out). Needs a bounded-scroll ancestor; no-op on the inline host. */
  pinActiveGate?: boolean;
  /** Resolve a form_submission gate (an in-app action, not the Approvals page). */
  onSubmitForm?: (stepId: string) => void;
  formPending?: boolean;
}

export function PlanTimeline({
  detail,
  variant = 'full',
  onDecide,
  decidePending = false,
  approvalsHref,
  workBase,
  pinActiveGate = false,
  onSubmitForm,
  formPending = false,
}: PlanTimelineProps) {
  const steps = useMemo(
    () => [...detail.steps].sort((a, b) => a.idx - b.idx),
    [detail.steps],
  );

  // Not-taken branches collapse to one dashed line each; everything else rails.
  const railSteps = steps.filter((s) => !(s.status === 'skipped' && s.branch));
  const notTaken = useMemo(() => {
    const byBranch = new Map<string, AgentPlanStepDetail[]>();
    for (const s of steps) {
      if (s.status === 'skipped' && s.branch) {
        const arr = byBranch.get(s.branch) ?? [];
        arr.push(s);
        byBranch.set(s.branch, arr);
      }
    }
    return [...byBranch.entries()];
  }, [steps]);

  const phased = railSteps.some((s) => s.phase);
  const groups = phased ? buildGroups(railSteps) : [{ phase: null, steps: railSteps }];

  // Pin the single open gate — only a decision (an approval links out, so
  // docking it buys nothing). Engine surfaces ≤1 open gate today.
  const pinnedStepId = pinActiveGate
    ? railSteps.find((s) => s.status === 'awaiting_user' && s.kind === 'decision')?.step_id ?? null
    : null;

  return (
    <div className="flex flex-col gap-2" data-testid="plan-timeline">
      {variant === 'full' && <PlanSummaryHeader detail={detail} />}
      <ol className="ml-1.5 flex flex-col border-l-2 border-lichen pl-5">
        {groups.map((g, i) =>
          g.phase ? (
            <PhaseGroup
              key={`p-${i}-${g.phase}`}
              group={g}
              onDecide={onDecide}
              decidePending={decidePending}
              approvalsHref={approvalsHref}
              workBase={workBase}
              pinnedStepId={pinnedStepId}
              onSubmitForm={onSubmitForm}
              formPending={formPending}
            />
          ) : (
            g.steps.map((step) => (
              <StepRow
                key={step.step_id}
                step={step}
                onDecide={onDecide}
                decidePending={decidePending}
                approvalsHref={approvalsHref}
                workBase={workBase}
                pinned={step.step_id === pinnedStepId}
                onSubmitForm={onSubmitForm}
                formPending={formPending}
              />
            ))
          ),
        )}
        {notTaken.map(([branch, brSteps]) => (
          <li key={`nt-${branch}`} className="relative flex gap-2.5 pb-2 opacity-60">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px] border border-dashed border-stone" aria-hidden />
            <div className="flex items-center gap-1.5 text-[12px] italic text-archive">
              <GitBranch size={13} aria-hidden />
              Alternate path — {brSteps.length} {brSteps.length === 1 ? 'step' : 'steps'}, not taken
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function phaseSummary(steps: AgentPlanStepDetail[]): { label: string; tone: string } {
  if (steps.some((s) => s.status === 'failed')) return { label: 'failed', tone: 'text-semantic-error' };
  if (steps.some((s) => s.status === 'awaiting_user')) return { label: 'needs you', tone: 'text-semantic-warning' };
  if (steps.some((s) => s.status === 'awaiting_external')) return { label: 'waiting', tone: 'text-archive' };
  if (steps.some((s) => s.status === 'running')) return { label: 'running', tone: 'text-bark' };
  if (steps.every((s) => s.status === 'completed' || s.status === 'skipped')) {
    const anyAi = steps.some((s) => hasAiCost(s.effort));
    return { label: anyAi ? `${steps.length} done` : `${steps.length} steps · no AI`, tone: 'text-archive' };
  }
  return { label: 'pending', tone: 'text-archive' };
}

function PhaseGroup({
  group, onDecide, decidePending, approvalsHref, workBase, pinnedStepId,
  onSubmitForm, formPending,
}: {
  group: Group;
  onDecide?: (stepId: string, chosen: string) => void;
  decidePending?: boolean;
  approvalsHref?: string;
  workBase?: string;
  pinnedStepId?: string | null;
  onSubmitForm?: (stepId: string) => void;
  formPending?: boolean;
}) {
  const summary = phaseSummary(group.steps);
  const active = group.steps.some(
    (s) => ['awaiting_user', 'awaiting_external', 'running', 'failed'].includes(s.status),
  );
  // Completed phases collapse by default; the active/failed phase stays open.
  const [open, setOpen] = useState(active);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li className="relative pb-2">
      <span
        className={`absolute -left-[27px] top-0.5 h-3.5 w-3.5 rounded-[3px] ${
          active && summary.label === 'needs you' ? 'bg-semantic-warning' : NODE[group.steps[0]?.status] ?? 'bg-stone'
        }`}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1 text-sm font-medium text-ink">
          <Chevron size={15} className="text-archive" aria-hidden />
          {group.phase}
        </span>
        <span className={`text-xs ${summary.tone}`}>{summary.label}</span>
      </button>
      {open && (
        <ol className="ml-1 mt-2 flex flex-col border-l border-lichen pl-3.5">
          {group.steps.map((step) => (
            <StepRow
              key={step.step_id}
              step={step}
              nested
              onDecide={onDecide}
              decidePending={decidePending}
              approvalsHref={approvalsHref}
              workBase={workBase}
              pinned={step.step_id === pinnedStepId}
              onSubmitForm={onSubmitForm}
              formPending={formPending}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function StepRow({
  step, nested = false, onDecide, decidePending, approvalsHref, workBase,
  pinned = false, onSubmitForm, formPending,
}: {
  step: AgentPlanStepDetail;
  nested?: boolean;
  onDecide?: (stepId: string, chosen: string) => void;
  decidePending?: boolean;
  approvalsHref?: string;
  workBase?: string;
  pinned?: boolean;
  onSubmitForm?: (stepId: string) => void;
  formPending?: boolean;
}) {
  const kind = KIND_GLYPH[step.kind] ?? KIND_GLYPH.tool_call;
  const routing = routingLabel(step);
  const awaitKind = step.wait_for?.kind;
  const isDecision = step.kind === 'decision' && step.status === 'awaiting_user';
  const isApprovalGate =
    step.status === 'awaiting_user'
    && (awaitKind === 'approval_request' || awaitKind === 'draft_approval' || awaitKind === 'form_submission');
  const dotOffset = nested ? '-left-[19px]' : '-left-[27px]';
  // Docked decision gate: stick to the top of the bounded scroll viewport. The
  // opaque bg + z-index occlude the rail scrolling behind; border-b is the
  // "stuck" cue. (Exact left-bleed over the rail is tuned in-browser.)
  const pinClass = pinned
    ? 'sticky top-0 z-20 -mx-2 border-b border-lichen bg-parchment px-2 pt-2'
    : '';

  return (
    <li className={`relative flex gap-2.5 pb-3 ${pinClass} ${step.status === 'skipped' ? 'opacity-60' : ''}`}>
      <span
        className={`${dotOffset} absolute top-1 h-2.5 w-2.5 shrink-0 rounded-full ${NODE[step.status] ?? 'bg-stone'}`}
        aria-hidden
      />
      <kind.Icon size={14} className={`mt-0.5 shrink-0 ${kind.klass}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm text-ink">{step.description}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-archive">
          {routing && <span>{routing}</span>}
          {step.tool && (
            <span className="rounded bg-stone/40 px-1.5 py-0.5 font-mono text-[10px]">{step.tool}</span>
          )}
        </div>

        {step.effort && <EffortLine step={step} />}
        <ResultFact step={step} workBase={workBase} />

        {step.status === 'failed' && step.error && (
          <p className="mt-1 text-[11px] text-semantic-error">{step.error}</p>
        )}

        {isDecision && (
          <DecisionPanel step={step} onDecide={onDecide} pending={decidePending} />
        )}
        {isApprovalGate && (
          <ApprovalPanel
            step={step}
            approvalsHref={approvalsHref}
            onSubmitForm={onSubmitForm}
            formPending={formPending}
          />
        )}
        {step.status === 'awaiting_external' && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-archive">
            <Clock size={11} aria-hidden /> Resumes automatically.
          </p>
        )}
      </div>
    </li>
  );
}

function EffortLine({ step }: { step: AgentPlanStepDetail }) {
  const effort = step.effort!;
  if (!hasAiCost(effort)) {
    if (step.status !== 'completed') return null;
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-archive/70">
        <span className="rounded-full bg-stone/40 px-1.5 py-0.5">no AI cost</span>
      </div>
    );
  }
  const raw = effortRaw(effort);
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 w-12 overflow-hidden rounded-full bg-stone/40"
          title={`effort weight ${(effort.weight ?? 0).toFixed(2)}`}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(6, (effort.weight ?? 0) * 100)}%`, backgroundColor: effortColor(effort.weight ?? 0) }}
          />
        </div>
        <span className="text-[11px] text-archive">{effortLead(effort)}</span>
      </div>
      {raw && <div className="mt-0.5 font-mono text-[10px] text-archive/70">{raw}</div>}
    </div>
  );
}

function ResultFact({ step, workBase }: { step: AgentPlanStepDetail; workBase?: string }) {
  const f = step.result_facts;
  if (!f) return null;
  // A resolved approval gate: "approved · reviewer · time".
  if (f.outcome) {
    const when = relativeTime(step.completed_at);
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-archive">
        <CheckCircle2 size={12} className="text-semantic-success" aria-hidden />
        {f.outcome === 'approved' ? 'approved in Approvals' : f.outcome}
        {when ? ` · ${when}` : ''}
      </div>
    );
  }
  // A produced draft → link to it (entity routing per type is a follow-on).
  if (f.draft_id && workBase) {
    const noun = (f.entity_type ?? 'record').replace(/_/g, ' ');
    return (
      <a
        href={`${workBase}/drafts?draft=${f.draft_id}`}
        className="mt-1 inline-flex items-center gap-1 text-[12px] text-bark hover:text-copper-dark"
      >
        <FileText size={13} aria-hidden /> view {noun} draft
      </a>
    );
  }
  return null;
}

function DecisionPanel({
  step, onDecide, pending,
}: {
  step: AgentPlanStepDetail;
  onDecide?: (stepId: string, chosen: string) => void;
  pending?: boolean;
}) {
  return (
    <div className="mt-1.5 rounded border border-bark/30 bg-bark/5 px-3 py-2">
      <p className="text-[12px] font-medium text-bark">Your move — choose a path</p>
      <p className="mb-2 text-[11px] text-archive">decided here, takes effect now</p>
      <div className="flex flex-wrap gap-2">
        {(step.options ?? []).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onDecide?.(step.step_id, opt.key)}
            disabled={!onDecide || pending}
            className="rounded border border-bark/40 px-3 py-1.5 text-xs font-medium text-bark transition-colors hover:bg-bark/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ApprovalPanel({
  step, approvalsHref, onSubmitForm, formPending,
}: {
  step: AgentPlanStepDetail;
  approvalsHref?: string;
  onSubmitForm?: (stepId: string) => void;
  formPending?: boolean;
}) {
  const isForm = step.wait_for?.kind === 'form_submission';
  const persona = step.persona ? SPECIALIST_LABELS[step.persona] ?? step.persona : null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-l-2 border-semantic-warning bg-semantic-warning/10 px-3 py-2">
      <div>
        <p className="text-[12px] font-medium text-semantic-warning">
          {isForm ? 'Needs a form submitted' : 'Needs approval'}{persona ? ` — ${persona}` : ''}
        </p>
        <p className="text-[11px] text-archive">
          {isForm ? 'mark it done once submitted' : 'you act on the Approvals page, not here'}
        </p>
      </div>
      {isForm ? (
        <button
          type="button"
          onClick={() => onSubmitForm?.(step.step_id)}
          disabled={!onSubmitForm || formPending}
          className="inline-flex items-center gap-1 rounded border border-semantic-warning/50 px-3 py-1.5 text-xs font-medium text-semantic-warning transition-colors hover:bg-semantic-warning/10 disabled:opacity-50"
        >
          <ClipboardCheck size={13} aria-hidden /> Mark form submitted
        </button>
      ) : approvalsHref ? (
        <a
          href={approvalsHref}
          className="inline-flex items-center gap-1 rounded border border-semantic-warning/50 px-3 py-1.5 text-xs font-medium text-semantic-warning transition-colors hover:bg-semantic-warning/10"
        >
          Review in Approvals <ExternalLink size={13} aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
