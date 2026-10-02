import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanDetailPage from '../../pages/work/PlanDetailPage';
import * as api from '../../lib/api/agentPlans';

vi.mock('../../lib/api/agentPlans');
const getAgentPlan = vi.mocked(api.getAgentPlan);
const runAgentPlan = vi.mocked(api.runAgentPlan);
const decideAgentPlanStep = vi.mocked(api.decideAgentPlanStep);
const submitAgentPlanForm = vi.mocked(api.submitAgentPlanForm);

const outcome: api.AgentPlanRunOutcome = {
  plan_id: 'p1', status: 'completed', halted: false, halt_reason: null,
  steps_executed: 1, last_error: null,
};

function detail(over: Partial<api.AgentPlanDetail> = {}): api.AgentPlanDetail {
  return {
    plan_id: 'p1', conversation_id: 'c1', goal: 'Process a gift', status: 'awaiting',
    step_count: 1, last_error: null, created_at: null, updated_at: null,
    started_at: null, completed_at: null, awaits_user: false, awaiting_kind: null,
    awaiting_step_id: null, steps: [], ...over,
  };
}

function step(over: Partial<api.AgentPlanStepDetail>): api.AgentPlanStepDetail {
  return { step_id: 's', idx: 0, kind: 'tool_call', description: 'x', status: 'pending', ...over } as api.AgentPlanStepDetail;
}

function renderDetail() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/work/plans/p1']}>
        <Routes>
          <Route path="/organizations/:orgId/collections/work/plans/:planId" element={<PlanDetailPage />} />
          <Route path="/organizations/:orgId/collections/work/plans" element={<div data-testid="inbox" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

beforeEach(() => vi.clearAllMocks());

describe('PlanDetailPage', () => {
  it('renders the plan goal + timeline', async () => {
    getAgentPlan.mockResolvedValue(detail({
      steps: [step({ description: 'Draft the acquisition', status: 'completed' })],
    }));
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Process a gift' })).toBeInTheDocument();
    expect(screen.getByText('Draft the acquisition')).toBeInTheDocument();
  });

  it('runs a pending plan', async () => {
    getAgentPlan.mockResolvedValue(detail({ status: 'pending', steps: [step({})] }));
    runAgentPlan.mockResolvedValue({ ...outcome, status: 'awaiting' });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(runAgentPlan).toHaveBeenCalledWith('org-1', 'p1'));
  });

  it('resolves a decision gate in place', async () => {
    getAgentPlan.mockResolvedValue(detail({
      status: 'awaiting', awaits_user: true, awaiting_kind: 'decision', awaiting_step_id: 'd',
      steps: [step({ step_id: 'd', kind: 'decision', status: 'awaiting_user', description: 'Keep or return?',
        options: [{ key: 'keep', label: 'Keep' }, { key: 'return', label: 'Return' }] })],
    }));
    decideAgentPlanStep.mockResolvedValue(outcome);
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(decideAgentPlanStep).toHaveBeenCalledWith('org-1', 'p1', 'd', 'keep'));
  });

  it('marks a form gate submitted (in-app action)', async () => {
    getAgentPlan.mockResolvedValue(detail({
      status: 'awaiting', awaits_user: true, awaiting_kind: 'form_submission', awaiting_step_id: 'f',
      steps: [step({ step_id: 'f', kind: 'await', status: 'awaiting_user',
        description: 'Submit the form', wait_for: { kind: 'form_submission' } })],
    }));
    submitAgentPlanForm.mockResolvedValue(outcome);
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /mark form submitted/i }));
    await waitFor(() => expect(submitAgentPlanForm).toHaveBeenCalledWith('org-1', 'p1', 'f'));
  });

  it('links an approval gate out to Approvals (no in-place action)', async () => {
    getAgentPlan.mockResolvedValue(detail({
      status: 'awaiting', awaits_user: true, awaiting_kind: 'approval_request', awaiting_step_id: 'a',
      steps: [step({ step_id: 'a', kind: 'await', status: 'awaiting_user',
        description: 'Final approval', wait_for: { kind: 'approval_request' } })],
    }));
    renderDetail();
    const link = await screen.findByRole('link', { name: /Review in Approvals/ });
    expect(link).toHaveAttribute('href', '/organizations/org-1/collections/work/approvals');
  });

  it('cross-surface: a plan resolved elsewhere advances on the next fetch', async () => {
    // Awaiting first (gate shown), then completed (e.g. approved on the Approvals page).
    getAgentPlan
      .mockResolvedValueOnce(detail({
        status: 'awaiting', awaits_user: true, awaiting_kind: 'approval_request', awaiting_step_id: 'a',
        steps: [step({ step_id: 'a', kind: 'await', status: 'awaiting_user',
          description: 'Final approval', wait_for: { kind: 'approval_request' } })],
      }))
      .mockResolvedValue(detail({
        status: 'completed',
        steps: [step({ step_id: 'a', kind: 'await', status: 'completed', description: 'Final approval' })],
      }));
    const { qc } = renderDetail();
    expect(await screen.findByText(/Needs approval/)).toBeInTheDocument();
    // Simulate the next poll fetching the now-resolved plan.
    await qc.refetchQueries({ queryKey: ['agent-plan', 'org-1', 'p1'] });
    await waitFor(() => expect(screen.getByText(/All steps complete/)).toBeInTheDocument());
    expect(screen.queryByText(/Needs approval/)).not.toBeInTheDocument();
  });
});
