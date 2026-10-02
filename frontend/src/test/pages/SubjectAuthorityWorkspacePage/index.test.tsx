import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubjectAuthorityWorkspacePage from '../../../pages/collections/SubjectAuthorityWorkspacePage';
import * as api from '../../../lib/api';

// jsdom polyfill for scrollIntoView used by useUnifiedSectionState
if (!Element.prototype.scrollIntoView) {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  Element.prototype.scrollIntoView = function () {};
}

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

const { mockHasPermission, mockSetEntityContext, mockSetPageContext, mockClearEntityContext } =
  vi.hoisted(() => ({
    mockHasPermission: vi.fn().mockReturnValue(true),
    mockSetEntityContext: vi.fn(),
    mockSetPageContext: vi.fn(),
    mockClearEntityContext: vi.fn(),
  }));

vi.mock('../../../lib/api', () => ({
  getSubjectAuthority: vi.fn(),
  createSubjectAuthority: vi.fn(),
  updateSubjectAuthority: vi.fn(),
  deleteSubjectAuthority: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(() => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: vi.fn().mockReturnValue(true),
    hasAllPermissions: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock('../../../hooks/useFieldAccess', () => ({
  useFieldAccess: vi.fn(() => ({
    isRestricted: () => false,
    hasRestrictions: false,
  })),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { user_id: 'u-1', email: 'test@example.com' },
    activeOrganizationId: 'org-1',
    isLoading: false,
    isAuthenticated: true,
  })),
}));

vi.mock('../../../contexts/AgentChatContext', () => ({
  useAgentChatContext: vi.fn(() => ({
    setEntityContext: mockSetEntityContext,
    isOpen: false,
    entityContext: null,
    openChat: vi.fn(),
    closeChat: vi.fn(),
    openChatWithMessage: vi.fn(),
    registerDispatch: vi.fn(),
  })),
}));

vi.mock('../../../contexts/PageContext', () => ({
  usePageContext: vi.fn(() => ({
    pageContext: {},
    pageContextRef: { current: {} },
    setPageContext: mockSetPageContext,
    clearEntityContext: mockClearEntityContext,
    hasProvider: true,
  })),
}));

// Mock RecordAuditHistory (depends on more APIs)
vi.mock('../../../components/workspace/RecordAuditHistory', () => ({
  RecordAuditHistory: () => <div data-testid="record-audit-history" />,
}));

// Mock CreateTaskSlideOver
vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-task-slideover" /> : null,
}));

// Mock RecordDetailPageWrapper - just render children (and capture props)
vi.mock('../../../components/record-detail', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../components/record-detail'
  );
  return {
    ...actual,
    RecordDetailPageWrapper: ({
      children,
      callbacks,
    }: {
      children: React.ReactNode;
      callbacks?: { onDelete?: () => void; onCreateTask?: () => void };
    }) => (
      <div data-testid="record-detail-wrapper">
        <button data-testid="trigger-delete" onClick={() => callbacks?.onDelete?.()}>
          trigger-delete
        </button>
        <button data-testid="trigger-create-task" onClick={() => callbacks?.onCreateTask?.()}>
          trigger-create-task
        </button>
        {children}
      </div>
    ),
  };
});

const mockGetSubjectAuthority = vi.mocked(api.getSubjectAuthority);
const mockCreateSubjectAuthority = vi.mocked(api.createSubjectAuthority);
const mockUpdateSubjectAuthority = vi.mocked(api.updateSubjectAuthority);
const mockDeleteSubjectAuthority = vi.mocked(api.deleteSubjectAuthority);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage({
  orgId = 'org-1',
  authorityId = 'subj-1',
  layout = 'classic',
}: {
  orgId?: string;
  authorityId?: string | null;
  layout?: 'classic' | 'new';
} = {}) {
  const qc = createTestQueryClient();
  const path = authorityId
    ? `/organizations/${orgId}/collections/subject-authorities/${authorityId}${layout === 'classic' ? '?layout=classic' : ''}`
    : `/organizations/${orgId}/collections/subject-authorities/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/subject-authorities/create"
            element={<SubjectAuthorityWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/subject-authorities/:authorityId"
            element={<SubjectAuthorityWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/vocabularies"
            element={<div>Vocabularies</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const fixtureSubject = {
  authority_id: 'subj-1',
  preferred_term: 'Madonna and Child',
  variant_terms: ['Maria with Child'],
  subject_type: 'iconographic',
  aat_id: '300025943',
  iconclass_id: '11F411',
  wikidata_id: 'Q208267',
  broader_subject_id: null,
  description: 'Religious iconographic subject',
  notes: 'Internal notes here',
  status: 'active',
  linked_objects_count: 3,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('SubjectAuthorityWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading state', () => {
    it('shows loader while fetching authority', () => {
      mockGetSubjectAuthority.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows not-found message on error', async () => {
      mockGetSubjectAuthority.mockRejectedValue(new Error('boom'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Subject Authority not found/i)).toBeInTheDocument();
      });
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  describe('view mode (classic layout)', () => {
    it('renders the preferred term as title', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Madonna and Child')).toBeInTheDocument();
      });
    });

    it('shows Active status badge', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
    });

    it('shows Deprecated badge for deprecated subjects', async () => {
      mockGetSubjectAuthority.mockResolvedValue({
        ...fixtureSubject,
        status: 'deprecated',
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Deprecated')).toBeInTheDocument();
      });
    });

    it('shows linked objects count when > 0', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Linked to 3 objects/i)).toBeInTheDocument();
      });
    });

    it('renders the subject type chip', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('iconographic')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('renders New Subject Authority title in create mode', async () => {
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Subject Authority')).toBeInTheDocument();
      });
      expect(mockGetSubjectAuthority).not.toHaveBeenCalled();
    });

    it('shows Create Subject button in create mode', async () => {
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create subject/i })
        ).toBeInTheDocument();
      });
    });

    it('does not show status badge bar in create mode', async () => {
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Subject Authority')).toBeInTheDocument();
      });
      // Active badge is bound to existingAuthority — should NOT appear
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
    });

    it('calls createSubjectAuthority with payload when title set', async () => {
      mockCreateSubjectAuthority.mockResolvedValue({
        ...fixtureSubject,
        authority_id: 'new-id',
      } as never);
      renderPage({ authorityId: null });

      await waitFor(() => {
        expect(screen.getByText('New Subject Authority')).toBeInTheDocument();
      });

      // Find the preferred-term input by placeholder
      const input = screen.getByPlaceholderText(/Madonna and Child/i);
      fireEvent.change(input, { target: { value: 'New Subject' } });

      const createBtn = screen.getByRole('button', { name: /create subject/i });
      fireEvent.click(createBtn);

      await waitFor(() => {
        expect(mockCreateSubjectAuthority).toHaveBeenCalled();
      });
      const payload = mockCreateSubjectAuthority.mock.calls[0][1];
      expect(payload.preferred_term).toBe('New Subject');
      expect(payload.subject_type).toBe('iconographic');
      expect(payload.status).toBe('active');
    });

    it('shows error when title is missing on create', async () => {
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Subject Authority')).toBeInTheDocument();
      });
      const createBtn = screen.getByRole('button', { name: /create subject/i });
      fireEvent.click(createBtn);
      await waitFor(() => {
        expect(screen.getByText(/Preferred term is required/i)).toBeInTheDocument();
      });
      expect(mockCreateSubjectAuthority).not.toHaveBeenCalled();
    });
  });

  describe('section editing & autosave', () => {
    it('saves when fields are edited (debounced autosave)', async () => {
      vi.useFakeTimers();
      try {
        mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
        mockUpdateSubjectAuthority.mockResolvedValue(fixtureSubject as never);

        renderPage();

        // Wait for the form to populate
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const inputs = screen.getAllByDisplayValue('Madonna and Child');
        expect(inputs.length).toBeGreaterThanOrEqual(1);
        fireEvent.change(inputs[0], { target: { value: 'Updated Term' } });

        // Advance fake timers past the 1s autosave debounce
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });

        expect(mockUpdateSubjectAuthority).toHaveBeenCalled();
        const payload = mockUpdateSubjectAuthority.mock.calls[0][2];
        expect(payload.preferred_term).toBe('Updated Term');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('delete flow', () => {
    it('opens delete confirmation when invoked through callback', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage({ layout: 'new' });

      await waitFor(() => {
        expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('trigger-delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete Subject Authority')).toBeInTheDocument();
      });
    });

    it('calls deleteSubjectAuthority on confirmation', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      mockDeleteSubjectAuthority.mockResolvedValue({} as never);
      renderPage({ layout: 'new' });

      await waitFor(() => {
        expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('trigger-delete'));

      // Locate the confirm-Delete button text inside the dialog (rendered via portal)
      const confirmBtn = await screen.findByText((content, el) => {
        return el?.tagName === 'BUTTON' && content.trim() === 'Delete';
      });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteSubjectAuthority).toHaveBeenCalledWith('org-1', 'subj-1');
      });
    });
  });

  describe('permissions / read-only', () => {
    it('shows read-only banner when user lacks edit permission', async () => {
      mockHasPermission.mockImplementation((perm: string) => perm !== 'subject_authorities.edit');
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Madonna and Child')).toBeInTheDocument();
      });
      expect(screen.getByText(/view only/i)).toBeInTheDocument();
    });

    it('hides Change History section when audit_logs perm missing', async () => {
      mockHasPermission.mockImplementation(
        (perm: string) => perm !== 'org.view_audit_logs'
      );
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Madonna and Child')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });
  });

  describe('section content / hooks integration', () => {
    it('renders the Description section content', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage();

      await waitFor(() => {
        // description value renders as input/textarea or text
        expect(screen.getByDisplayValue('Religious iconographic subject')).toBeInTheDocument();
      });
    });

    it('renders external identifier inputs with values when expanded', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage();

      // Wait for view to populate
      await waitFor(() => {
        expect(screen.getByText('Madonna and Child')).toBeInTheDocument();
      });

      // External Identifiers section is collapsed by default — expand it
      const externalToggle = screen.getByRole('button', { name: /external identifiers/i });
      fireEvent.click(externalToggle);

      await waitFor(() => {
        expect(screen.getByDisplayValue('300025943')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('11F411')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Q208267')).toBeInTheDocument();
    });

    it('renders variant terms when present', async () => {
      mockGetSubjectAuthority.mockResolvedValue(fixtureSubject as never);
      renderPage();

      await waitFor(() => {
        // variant terms are inside an input (edit) or chips (read)
        // In create-edit mode default isEditing=true, but with classic layout & view mode also fine
        const matches = screen.queryAllByText('Maria with Child');
        expect(matches.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
