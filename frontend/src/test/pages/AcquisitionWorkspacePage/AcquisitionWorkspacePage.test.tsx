import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getAcquisition: vi.fn(),
  createAcquisition: vi.fn(),
  updateAcquisition: vi.fn(),
  deleteAcquisition: vi.fn(),
  rollbackAcquisition: vi.fn(),
  approveAcquisition: vi.fn(),
  completeAcquisition: vi.fn(),
  getObjectEntry: vi.fn(),
  getContact: vi.fn(),
}));

vi.mock('../../../hooks/useWorkspacePage', () => ({
  useWorkspacePage: vi.fn(),
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: () => ({
    getLookup: () => [],
    getLabel: (_k: string, v: string) => v,
    categories: [],
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('../../../hooks/useProcedureRequirements', () => ({
  useProcedureRequirements: () => ({
    requirementGroups: [],
    statusOrder: ['proposed', 'approved', 'completed', 'cancelled'],
    procedureLabel: 'Acquisition',
    enforcementEnabled: false,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { user_id: 'user-1' },
    isPlatformAdmin: false,
    roleOverride: null,
  }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock('../../../hooks/useContactSelector', () => ({
  useConstituentSelector: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    createSelectHandler: (cb: (id: string) => void) => (id: string) => cb(id),
  }),
}));

// Heavy children
vi.mock('../../../components/collections/ProcedureRequirementsCard', () => ({
  ProcedureRequirementsCard: () => <div data-testid="requirements-card" />,
}));
vi.mock('../../../components/collections/StatusAdvancementDialog', () => ({
  StatusAdvancementDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="status-advance-dialog" /> : null,
}));
vi.mock('../../../components/collections/AdvanceWithExceptionDialog', () => ({
  AdvanceWithExceptionDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="advance-exception-dialog" /> : null,
}));
vi.mock('../../../components/collections/ChangeStatusDropdown', () => ({
  ChangeStatusDropdown: () => <div data-testid="change-status-dropdown" />,
}));
vi.mock('../../../components/collections/AcquisitionObjectLinker', () => ({
  AcquisitionObjectLinker: () => <div data-testid="acquisition-object-linker" />,
}));
vi.mock('../../../components/collections/AcquisitionEntryLinker', () => ({
  AcquisitionEntryLinker: () => <div data-testid="acquisition-entry-linker" />,
}));
vi.mock('../../../components/collections/SignedDocumentSlot', () => ({
  SignedDocumentSlot: () => <div data-testid="signed-document-slot" />,
}));
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: () => null,
}));
vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: () => null,
}));
vi.mock('../../../components/reports/GenerateReportSlideOver', () => ({
  GenerateReportSlideOver: () => null,
}));
vi.mock('../../../components/RecordDiscussionTab', () => ({
  RecordDiscussionTab: () => <div data-testid="discussion-tab" />,
}));

vi.mock('../../../components/record-detail', () => ({
  RecordDetailPageWrapper: ({ children }: { children: ReactNode }) => (
    <div data-testid="record-detail-wrapper">{children}</div>
  ),
  SectionOrderProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSectionOrder: (): [Record<string, string[]>, (g: string, s: string[]) => void, () => void] => [
    {},
    () => {},
    () => {},
  ],
}));

vi.mock('../../../components/workspace', () => ({
  WorkspaceErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  WorkspaceHeader: ({ title, objectNumber }: { title?: string; objectNumber?: string }) => (
    <div data-testid="workspace-header">
      {title && <span>{title}</span>}
      {objectNumber && <span>{objectNumber}</span>}
    </div>
  ),
  WorkspaceSection: ({
    title,
    children,
    isExpanded,
  }: {
    title: string;
    children?: ReactNode;
    isExpanded?: boolean;
  }) => (
    <section data-testid={`section-${title}`}>
      <h3>{title}</h3>
      {isExpanded !== false && <div>{children}</div>}
    </section>
  ),
  EditableField: ({ value, label }: { value?: unknown; label?: string }) => (
    <div data-testid={`editable-field-${label}`}>{String(value ?? '')}</div>
  ),
  EditableSelect: ({ value, label }: { value?: string; label?: string }) => (
    <div data-testid={`editable-select-${label}`}>{value ?? ''}</div>
  ),
  EditableCheckbox: ({ value, label }: { value?: boolean; label?: string }) => (
    <div data-testid={`editable-checkbox-${label}`}>{String(value)}</div>
  ),
  RecordAuditHistory: () => <div data-testid="audit-history" />,
  SectionGroupDivider: () => null,
  ReadOnlyBanner: ({ visible }: { visible?: boolean }) =>
    visible ? <div data-testid="read-only-banner">Read-only</div> : null,
  PendingApprovalBanner: ({ visible }: { visible?: boolean }) =>
    visible ? <div data-testid="pending-approval-banner" /> : null,
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="confirm-dialog" /> : null,
}));
vi.mock('../../../components/RollbackDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="rollback-dialog" /> : null,
}));
vi.mock('../../../components/ui/MadronaLoader', () => ({
  MadronaLoader: ({ label }: { label?: string }) => (
    <div data-testid="madrona-loader" role="status" aria-label={label || 'Loading'}>
      {label || 'Loading'}
    </div>
  ),
}));

import AcquisitionWorkspacePage from '../../../pages/collections/AcquisitionWorkspacePage';
import * as useWorkspacePageMod from '../../../hooks/useWorkspacePage';

const mockGetAcquisition = vi.mocked(api.getAcquisition);
const mockGetObjectEntry = vi.mocked(api.getObjectEntry);
const mockGetContact = vi.mocked(api.getContact);

const defaultWp = {
  isCreateMode: false,
  isEditing: false,
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
};

function renderPage(path = '/organizations/org-1/collections/acquisitions/acq-1?layout=classic') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/acquisitions/create"
            element={<AcquisitionWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/acquisitions/:acquisitionId"
            element={<AcquisitionWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const acquisitionFixture = {
  acquisition_id: 'acq-1',
  acquisition_number: 'ACQ-001',
  status: 'proposed',
  acquisition_method: 'gift',
  acquisition_date: '2026-04-01',
  source_id: '',
  source_type: '',
  cost: 1000,
  cost_currency: 'USD',
  appraised_value: 1500,
  appraised_value_currency: 'USD',
  legal_status: 'clear',
  provenance_verified: false,
  board_approval_required: false,
  objects_count: 1,
  created_at: '2026-04-01T00:00:00Z',
  created_by: 'user-1',
};

describe('AcquisitionWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetObjectEntry.mockResolvedValue({} as never);
    mockGetContact.mockResolvedValue({} as never);
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue(defaultWp);
  });

  it('renders error state when fetch fails', async () => {
    mockGetAcquisition.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/acquisition not found/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/back to acquisitions/i)).toBeInTheDocument();
  });

  it('renders acquisition number once loaded', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('ACQ-001')).toBeInTheDocument();
    });
  });

  it('renders Approve button when status is proposed', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    });
  });

  it('renders Complete Acquisition button when status is approved', async () => {
    mockGetAcquisition.mockResolvedValue({ ...acquisitionFixture, status: 'approved' } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /complete acquisition/i })).toBeInTheDocument();
    });
  });

  it('renders core sections', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Acquisition Information')).toBeInTheDocument();
    });
    expect(screen.getByText('Source Information')).toBeInTheDocument();
    expect(screen.getByText('Financial Information')).toBeInTheDocument();
    expect(screen.getByText('Legal & Provenance')).toBeInTheDocument();
    expect(screen.getByText('Board Approval')).toBeInTheDocument();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
  });

  it('renders ProcedureRequirementsCard', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('requirements-card')).toBeInTheDocument();
    });
  });

  it('renders ChangeStatusDropdown', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('change-status-dropdown')).toBeInTheDocument();
    });
  });

  it('renders ReadOnlyBanner when canEdit is false', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      canEdit: false,
    });
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    });
  });

  it('renders create mode header for /create path', async () => {
    renderPage('/organizations/org-1/collections/acquisitions/create');
    await waitFor(() => {
      expect(screen.getByText('New Acquisition')).toBeInTheDocument();
    });
  });

  it('hides change history when audit permission missing', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      hasPermission: (p: string) => p !== 'org.view_audit_logs',
    });
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('ACQ-001')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('audit-history')).not.toBeInTheDocument();
  });

  it('renders accessioning section when not in create mode', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Accessioning')).toBeInTheDocument();
    });
  });

  it('renders linked objects section after load', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Linked Objects')).toBeInTheDocument();
    });
    expect(screen.getByTestId('acquisition-object-linker')).toBeInTheDocument();
  });

  it('uses new layout (RecordDetailPageWrapper) when useNewLayout=true', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      useNewLayout: true,
    });
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage('/organizations/org-1/collections/acquisitions/acq-1');
    await waitFor(() => {
      expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
    });
  });

  it('renders ConfirmDialog when delete dialog is open', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      dialogs: {
        showDeleteConfirm: true,
        setShowDeleteConfirm: vi.fn(),
        showCreateTask: false,
        setShowCreateTask: vi.fn(),
      },
    });
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });
  });

  it('renders status pill text for completed status', async () => {
    mockGetAcquisition.mockResolvedValue({
      ...acquisitionFixture,
      status: 'completed',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/completed/i).length).toBeGreaterThan(0);
    });
  });

  it('renders cancelled status without workflow indicator', async () => {
    mockGetAcquisition.mockResolvedValue({
      ...acquisitionFixture,
      status: 'cancelled',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('ACQ-001')).toBeInTheDocument();
    });
    // No workflow progress indicator label
    expect(screen.queryByText(/acquisition workflow/i)).not.toBeInTheDocument();
  });

  it('renders Discussion section heading', async () => {
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Discussion')).toBeInTheDocument();
    });
  });

  it('renders objects_count when greater than 1', async () => {
    mockGetAcquisition.mockResolvedValue({
      ...acquisitionFixture,
      objects_count: 5,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/5 objects/i)).toBeInTheDocument();
    });
  });

  it('renders footer with timestamps when loaded', async () => {
    mockGetAcquisition.mockResolvedValue({
      ...acquisitionFixture,
      updated_at: '2026-04-15T10:00:00Z',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/created:/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/last updated:/i)).toBeInTheDocument();
  });

  it('renders accessioning section banner for approved status', async () => {
    mockGetAcquisition.mockResolvedValue({
      ...acquisitionFixture,
      status: 'approved',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/acquisition approved\. complete the acquisition/i)
      ).toBeInTheDocument();
    });
  });

  it('renders accessioning section banner for completed status', async () => {
    mockGetAcquisition.mockResolvedValue({
      ...acquisitionFixture,
      status: 'completed',
      completed_date: '2026-04-10',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/acquisition completed - objects ready for accessioning/i)
      ).toBeInTheDocument();
    });
  });

  it('renders editing UI when isEditing=true', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      isEditing: true,
    });
    mockGetAcquisition.mockResolvedValue(acquisitionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('ACQ-001')).toBeInTheDocument();
    });
  });

  it('renders new layout wrapper', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      useNewLayout: true,
    });
    mockGetAcquisition.mockResolvedValue({
      ...acquisitionFixture,
      acquisition_method: 'gift',
    } as never);
    renderPage('/organizations/org-1/collections/acquisitions/acq-1');
    await waitFor(() => {
      expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
    });
    // Sections still rendered inside the wrapper
    expect(screen.getByText('Acquisition Information')).toBeInTheDocument();
  });
});
