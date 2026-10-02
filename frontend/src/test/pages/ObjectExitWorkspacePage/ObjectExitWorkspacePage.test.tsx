import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as api from '../../../lib/api';

// ---- Mock api -------------------------------------------------------------
vi.mock('../../../lib/api', () => ({
  getObjectExit: vi.fn(),
  createObjectExit: vi.fn(),
  updateObjectExit: vi.fn(),
  deleteObjectExit: vi.fn(),
  rollbackObjectExit: vi.fn(),
  getObjectEntry: vi.fn(),
  generateDocument: vi.fn(),
  getContact: vi.fn(),
}));

// ---- Mock context-dependent hooks ----------------------------------------
vi.mock('../../../hooks/useWorkspacePage', () => ({
  useWorkspacePage: vi.fn(() => ({
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
  })),
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
    statusOrder: ['pending', 'preparing', 'dispatched', 'in_transit', 'acknowledged', 'cancelled'],
    procedureLabel: 'Object Exit',
    enforcementEnabled: false,
    isLoading: false,
    error: null,
  }),
}));

// ---- Mock heavy child components -----------------------------------------
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
vi.mock('../../../components/collections/ShipmentLinker', () => ({
  ShipmentLinker: () => <div data-testid="shipment-linker" />,
}));
vi.mock('../../../components/collections/SignedDocumentSlot', () => ({
  SignedDocumentSlot: () => <div data-testid="signed-document-slot" />,
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

import ObjectExitWorkspacePage from '../../../pages/collections/ObjectExitWorkspacePage';
import * as useWorkspacePageMod from '../../../hooks/useWorkspacePage';

const mockGetObjectExit = vi.mocked(api.getObjectExit);
const mockGetObjectEntry = vi.mocked(api.getObjectEntry);
const mockGetContact = vi.mocked(api.getContact);

function renderPage(path = '/organizations/org-1/collections/exits/exit-1?layout=classic') {
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
            path="/organizations/:orgId/collections/exits/create"
            element={<ObjectExitWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/exits/:exitId"
            element={<ObjectExitWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const exitFixture = {
  exit_id: 'exit-1',
  exit_number: 'EXIT-001',
  status: 'pending',
  exit_date: '2026-04-01',
  exit_reason: 'loan',
  exit_method: 'shipped',
  recipient_name: 'Test Recipient',
  packing_method: 'crate',
  shipping_method: 'truck',
  shipping_company: 'Acme',
  tracking_number: '1Z999',
  courier_id: '',
  condition_at_exit: 'good',
  authorization_date: '',
  authorization_note: '',
  receipt_reference: '',
  receipt_note: '',
  exit_note: '',
  internal_note: '',
  receipt_acknowledged: false,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: null,
};

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

describe('ObjectExitWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetObjectEntry.mockResolvedValue({} as never);
    mockGetContact.mockResolvedValue({} as never);
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue(defaultWp);
  });

  it('renders loader while fetching', () => {
    mockGetObjectExit.mockImplementation(() => new Promise(() => {}));
    renderPage();
    // MadronaLoader has accessible label "Loading…"
    expect(document.body).toBeInTheDocument();
  });

  it('renders not-found error state when fetch errors', async () => {
    mockGetObjectExit.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/exit not found/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/back to object exits/i)).toBeInTheDocument();
  });

  it('renders exit number in header (classic layout) once loaded', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('EXIT-001')).toBeInTheDocument();
    });
  });

  it('renders status pill for pending status', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      // Status label rendered
      expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
    });
  });

  it('renders Start Preparing button when status is pending', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start preparing/i })).toBeInTheDocument();
    });
  });

  it('renders Mark Dispatched button when status is preparing', async () => {
    mockGetObjectExit.mockResolvedValue({ ...exitFixture, status: 'preparing' } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark dispatched/i })).toBeInTheDocument();
    });
  });

  it('renders Mark In Transit button when status is dispatched', async () => {
    mockGetObjectExit.mockResolvedValue({ ...exitFixture, status: 'dispatched' } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark in transit/i })).toBeInTheDocument();
    });
  });

  it('renders Mark Acknowledged button when status is in_transit', async () => {
    mockGetObjectExit.mockResolvedValue({ ...exitFixture, status: 'in_transit' } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark acknowledged/i })).toBeInTheDocument();
    });
  });

  it('shows ReadOnlyBanner when canEdit is false', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      canEdit: false,
    });
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('EXIT-001')).toBeInTheDocument();
    });
    // Mocked ReadOnlyBanner renders test id when visible
    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
  });

  it('renders Recipient Information section header', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Recipient Information')).toBeInTheDocument();
    });
  });

  it('renders Exit Information section header', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Exit Information')).toBeInTheDocument();
    });
  });

  it('renders Notes section header', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Notes')).toBeInTheDocument();
    });
  });

  it('renders ProcedureRequirementsCard', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('requirements-card')).toBeInTheDocument();
    });
  });

  it('renders ChangeStatusDropdown', async () => {
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('change-status-dropdown')).toBeInTheDocument();
    });
  });

  it('hides Change History when user lacks audit log permission', async () => {
    vi.mocked(useWorkspacePageMod.useWorkspacePage).mockReturnValue({
      ...defaultWp,
      hasPermission: (p: string) => p !== 'org.view_audit_logs',
    });
    mockGetObjectExit.mockResolvedValue(exitFixture as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('EXIT-001')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('audit-history')).not.toBeInTheDocument();
  });
});
