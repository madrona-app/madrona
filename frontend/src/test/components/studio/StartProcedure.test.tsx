import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StartProcedure } from '../../../components/studio/StartProcedure';
import * as tmplApi from '../../../lib/api/planTemplates';
import * as planApi from '../../../lib/api/agentPlans';

// Guide Studio's entry point is hidden when Guide is unavailable.
const { guideAvailable } = vi.hoisted(() => ({ guideAvailable: { value: true } }));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => guideAvailable.value }),
}));

vi.mock('../../../lib/api/planTemplates');
vi.mock('../../../lib/api/agentPlans');
const listPlanTemplates = vi.mocked(tmplApi.listPlanTemplates);
const createPlanFromTemplate = vi.mocked(tmplApi.createPlanFromTemplate);
const runAgentPlan = vi.mocked(planApi.runAgentPlan);

vi.mock('../../../hooks/useActiveProduct', () => ({
  useActiveProduct: () => ({ activeProductId: 'collections' }),
  workBasePath: (orgId: string) => `/organizations/${orgId}/collections/work`,
}));

const ACQ: tmplApi.PlanTemplate = {
  template_id: 'acquisition_accession',
  title: 'Acquisition & Accessioning',
  goal: 'Propose an acquisition and accession the object.',
  procedure: 'Acquisition',
  nav_item: 'acquisitions',
  params: [
    { key: 'acquisition_method', label: 'Acquisition method', type: 'enum', required: true, enum_options: ['gift', 'purchase'], from_context: false, entity_kind: null, help_text: null },
    { key: 'object_number', label: 'Object number', type: 'text', required: true, enum_options: [], from_context: false, entity_kind: null, help_text: null },
  ],
  steps: [
    { kind: 'tool_call', persona: 'registrar', description: 'Draft the acquisition proposal' },
    { kind: 'await', persona: null, description: 'Board sign-off' },
    { kind: 'tool_call', persona: 'conservator', description: 'Draft the intake condition report' },
  ],
};

function renderSP() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/acquisitions']}>
        <Routes>
          <Route path="/organizations/:orgId/collections/acquisitions" element={<StartProcedure navItem="acquisitions" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPlanTemplates.mockResolvedValue({ templates: [ACQ] });
});

describe('StartProcedure', () => {
  it('opens a dominant launch that previews the plan (steps · agents · sign-offs)', async () => {
    renderSP();
    fireEvent.click(screen.getByRole('button', { name: /start a procedure/i }));
    expect(await screen.findByRole('dialog', { name: /start a studio procedure/i })).toBeInTheDocument();
    // Preview shows the step descriptions + the summary line (await async load).
    expect(await screen.findByText('Draft the acquisition proposal')).toBeInTheDocument();
    expect(screen.getByText(/3 steps · 2 agents · 1 sign-off/)).toBeInTheDocument();
  });

  it('Run is gated on required params, then creates + runs + dissolves to the pill', async () => {
    createPlanFromTemplate.mockResolvedValue({ plan_id: 'p-9' } as never);
    runAgentPlan.mockResolvedValue({ plan_id: 'p-9', status: 'awaiting', halted: true, halt_reason: 'awaiting' } as never);
    renderSP();
    fireEvent.click(screen.getByRole('button', { name: /start a procedure/i }));

    const runBtn = await screen.findByRole('button', { name: /run it/i });
    expect(runBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Acquisition method/i), { target: { value: 'gift' } });
    fireEvent.change(screen.getByLabelText(/Object number/i), { target: { value: '2026.9' } });
    expect(runBtn).toBeEnabled();

    fireEvent.click(runBtn);
    await waitFor(() => expect(createPlanFromTemplate).toHaveBeenCalledWith('org-1', expect.objectContaining({
      template_id: 'acquisition_accession',
      params: { acquisition_method: 'gift', object_number: '2026.9' },
    })));
    await waitFor(() => expect(runAgentPlan).toHaveBeenCalledWith('org-1', 'p-9'));

    // Dissolves IN PLACE to the pulsing Review pill — no navigation.
    const pill = await screen.findByRole('link', { name: /studio drafted your records/i });
    expect(pill).toHaveAttribute('href', '/organizations/org-1/collections/work/plans/p-9');
  });

  it('renders nothing when Guide is unavailable', () => {
    guideAvailable.value = false;
    try {
      renderSP();
      // Not merely hidden: the template query is agent-gated and 503s, which
      // is what produced "Couldn't load procedures" on Collections pages.
      expect(screen.queryByRole('button', { name: /start a procedure/i })).not.toBeInTheDocument();
      expect(listPlanTemplates).not.toHaveBeenCalled();
    } finally {
      guideAvailable.value = true;
    }
  });
});
