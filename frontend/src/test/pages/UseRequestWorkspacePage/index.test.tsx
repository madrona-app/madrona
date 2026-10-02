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
    getUseRequest: vi.fn(),
    createUseRequest: vi.fn(),
    updateUseRequest: vi.fn(),
    deleteUseRequest: vi.fn(),
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
    permissions: ['use_requests.edit', 'org.view_audit_logs'],
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
vi.mock('../../../components/collections/UseRequestObjectLinker', () => ({
  UseRequestObjectLinker: () => null,
}));

const mockGetUseRequest = vi.mocked(api.getUseRequest);

import UseRequestWorkspacePage from '../../../pages/collections/UseRequestWorkspacePage';

function renderUseRequest(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/use-requests/create"
            element={<UseRequestWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/use-requests/:requestId"
            element={<UseRequestWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleRequest = {
  request_id: 'req-1',
  organization_id: 'org-1',
  request_number: 'UR-2026-001',
  requester_name: 'Alice Researcher',
  requester_email: 'alice@example.com',
  use_type: 'reproduction',
  use_purpose: 'publication',
  project_title: 'A book',
  status: 'submitted',
  access_date_start: null,
  access_date_end: null,
  reproduction_type: null,
  exhibition_title: null,
  fee_quoted: null,
  approval_conditions: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

describe('UseRequestWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading state', () => {
    it('shows the loader', () => {
      mockGetUseRequest.mockImplementation(() => new Promise(() => {}));
      renderUseRequest('/organizations/org-1/collections/use-requests/req-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the not-found fallback', async () => {
      mockGetUseRequest.mockRejectedValue(new Error('500'));
      renderUseRequest('/organizations/org-1/collections/use-requests/req-1');
      await waitFor(() => {
        expect(screen.getByText('Use request not found')).toBeInTheDocument();
      });
    });
  });

  describe('view mode with data', () => {
    it('renders the requester and details sections', async () => {
      mockGetUseRequest.mockResolvedValue(sampleRequest as never);
      renderUseRequest('/organizations/org-1/collections/use-requests/req-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-requester')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
    });

    it('shows change history with audit permission', async () => {
      mockGetUseRequest.mockResolvedValue(sampleRequest as never);
      mockHasPermission.mockImplementation((p: string) => p === 'org.view_audit_logs' || p === 'use_requests.edit');
      renderUseRequest('/organizations/org-1/collections/use-requests/req-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-history')).toBeInTheDocument();
      });
    });

    it('hides change history without audit permission', async () => {
      mockGetUseRequest.mockResolvedValue(sampleRequest as never);
      mockHasPermission.mockImplementation((p: string) => p === 'use_requests.edit');
      renderUseRequest('/organizations/org-1/collections/use-requests/req-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-requester')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ws-section-history')).not.toBeInTheDocument();
    });

    it('shows read-only banner when user cannot edit', async () => {
      mockGetUseRequest.mockResolvedValue(sampleRequest as never);
      mockHasPermission.mockReturnValue(false);
      renderUseRequest('/organizations/org-1/collections/use-requests/req-1?layout=classic');
      await waitFor(() => {
        expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('does not call getUseRequest', async () => {
      renderUseRequest('/organizations/org-1/collections/use-requests/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-header')).toHaveTextContent('New Use Request');
      });
      expect(mockGetUseRequest).not.toHaveBeenCalled();
    });
  });
});
