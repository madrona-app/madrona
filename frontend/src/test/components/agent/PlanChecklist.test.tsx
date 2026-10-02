import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanChecklist } from '../../../components/agent/PlanChecklist';
import type { AgentMessageUI } from '../../../hooks/useAgentChat';

type PlanHint = AgentMessageUI & { kind: 'plan' };

function makeHint(overrides: Partial<PlanHint> = {}): PlanHint {
  return {
    kind: 'plan',
    plan_id: 'plan-1',
    goal: 'Receive incoming Calder loan',
    status: 'pending',
    steps: [
      {
        step_id: 'step-1',
        idx: 0,
        kind: 'tool_call',
        description: 'Pull the incoming-loan playbook',
        status: 'pending',
        tool: 'lookup_playbook',
        persona: null,
      },
      {
        step_id: 'step-2',
        idx: 1,
        kind: 'delegate',
        description: 'Confirm facility report with loans registrar',
        status: 'pending',
        tool: 'delegate_to_specialist',
        persona: 'loans_registrar',
      },
      {
        step_id: 'step-3',
        idx: 2,
        kind: 'await',
        description: 'Wait for registrar approval',
        status: 'pending',
        tool: null,
        persona: null,
      },
    ],
    ...overrides,
  };
}

describe('PlanChecklist', () => {
  it('renders the goal and step count chip', () => {
    render(<PlanChecklist hint={makeHint()} />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText(/Receive incoming Calder loan/)).toBeInTheDocument();
    expect(screen.getByText('3 steps')).toBeInTheDocument();
  });

  it('singularizes the step chip when there is one step', () => {
    render(
      <PlanChecklist
        hint={makeHint({
          steps: [
            {
              step_id: 'step-1',
              idx: 0,
              kind: 'tool_call',
              description: 'Look up playbook',
              status: 'pending',
              tool: 'lookup_playbook',
              persona: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('1 step')).toBeInTheDocument();
  });

  it('renders the persona label for delegate steps', () => {
    render(<PlanChecklist hint={makeHint()} />);
    expect(screen.getByText('Loans Registrar')).toBeInTheDocument();
  });

  it('renders the tool name in monospace for tool_call steps', () => {
    render(<PlanChecklist hint={makeHint()} />);
    expect(screen.getByText('lookup_playbook')).toBeInTheDocument();
  });

  it('shows the plan-level status pill', () => {
    render(<PlanChecklist hint={makeHint({ status: 'awaiting' })} />);
    expect(screen.getByText('Awaiting')).toBeInTheDocument();
  });

  it('renders all step descriptions', () => {
    render(<PlanChecklist hint={makeHint()} />);
    expect(screen.getByText('Pull the incoming-loan playbook')).toBeInTheDocument();
    expect(
      screen.getByText('Confirm facility report with loans registrar'),
    ).toBeInTheDocument();
    expect(screen.getByText('Wait for registrar approval')).toBeInTheDocument();
  });

  it('reflects step status in visible chips', () => {
    render(
      <PlanChecklist
        hint={makeHint({
          status: 'running',
          steps: [
            { step_id: 's1', idx: 0, kind: 'tool_call', description: 'A',
              status: 'completed', tool: 'lookup_playbook', persona: null },
            { step_id: 's2', idx: 1, kind: 'tool_call', description: 'B',
              status: 'running', tool: 'search_collection', persona: null },
            { step_id: 's3', idx: 2, kind: 'tool_call', description: 'C',
              status: 'pending', tool: 'search_collection', persona: null },
          ],
        })}
      />,
    );
    // Chips appear because both tool and step status are present.
    // 'Running' appears twice: once on the plan-level status pill and
    // once on the in-progress step's status chip.
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('hides the cancel button when no onCancel handler is provided', () => {
    render(<PlanChecklist hint={makeHint()} />);
    expect(screen.queryByRole('button', { name: /cancel plan/i })).not.toBeInTheDocument();
  });

  it('shows cancel and fires the handler when provided on a non-terminal plan', () => {
    const onCancel = vi.fn();
    render(<PlanChecklist hint={makeHint()} onCancel={onCancel} />);
    const btn = screen.getByRole('button', { name: /cancel plan/i });
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledWith('plan-1');
  });

  it('hides cancel on terminal plans (completed/failed/cancelled)', () => {
    const onCancel = vi.fn();
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const { unmount } = render(
        <PlanChecklist hint={makeHint({ status })} onCancel={onCancel} />,
      );
      expect(screen.queryByRole('button', { name: /cancel plan/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('collapses and expands when the header is clicked', () => {
    render(<PlanChecklist hint={makeHint()} />);
    expect(screen.getByText('Pull the incoming-loan playbook')).toBeInTheDocument();
    const header = screen.getByRole('button', { name: /Plan/ });
    fireEvent.click(header);
    expect(
      screen.queryByText('Pull the incoming-loan playbook'),
    ).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('Pull the incoming-loan playbook')).toBeInTheDocument();
  });

  it('renders empty-state copy when the planner returns zero steps', () => {
    render(<PlanChecklist hint={makeHint({ steps: [] })} />);
    expect(
      screen.getByText(/planner returned no steps/i),
    ).toBeInTheDocument();
  });

  it('falls back to the raw persona key when unknown', () => {
    render(
      <PlanChecklist
        hint={makeHint({
          steps: [
            {
              step_id: 's1',
              idx: 0,
              kind: 'delegate',
              description: 'Delegate to wizard',
              status: 'pending',
              tool: 'delegate_to_specialist',
              persona: 'wizard',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('wizard')).toBeInTheDocument();
  });
});

describe('PlanChecklist await actions', () => {
  function awaitingHint(waitFor: Record<string, unknown>): PlanHint {
    return makeHint({
      status: 'awaiting',
      steps: [
        {
          step_id: 'await-step',
          idx: 0,
          kind: 'await',
          description: 'Wait for the user',
          status: 'awaiting_user',
          tool: null,
          persona: null,
          wait_for: waitFor as PlanHint['steps'][number]['wait_for'],
        },
      ],
    });
  }

  it('shows "Mark form submitted" for a form_submission await and calls onSubmitForm', async () => {
    const onSubmitForm = vi
      .fn()
      .mockResolvedValue({ status: 'completed', halt_reason: null });
    render(
      <PlanChecklist
        hint={awaitingHint({ kind: 'form_submission', form: 'condition_report' })}
        onSubmitForm={onSubmitForm}
      />,
    );
    const btn = screen.getByRole('button', { name: /mark form submitted/i });
    fireEvent.click(btn);
    expect(onSubmitForm).toHaveBeenCalledWith('plan-1', 'await-step');
    expect(await screen.findByText(/plan completed/i)).toBeInTheDocument();
  });

  it('shows a "Review in Approvals" link for an approval_request await', () => {
    render(
      <PlanChecklist
        hint={awaitingHint({ kind: 'approval_request', request_id: 'req-1' })}
        approvalsHref="/organizations/org-1/collections/work/approvals"
      />,
    );
    const link = screen.getByRole('link', { name: /review in approvals/i });
    expect(link).toHaveAttribute(
      'href',
      '/organizations/org-1/collections/work/approvals',
    );
  });

  it('shows auto-resume text for a workflow_transition await and no button', () => {
    render(
      <PlanChecklist
        hint={awaitingHint({ kind: 'workflow_transition', entity: 'loan_in' })}
        onSubmitForm={vi.fn()}
      />,
    );
    expect(screen.getByText(/resumes automatically/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mark form submitted/i }),
    ).not.toBeInTheDocument();
  });

  it('shows "View in Plans" and calls onOpenInPlans with the plan id', () => {
    const onOpenInPlans = vi.fn();
    render(
      <PlanChecklist
        hint={awaitingHint({ kind: 'workflow_transition', entity: 'loan_in' })}
        onOpenInPlans={onOpenInPlans}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /view in plans/i }));
    expect(onOpenInPlans).toHaveBeenCalledWith('plan-1');
  });

  it('hides the form action when the plan is not awaiting', () => {
    render(
      <PlanChecklist
        hint={{
          ...awaitingHint({ kind: 'form_submission', form: 'x' }),
          status: 'pending',
        }}
        onSubmitForm={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /mark form submitted/i }),
    ).not.toBeInTheDocument();
  });
});
