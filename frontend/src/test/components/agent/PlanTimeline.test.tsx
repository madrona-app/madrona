import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanTimeline } from '../../../components/agent/PlanTimeline';
import type {
  AgentPlanDetail, AgentPlanStepDetail, StepEffort,
} from '../../../lib/api/agentPlans';

function effort(p: Partial<StepEffort>): StepEffort {
  return {
    input_tokens: null, output_tokens: null, llm_rounds: null, tool_calls: null,
    latency_ms: null, delegation_depth: null, cost_estimate_usd: null,
    raw_effort: null, weight: 0, model_id: null, attempt: 1, ...p,
  };
}

function step(p: Partial<AgentPlanStepDetail>): AgentPlanStepDetail {
  return {
    step_id: p.step_id ?? 's', idx: p.idx ?? 0, kind: p.kind ?? 'tool_call',
    description: p.description ?? 'step', status: p.status ?? 'pending', ...p,
  } as AgentPlanStepDetail;
}

function detail(steps: AgentPlanStepDetail[], over: Partial<AgentPlanDetail> = {}): AgentPlanDetail {
  return {
    plan_id: 'p1', conversation_id: 'c1', goal: 'Process a gift',
    status: 'running', step_count: steps.length, last_error: null,
    created_at: null, updated_at: null, started_at: null, completed_at: null,
    awaits_user: false, awaiting_kind: null, awaiting_step_id: null,
    steps,
    effort_summary: {
      total_input_tokens: 1500, total_output_tokens: 300, total_tokens: 1800,
      total_llm_rounds: 2, total_tool_calls: 6, total_latency_ms: 4200,
      specialist_steps: 1, cost_estimate_usd: 0.03,
    },
    ...over,
  };
}

describe('PlanTimeline §4', () => {
  it('demotes effort to a plain bucket + time, with raw tokens muted', () => {
    render(<PlanTimeline detail={detail([
      step({ step_id: 'd', idx: 0, kind: 'delegate', description: 'Ask conservator',
        status: 'completed', persona: 'conservator',
        effort: effort({ input_tokens: 1500, output_tokens: 300, llm_rounds: 2, latency_ms: 4200, weight: 0.5 }) }),
    ])} />);
    expect(screen.getByText(/moderate effort · 4\.2s/)).toBeInTheDocument();
    expect(screen.getByText(/1\.8k tok/)).toBeInTheDocument();   // raw, demoted
  });

  it('shows a "no AI cost" chip for a deterministic completed tool_call', () => {
    render(<PlanTimeline detail={detail([
      step({ step_id: 's', kind: 'tool_call', status: 'completed', persona: 'registrar',
        effort: effort({ tool_calls: 1, weight: 0 }) }),
    ])} />);
    expect(screen.getByText(/no AI cost/)).toBeInTheDocument();
  });

  it('labels routing as "AI → Registrar"', () => {
    render(<PlanTimeline detail={detail([
      step({ kind: 'tool_call', status: 'completed', persona: 'registrar' }),
    ])} />);
    expect(screen.getByText('AI → Registrar')).toBeInTheDocument();
  });

  it('renders the DECISION gate (coral, act-in-place) and fires onDecide', () => {
    const onDecide = vi.fn();
    render(<PlanTimeline onDecide={onDecide} detail={detail(
      [step({ step_id: 'dec', kind: 'decision', description: 'Keep or return?',
        status: 'awaiting_user',
        options: [{ key: 'keep', label: 'Keep' }, { key: 'return', label: 'Return' }] })],
      { awaits_user: true, awaiting_kind: 'decision', awaiting_step_id: 'dec', status: 'awaiting' },
    )} />);
    expect(screen.getByText(/choose a path/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(onDecide).toHaveBeenCalledWith('dec', 'return');
  });

  it('renders the APPROVAL gate (amber, links out to Approvals)', () => {
    render(<PlanTimeline approvalsHref="/x/approvals" detail={detail(
      [step({ step_id: 'a', kind: 'await', description: 'Final accession approval',
        status: 'awaiting_user', persona: 'registrar',
        wait_for: { kind: 'approval_request' } })],
      { awaits_user: true, awaiting_kind: 'approval_request', awaiting_step_id: 'a', status: 'awaiting' },
    )} />);
    expect(screen.getByText(/Needs approval/)).toBeInTheDocument();
    expect(screen.getByText(/act on the Approvals page/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Review in Approvals/ });
    expect(link).toHaveAttribute('href', '/x/approvals');
  });

  it('groups into collapsible phases; completed collapsed, active expanded', () => {
    render(<PlanTimeline detail={detail([
      step({ step_id: 'r1', idx: 0, phase: 'Receipt', status: 'completed', description: 'Log entry' }),
      step({ step_id: 'd1', idx: 1, phase: 'Decision', kind: 'decision', status: 'awaiting_user',
        description: 'Keep or return?', options: [{ key: 'keep', label: 'Keep' }, { key: 'r', label: 'Return' }] }),
    ], { awaits_user: true, awaiting_kind: 'decision', awaiting_step_id: 'd1', status: 'awaiting' })} />);
    // Receipt header present but its step collapsed (completed phase defaults closed).
    expect(screen.getByText('Receipt')).toBeInTheDocument();
    expect(screen.queryByText('Log entry')).not.toBeInTheDocument();
    // Active Decision phase open → its content visible.
    expect(screen.getByText(/choose a path/)).toBeInTheDocument();
    // Expanding Receipt reveals its step.
    fireEvent.click(screen.getByText('Receipt'));
    expect(screen.getByText('Log entry')).toBeInTheDocument();
  });

  it('collapses a not-taken branch to one line', () => {
    render(<PlanTimeline detail={detail([
      step({ step_id: 'd', kind: 'decision', status: 'completed',
        options: [{ key: 'keep', label: 'Keep' }, { key: 'return', label: 'Return' }] }),
      step({ step_id: 'x', idx: 1, status: 'skipped', branch: 'return', description: 'Object exit' }),
    ])} />);
    expect(screen.getByText(/Alternate path — 1 step, not taken/)).toBeInTheDocument();
    expect(screen.queryByText('Object exit')).not.toBeInTheDocument();
  });

  it('links to a produced draft artifact', () => {
    render(<PlanTimeline workBase="/organizations/org9/collections/work" detail={detail([
      step({ kind: 'tool_call', status: 'completed', persona: 'conservator',
        result_facts: { draft_id: 'dr1', entity_type: 'condition_report' } }),
    ])} />);
    const link = screen.getByRole('link', { name: /view condition report draft/ });
    expect(link).toHaveAttribute('href', '/organizations/org9/collections/work/drafts?draft=dr1');
  });

  it('shows "approved in Approvals" for a resolved approval', () => {
    render(<PlanTimeline detail={detail([
      step({ kind: 'await', status: 'completed', completed_at: new Date(Date.now() - 7200000).toISOString(),
        result_facts: { outcome: 'approved', reviewed_by: 'u1' } }),
    ])} />);
    expect(screen.getByText(/approved in Approvals · 2h ago/)).toBeInTheDocument();
  });

  it('header shows a distinct error state for a failed plan', () => {
    render(<PlanTimeline detail={detail(
      [step({ status: 'failed', error: 'boom' })],
      { status: 'failed', last_error: 'tool exploded' },
    )} />);
    expect(screen.getByText(/This plan failed/)).toBeInTheDocument();
    expect(screen.getByText(/tool exploded/)).toBeInTheDocument();
  });

  it('header demotes token/cost behind a details toggle', () => {
    render(<PlanTimeline detail={detail([
      step({ kind: 'tool_call', status: 'completed' }),
    ])} />);
    // Lead shows work done, not tokens.
    expect(screen.getByText(/6 tool calls/)).toBeInTheDocument();
    expect(screen.queryByText(/1\.8k tok/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /details/ }));
    expect(screen.getByText(/1\.8k tok/)).toBeInTheDocument();
  });
});
