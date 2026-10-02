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
    getExhibition: vi.fn(),
    createExhibition: vi.fn(),
    updateExhibition: vi.fn(),
    deleteExhibition: vi.fn(),
    apiFetch: vi.fn(),
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
    permissions: ['exhibit.edit', 'org.view_audit_logs'],
  }),
}));

vi.mock('../../../hooks/useFieldAccess', () => ({
  useFieldAccess: () => ({ isRestricted: () => false, hasRestrictions: false }),
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

// Stub all heavy exhibit tab components
vi.mock('../../../components/RecordDiscussionTab', () => ({
  RecordDiscussionTab: () => null,
}));
vi.mock('../../../components/collections/ExhibitionObjectLinker', () => ({
  ExhibitionObjectLinker: () => null,
}));
vi.mock('../../../components/exhibit/ExhibitionLabelsTab', () => ({
  ExhibitionLabelsTab: () => null,
}));
vi.mock('../../../components/exhibit/InterpretiveContentTab', () => ({
  InterpretiveContentTab: () => null,
}));
vi.mock('../../../components/exhibit/TouringScheduleTab', () => ({
  TouringScheduleTab: () => null,
}));
vi.mock('../../../components/exhibit/ExhibitionChecklistTab', () => ({
  default: () => null,
}));
vi.mock('../../../components/exhibit/ExhibitionBudgetTab', () => ({
  ExhibitionBudgetTab: () => null,
}));
vi.mock('../../../components/exhibit/ExhibitionLogisticsTab', () => ({
  ExhibitionLogisticsTab: () => null,
}));
vi.mock('../../../components/exhibit/ExhibitionLoansTab', () => ({
  ExhibitionLoansTab: () => null,
}));
vi.mock('../../../components/exhibit/ExportPanel/ExportPanel', () => ({
  default: () => null,
}));

const mockGetExhibition = vi.mocked(api.getExhibition);
const mockApiFetch = vi.mocked(api.apiFetch);

import ExhibitionWorkspacePage from '../../../pages/collections/ExhibitionWorkspacePage';

function renderExhibition(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/exhibit/exhibitions/create"
            element={<ExhibitionWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/exhibit/exhibitions/:exhibitionId"
            element={<ExhibitionWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleExhibition = {
  exhibition_id: 'ex-1',
  organization_id: 'org-1',
  title: 'Spring Show',
  exhibition_type: 'temporary',
  status: 'planned',
  planned_start_date: '2026-05-01T00:00:00Z',
  planned_end_date: '2026-08-30T00:00:00Z',
  curator_notes: null,
  outcome: null,
  provisos: null,
  is_public: false,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  _restricted_fields: [],
};

describe('ExhibitionWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    mockApiFetch.mockResolvedValue({ venues: [] } as never);
  });

  describe('loading state', () => {
    it('shows the loader', () => {
      mockGetExhibition.mockImplementation(() => new Promise(() => {}));
      renderExhibition('/organizations/org-1/exhibit/exhibitions/ex-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the not-found fallback', async () => {
      mockGetExhibition.mockRejectedValue(new Error('gone'));
      renderExhibition('/organizations/org-1/exhibit/exhibitions/ex-1');
      await waitFor(() => {
        expect(screen.getByText('Exhibition not found')).toBeInTheDocument();
      });
      expect(screen.getByText('gone')).toBeInTheDocument();
    });
  });

  describe('view mode with data', () => {
    it('renders main exhibition sections', async () => {
      mockGetExhibition.mockResolvedValue(sampleExhibition as never);
      renderExhibition('/organizations/org-1/exhibit/exhibitions/ex-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ws-section-dates')).toBeInTheDocument();
    });

    it('shows the read-only banner when user cannot edit', async () => {
      mockGetExhibition.mockResolvedValue(sampleExhibition as never);
      mockHasPermission.mockReturnValue(false);
      renderExhibition('/organizations/org-1/exhibit/exhibitions/ex-1?layout=classic');
      await waitFor(() => {
        expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
      });
    });

    it('shows change history when audit permission granted', async () => {
      mockGetExhibition.mockResolvedValue(sampleExhibition as never);
      mockHasPermission.mockImplementation((p: string) => p === 'org.view_audit_logs' || p === 'exhibit.edit');
      renderExhibition('/organizations/org-1/exhibit/exhibitions/ex-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-history')).toBeInTheDocument();
      });
    });

    it('hides change history without audit permission', async () => {
      mockGetExhibition.mockResolvedValue(sampleExhibition as never);
      mockHasPermission.mockImplementation((p: string) => p === 'exhibit.edit');
      renderExhibition('/organizations/org-1/exhibit/exhibitions/ex-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ws-section-history')).not.toBeInTheDocument();
    });
  });

  describe('create mode', () => {
    it('does not call getExhibition', async () => {
      renderExhibition('/organizations/org-1/exhibit/exhibitions/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-details')).toBeInTheDocument();
      });
      expect(mockGetExhibition).not.toHaveBeenCalled();
    });
  });
});
