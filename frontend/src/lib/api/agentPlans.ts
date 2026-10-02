import { apiFetch } from './_utils';

export type PlanStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'awaiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WaitKind =
  | 'approval_request'
  | 'form_submission'
  | 'workflow_transition'
  | 'job_completion'
  // Draft-chaining: the plan parks until a draft proposed by an earlier step
  // is approved and applied. The backend has emitted this since the
  // draft-chaining engine shipped (see AWAIT_KINDS in agent_plan_service.py);
  // this union never learned it, so PlanTimeline's approval-gate check was
  // comparing against a value TypeScript knew to be impossible and the gate
  // never rendered for a draft approval.
  | 'draft_approval';

/** §2A per-step effort telemetry. Fields are null when not measured — a
 * deterministic tool_call has no LLM cost (honest null, never a fake 0). */
export interface StepEffort {
  input_tokens: number | null;
  output_tokens: number | null;
  llm_rounds: number | null;
  tool_calls: number | null;
  latency_ms: number | null;
  delegation_depth: number | null;
  cost_estimate_usd: number | null;
  raw_effort: number | null;
  /** Normalized within the plan (0–1): where the AI worked hardest. */
  weight: number;
  model_id: string | null;
  attempt: number;
}

/** §2E plan-wide effort rollup for the summary header. */
export interface PlanEffortSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_llm_rounds: number;
  total_tool_calls: number;
  total_latency_ms: number;
  specialist_steps: number;
  cost_estimate_usd: number | null;
}

/** A selectable option on a `decision` (branch) step. */
export interface DecisionOption {
  key: string;
  label: string;
}

/** Curated, link-able facts a step produced — the BE emits facts, the FE owns
 * routing (entity workspace if applied_entity_id, else the draft). Self-heals
 * across polls as a draft is applied. */
export interface StepResultFacts {
  draft_id?: string;
  entity_type?: string;
  applied_entity_id?: string;
  draft_status?: string;
  outcome?: string;       // approval/draft_approval await outcome
  reviewed_by?: string;
  chosen?: string;        // decision branch chosen
}

export interface AgentPlanStepDetail {
  step_id: string;
  idx: number;
  kind: 'tool_call' | 'delegate' | 'await' | 'decision';
  description: string;
  tool?: string | null;
  persona?: string | null;
  status: string;
  wait_for?: { kind?: WaitKind; [k: string]: unknown } | null;
  error?: string | null;
  /** Branch-group key this step belongs to (null = unconditional). */
  branch?: string | null;
  /** Phase-group label (null = ungrouped → flat rail). Template-authored only. */
  phase?: string | null;
  /** A decision step's selectable branches (null otherwise). */
  options?: DecisionOption[] | null;
  /** Absolute ISO timestamps; render relative time client-side so it stays fresh. */
  started_at?: string | null;
  completed_at?: string | null;
  /** Link-able facts (artifact produced, gate outcome). Null until there's something. */
  result_facts?: StepResultFacts | null;
  /** Null until the step has run; awaits never carry it. */
  effort?: StepEffort | null;
}

export interface AgentPlanSummary {
  plan_id: string;
  conversation_id: string;
  goal: string;
  status: PlanStatus;
  step_count: number;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** A step is parked on this user (approval/form). Drives the "needs you" badge. */
  awaits_user: boolean;
  awaiting_kind: WaitKind | 'decision' | null;
  awaiting_step_id: string | null;
}

export interface AgentPlanDetail extends AgentPlanSummary {
  steps: AgentPlanStepDetail[];
  effort_summary?: PlanEffortSummary;
}

export interface AgentPlanRunOutcome {
  plan_id: string;
  status: PlanStatus;
  halted: boolean;
  halt_reason: string | null;
  steps_executed: number;
  last_error: string | null;
}

export async function listAgentPlans(
  orgId: string,
  status?: PlanStatus,
): Promise<{ plans: AgentPlanSummary[] }> {
  const q = status ? `?status=${status}` : '';
  return apiFetch(`/organizations/${orgId}/agent/plans${q}`);
}

/** Count of the user's plans awaiting their action (decision/approval/form). */
export async function getAgentPlanAwaitingCount(
  orgId: string,
): Promise<{ count: number }> {
  return apiFetch(`/organizations/${orgId}/agent/plans/count`);
}

export async function getAgentPlan(
  orgId: string,
  planId: string,
): Promise<AgentPlanDetail> {
  return apiFetch(`/organizations/${orgId}/agent/plans/${planId}`);
}

export async function runAgentPlan(
  orgId: string,
  planId: string,
): Promise<AgentPlanRunOutcome> {
  return apiFetch(`/organizations/${orgId}/agent/plans/${planId}/run`, {
    method: 'POST',
  });
}

export async function submitAgentPlanForm(
  orgId: string,
  planId: string,
  stepId: string,
): Promise<AgentPlanRunOutcome> {
  return apiFetch(
    `/organizations/${orgId}/agent/plans/${planId}/steps/${stepId}/form-submitted`,
    { method: 'POST' },
  );
}

/** Resolve a `decision` (branch) step: the chosen key selects a path and the
 * other branches are skipped, then the plan resumes. */
export async function decideAgentPlanStep(
  orgId: string,
  planId: string,
  stepId: string,
  chosen: string,
): Promise<AgentPlanRunOutcome> {
  return apiFetch(
    `/organizations/${orgId}/agent/plans/${planId}/steps/${stepId}/decide`,
    { method: 'POST', body: JSON.stringify({ chosen }) },
  );
}
