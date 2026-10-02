import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConditionReportWorkspacePage from '../../../pages/collections/ConditionReportWorkspacePage';
import * as api from '../../../lib/api';
import * as workspacePageHook from '../../../hooks/useWorkspacePage';
import * as procedureHook from '../../../hooks/useProcedureRequirements';
import * as lookupHook from '../../../hooks/useLookupValues';

// -----------------------------------------------------------------------------
// API mocks
// -----------------------------------------------------------------------------
vi.mock('../../../lib/api', () => ({
  getConditionReport: vi.fn(),
  createConditionReport: vi.fn(),
  updateConditionReport: vi.fn(),
  deleteConditionReport: vi.fn(),
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

vi.mock('../../../components/workspace/PendingApprovalBanner', () => ({
  PendingApprovalBanner: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="pending-approval-banner" /> : null,
}));

// -----------------------------------------------------------------------------
// Typed mock handles
// -----------------------------------------------------------------------------
const mockGetReport = vi.mocked(api.getConditionReport);
const mockUpdateReport = vi.mocked(api.updateConditionReport);
const mockCreateReport = vi.mocked(api.createConditionReport);
const mockDeleteReport = vi.mocked(api.deleteConditionReport);
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
  reportId = 'report-1',
  orgId = 'org-1',
  search = '',
}: { reportId?: string | null; orgId?: string; search?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const path = reportId
    ? `/organizations/${orgId}/collections/condition-reports/${reportId}${search}`
    : `/organizations/${orgId}/collections/condition-reports/create${search}`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/condition-reports/create"
            element={<ConditionReportWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/condition-reports/:reportId"
            element={<ConditionReportWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/condition-reports"
            element={<div>Condition Reports List</div>}
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
  report_number: 'CR-2024-001',
  report_type: 'periodic',
  status: 'draft',
  report_date: '2024-04-01',
  examiner_id: 'user-1',
  examiner_name: 'Alex Examiner',
  object_id: 'obj-1',
  overall_condition: 'good',
  condition_summary: 'Stable, minor surface dust.',
  completeness: '',
  completeness_date: '',
  hazards: null,
  recommendations: '',
  conservation_needed: false,
  conservation_priority: '',
  handling_requirements: '',
  packing_requirements: '',
  display_restrictions: '',
  next_check_date: '',
  report_note: '',
  check_reason: '',
  created_at: '2024-04-01T00:00:00Z',
  updated_at: '2024-04-02T00:00:00Z',
};

describe('ConditionReportWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspacePage.mockReturnValue(makeWp());
    mockUseProcedure.mockReturnValue({
      requirementGroups: [],
      isLoading: false,
      error: null,
    } as never);
    mockUseLookups.mockReturnValue({
      getLookup: (field: string) => {
        if (field === 'report_type') {
          return [
            { value: 'periodic', label: 'Periodic' },
            { value: 'incoming', label: 'Incoming' },
          ];
        }
        if (field === 'condition') {
          return [
            { value: 'excellent', label: 'Excellent' },
            { value: 'good', label: 'Good' },
          ];
        }
        return [];
      },
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
    it('renders the not-found error with link back to the list', async () => {
      mockGetReport.mockRejectedValue(new Error('Network down'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Report not found')).toBeInTheDocument();
      });
      expect(screen.getByText('Network down')).toBeInTheDocument();
      const backLink = screen.getByRole('link', { name: /back to condition reports/i });
      expect(backLink).toHaveAttribute(
        'href',
        '/organizations/org-1/collections/condition-reports'
      );
    });
  });

  describe('create mode', () => {
    it('renders the new-report header and hides view-only sections', async () => {
      renderPage({ reportId: null });
      await waitFor(() => {
        expect(screen.getByText('New Condition Report')).toBeInTheDocument();
      });
      expect(screen.queryByText('Draft')).not.toBeInTheDocument();
      expect(screen.queryByTestId('procedure-requirements-card')).not.toBeInTheDocument();
    });

    it('seeds object_id from the ?object_id= query param', async () => {
      renderPage({ reportId: null, search: '?object_id=obj-42' });
      await waitFor(() => {
        const selectors = screen.getAllByTestId('object-selector');
        const hit = selectors.find((el) => el.getAttribute('data-value') === 'obj-42');
        expect(hit).toBeTruthy();
      });
    });
  });

  describe('view / edit mode', () => {
    beforeEach(() => {
      mockGetReport.mockResolvedValue(baseReport as never);
    });

    it('renders the draft status badge', async () => {
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
      expect(screen.getByText('Condition Report Requirements')).toBeInTheDocument();
    });

    it('renders the linked CollectionObject via ObjectSelector', async () => {
      renderPage();
      await waitFor(() => {
        const selectors = screen.getAllByTestId('object-selector');
        const hit = selectors.find((el) => el.getAttribute('data-value') === 'obj-1');
        expect(hit).toBeTruthy();
      });
    });

    it('shows the Good Condition badge from existing data', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/good condition/i)).toBeInTheDocument();
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

    it('renders the Change History section when audit permission is granted', async () => {
      mockUseWorkspacePage.mockReturnValue(
        makeWp({ hasPermission: (p: string) => p === 'org.view_audit_logs' })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Change History')).toBeInTheDocument();
      });
    });

    it('omits the Change History section when audit permission is denied', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ hasPermission: () => false }));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Draft')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });
  });

  describe('status transitions', () => {
    it('marks a draft report complete and POSTs status=completed', async () => {
      mockGetReport.mockResolvedValue(baseReport as never);
      mockUpdateReport.mockResolvedValue({} as never);
      renderPage();
      const completeBtn = await screen.findByRole('button', { name: /mark complete/i });
      fireEvent.click(completeBtn);
      await waitFor(() => {
        expect(mockUpdateReport).toHaveBeenCalledWith(
          'org-1',
          'report-1',
          { status: 'completed' }
        );
      });
    });

    it('marks a completed report reviewed and POSTs status=reviewed', async () => {
      mockGetReport.mockResolvedValue({
        ...baseReport,
        status: 'completed',
      } as never);
      mockUpdateReport.mockResolvedValue({} as never);
      renderPage();
      const reviewedBtn = await screen.findByRole('button', { name: /mark reviewed/i });
      fireEvent.click(reviewedBtn);
      await waitFor(() => {
        expect(mockUpdateReport).toHaveBeenCalledWith(
          'org-1',
          'report-1',
          { status: 'reviewed' }
        );
      });
    });

    it('hides transition buttons once the report is reviewed', async () => {
      mockGetReport.mockResolvedValue({
        ...baseReport,
        status: 'reviewed',
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Reviewed')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeInTheDocument();
    });
  });

  describe('delete mutation', () => {
    it('calls deleteConditionReport when the dialog is confirmed', async () => {
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
      const dialogTitle = await screen.findByText('Delete Condition Report');
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

  describe('SlideOver dialogs', () => {
    it('opens the report slide-over when the header button is clicked', async () => {
      mockGetReport.mockResolvedValue(baseReport as never);
      renderPage();
      const reportBtn = await screen.findByRole('button', { name: /generate report/i });
      fireEvent.click(reportBtn);
      await waitFor(() => {
        expect(screen.getByTestId('generate-report-slideover')).toBeInTheDocument();
      });
    });

    it('renders the create-task slide-over when the dialog flag is true', async () => {
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

  describe('create flow validation', () => {
    it('blocks creation when the required object_id is missing and surfaces the validation error', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ isCreateMode: true }));
      mockCreateReport.mockResolvedValue({ report_id: 'new-1' } as never);
      renderPage({ reportId: null });
      const createBtn = await screen.findByRole('button', {
        name: /create condition report/i,
      });
      fireEvent.click(createBtn);
      await waitFor(() => {
        expect(screen.getByText(/object is required/i)).toBeInTheDocument();
      });
      expect(mockCreateReport).not.toHaveBeenCalled();
    });
  });
});
