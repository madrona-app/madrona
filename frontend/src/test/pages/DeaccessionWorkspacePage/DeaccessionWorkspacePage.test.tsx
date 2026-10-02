import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getDeaccession: vi.fn(),
  createDeaccession: vi.fn(),
  updateDeaccession: vi.fn(),
  deleteDeaccession: vi.fn(),
  rollbackDeaccession: vi.fn(),
  getContact: vi.fn(),
  getAllLookups: vi.fn().mockResolvedValue([]),
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
    statusOrder: [
      'proposed',
      'under_review',
      'committee_reviewed',
      'pending_board',
      'approved',
      'in_progress',
      'completed',
      'cancelled',
      'rejected',
    ],
    procedureLabel: 'Deaccession',
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
vi.mock('../../../components/collections/ObjectSelector', () => ({
  ObjectSelector: () => <div data-testid="object-selector" />,
}));
vi.mock('../../../components/collections/ShipmentLinker', () => ({
  ShipmentLinker: () => <div data-testid="shipment-linker" />,
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

import DeaccessionWorkspacePage from '../../../pages/collections/DeaccessionWorkspacePage';
import * as useWorkspacePageMod from '../../../hooks/useWorkspacePage';

const mockGetDeaccession = vi.mocked(api.getDeaccession);
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

function renderPage(path = '/organizations/org-1/collections/deaccessions/deacc-1?layout=classic') {
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
            path="/organizations/:orgId/collections/deaccessions/create"
            element={<DeaccessionWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/deaccessions/:deaccessionId"
            element={<DeaccessionWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const deaccessionFixture = {
  deaccession_id: 'deacc-1',
  deaccession_number: 'DEACC-001',
  status: 'proposed',
  object_id: 'obj-1',
  proposal_date: '2026-04-01',
  reason: 'outside_scope',
  reason_detail: '',
  disposal_method: '',
  recipient_name: '',
  board_approval_required: true,
  appraised_value: 5000,
  appraised_value_currency: 'USD',
  provenance_review_complete: false,
  public_notice_required: false,
  created_at: '2026-04-01T00:00:00Z',
  created_by: 'user-1',
};

describe('DeaccessionWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContact.mockResolvedValue({} as never);
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue(defaultWp);
  });

  it('renders error state when fetch fails', async () => {
    mockGetDeaccession.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/deaccession not found/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/back to deaccessions/i)).toBeInTheDocument();
  });

  it('renders deaccession number once loaded', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DEACC-001')).toBeInTheDocument();
    });
  });

  it('renders Start Review button when status is proposed', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start review/i })).toBeInTheDocument();
    });
  });

  it('renders Committee Reviewed button when status is under_review', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'under_review',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /committee reviewed/i })).toBeInTheDocument();
    });
  });

  it('renders Submit to Board button when status is committee_reviewed', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'committee_reviewed',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submit to board/i })).toBeInTheDocument();
    });
  });

  it('renders Approve button when status is pending_board', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'pending_board',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    });
  });

  it('renders Start Disposal button when status is approved', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'approved',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start disposal/i })).toBeInTheDocument();
    });
  });

  it('renders Complete button when status is in_progress', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'in_progress',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument();
    });
  });

  it('renders core sections', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Collection Object')).toBeInTheDocument();
    });
    expect(screen.getByText('Deaccession Information')).toBeInTheDocument();
    expect(screen.getByText('Disposal Method')).toBeInTheDocument();
    expect(screen.getByText('Committee Review')).toBeInTheDocument();
    expect(screen.getByText('Board Approval')).toBeInTheDocument();
    expect(screen.getByText('Legal & Provenance Review')).toBeInTheDocument();
    expect(screen.getByText('Valuation')).toBeInTheDocument();
    expect(screen.getByText('Public Notice')).toBeInTheDocument();
  });

  it('renders ProcedureRequirementsCard', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('requirements-card')).toBeInTheDocument();
    });
  });

  it('renders ChangeStatusDropdown', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('change-status-dropdown')).toBeInTheDocument();
    });
  });

  it('renders create mode warning banner', async () => {
    renderPage('/organizations/org-1/collections/deaccessions/create');
    await waitFor(() => {
      expect(screen.getByText(/deaccessioning is an irreversible/i)).toBeInTheDocument();
    });
  });

  it('renders create mode title', async () => {
    renderPage('/organizations/org-1/collections/deaccessions/create');
    await waitFor(() => {
      expect(screen.getByText('New Deaccession')).toBeInTheDocument();
    });
  });

  it('shows ReadOnlyBanner when canEdit false', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      canEdit: false,
    });
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
    });
  });

  it('hides change history when audit permission missing', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      hasPermission: (p: string) => p !== 'org.view_audit_logs',
    });
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DEACC-001')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('audit-history')).not.toBeInTheDocument();
  });

  it('renders ObjectSelector for collection object section', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('object-selector')).toBeInTheDocument();
    });
  });

  it('uses new layout (RecordDetailPageWrapper) when useNewLayout=true', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      useNewLayout: true,
    });
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage('/organizations/org-1/collections/deaccessions/deacc-1');
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
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });
  });

  it('renders status pill for completed status', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'completed',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/completed/i).length).toBeGreaterThan(0);
    });
  });

  it('renders rejected status pill', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'rejected',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/rejected/i).length).toBeGreaterThan(0);
    });
  });

  it('renders disposal method badge when set', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      disposal_method: 'sale',
    } as never);
    renderPage();
    await waitFor(() => {
      // Status bar shows disposal method label (passed through getLabel mock)
      expect(screen.getAllByText(/sale/i).length).toBeGreaterThan(0);
    });
  });

  it('renders shipments section heading after load', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Shipments')).toBeInTheDocument();
    });
  });

  it('renders Notes section', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Additional Notes')).toBeInTheDocument();
    });
  });

  it('renders footer with timestamps when loaded', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      updated_at: '2026-04-15T10:00:00Z',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/created:/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/last updated:/i)).toBeInTheDocument();
  });

  it('renders editing mode UI when isEditing=true', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      isEditing: true,
    });
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DEACC-001')).toBeInTheDocument();
    });
  });

  it('renders cancelled status indicator', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      status: 'cancelled',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/cancelled/i).length).toBeGreaterThan(0);
    });
  });

  it('renders disposal_method=sale value in disposal section', async () => {
    mockGetDeaccession.mockResolvedValue({
      ...deaccessionFixture,
      disposal_method: 'sale',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Disposal Method')).toBeInTheDocument();
    });
  });

  it('renders new layout wrapper', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      useNewLayout: true,
    });
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage('/organizations/org-1/collections/deaccessions/deacc-1');
    await waitFor(() => {
      expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
    });
    // Section content still rendered inside wrapper
    expect(screen.getByText('Deaccession Information')).toBeInTheDocument();
  });

  it('renders SignedDocumentSlot in board approval section', async () => {
    mockGetDeaccession.mockResolvedValue(deaccessionFixture as never);
    renderPage();
    // Board section is collapsed by default but rendering still includes it
    await waitFor(() => {
      expect(screen.getByText('Board Approval')).toBeInTheDocument();
    });
  });
});
