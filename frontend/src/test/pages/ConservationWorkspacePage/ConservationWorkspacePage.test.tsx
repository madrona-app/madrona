import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConservationWorkspacePage from '../../../pages/collections/ConservationWorkspacePage';
import * as api from '../../../lib/api';
import * as workspacePageHook from '../../../hooks/useWorkspacePage';
import * as procedureHook from '../../../hooks/useProcedureRequirements';
import * as lookupHook from '../../../hooks/useLookupValues';

// -----------------------------------------------------------------------------
// API mocks
// -----------------------------------------------------------------------------
vi.mock('../../../lib/api', () => ({
  getConservationTreatment: vi.fn(),
  createConservationTreatment: vi.fn(),
  updateConservationTreatment: vi.fn(),
  deleteConservationTreatment: vi.fn(),
  getContact: vi.fn(),
}));

// -----------------------------------------------------------------------------
// Hook mocks
// -----------------------------------------------------------------------------
vi.mock('../../../hooks/useWorkspacePage', () => ({
  useWorkspacePage: vi.fn(),
}));

vi.mock('../../../hooks/useProcedureRequirements', () => ({
  useProcedureRequirements: vi.fn(),
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { user_id: 'u-1', email: 'tester@example.com', is_platform_admin: false },
    activeOrganizationId: 'org-1',
    isPlatformAdmin: false,
    roleOverride: null,
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// -----------------------------------------------------------------------------
// Heavy child component mocks (non-SUT) — keep render light & deterministic
// -----------------------------------------------------------------------------
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="contact-selector-slideover" /> : null,
}));

vi.mock('../../../components/collections/ObjectSelector', () => ({
  ObjectSelector: ({ label, objectId }: { label?: string; objectId?: string | null }) => (
    <div data-testid="object-selector" data-label={label} data-value={objectId || ''} />
  ),
}));

vi.mock('../../../components/reports/GenerateReportSlideOver', () => ({
  GenerateReportSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="generate-report-slideover" /> : null,
}));

vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-task-slideover" /> : null,
}));

vi.mock('../../../components/workspace/RecordAuditHistory', () => ({
  RecordAuditHistory: () => <div data-testid="record-audit-history" />,
}));

vi.mock('../../../components/collections/ProcedureRequirementsCard', () => ({
  ProcedureRequirementsCard: ({ title }: { title: string }) => (
    <div data-testid="procedure-requirements-card">{title}</div>
  ),
}));

// -----------------------------------------------------------------------------
// Typed mock handles
// -----------------------------------------------------------------------------
const mockGetTreatment = vi.mocked(api.getConservationTreatment);
const mockUpdateTreatment = vi.mocked(api.updateConservationTreatment);
const mockCreateTreatment = vi.mocked(api.createConservationTreatment);
const mockDeleteTreatment = vi.mocked(api.deleteConservationTreatment);
const mockGetContact = vi.mocked(api.getContact);
const mockUseWorkspacePage = vi.mocked(workspacePageHook.useWorkspacePage);
const mockUseProcedure = vi.mocked(procedureHook.useProcedureRequirements);
const mockUseLookups = vi.mocked(lookupHook.useLookupValues);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function makeWp(overrides: Partial<ReturnType<typeof workspacePageHook.useWorkspacePage>> = {}) {
  return {
    isCreateMode: false,
    isEditing: true,
    setIsEditing: vi.fn(),
    useNewLayout: false,
    canEdit: true,
    isRestricted: () => false,
    hasRestrictions: false,
    dialogs: {
      showDeleteConfirm: false,
      setShowDeleteConfirm: vi.fn(),
      showCreateTask: false,
      setShowCreateTask: vi.fn(),
    },
    hasPermission: () => true,
    ...overrides,
  } as ReturnType<typeof workspacePageHook.useWorkspacePage>;
}

function renderPage({
  treatmentId = 'treatment-1',
  orgId = 'org-1',
}: { treatmentId?: string | null; orgId?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const path = treatmentId
    ? `/organizations/${orgId}/collections/conservation/${treatmentId}`
    : `/organizations/${orgId}/collections/conservation/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/conservation/create"
            element={<ConservationWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/conservation/:treatmentId"
            element={<ConservationWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/conservation"
            element={<div>Conservation List</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------
const baseTreatment = {
  treatment_id: 'treatment-1',
  treatment_number: 'CT-2024-001',
  treatment_type: 'remedial',
  status: 'proposed',
  object_id: 'obj-1',
  conservator_id: '',
  proposal_date: '2024-04-01',
  proposal_summary: 'Surface clean and stabilize',
  proposal_document_ref: 'DOC-1',
  estimated_duration_days: 7,
  estimated_cost: 1500,
  estimated_cost_currency: 'USD',
  start_date: '',
  end_date: '',
  actual_duration_days: null,
  actual_cost: null,
  actual_cost_currency: 'USD',
  treatment_description: '',
  materials_used: null,
  methods_used: '',
  recommendations: '',
  restrictions: '',
  treatment_note: '',
  created_at: '2024-04-01T00:00:00Z',
  updated_at: '2024-04-02T00:00:00Z',
};

describe('ConservationWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspacePage.mockReturnValue(makeWp());
    mockUseProcedure.mockReturnValue({
      requirementGroups: [],
      isLoading: false,
      error: null,
    } as never);
    mockUseLookups.mockReturnValue({
      getLookup: () => [
        { value: 'remedial', label: 'Remedial' },
        { value: 'preventive', label: 'Preventive' },
      ],
      getLabel: (_field: string, value: string) => value,
      isLoading: false,
      error: null,
    } as never);
    mockGetContact.mockResolvedValue({} as never);
  });

  describe('loading state', () => {
    it('renders the loader while the treatment fetch is pending', () => {
      mockGetTreatment.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('error / not-found state', () => {
    it('renders the not-found error with link back to list', async () => {
      mockGetTreatment.mockRejectedValue(new Error('Forbidden'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Treatment not found')).toBeInTheDocument();
      });
      expect(screen.getByText('Forbidden')).toBeInTheDocument();
      const backLink = screen.getByRole('link', { name: /back to conservation/i });
      expect(backLink).toHaveAttribute(
        'href',
        '/organizations/org-1/collections/conservation'
      );
    });
  });

  describe('create mode', () => {
    it('renders the new-treatment header without a status bar', async () => {
      renderPage({ treatmentId: null });
      await waitFor(() => {
        expect(screen.getByText('New Conservation Treatment')).toBeInTheDocument();
      });
      // Status bar is hidden in create mode
      expect(screen.queryByText('Proposed')).not.toBeInTheDocument();
      // procedure compliance card is hidden in create mode
      expect(screen.queryByTestId('procedure-requirements-card')).not.toBeInTheDocument();
    });
  });

  describe('view / edit mode', () => {
    beforeEach(() => {
      mockGetTreatment.mockResolvedValue(baseTreatment as never);
    });

    it('renders the status bar with the proposed status badge', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Proposed')).toBeInTheDocument();
      });
    });

    it('renders the procedure requirements card when a record exists', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('procedure-requirements-card')).toBeInTheDocument();
      });
      expect(screen.getByText('Conservation Requirements')).toBeInTheDocument();
    });

    it('renders the Change History section header when the user has the audit permission', async () => {
      mockUseWorkspacePage.mockReturnValue(
        makeWp({ hasPermission: (p: string) => p === 'org.view_audit_logs' })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Change History')).toBeInTheDocument();
      });
    });

    it('omits the Change History section when the user lacks the audit permission', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ hasPermission: () => false }));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Proposed')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });

    it('shows the view-only banner when canEdit is false', async () => {
      mockUseWorkspacePage.mockReturnValue(
        makeWp({ canEdit: false, isEditing: false })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Proposed')).toBeInTheDocument();
      });
      // ReadOnlyBanner copy: "View only — you don't have permission to edit this record"
      expect(screen.getByText(/view only/i)).toBeInTheDocument();
    });

    it('renders the linked-object selector pointing at the treatment object_id', async () => {
      renderPage();
      await waitFor(() => {
        const selectors = screen.getAllByTestId('object-selector');
        const hit = selectors.find((el) => el.getAttribute('data-value') === 'obj-1');
        expect(hit).toBeTruthy();
      });
    });
  });

  describe('status transitions', () => {
    it('approves a proposed treatment and POSTs status=approved', async () => {
      mockGetTreatment.mockResolvedValue(baseTreatment as never);
      mockUpdateTreatment.mockResolvedValue({} as never);
      renderPage();
      const approveBtn = await screen.findByRole('button', { name: /approve/i });
      fireEvent.click(approveBtn);
      await waitFor(() => {
        expect(mockUpdateTreatment).toHaveBeenCalledWith(
          'org-1',
          'treatment-1',
          { status: 'approved' }
        );
      });
    });

    it('starts an approved treatment and POSTs status=in_progress', async () => {
      mockGetTreatment.mockResolvedValue({
        ...baseTreatment,
        status: 'approved',
      } as never);
      mockUpdateTreatment.mockResolvedValue({} as never);
      renderPage();
      const startBtn = await screen.findByRole('button', { name: /start treatment/i });
      fireEvent.click(startBtn);
      await waitFor(() => {
        expect(mockUpdateTreatment).toHaveBeenCalledWith(
          'org-1',
          'treatment-1',
          { status: 'in_progress' }
        );
      });
    });

    it('completes an in-progress treatment and POSTs status=completed', async () => {
      mockGetTreatment.mockResolvedValue({
        ...baseTreatment,
        status: 'in_progress',
      } as never);
      mockUpdateTreatment.mockResolvedValue({} as never);
      renderPage();
      const completeBtn = await screen.findByRole('button', { name: /^complete$/i });
      fireEvent.click(completeBtn);
      await waitFor(() => {
        expect(mockUpdateTreatment).toHaveBeenCalledWith(
          'org-1',
          'treatment-1',
          { status: 'completed' }
        );
      });
    });

    it('does not show transition buttons once completed', async () => {
      mockGetTreatment.mockResolvedValue({
        ...baseTreatment,
        status: 'completed',
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Completed')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /start treatment/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('delete mutation', () => {
    it('fires deleteConservationTreatment when the confirm dialog is accepted', async () => {
      mockGetTreatment.mockResolvedValue(baseTreatment as never);
      mockDeleteTreatment.mockResolvedValue({} as never);
      const setShowDeleteConfirm = vi.fn();
      mockUseWorkspacePage.mockReturnValue(
        makeWp({
          dialogs: {
            showDeleteConfirm: true,
            setShowDeleteConfirm,
            showCreateTask: false,
            setShowCreateTask: vi.fn(),
          },
        })
      );
      renderPage();
      // Locate the Delete button inside the ConfirmDialog by finding the dialog
      // title "Delete Treatment Record" and walking to its parent.
      const dialogTitle = await screen.findByText('Delete Treatment Record');
      const dialogRoot = dialogTitle.closest('div[role="dialog"]')
        || dialogTitle.parentElement?.parentElement?.parentElement
        || dialogTitle.parentElement;
      expect(dialogRoot).toBeTruthy();
      const buttons = (dialogRoot as HTMLElement).querySelectorAll('button');
      const confirmBtn = Array.from(buttons).find(
        (b) => b.textContent?.trim() === 'Delete'
      );
      expect(confirmBtn).toBeTruthy();
      fireEvent.click(confirmBtn as HTMLElement);
      await waitFor(() => {
        expect(mockDeleteTreatment).toHaveBeenCalledWith('org-1', 'treatment-1');
      });
      expect(setShowDeleteConfirm).toHaveBeenCalledWith(false);
    });
  });

  describe('SlideOver dialogs', () => {
    it('opens the report slide-over when "Generate Report" is clicked', async () => {
      mockGetTreatment.mockResolvedValue(baseTreatment as never);
      renderPage();
      const reportBtn = await screen.findByRole('button', { name: /generate report/i });
      fireEvent.click(reportBtn);
      await waitFor(() => {
        expect(screen.getByTestId('generate-report-slideover')).toBeInTheDocument();
      });
    });

    it('renders the create-task slide-over when the dialog flag is true', async () => {
      mockGetTreatment.mockResolvedValue(baseTreatment as never);
      mockUseWorkspacePage.mockReturnValue(
        makeWp({
          dialogs: {
            showDeleteConfirm: false,
            setShowDeleteConfirm: vi.fn(),
            showCreateTask: true,
            setShowCreateTask: vi.fn(),
          },
        })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('create-task-slideover')).toBeInTheDocument();
      });
    });
  });

  describe('field editing', () => {
    it('opens the conservator selector slide-over when search button is clicked', async () => {
      mockGetTreatment.mockResolvedValue(baseTreatment as never);
      renderPage();
      // baseTreatment has conservator_id === '', and the "conservator"
      // section starts expanded, so the search button is rendered.
      const searchBtn = await screen.findByRole('button', {
        name: /search or create conservator/i,
      });
      fireEvent.click(searchBtn);
      await waitFor(() => {
        expect(screen.getByTestId('contact-selector-slideover')).toBeInTheDocument();
      });
    });

    it('toggles a collapsed section when its header is clicked', async () => {
      mockGetTreatment.mockResolvedValue(baseTreatment as never);
      renderPage();
      // The Treatment Proposal section starts collapsed; clicking its
      // header should toggle it without throwing.
      const proposalHeader = await screen.findByRole('button', {
        name: /treatment proposal/i,
      });
      fireEvent.click(proposalHeader);
      // After expansion the proposal_summary textarea becomes available.
      await waitFor(() => {
        expect(screen.getByLabelText(/proposal summary/i)).toBeInTheDocument();
      });
    });
  });

  describe('create flow', () => {
    it('shows the validation error when create is submitted without required fields', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ isCreateMode: true }));
      mockCreateTreatment.mockResolvedValue({ treatment_id: 'new-1' } as never);
      renderPage({ treatmentId: null });
      const createBtn = await screen.findByRole('button', {
        name: /create conservation treatment/i,
      });
      fireEvent.click(createBtn);
      // The hook's validateCreateForm requires a `title` field which the
      // conservation form lacks, so the validation error is surfaced.
      await waitFor(() => {
        expect(screen.getByText(/title is required/i)).toBeInTheDocument();
      });
      expect(mockCreateTreatment).not.toHaveBeenCalled();
    });
  });
});
