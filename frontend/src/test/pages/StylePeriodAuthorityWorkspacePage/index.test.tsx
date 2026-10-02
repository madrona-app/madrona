import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StylePeriodAuthorityWorkspacePage from '../../../pages/collections/StylePeriodAuthorityWorkspacePage';
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
  getStylePeriodAuthority: vi.fn(),
  createStylePeriodAuthority: vi.fn(),
  updateStylePeriodAuthority: vi.fn(),
  deleteStylePeriodAuthority: vi.fn(),
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

vi.mock('../../../components/workspace/RecordAuditHistory', () => ({
  RecordAuditHistory: () => <div data-testid="record-audit-history" />,
}));

vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-task-slideover" /> : null,
}));

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

const mockGetStylePeriodAuthority = vi.mocked(api.getStylePeriodAuthority);
const mockCreateStylePeriodAuthority = vi.mocked(api.createStylePeriodAuthority);
const mockUpdateStylePeriodAuthority = vi.mocked(api.updateStylePeriodAuthority);
const mockDeleteStylePeriodAuthority = vi.mocked(api.deleteStylePeriodAuthority);

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
  authorityId = 'auth-1',
  layout = 'classic',
}: {
  orgId?: string;
  authorityId?: string | null;
  layout?: 'classic' | 'new';
} = {}) {
  const qc = createTestQueryClient();
  const path = authorityId
    ? `/organizations/${orgId}/collections/style-period-authorities/${authorityId}${layout === 'classic' ? '?layout=classic' : ''}`
    : `/organizations/${orgId}/collections/style-period-authorities/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/style-period-authorities/create"
            element={<StylePeriodAuthorityWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/style-period-authorities/:authorityId"
            element={<StylePeriodAuthorityWorkspacePage />}
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

const fixtureAuthority = {
  authority_id: 'auth-1',
  preferred_term: 'Baroque',
  variant_terms: ['Barocco'],
  authority_type: 'period',
  aat_id: '300021147',
  wikidata_id: 'Q37853',
  culture: 'Italian',
  date_display: '1600-1750',
  date_earliest: '1600',
  date_latest: '1750',
  geographic_scope: 'Western Europe',
  parent_authority_id: null,
  description: 'Period of dramatic, exuberant style',
  notes: 'Curator notes',
  status: 'active',
  linked_objects_count: 5,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('StylePeriodAuthorityWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading & error', () => {
    it('shows loader while fetching', () => {
      mockGetStylePeriodAuthority.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows not-found message on error', async () => {
      mockGetStylePeriodAuthority.mockRejectedValue(new Error('boom'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Style\/Period Authority not found/i)).toBeInTheDocument();
      });
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  describe('view mode (classic layout)', () => {
    it('renders preferred term as title', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Baroque')).toBeInTheDocument();
      });
    });

    it('shows Active status badge and authority type chip', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
      expect(screen.getByText('period')).toBeInTheDocument();
    });

    it('shows linked objects count', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Linked to 5 objects/i)).toBeInTheDocument();
      });
    });

    it('renders dates section data', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByDisplayValue('1600-1750')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('1600')).toBeInTheDocument();
      expect(screen.getByDisplayValue('1750')).toBeInTheDocument();
    });
  });

  describe('create mode', () => {
    it('renders New Style/Period Authority title', async () => {
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Style/Period Authority')).toBeInTheDocument();
      });
      expect(mockGetStylePeriodAuthority).not.toHaveBeenCalled();
    });

    it('shows Create Style/Period button in create mode', async () => {
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create style\/period/i })
        ).toBeInTheDocument();
      });
    });

    it('blocks create when preferred_term is empty', async () => {
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Style/Period Authority')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /create style\/period/i }));
      await waitFor(() => {
        expect(screen.getByText(/Preferred term is required/i)).toBeInTheDocument();
      });
      expect(mockCreateStylePeriodAuthority).not.toHaveBeenCalled();
    });

    it('calls createStylePeriodAuthority with payload', async () => {
      mockCreateStylePeriodAuthority.mockResolvedValue({
        ...fixtureAuthority,
        authority_id: 'new-id',
      } as never);
      renderPage({ authorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Style/Period Authority')).toBeInTheDocument();
      });
      const input = screen.getByPlaceholderText(/Baroque/i);
      fireEvent.change(input, { target: { value: 'Renaissance' } });
      fireEvent.click(screen.getByRole('button', { name: /create style\/period/i }));
      await waitFor(() => {
        expect(mockCreateStylePeriodAuthority).toHaveBeenCalled();
      });
      const payload = mockCreateStylePeriodAuthority.mock.calls[0][1];
      expect(payload.preferred_term).toBe('Renaissance');
      expect(payload.authority_type).toBe('style');
    });
  });

  describe('section editing & autosave', () => {
    it('saves on field edit (debounced)', async () => {
      vi.useFakeTimers();
      try {
        mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
        mockUpdateStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);

        renderPage();
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const inputs = screen.getAllByDisplayValue('Baroque');
        fireEvent.change(inputs[0], { target: { value: 'Mannerism' } });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });

        expect(mockUpdateStylePeriodAuthority).toHaveBeenCalled();
        const payload = mockUpdateStylePeriodAuthority.mock.calls[0][2];
        expect(payload.preferred_term).toBe('Mannerism');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('delete flow', () => {
    it('opens dialog and calls deleteStylePeriodAuthority on confirm', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      mockDeleteStylePeriodAuthority.mockResolvedValue({} as never);
      renderPage({ layout: 'new' });

      await waitFor(() => {
        expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('trigger-delete'));

      const confirmBtn = await screen.findByText((content, el) => {
        return el?.tagName === 'BUTTON' && content.trim() === 'Delete';
      });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteStylePeriodAuthority).toHaveBeenCalledWith('org-1', 'auth-1');
      });
    });
  });

  describe('permissions', () => {
    it('shows view-only banner when user lacks edit permission', async () => {
      mockHasPermission.mockImplementation(
        (perm: string) => perm !== 'style_period_authorities.edit'
      );
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Baroque')).toBeInTheDocument();
      });
      expect(screen.getByText(/view only/i)).toBeInTheDocument();
    });

    it('hides Change History when audit_logs perm missing', async () => {
      mockHasPermission.mockImplementation(
        (perm: string) => perm !== 'org.view_audit_logs'
      );
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Baroque')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });
  });

  describe('section content', () => {
    it('renders culture and geographic scope inputs', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByDisplayValue('Italian')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('Western Europe')).toBeInTheDocument();
    });

    it('shows external IDs when section expanded', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Baroque')).toBeInTheDocument();
      });
      const externalToggle = screen.getByRole('button', { name: /external identifiers/i });
      fireEvent.click(externalToggle);
      await waitFor(() => {
        expect(screen.getByDisplayValue('300021147')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('Q37853')).toBeInTheDocument();
    });

    it('renders variant terms when present', async () => {
      mockGetStylePeriodAuthority.mockResolvedValue(fixtureAuthority as never);
      renderPage();
      await waitFor(() => {
        const matches = screen.queryAllByText('Barocco');
        expect(matches.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
