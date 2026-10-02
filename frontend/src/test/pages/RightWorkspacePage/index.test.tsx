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
    getRight: vi.fn(),
    createRight: vi.fn(),
    updateRight: vi.fn(),
    deleteRight: vi.fn(),
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
    permissions: ['rights.edit', 'org.view_audit_logs'],
  }),
}));

vi.mock('../../../hooks/useFieldAccess', () => ({
  useFieldAccess: () => ({ isRestricted: () => false, hasRestrictions: false }),
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
vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: () => null,
}));
vi.mock('../../../components/collections/ObjectSelector', () => ({
  ObjectSelector: () => <div data-testid="object-selector" />,
}));

const mockGetRight = vi.mocked(api.getRight);

import RightWorkspacePage from '../../../pages/collections/RightWorkspacePage';

function renderRight(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/rights/create"
            element={<RightWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/rights/:rightId"
            element={<RightWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleRight = {
  right_id: 'right-1',
  organization_id: 'org-1',
  object_id: 'obj-1',
  right_type: 'copyright',
  status: 'active',
  rights_holder_contact_id: null,
  rights_holder_credit: null,
  start_date: '2026-01-01T00:00:00Z',
  end_date: null,
  territory: 'US',
  license_type: 'exclusive',
  license_reference: null,
  fee_required: false,
  fee_amount: null,
  fee_currency: 'USD',
  is_orphan_work: false,
  agreement_reference: null,
  right_note: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

describe('RightWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading state', () => {
    it('shows the loader while fetching the right', () => {
      mockGetRight.mockImplementation(() => new Promise(() => {}));
      renderRight('/organizations/org-1/collections/rights/right-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the not-found fallback', async () => {
      mockGetRight.mockRejectedValue(new Error('cannot reach'));
      renderRight('/organizations/org-1/collections/rights/right-1');
      await waitFor(() => {
        expect(screen.getByText('Right not found')).toBeInTheDocument();
      });
      expect(screen.getByText('cannot reach')).toBeInTheDocument();
    });
  });

  describe('view mode with data', () => {
    it('renders the right sections', async () => {
      mockGetRight.mockResolvedValue(sampleRight as never);
      renderRight('/organizations/org-1/collections/rights/right-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ws-section-duration')).toBeInTheDocument();
      expect(screen.getByTestId('ws-section-license')).toBeInTheDocument();
    });

    it('shows change history with audit permission', async () => {
      mockGetRight.mockResolvedValue(sampleRight as never);
      mockHasPermission.mockImplementation((p: string) => p === 'org.view_audit_logs' || p === 'rights.edit');
      renderRight('/organizations/org-1/collections/rights/right-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-history')).toBeInTheDocument();
      });
    });

    it('hides change history without audit permission', async () => {
      mockGetRight.mockResolvedValue(sampleRight as never);
      mockHasPermission.mockImplementation((p: string) => p === 'rights.edit');
      renderRight('/organizations/org-1/collections/rights/right-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ws-section-history')).not.toBeInTheDocument();
    });

    it('shows the read-only banner without edit permission', async () => {
      mockGetRight.mockResolvedValue(sampleRight as never);
      mockHasPermission.mockReturnValue(false);
      renderRight('/organizations/org-1/collections/rights/right-1?layout=classic');
      await waitFor(() => {
        expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('does not call getRight', async () => {
      renderRight('/organizations/org-1/collections/rights/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-header')).toHaveTextContent('New Rights Record');
      });
      expect(mockGetRight).not.toHaveBeenCalled();
    });
  });
});
