import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DraftsInboxPage from '../../pages/work/DraftsInboxPage';
import * as api from '../../lib/api/drafts';

vi.mock('../../lib/api/drafts');

// Controllable permission gate (collections.create → canAct).
let canActMock = true;
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => canActMock }),
}));

const listDrafts = vi.mocked(api.listDrafts);
const approveDraft = vi.mocked(api.approveDraft);
const getDraftFormSchema = vi.mocked(api.getDraftFormSchema);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/work/drafts`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/work/drafts"
            element={<DraftsInboxPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function draft(over: Partial<api.AgentDraft> = {}): api.AgentDraft {
  return {
    draft_id: 'd1',
    entity_type: 'condition_report',
    intended_action: 'create',
    status: 'pending',
    payload: { object_id: 'obj-1', report_type: 'conservation' },
    rationale: 'surface stable',
    citations: null,
    target_entity_id: null,
    proposed_by_user_id: 'u1',
    proposed_by_persona: 'conservator',
    plan_id: null,
    plan_step_id: null,
    conversation_id: null,
    approval_request_id: null,
    applied_entity_id: null,
    apply_error: null,
    model_provider: 'claude',
    model_id: 'claude-haiku-4-5',
    procedure: null,
    created_at: '2026-05-23T10:00:00Z',
    decided_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  canActMock = true;
  getDraftFormSchema.mockResolvedValue({
    entity_type: 'condition_report',
    entity_label: 'Condition Report',
    fields: [
      { name: 'object_id', label: 'Object', type: 'text', required: true, enum_values: null, section: 'identification', lookup_category: null },
      { name: 'report_type', label: 'Report type', type: 'enum', required: true, enum_values: ['conservation', 'periodic'], section: 'examination', lookup_category: null },
    ],
  });
});

describe('DraftsInboxPage', () => {
  it('lists pending drafts', async () => {
    listDrafts.mockResolvedValue({ drafts: [draft()] });
    renderPage();
    expect(await screen.findByText(/conservation — object obj-1/)).toBeInTheDocument();
  });

  it('approves a draft (non rule-bound) and calls the API', async () => {
    listDrafts.mockResolvedValue({ drafts: [draft()] });
    approveDraft.mockResolvedValue(draft({ status: 'approved', applied_entity_id: 'r1' }));
    renderPage();
    fireEvent.click(await screen.findByText(/conservation — object obj-1/));
    fireEvent.click(await screen.findByRole('button', { name: /^Approve$/ }));
    await waitFor(() => expect(approveDraft).toHaveBeenCalledWith('org-1', 'd1'));
  });

  it('shows "Review in Approvals" for a rule-bound draft instead of Approve', async () => {
    listDrafts.mockResolvedValue({
      drafts: [draft({ approval_request_id: 'req-1' })],
    });
    renderPage();
    fireEvent.click(await screen.findByText(/conservation — object obj-1/));
    expect(
      await screen.findByRole('link', { name: /review in approvals/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).not.toBeInTheDocument();
  });

  it('hides Approve/Reject for a view-only role (no collections.create)', async () => {
    canActMock = false;
    listDrafts.mockResolvedValue({ drafts: [draft()] });
    renderPage();
    fireEvent.click(await screen.findByText(/conservation — object obj-1/));
    expect(await screen.findByText(/view only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reject$/ })).not.toBeInTheDocument();
  });

  it('shows empty state when no pending drafts', async () => {
    listDrafts.mockResolvedValue({ drafts: [draft({ status: 'approved' })] });
    renderPage();
    expect(await screen.findByText(/no drafts awaiting review/i)).toBeInTheDocument();
  });

  it('renders the payload as an editable form (labeled fields), not raw JSON', async () => {
    listDrafts.mockResolvedValue({ drafts: [draft()] });
    renderPage();
    fireEvent.click(await screen.findByText(/conservation — object obj-1/));
    // The generated form: a labeled field + the Form/JSON toggle.
    expect(await screen.findByText('Report type')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument();
    // Form is the default — the raw JSON textarea is not shown until toggled.
    expect(screen.queryByLabelText(/draft payload \(json\)/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByLabelText(/draft payload \(json\)/i)).toBeInTheDocument();
  });
});
