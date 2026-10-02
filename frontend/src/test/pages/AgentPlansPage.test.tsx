import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentPlansPage from '../../pages/work/AgentPlansPage';
import * as api from '../../lib/api/agentPlans';

// These pages embed StartProcedure, which reads app access to hide
// itself when Guide is unavailable. useAuth throws without a provider.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => true }),
}));

vi.mock('../../lib/api/agentPlans');

const listAgentPlans = vi.mocked(api.listAgentPlans);

function renderPage(entry = '/organizations/org-1/collections/work/plans') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/organizations/:orgId/collections/work/plans" element={<AgentPlansPage />} />
          <Route
            path="/organizations/:orgId/collections/work/plans/:planId"
            element={<div data-testid="detail-stub" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function summary(over: Partial<api.AgentPlanSummary> = {}): api.AgentPlanSummary {
  return {
    plan_id: 'p1', conversation_id: 'c1', goal: 'Test goal', status: 'awaiting',
    step_count: 2, last_error: null, created_at: '2026-05-22T10:00:00Z',
    updated_at: null, started_at: null, completed_at: null,
    awaits_user: true, awaiting_kind: 'decision', awaiting_step_id: 'step-9', ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('AgentPlansPage (inbox)', () => {
  it("lists the user's plans", async () => {
    listAgentPlans.mockResolvedValue({ plans: [summary({ goal: 'Receive the Calder loan' })] });
    renderPage();
    expect(await screen.findByText('Receive the Calder loan')).toBeInTheDocument();
  });

  it('each row links to the plan-detail surface (no inline expand)', async () => {
    listAgentPlans.mockResolvedValue({ plans: [summary({ goal: 'Receive the Calder loan' })] });
    renderPage();
    const link = await screen.findByRole('link', { name: /Receive the Calder loan/ });
    expect(link).toHaveAttribute('href', '/organizations/org-1/collections/work/plans/p1');
  });

  it('redirects an old ?plan= deep-link to the detail route', async () => {
    listAgentPlans.mockResolvedValue({ plans: [summary()] });
    renderPage('/organizations/org-1/collections/work/plans?plan=p1');
    expect(await screen.findByTestId('detail-stub')).toBeInTheDocument();
  });

  it('shows an empty state when nothing needs the user', async () => {
    listAgentPlans.mockResolvedValue({
      plans: [summary({ status: 'completed', awaits_user: false, awaiting_kind: null, awaiting_step_id: null })],
    });
    renderPage();
    expect(await screen.findByText(/nothing is waiting on you/i)).toBeInTheDocument();
  });
});
