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
    getInsurancePolicy: vi.fn(),
    getInsuranceCoverages: vi.fn(),
    createInsurancePolicy: vi.fn(),
    updateInsurancePolicy: vi.fn(),
    deleteInsurancePolicy: vi.fn(),
    createInsuranceCoverage: vi.fn(),
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
    permissions: ['insurance.edit', 'org.view_audit_logs'],
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
  WorkspacePageShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  EditModeIndicator: () => null,
  WorkspaceErrorFallback: () => null,
  withErrorBoundary: <T,>(C: T) => C,
  RestrictedFieldPlaceholder: () => null,
  EditablePlaceField: () => null,
  SectionEmptyState: () => null,
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
vi.mock('../../../components/collections/ProcedureRequirementsCard', () => ({
  ProcedureRequirementsCard: () => null,
}));

const mockGetInsurancePolicy = vi.mocked(api.getInsurancePolicy);
const mockGetInsuranceCoverages = vi.mocked(api.getInsuranceCoverages);

import InsuranceWorkspacePage from '../../../pages/collections/InsuranceWorkspacePage';

function renderInsurance(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/insurance/policies/create"
            element={<InsuranceWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/insurance/policies/:policyId"
            element={<InsuranceWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const samplePolicy = {
  policy_id: 'pol-1',
  organization_id: 'org-1',
  policy_number: 'POL-2024-001',
  policy_name: 'Annual Fine Arts',
  policy_type: 'blanket',
  provider_name: 'AIG',
  broker_name: 'Lloyd Brokers',
  effective_date: '2026-01-01T00:00:00Z',
  expiration_date: '2026-12-31T00:00:00Z',
  coverage_limit: 1000000,
  coverage_limit_currency: 'USD',
  per_occurrence_limit: 500000,
  deductible: 5000,
  annual_premium: 12000,
  status: 'active',
  notes: 'Renews annually',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

describe('InsuranceWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    mockGetInsuranceCoverages.mockResolvedValue({ coverages: [], total: 0 } as never);
  });

  describe('loading state', () => {
    it('shows the loading indicator', () => {
      mockGetInsurancePolicy.mockImplementation(() => new Promise(() => {}));
      renderInsurance('/organizations/org-1/collections/insurance/policies/pol-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the not-found message', async () => {
      mockGetInsurancePolicy.mockRejectedValue(new Error('Service down'));
      renderInsurance('/organizations/org-1/collections/insurance/policies/pol-1');
      await waitFor(() => {
        expect(screen.getByText('Insurance policy not found')).toBeInTheDocument();
      });
      expect(screen.getByText('Service down')).toBeInTheDocument();
    });
  });

  describe('view mode with data', () => {
    it('renders policy detail sections', async () => {
      mockGetInsurancePolicy.mockResolvedValue(samplePolicy as never);
      renderInsurance('/organizations/org-1/collections/insurance/policies/pol-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ws-section-provider')).toBeInTheDocument();
      expect(screen.getByTestId('ws-section-coverage')).toBeInTheDocument();
      expect(screen.getByTestId('ws-section-dates')).toBeInTheDocument();
    });

    it('hides change history without org.view_audit_logs', async () => {
      mockGetInsurancePolicy.mockResolvedValue(samplePolicy as never);
      mockHasPermission.mockImplementation((p: string) => p === 'insurance.edit');
      renderInsurance('/organizations/org-1/collections/insurance/policies/pol-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ws-section-history')).not.toBeInTheDocument();
    });

    it('shows change history when the audit permission is granted', async () => {
      mockGetInsurancePolicy.mockResolvedValue(samplePolicy as never);
      mockHasPermission.mockImplementation((p: string) => p === 'org.view_audit_logs' || p === 'insurance.edit');
      renderInsurance('/organizations/org-1/collections/insurance/policies/pol-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-history')).toBeInTheDocument();
      });
    });

    it('shows the read-only banner when the user cannot edit', async () => {
      mockGetInsurancePolicy.mockResolvedValue(samplePolicy as never);
      mockHasPermission.mockReturnValue(false);
      renderInsurance('/organizations/org-1/collections/insurance/policies/pol-1?layout=classic');
      await waitFor(() => {
        expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('renders the create header without fetching the policy', async () => {
      renderInsurance('/organizations/org-1/collections/insurance/policies/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-header')).toHaveTextContent('New Insurance Policy');
      });
      expect(mockGetInsurancePolicy).not.toHaveBeenCalled();
    });
  });
});
