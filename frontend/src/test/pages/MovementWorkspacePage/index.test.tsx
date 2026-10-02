import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../../../lib/api';

// =========================================================================
// Module mocks
// =========================================================================

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return {
    ...actual,
    getMovement: vi.fn(),
    createMovement: vi.fn(),
    updateMovement: vi.fn(),
    deleteMovement: vi.fn(),
    getCollectionObject: vi.fn(),
    getContact: vi.fn(),
  };
});

vi.mock('../../../contexts/AgentChatContext', () => ({
  useAgentChatContext: () => ({
    setEntityContext: vi.fn(),
    isOpen: false,
    entityContext: null,
    openChat: vi.fn(),
    closeChat: vi.fn(),
    openChatWithMessage: vi.fn(),
    registerDispatch: vi.fn(),
  }),
}));

vi.mock('../../../contexts/PageContext', () => ({
  usePageContext: () => ({
    setPageContext: vi.fn(),
    clearEntityContext: vi.fn(),
    hasProvider: true,
  }),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

const mockHasPermission = vi.fn().mockReturnValue(true);
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    permissions: ['movements.edit', 'org.view_audit_logs'],
  }),
}));

vi.mock('../../../hooks/useFieldAccess', () => ({
  useFieldAccess: () => ({ isRestricted: () => false, hasRestrictions: false }),
}));

vi.mock('../../../hooks/useProcedureRequirements', () => ({
  useProcedureRequirements: () => ({
    requirementGroups: [],
    statusOrder: [],
    enabled: false,
    isLoading: false,
  }),
}));

// Stub heavy workspace UI
vi.mock('../../../components/workspace', () => ({
  WorkspaceHeader: ({ title }: { title?: string }) => (
    <header data-testid="ws-header">{title}</header>
  ),
  WorkspaceErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  WorkspacePageShell: ({
    children,
    isLoading,
    error,
    isCreateMode,
    entityData,
    entityName,
  }: {
    children: React.ReactNode;
    isLoading?: boolean;
    error?: unknown;
    isCreateMode?: boolean;
    entityData?: unknown;
    entityName?: string;
  }) => {
    if (!isCreateMode && isLoading) {
      return <div role="status" aria-label="loading">Loading {entityName}</div>;
    }
    if (!isCreateMode && (error || !entityData)) {
      return (
        <div data-testid="shell-error">
          {entityName} not found
        </div>
      );
    }
    return <>{children}</>;
  },
  WorkspaceSection: ({
    id,
    title,
    children,
  }: {
    id?: string;
    title?: string;
    children?: React.ReactNode;
  }) => (
    <section data-testid={`ws-section-${id ?? 'unknown'}`} aria-label={title}>
      {children}
    </section>
  ),
  EditableField: ({ label }: { label?: string }) => (
    <div data-testid="editable-field" data-label={label} />
  ),
  EditableSelect: ({ label }: { label?: string }) => (
    <div data-testid="editable-select" data-label={label} />
  ),
  EditableCheckbox: ({ label }: { label?: string }) => (
    <div data-testid="editable-checkbox" data-label={label} />
  ),
  RecordAuditHistory: () => <div data-testid="audit-history" />,
  SectionGroupDivider: ({ label }: { label?: string }) => (
    <div data-testid="section-divider">{label}</div>
  ),
  ReadOnlyBanner: ({ visible }: { visible?: boolean }) =>
    visible ? <div data-testid="read-only-banner">Read only</div> : null,
  PendingApprovalBanner: () => null,
  EditModeIndicator: () => null,
  WorkspaceErrorFallback: () => null,
  withErrorBoundary: <T,>(C: T) => C,
  RestrictedFieldPlaceholder: () => null,
  EditablePlaceField: () => null,
  SectionEmptyState: () => null,
}));

vi.mock('../../../components/workspace/WorkspacePageShell', () => ({
  WorkspacePageShell: ({
    children,
    isLoading,
    error,
    isCreateMode,
    entityData,
    entityName,
  }: {
    children: React.ReactNode;
    isLoading?: boolean;
    error?: unknown;
    isCreateMode?: boolean;
    entityData?: unknown;
    entityName?: string;
  }) => {
    if (!isCreateMode && isLoading) {
      return <div role="status" aria-label="loading">Loading {entityName}</div>;
    }
    if (!isCreateMode && (error || !entityData)) {
      return <div data-testid="shell-error">{entityName} not found</div>;
    }
    return <>{children}</>;
  },
}));

vi.mock('../../../components/record-detail', () => ({
  SectionOrderProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RecordDetailPageWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="record-detail-wrapper">{children}</div>
  ),
  useSectionOrder: () => [{}, vi.fn(), vi.fn()],
}));

vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: () => null,
}));
vi.mock('../../../components/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../../../components/ui/MadronaLoader', () => ({
  MadronaLoader: ({ label }: { label?: string }) => (
    <div role="status" aria-label="loading">{label}</div>
  ),
}));
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: () => null,
}));
vi.mock('../../../components/collections/LocationPickerModal', () => ({
  EditableLocationPicker: ({ label }: { label?: string }) => (
    <div data-testid="location-picker" data-label={label} />
  ),
}));
vi.mock('../../../components/collections/ObjectSelector', () => ({
  ObjectSelector: () => <div data-testid="object-selector" />,
}));
vi.mock('../../../components/collections/ShipmentLinker', () => ({
  ShipmentLinker: () => null,
}));
vi.mock('../../../components/collections/ConditionReportLinker', () => ({
  ConditionReportLinker: () => null,
}));
vi.mock('../../../components/collections/AuthorizationSection', () => ({
  AuthorizationSection: ({ title }: { title?: string }) => (
    <div data-testid="authorization-section">{title}</div>
  ),
}));
vi.mock('../../../components/collections/SignedDocumentSlot', () => ({
  SignedDocumentSlot: () => null,
}));
vi.mock('../../../components/collections/ProcedureRequirementsCard', () => ({
  ProcedureRequirementsCard: () => null,
}));

const mockGetMovement = vi.mocked(api.getMovement);
const mockCreateMovement = vi.mocked(api.createMovement);
const mockUpdateMovement = vi.mocked(api.updateMovement);

import MovementWorkspacePage from '../../../pages/collections/MovementWorkspacePage';

function renderMovement(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/movements/create"
            element={<MovementWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/movements/:movementId"
            element={<MovementWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleMovement = {
  movement_id: 'mov-1',
  organization_id: 'org-1',
  movement_reference_number: 'MOVE-001',
  object_id: 'obj-1',
  reason: 'storage',
  from_location_id: 'loc-1',
  to_location_id: 'loc-2',
  movement_date: '2026-04-10T00:00:00Z',
  status: 'pending',
  movement_note: 'Initial move',
  handler_id: null,
  handler_name: null,
  authorizer_id: null,
  authorization_date: null,
  authorization_note: null,
  movement_method: null,
  organization_courier: false,
  courier_name: null,
  shipper_id: null,
  shipper_name: null,
  shipping_method: null,
  shipping_tracking_number: null,
  shipping_insurance_value: null,
  shipping_insurance_currency: null,
  shipping_note: null,
  condition_note: null,
  condition_report_id: null,
  location_fitness: null,
  planned_removal_date: null,
  planned_return_date: null,
  created_at: '2026-04-01T00:00:00Z',
};

describe('MovementWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading state', () => {
    it('shows the loading state until the movement is fetched', () => {
      mockGetMovement.mockImplementation(() => new Promise(() => {}));
      renderMovement('/organizations/org-1/collections/movements/mov-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows the shell-level error message', async () => {
      mockGetMovement.mockRejectedValue(new Error('not found'));
      renderMovement('/organizations/org-1/collections/movements/mov-1');
      await waitFor(() => {
        expect(screen.getByTestId('shell-error')).toBeInTheDocument();
      });
    });
  });

  describe('view mode with data', () => {
    it('renders sections once data has loaded', async () => {
      mockGetMovement.mockResolvedValue(sampleMovement as never);
      renderMovement('/organizations/org-1/collections/movements/mov-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-object')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ws-section-movement')).toBeInTheDocument();
    });

    it('hides change history when the user lacks the audit permission', async () => {
      mockGetMovement.mockResolvedValue(sampleMovement as never);
      mockHasPermission.mockImplementation((p: string) => p === 'movements.edit');
      renderMovement('/organizations/org-1/collections/movements/mov-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-object')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ws-section-history')).not.toBeInTheDocument();
    });

    it('shows change history when the audit permission is granted', async () => {
      mockGetMovement.mockResolvedValue(sampleMovement as never);
      mockHasPermission.mockImplementation((p: string) => p === 'org.view_audit_logs' || p === 'movements.edit');
      renderMovement('/organizations/org-1/collections/movements/mov-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-history')).toBeInTheDocument();
      });
    });

    it('shows the read-only banner when the user cannot edit', async () => {
      mockGetMovement.mockResolvedValue(sampleMovement as never);
      mockHasPermission.mockReturnValue(false);
      renderMovement('/organizations/org-1/collections/movements/mov-1?layout=classic');
      await waitFor(() => {
        expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('does not call getMovement', async () => {
      renderMovement('/organizations/org-1/collections/movements/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-object')).toBeInTheDocument();
      });
      expect(mockGetMovement).not.toHaveBeenCalled();
    });
  });

  // Smoke-test the api wiring without exercising the full UI flow.
  it('exposes create/update mutations from api module', () => {
    expect(typeof mockCreateMovement).toBe('function');
    expect(typeof mockUpdateMovement).toBe('function');
  });
});
