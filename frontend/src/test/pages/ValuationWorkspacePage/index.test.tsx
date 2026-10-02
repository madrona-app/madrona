import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../../../lib/api';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return {
    ...actual,
    getValuation: vi.fn(),
    createValuation: vi.fn(),
    updateValuation: vi.fn(),
    deleteValuation: vi.fn(),
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
    permissions: ['valuations.edit', 'org.view_audit_logs'],
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

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: () => ({
    getLookup: () => [],
    getLabel: (_: string, v: string) => v,
  }),
}));

vi.mock('../../../components/workspace', () => ({
  WorkspaceHeader: ({ title }: { title?: string }) => (
    <header data-testid="ws-header">{title}</header>
  ),
  WorkspaceErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
vi.mock('../../../components/NavigationBlockerDialog', () => ({
  NavigationBlockerDialog: () => null,
}));
vi.mock('../../../components/collections/ProcedureRequirementsCard', () => ({
  ProcedureRequirementsCard: () => null,
}));
vi.mock('../../../components/collections/ObjectSelector', () => ({
  ObjectSelector: () => <div data-testid="object-selector" />,
}));
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: () => null,
}));

const mockGetValuation = vi.mocked(api.getValuation);

import ValuationWorkspacePage from '../../../pages/collections/ValuationWorkspacePage';

function renderValuation(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/valuations/create"
            element={<ValuationWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/valuations/:valuationId"
            element={<ValuationWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleValuation = {
  valuation_id: 'val-1',
  organization_id: 'org-1',
  valuation_type: 'insurance',
  valuation_amount: 50000,
  valuation_currency: 'USD',
  valuation_date: '2026-04-01T00:00:00Z',
  valuation_method: 'market_comparison',
  is_current: true,
  object_id: 'obj-1',
  valuator_id: null,
  valuator_credentials: null,
  valid_from: '2026-04-01T00:00:00Z',
  valid_until: '2027-04-01T00:00:00Z',
  documentation_reference: null,
  valuation_note: null,
  status: 'active',
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

describe('ValuationWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading state', () => {
    it('shows the shell loader', () => {
      mockGetValuation.mockImplementation(() => new Promise(() => {}));
      renderValuation('/organizations/org-1/collections/valuations/val-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows the shell error', async () => {
      mockGetValuation.mockRejectedValue(new Error('boom'));
      renderValuation('/organizations/org-1/collections/valuations/val-1');
      await waitFor(() => {
        expect(screen.getByTestId('shell-error')).toBeInTheDocument();
      });
    });
  });

  describe('view mode with data', () => {
    it('renders the valuation sections', async () => {
      mockGetValuation.mockResolvedValue(sampleValuation as never);
      renderValuation('/organizations/org-1/collections/valuations/val-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ws-section-valuator')).toBeInTheDocument();
      expect(screen.getByTestId('ws-section-validity')).toBeInTheDocument();
    });

    it('renders change history when user has audit permission', async () => {
      mockGetValuation.mockResolvedValue(sampleValuation as never);
      mockHasPermission.mockImplementation((p: string) => p === 'org.view_audit_logs' || p === 'valuations.edit');
      renderValuation('/organizations/org-1/collections/valuations/val-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-history')).toBeInTheDocument();
      });
    });

    it('hides change history when user lacks audit permission', async () => {
      mockGetValuation.mockResolvedValue(sampleValuation as never);
      mockHasPermission.mockImplementation((p: string) => p === 'valuations.edit');
      renderValuation('/organizations/org-1/collections/valuations/val-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ws-section-history')).not.toBeInTheDocument();
    });

    it('shows read-only banner when user cannot edit', async () => {
      mockGetValuation.mockResolvedValue(sampleValuation as never);
      mockHasPermission.mockReturnValue(false);
      renderValuation('/organizations/org-1/collections/valuations/val-1?layout=classic');
      await waitFor(() => {
        expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('does not call getValuation', async () => {
      renderValuation('/organizations/org-1/collections/valuations/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(mockGetValuation).not.toHaveBeenCalled();
    });
  });
});
