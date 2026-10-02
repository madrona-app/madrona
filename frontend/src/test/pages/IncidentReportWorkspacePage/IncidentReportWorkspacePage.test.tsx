import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IncidentReportWorkspacePage from '../../../pages/collections/IncidentReportWorkspacePage';
import * as api from '../../../lib/api';
import * as workspacePageHook from '../../../hooks/useWorkspacePage';
import * as procedureHook from '../../../hooks/useProcedureRequirements';
import * as lookupHook from '../../../hooks/useLookupValues';

// -----------------------------------------------------------------------------
// API mocks
// -----------------------------------------------------------------------------
vi.mock('../../../lib/api', () => ({
  getIncidentReport: vi.fn(),
  createIncidentReport: vi.fn(),
  updateIncidentReport: vi.fn(),
  deleteIncidentReport: vi.fn(),
  closeIncidentReport: vi.fn(),
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
// Heavy child component mocks
// -----------------------------------------------------------------------------
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

vi.mock('../../../components/collections/IncidentObjectLinker', () => ({
  IncidentObjectLinker: ({ reportId }: { reportId?: string }) => (
    <div data-testid="incident-object-linker" data-report-id={reportId || ''} />
  ),
}));

// -----------------------------------------------------------------------------
// Typed mock handles
// -----------------------------------------------------------------------------
const mockGetReport = vi.mocked(api.getIncidentReport);
const mockUpdateReport = vi.mocked(api.updateIncidentReport);
const mockCreateReport = vi.mocked(api.createIncidentReport);
const mockDeleteReport = vi.mocked(api.deleteIncidentReport);
const mockCloseReport = vi.mocked(api.closeIncidentReport);
const mockUseWorkspacePage = vi.mocked(workspacePageHook.useWorkspacePage);
const mockUseProcedure = vi.mocked(procedureHook.useProcedureRequirements);
const mockUseLookups = vi.mocked(lookupHook.useLookupValues);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function makeWp(overrides: Partial<ReturnType<typeof workspacePageHook.useWorkspacePage>> = {}) {
  return {
    isCreateMode: false,
    isEditing: false, // incident report header actions only show in non-editing mode
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
  reportId = 'report-1',
  orgId = 'org-1',
}: { reportId?: string | null; orgId?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const path = reportId
    ? `/organizations/${orgId}/collections/incidents/${reportId}`
    : `/organizations/${orgId}/collections/incidents/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/incidents/create"
            element={<IncidentReportWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/incidents/:reportId"
            element={<IncidentReportWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/incidents"
            element={<div>Incidents List</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------
const baseReport = {
  report_id: 'report-1',
  report_number: 'IR-2024-001',
  status: 'draft',
  report_date: '2024-04-01',
  incident_type: 'damage',
  incident_subtype: '',
  incident_date: '2024-04-01',
  incident_location_description: 'Gallery A',
  discovered_date: '2024-04-01',
  discovered_by_name: 'Pat Curator',
  discovery_circumstances: '',
  incident_description: 'Object knocked over during cleaning.',
  cause_analysis: '',
  immediate_actions: '',
  police_notified: false,
  police_report_number: '',
  police_report_date: '',
  insurance_claim_filed: false,
  insurance_claim_number: '',
  insurance_claim_status: '',
  insurance_claim_amount: null,
  insurance_settlement_amount: null,
  investigation_required: false,
  investigation_findings: '',
  investigation_completed_date: '',
  resolution_summary: '',
  resolved_date: '',
  lessons_learned: '',
  created_at: '2024-04-01T00:00:00Z',
  updated_at: '2024-04-02T00:00:00Z',
};

describe('IncidentReportWorkspacePage', () => {
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
        { value: 'damage', label: 'Damage' },
        { value: 'theft', label: 'Theft' },
        { value: 'fire', label: 'Fire' },
      ],
      getLabel: (_field: string, value: string) => value,
      isLoading: false,
      error: null,
    } as never);
  });

  describe('loading state', () => {
    it('renders the loader while the report fetch is pending', () => {
      mockGetReport.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('error / not-found state', () => {
    it('renders the not-found message on fetch error', async () => {
      mockGetReport.mockRejectedValue(new Error('Forbidden'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Incident report not found')).toBeInTheDocument();
      });
      expect(screen.getByText('Forbidden')).toBeInTheDocument();
    });
  });

  describe('create mode', () => {
    it('renders the new-incident header with auto-generated placeholder', async () => {
      renderPage({ reportId: null });
      await waitFor(() => {
        expect(screen.getByText('New Incident Report')).toBeInTheDocument();
      });
      // No status badge in create mode
      expect(screen.queryByText('Submitted')).not.toBeInTheDocument();
      expect(screen.queryByTestId('procedure-requirements-card')).not.toBeInTheDocument();
    });

    it('does not render the IncidentObjectLinker in create mode', async () => {
      renderPage({ reportId: null });
      await waitFor(() => {
        expect(screen.getByText('New Incident Report')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('incident-object-linker')).not.toBeInTheDocument();
    });
  });

  describe('view mode', () => {
    beforeEach(() => {
      mockGetReport.mockResolvedValue(baseReport as never);
    });

    it('shows the Draft status badge', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Draft')).toBeInTheDocument();
      });
    });

    it('renders the procedure requirements card for an existing report', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('procedure-requirements-card')).toBeInTheDocument();
      });
      expect(screen.getByText('Incident Report Requirements')).toBeInTheDocument();
    });

    it('renders the IncidentObjectLinker linked to the current reportId', async () => {
      renderPage();
      await waitFor(() => {
        const linker = screen.getByTestId('incident-object-linker');
        expect(linker.getAttribute('data-report-id')).toBe('report-1');
      });
    });

    it('shows the theft alert banner when incident_type is theft', async () => {
      mockGetReport.mockResolvedValue({
        ...baseReport,
        incident_type: 'theft',
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Theft Incident')).toBeInTheDocument();
      });
      expect(
        screen.getByText(/police have been notified/i)
      ).toBeInTheDocument();
    });

    it('shows the fire alert banner when incident_type is fire', async () => {
      mockGetReport.mockResolvedValue({
        ...baseReport,
        incident_type: 'fire',
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Fire Incident')).toBeInTheDocument();
      });
    });

    it('shows the view-only banner when canEdit is false', async () => {
      mockUseWorkspacePage.mockReturnValue(
        makeWp({ canEdit: false, isEditing: false })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/view only/i)).toBeInTheDocument();
      });
    });

    it('renders Change History section header when audit permission is granted', async () => {
      mockUseWorkspacePage.mockReturnValue(
        makeWp({ hasPermission: (p: string) => p === 'org.view_audit_logs' })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Change History')).toBeInTheDocument();
      });
    });
  });

  describe('status transitions', () => {
    it('submits a draft incident and POSTs status=submitted', async () => {
      mockGetReport.mockResolvedValue(baseReport as never);
      mockUpdateReport.mockResolvedValue({} as never);
      renderPage();
      const submitBtn = await screen.findByRole('button', { name: /^submit$/i });
      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(mockUpdateReport).toHaveBeenCalledWith(
          'org-1',
          'report-1',
          { status: 'submitted' }
        );
      });
    });

    it('starts an investigation and POSTs status=under_investigation', async () => {
      mockGetReport.mockResolvedValue({
        ...baseReport,
        status: 'submitted',
      } as never);
      mockUpdateReport.mockResolvedValue({} as never);
      renderPage();
      const startBtn = await screen.findByRole('button', { name: /start investigation/i });
      fireEvent.click(startBtn);
      await waitFor(() => {
        expect(mockUpdateReport).toHaveBeenCalledWith(
          'org-1',
          'report-1',
          { status: 'under_investigation' }
        );
      });
    });

    it('resolves an under-investigation report and POSTs status=resolved', async () => {
      mockGetReport.mockResolvedValue({
        ...baseReport,
        status: 'under_investigation',
      } as never);
      mockUpdateReport.mockResolvedValue({} as never);
      renderPage();
      const resolveBtn = await screen.findByRole('button', { name: /^resolve$/i });
      fireEvent.click(resolveBtn);
      await waitFor(() => {
        expect(mockUpdateReport).toHaveBeenCalledWith(
          'org-1',
          'report-1',
          { status: 'resolved' }
        );
      });
    });

    it('closes a resolved report via the dedicated closeIncidentReport endpoint', async () => {
      mockGetReport.mockResolvedValue({
        ...baseReport,
        status: 'resolved',
      } as never);
      mockCloseReport.mockResolvedValue({} as never);
      renderPage();
      const closeBtn = await screen.findByRole('button', { name: /^close$/i });
      fireEvent.click(closeBtn);
      await waitFor(() => {
        expect(mockCloseReport).toHaveBeenCalledWith('org-1', 'report-1');
      });
    });
  });

  describe('delete mutation', () => {
    it('deletes the incident report when the dialog is confirmed', async () => {
      mockGetReport.mockResolvedValue(baseReport as never);
      mockDeleteReport.mockResolvedValue({} as never);
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
      const dialogTitle = await screen.findByText('Delete Incident Report');
      const dialogRoot = dialogTitle.closest('div[role="dialog"]')
        || dialogTitle.parentElement?.parentElement?.parentElement
        || dialogTitle.parentElement;
      const confirmBtn = Array.from(
        (dialogRoot as HTMLElement).querySelectorAll('button')
      ).find((b) => b.textContent?.trim() === 'Delete');
      expect(confirmBtn).toBeTruthy();
      fireEvent.click(confirmBtn as HTMLElement);
      await waitFor(() => {
        expect(mockDeleteReport).toHaveBeenCalledWith('org-1', 'report-1');
      });
      expect(setShowDeleteConfirm).toHaveBeenCalledWith(false);
    });
  });

  describe('create flow validation', () => {
    it('blocks creation when the validateCreateForm `title` requirement fails', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ isCreateMode: true }));
      mockCreateReport.mockResolvedValue({ report_id: 'new-1' } as never);
      renderPage({ reportId: null });
      const createBtn = await screen.findByRole('button', { name: /create report/i });
      fireEvent.click(createBtn);
      // Hook validates against a `title` field that the incident form
      // does not expose; the validation error is surfaced.
      await waitFor(() => {
        expect(screen.getByText(/title is required/i)).toBeInTheDocument();
      });
      expect(mockCreateReport).not.toHaveBeenCalled();
    });
  });


  describe('CreateTask slide-over', () => {
    it('renders when the dialog flag is true', async () => {
      mockGetReport.mockResolvedValue(baseReport as never);
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
});
