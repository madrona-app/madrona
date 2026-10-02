import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConstituentWorkspacePage from '../../../pages/collections/ConstituentWorkspacePage';
import * as constituentsApi from '../../../lib/api/constituents';

// jsdom doesn't implement scrollIntoView; useUnifiedSectionState uses it
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

vi.mock('../../../lib/api/constituents', () => ({
  getConstituent: vi.fn(),
  createConstituent: vi.fn(),
  updateConstituent: vi.fn(),
  deleteConstituent: vi.fn(),
  searchUlan: vi.fn(),
  getUlanRecord: vi.fn(),
  searchViaf: vi.fn(),
  searchWikidata: vi.fn(),
  searchLoc: vi.fn(),
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

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: vi.fn(() => ({
    getLookup: vi.fn(() => []),
    getLabel: vi.fn((_ctx: string, val: string) => val),
    isLoading: false,
    error: null,
  })),
  default: vi.fn(() => ({
    getLookup: vi.fn(() => []),
    getLabel: vi.fn((_ctx: string, val: string) => val),
    isLoading: false,
    error: null,
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

vi.mock('../../../components/RecordDiscussionTab', () => ({
  RecordDiscussionTab: () => <div data-testid="record-discussion-tab" />,
}));

vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-task-slideover" /> : null,
}));

// Mock the heavy MediaSection
vi.mock('../../../pages/collections/ConstituentWorkspacePage/MediaSection', () => ({
  MediaSection: () => <div data-testid="media-section" />,
}));

// Mock RecordDetailPageWrapper - capture callbacks
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

const mockGetConstituent = vi.mocked(constituentsApi.getConstituent);
const mockCreateConstituent = vi.mocked(constituentsApi.createConstituent);
const mockUpdateConstituent = vi.mocked(constituentsApi.updateConstituent);
const mockDeleteConstituent = vi.mocked(constituentsApi.deleteConstituent);
const mockSearchUlan = vi.mocked(constituentsApi.searchUlan);

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
  constituentId = 'c-1',
  layout = 'classic',
}: {
  orgId?: string;
  constituentId?: string | null;
  layout?: 'classic' | 'new';
} = {}) {
  const qc = createTestQueryClient();
  const path = constituentId
    ? `/organizations/${orgId}/collections/constituents/${constituentId}${layout === 'classic' ? '?layout=classic' : ''}`
    : `/organizations/${orgId}/collections/constituents/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/constituents/create"
            element={<ConstituentWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/constituents/:constituentId"
            element={<ConstituentWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/constituents"
            element={<div>Constituents</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const fixtureConstituent = {
  constituent_id: 'c-1',
  name: 'Frida Kahlo',
  display_name: 'Frida Kahlo',
  sort_name: 'Kahlo, Frida',
  given_name: 'Frida',
  family_name: 'Kahlo',
  name_prefix: '',
  name_suffix: '',
  variant_names: ['Magdalena Carmen Frida Kahlo'],
  constituent_type: 'person',
  nationality: 'Mexican',
  culture: '',
  gender: 'female',
  life_roles: ['painter'],
  email: 'frida@example.org',
  phone: '+52 555 1234',
  phone_secondary: '',
  title: '',
  role: 'Artist',
  organization_name: '',
  department: '',
  website: 'https://frida.example',
  address: { street: '', city: '', state: '', postal_code: '', country: '' },
  birth_date_display: '1907',
  death_date_display: '1954',
  active_date_display: '',
  birth_place: 'Coyoacán',
  birth_place_tgn_id: '',
  death_place: 'Coyoacán',
  death_place_tgn_id: '',
  biography: 'Mexican painter known for her self-portraits.',
  biography_source: '',
  ulan_id: '500030701',
  viaf_id: '12345',
  wikidata_id: 'Q5588',
  loc_id: 'n79055466',
  status: 'active',
  is_active: true,
  is_verified: true,
  notes: '',
  internal_notes: '',
  cataloger_notes: '',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('ConstituentWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    mockSearchUlan.mockResolvedValue({ results: [] } as never);
  });

  describe('loading & error', () => {
    it('shows loader while fetching', () => {
      mockGetConstituent.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows not-found message on API failure', async () => {
      mockGetConstituent.mockRejectedValue(new Error('boom'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Record not found/i)).toBeInTheDocument();
      });
      expect(screen.getByText('boom')).toBeInTheDocument();
    });

    it('renders Back to People and Organizations link in error state', async () => {
      mockGetConstituent.mockRejectedValue(new Error('nope'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Back to People and Organizations/i)).toBeInTheDocument();
      });
    });
  });

  describe('view mode (classic layout)', () => {
    it('renders constituent name as title', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Frida Kahlo')).toBeInTheDocument();
      });
    });

    it('shows verified badge when is_verified is true', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Verified')).toBeInTheDocument();
      });
    });

    it('shows Inactive badge when is_active=false', async () => {
      mockGetConstituent.mockResolvedValue({
        ...fixtureConstituent,
        is_active: false,
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Inactive')).toBeInTheDocument();
      });
    });

    it('renders constituent type label', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();
      await waitFor(() => {
        // Person label appears in badge
        expect(screen.getAllByText(/Person/i).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('create mode', () => {
    it('renders New Person or Organization title in create mode', async () => {
      renderPage({ constituentId: null });
      await waitFor(() => {
        expect(screen.getByText('New Person or Organization')).toBeInTheDocument();
      });
      expect(mockGetConstituent).not.toHaveBeenCalled();
    });

    it('shows Create Person or Organization button', async () => {
      renderPage({ constituentId: null });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create person or organization/i })
        ).toBeInTheDocument();
      });
    });

    it('blocks create when name is missing', async () => {
      renderPage({ constituentId: null });
      await waitFor(() => {
        expect(screen.getByText('New Person or Organization')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /create person or organization/i }));
      await waitFor(() => {
        expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
      });
      expect(mockCreateConstituent).not.toHaveBeenCalled();
    });
  });

  describe('section editing & autosave', () => {
    it('saves on field blur with debounced autosave', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      mockUpdateConstituent.mockResolvedValue(fixtureConstituent as never);

      renderPage();

      // Wait for the form to populate
      await waitFor(() => {
        const inputs = screen.queryAllByDisplayValue('Frida Kahlo');
        expect(inputs.length).toBeGreaterThanOrEqual(1);
      });

      const inputs = screen.getAllByDisplayValue('Frida Kahlo');
      fireEvent.change(inputs[0], { target: { value: 'Frida K.' } });
      // Trigger blur to invoke handleFieldBlur — autosave path
      fireEvent.blur(inputs[0]);

      await waitFor(() => {
        expect(mockUpdateConstituent).toHaveBeenCalled();
      });
      const payload = mockUpdateConstituent.mock.calls[0][2];
      expect(payload.name).toBe('Frida K.');
    });
  });

  describe('delete flow', () => {
    it('opens dialog and calls deleteConstituent on confirm (new layout)', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      mockDeleteConstituent.mockResolvedValue({} as never);

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
        expect(mockDeleteConstituent).toHaveBeenCalledWith('org-1', 'c-1');
      });
    });

    it('classic layout shows Delete button in header', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage({ layout: 'classic' });
      await waitFor(() => {
        expect(screen.getByText('Frida Kahlo')).toBeInTheDocument();
      });
      // Switch to non-edit mode to reveal classic Delete button (rendered when !isEditing)
      // The classic header has a Delete button when not editing
      // Click "Done" to exit edit mode (the header save indicator)
      const doneBtn = screen.queryByRole('button', { name: /done/i });
      if (doneBtn) fireEvent.click(doneBtn);

      // After exiting edit, the Delete + Create Task buttons appear
      await waitFor(() => {
        expect(
          screen.getAllByRole('button', { name: /delete/i }).length
        ).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('permissions', () => {
    it('shows view-only banner when user lacks edit permission', async () => {
      mockHasPermission.mockImplementation((perm: string) => perm !== 'constituents.edit');
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByText('Frida Kahlo').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByText(/view only/i)).toBeInTheDocument();
    });

    it('hides Change History when audit_logs perm missing', async () => {
      mockHasPermission.mockImplementation((perm: string) => perm !== 'org.view_audit_logs');
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);

      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Frida Kahlo')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });
  });

  describe('section content & hooks', () => {
    it('hydrates form from fetched data (display_name)', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByDisplayValue('Kahlo, Frida')).toBeInTheDocument();
      });
    });

    it('renders email/phone in contact section when expanded', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Frida Kahlo')).toBeInTheDocument();
      });

      const contactToggle = screen.getByRole('button', { name: /contact details/i });
      fireEvent.click(contactToggle);

      await waitFor(() => {
        expect(screen.getByDisplayValue('frida@example.org')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('+52 555 1234')).toBeInTheDocument();
    });

    it('renders biography section content when expanded', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Frida Kahlo')).toBeInTheDocument();
      });

      const bioToggle = screen.getByRole('button', { name: /biography/i });
      fireEvent.click(bioToggle);

      await waitFor(() => {
        expect(
          screen.getByDisplayValue('Mexican painter known for her self-portraits.')
        ).toBeInTheDocument();
      });
    });

    it('renders external authority IDs when section expanded', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();

      await waitFor(() => {
        expect(screen.getAllByText('Frida Kahlo').length).toBeGreaterThanOrEqual(1);
      });

      const externalToggle = screen.getByRole('button', { name: /authority links/i });
      fireEvent.click(externalToggle);

      // ULAN id rendered as display text (since it's a linked authority card)
      await waitFor(() => {
        expect(screen.getByText('500030701')).toBeInTheDocument();
      });
      expect(screen.getByText('ULAN')).toBeInTheDocument();
      expect(screen.getByText('VIAF')).toBeInTheDocument();
    });

    it('hides media section in create mode (placeholder shown instead)', async () => {
      renderPage({ constituentId: null });
      await waitFor(() => {
        expect(screen.getByText('New Person or Organization')).toBeInTheDocument();
      });
      // Mocked MediaSection should NOT appear because we're in create mode
      expect(screen.queryByTestId('media-section')).not.toBeInTheDocument();
      expect(
        screen.getByText(/Save the record first to add media/i)
      ).toBeInTheDocument();
    });

    it('renders the MediaSection in view mode', async () => {
      mockGetConstituent.mockResolvedValue(fixtureConstituent as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('media-section')).toBeInTheDocument();
      });
    });
  });
});
