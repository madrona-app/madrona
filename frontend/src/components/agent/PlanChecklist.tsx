/**
 * Inline plan checklist rendered in an assistant message when the staff
 * agent invoked make_plan. Shows the goal, ordered steps with status
 * chips, and a Cancel control.
 *
 * Status semantics:
 *   pending           — step hasn't started
 *   running           — executor is on this step right now
 *   completed         — step finished successfully
 *   failed            — step errored; plan halts
 *   awaiting_user     — paused on approval / form submission
 *   awaiting_external — paused on workflow transition (Celery resumes)
 *   skipped           — superseded by an earlier failure or rejection
 *
 * The card is one-shot — it captures the plan as it stood when make_plan
 * returned. Live status updates as the executor runs are out of scope
 * for v1; users can refresh the chat to see the latest persisted state.
 */

import { useMemo, useState } from 'react';
import {
  ListChecks,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  CheckCircle2,
  AlertCircle,
  Hourglass,
  XCircle,
  ArrowRightCircle,
  Play,
  ClipboardCheck,
  ExternalLink,
} from 'lucide-react';
import type { AgentMessageUI } from '../../hooks/useAgentChat';

type PlanHint = AgentMessageUI & { kind: 'plan' };
type StepStatus = PlanHint['steps'][number]['status'];
type PlanStatus = PlanHint['status'];

const SPECIALIST_LABELS: Record<string, string> = {
  registrar: 'Registrar',
  loans_registrar: 'Loans Registrar',
  conservator: 'Conservator',
  rights_specialist: 'Rights Specialist',
  curator: 'Curator',
};

interface StepStyle {
  Icon: typeof Circle;
  label: string;
  iconClass: string;
  rowClass: string;
}

const STEP_STATUS_STYLE: Record<StepStatus, StepStyle> = {
  pending: {
    Icon: Circle,
    label: 'Pending',
    iconClass: 'text-archive',
    rowClass: '',
  },
  running: {
    Icon: CircleDot,
    label: 'Running',
    iconClass: 'text-bark animate-pulse',
    rowClass: '',
  },
  completed: {
    Icon: CheckCircle2,
    label: 'Completed',
    iconClass: 'text-semantic-success',
    rowClass: '',
  },
  failed: {
    Icon: XCircle,
    label: 'Failed',
    iconClass: 'text-semantic-error',
    rowClass: '',
  },
  awaiting_user: {
    Icon: Hourglass,
    label: 'Awaiting user',
    iconClass: 'text-semantic-warning',
    rowClass: '',
  },
  awaiting_external: {
    Icon: Hourglass,
    label: 'Awaiting',
    iconClass: 'text-semantic-warning',
    rowClass: '',
  },
  skipped: {
    Icon: ArrowRightCircle,
    label: 'Skipped',
    iconClass: 'text-archive',
    rowClass: 'opacity-60',
  },
};

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  paused: 'Paused',
  awaiting: 'Awaiting',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** What the run endpoint returns, narrowed to what the card displays. */
export interface PlanRunOutcome {
  status: PlanStatus;
  halt_reason: string | null;
}

interface PlanChecklistProps {
  hint: PlanHint;
  /** Optional cancel handler. Wiring is left to callers (the chat panel
   * owns the API client). When omitted, the cancel button is hidden. */
  onCancel?: (planId: string) => void;
  /** Optional run handler — POSTs to the executor trigger endpoint and
   * resolves with the plan's new persisted state (or throws on failure).
   * When omitted, the Run button is hidden. v1 Phase 0: a plan only ever
   * runs on an explicit user click; nothing auto-executes. The card is
   * one-shot — it shows the outcome the run returned, not live per-step
   * progress (refresh the chat for the latest state). */
  onRunPlan?: (planId: string) => Promise<PlanRunOutcome>;
  /** Optional form-submission handler — POSTs to the step's form-submitted
   * endpoint to resolve a form_submission await and resume the plan. When
   * omitted, the "Mark form submitted" action is hidden. */
  onSubmitForm?: (planId: string, stepId: string) => Promise<PlanRunOutcome>;
  /** Where to send the user to review a pending approval (the Approvals
   * page). When omitted, the approval await shows status text only. */
  approvalsHref?: string;
  /** Hand off to the plan's durable home in the Guide app. When provided, a
   * "View in Plans" link appears; the caller navigates + closes the chat. */
  onOpenInPlans?: (planId: string) => void;
}

export function PlanChecklist({
  hint,
  onCancel,
  onRunPlan,
  onSubmitForm,
  approvalsHref,
  onOpenInPlans,
}: PlanChecklistProps) {
  const [expanded, setExpanded] = useState(true);
  const ToggleIcon = expanded ? ChevronDown : ChevronRight;

  // The card is one-shot. After a successful run we reflect the status
  // the endpoint returned; we don't poll for per-step progress (v1).
  const [displayStatus, setDisplayStatus] = useState<PlanStatus>(hint.status);
  const [runPhase, setRunPhase] =
    useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [formPhase, setFormPhase] =
    useState<'idle' | 'submitting' | 'error'>('idle');

  // The active await on a serial plan is the first await step. We can't see
  // live per-step status (one-shot card), so we target it by order.
  const awaitStep = useMemo(
    () => hint.steps.find((s) => s.kind === 'await' && !!s.wait_for),
    [hint.steps],
  );
  const awaitKind = awaitStep?.wait_for?.kind;
  const showAwaitActions = displayStatus === 'awaiting' && !!awaitStep;

  const planTerminal = useMemo(
    () =>
      displayStatus === 'completed'
        || displayStatus === 'failed'
        || displayStatus === 'cancelled',
    [displayStatus],
  );

  const canRun =
    !!onRunPlan && displayStatus === 'pending' && runPhase !== 'running';

  async function handleRun() {
    if (!onRunPlan) return;
    setRunPhase('running');
    setRunMessage(null);
    try {
      const outcome = await onRunPlan(hint.plan_id);
      setDisplayStatus(outcome.status);
      setRunPhase('done');
      if (outcome.halt_reason === 'awaiting') {
        setRunMessage('Plan paused — waiting on an approval or transition.');
      } else if (outcome.status === 'failed') {
        setRunMessage('Plan stopped on a failed step.');
      } else if (outcome.status === 'completed') {
        setRunMessage('Plan completed.');
      } else {
        setRunMessage(null);
      }
    } catch {
      setRunPhase('error');
      setRunMessage('Could not start the plan. Try again.');
    }
  }

  async function handleSubmitForm(stepId: string) {
    if (!onSubmitForm) return;
    setFormPhase('submitting');
    setRunMessage(null);
    try {
      const outcome = await onSubmitForm(hint.plan_id, stepId);
      setDisplayStatus(outcome.status);
      setFormPhase('idle');
      if (outcome.status === 'completed') {
        setRunMessage('Form recorded — plan completed.');
      } else if (outcome.halt_reason === 'awaiting') {
        setRunMessage('Form recorded — plan paused on the next step.');
      } else if (outcome.status === 'failed') {
        setRunMessage('Plan stopped on a failed step.');
      } else {
        setRunMessage('Form recorded.');
      }
    } catch {
      setFormPhase('error');
      setRunMessage('Could not record the form submission. Try again.');
    }
  }

  return (
    <div
      className="mt-2 rounded-md border border-lichen bg-parchment"
      data-testid="plan-checklist"
      data-plan-id={hint.plan_id}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-bark/5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30"
        aria-expanded={expanded}
      >
        <ListChecks size={14} className="text-bark shrink-0" aria-hidden />
        <span className="font-medium text-ink">Plan</span>
        <span className="text-archive truncate">{hint.goal}</span>
        <span className="ml-auto flex items-center gap-2 text-archive shrink-0">
          <span className="text-[10px] uppercase tracking-wide">
            {hint.steps.length} {hint.steps.length === 1 ? 'step' : 'steps'}
          </span>
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone/50 text-ink"
          >
            {PLAN_STATUS_LABEL[displayStatus] ?? displayStatus}
          </span>
          <ToggleIcon size={12} aria-hidden />
        </span>
      </button>

      {expanded && (
        <>
          {hint.steps.length === 0 ? (
            <div className="px-3 pb-3 text-xs text-archive italic">
              The planner returned no steps. The goal may need clarification.
            </div>
          ) : (
            <ol className="px-3 pb-2">
              {hint.steps.map((step) => {
                const style = STEP_STATUS_STYLE[step.status]
                  ?? STEP_STATUS_STYLE.pending;
                const { Icon } = style;
                const personaLabel = step.persona
                  ? (SPECIALIST_LABELS[step.persona] ?? step.persona)
                  : null;
                return (
                  <li
                    key={step.step_id}
                    className={`flex items-start gap-2 py-1.5 text-sm text-ink ${style.rowClass}`}
                  >
                    <Icon
                      size={14}
                      className={`mt-0.5 shrink-0 ${style.iconClass}`}
                      aria-hidden
                    />
                    <span className="text-archive font-mono text-[10px] mt-1 shrink-0 w-4">
                      {step.idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="break-words">{step.description}</div>
                      {(personaLabel || step.tool) && (
                        <div className="text-[11px] text-archive mt-0.5 flex items-center gap-2 flex-wrap">
                          {personaLabel && (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-medium">to:</span>
                              <span>{personaLabel}</span>
                            </span>
                          )}
                          {step.tool && (
                            <span className="font-mono text-[10px] bg-stone/40 px-1.5 py-0.5 rounded">
                              {step.tool}
                            </span>
                          )}
                          <span
                            className="text-[10px] uppercase tracking-wide ml-auto"
                            title={style.label}
                          >
                            {style.label}
                          </span>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {((onRunPlan && displayStatus === 'pending')
            || showAwaitActions
            || runMessage
            || onOpenInPlans
            || (onCancel && !planTerminal)) && (
            <div className="px-3 pb-3 pt-1 border-t border-lichen flex items-center gap-2 flex-wrap">
              {onOpenInPlans && (
                <button
                  type="button"
                  onClick={() => onOpenInPlans(hint.plan_id)}
                  className="inline-flex items-center gap-1 text-[11px] text-bark hover:text-copper-dark"
                  title="Manage this plan in the Guide app"
                >
                  <ExternalLink size={11} aria-hidden />
                  View in Plans
                </button>
              )}
              {runMessage && (
                <span
                  className={`text-[11px] ${
                    runPhase === 'error'
                      ? 'text-semantic-error'
                      : 'text-archive'
                  }`}
                >
                  {runMessage}
                </span>
              )}
              {showAwaitActions && awaitKind === 'workflow_transition' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-semantic-warning">
                  <Hourglass size={12} aria-hidden />
                  Waiting on a workflow change — resumes automatically.
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {showAwaitActions && awaitKind === 'approval_request' && (
                  approvalsHref ? (
                    <a
                      href={approvalsHref}
                      className="inline-flex items-center gap-1 text-xs bg-bark text-parchment rounded px-2.5 py-1 hover:bg-copper-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                      title="Review in Approvals"
                    >
                      <ExternalLink size={12} aria-hidden />
                      Review in Approvals
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-semantic-warning">
                      <Hourglass size={12} aria-hidden />
                      Waiting on an approval.
                    </span>
                  )
                )}
                {showAwaitActions
                  && awaitKind === 'form_submission'
                  && onSubmitForm
                  && awaitStep && (
                  <button
                    type="button"
                    onClick={() => handleSubmitForm(awaitStep.step_id)}
                    disabled={formPhase === 'submitting'}
                    className="inline-flex items-center gap-1 text-xs bg-bark text-parchment rounded px-2.5 py-1 hover:bg-copper-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    title="Mark the form as submitted to resume the plan"
                  >
                    <ClipboardCheck size={12} aria-hidden />
                    {formPhase === 'submitting' ? 'Recording…' : 'Mark form submitted'}
                  </button>
                )}
                {onRunPlan && displayStatus === 'pending' && (
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={!canRun}
                    className="inline-flex items-center gap-1 text-xs bg-bark text-parchment rounded px-2.5 py-1 hover:bg-copper-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    title="Run plan"
                  >
                    <Play size={12} aria-hidden />
                    {runPhase === 'running' ? 'Starting…' : 'Run plan'}
                  </button>
                )}
                {onCancel && !planTerminal && (
                  <button
                    type="button"
                    onClick={() => onCancel(hint.plan_id)}
                    className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark border border-lichen rounded px-2 py-1 hover:border-bark/30 transition-colors"
                    title="Cancel plan"
                  >
                    <AlertCircle size={12} aria-hidden />
                    Cancel plan
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
