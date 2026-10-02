import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlaceAuthorityWorkspacePage from '../../../pages/collections/PlaceAuthorityWorkspacePage';
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
  getPlaceAuthority: vi.fn(),
  createPlaceAuthority: vi.fn(),
  updatePlaceAuthority: vi.fn(),
  deletePlaceAuthority: vi.fn(),
  updatePlaceGeometry: vi.fn(),
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

// Mock lazy-loaded map components
vi.mock('../../../components/maps/PointPicker', () => ({
  default: ({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) => (
    <div data-testid="point-picker">
      <button
        data-testid="point-picker-set"
        onClick={() => onChange({ latitude: 10, longitude: 20 })}
      >
        set
      </button>
      <span data-testid="point-picker-value">{JSON.stringify(value)}</span>
    </div>
  ),
}));

vi.mock('../../../components/maps/AreaDrawer', () => ({
  default: () => <div data-testid="area-drawer" />,
}));

vi.mock('../../../components/maps/LocationPreview', () => ({
  default: ({ latitude, longitude }: { latitude: number; longitude: number }) => (
    <div data-testid="location-preview">
      {latitude},{longitude}
    </div>
  ),
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

const mockGetPlaceAuthority = vi.mocked(api.getPlaceAuthority);
const mockCreatePlaceAuthority = vi.mocked(api.createPlaceAuthority);
const mockUpdatePlaceAuthority = vi.mocked(api.updatePlaceAuthority);
const mockDeletePlaceAuthority = vi.mocked(api.deletePlaceAuthority);

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
  placeAuthorityId = 'place-1',
  layout = 'classic',
}: {
  orgId?: string;
  placeAuthorityId?: string | null;
  layout?: 'classic' | 'new';
} = {}) {
  const qc = createTestQueryClient();
  const path = placeAuthorityId
    ? `/organizations/${orgId}/collections/place-authorities/${placeAuthorityId}${layout === 'classic' ? '?layout=classic' : ''}`
    : `/organizations/${orgId}/collections/place-authorities/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/place-authorities/create"
            element={<PlaceAuthorityWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/place-authorities/:placeAuthorityId"
            element={<PlaceAuthorityWorkspacePage />}
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

const fixturePlace = {
  place_authority_id: 'place-1',
  preferred_name: 'Florence',
  variant_names: ['Firenze'],
  place_type: 'city',
  tgn_id: '7000457',
  geonames_id: '3176959',
  wikidata_id: 'Q2044',
  coordinates_lat: 43.7696,
  coordinates_lng: 11.2558,
  parent_place_id: null,
  hierarchy_path: 'Europe > Italy > Tuscany > Florence',
  country_code: 'IT',
  notes: 'A city in Tuscany',
  status: 'active',
  linked_objects_count: 7,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('PlaceAuthorityWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading & error', () => {
    it('shows loader while fetching', () => {
      mockGetPlaceAuthority.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows not-found error message', async () => {
      mockGetPlaceAuthority.mockRejectedValue(new Error('place crash'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Place Authority not found/i)).toBeInTheDocument();
      });
      expect(screen.getByText('place crash')).toBeInTheDocument();
    });
  });

  describe('view mode (classic layout)', () => {
    it('renders the preferred name as title', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Florence')).toBeInTheDocument();
      });
    });

    it('shows Active status badge', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
    });

    it('shows linked objects count when > 0', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Linked to 7 objects/i)).toBeInTheDocument();
      });
    });

    it('renders coordinate inputs with latitude/longitude', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByDisplayValue('43.7696')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('11.2558')).toBeInTheDocument();
    });

    it('renders country code and hierarchy path inputs', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByDisplayValue('IT')).toBeInTheDocument();
      });
      expect(
        screen.getByDisplayValue('Europe > Italy > Tuscany > Florence')
      ).toBeInTheDocument();
    });
  });

  describe('create mode', () => {
    it('renders New Place Authority title', async () => {
      renderPage({ placeAuthorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Place Authority')).toBeInTheDocument();
      });
      expect(mockGetPlaceAuthority).not.toHaveBeenCalled();
    });

    it('shows Create Place Authority button', async () => {
      renderPage({ placeAuthorityId: null });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create place authority/i })
        ).toBeInTheDocument();
      });
    });

    it('blocks create when preferred_name is empty', async () => {
      renderPage({ placeAuthorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Place Authority')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /create place authority/i }));
      await waitFor(() => {
        expect(screen.getByText(/Preferred name is required/i)).toBeInTheDocument();
      });
      expect(mockCreatePlaceAuthority).not.toHaveBeenCalled();
    });

    it('calls createPlaceAuthority with payload when name set', async () => {
      mockCreatePlaceAuthority.mockResolvedValue({
        ...fixturePlace,
        place_authority_id: 'new-place',
      } as never);
      renderPage({ placeAuthorityId: null });
      await waitFor(() => {
        expect(screen.getByText('New Place Authority')).toBeInTheDocument();
      });
      const input = screen.getByPlaceholderText('e.g., Florence');
      fireEvent.change(input, { target: { value: 'Rome' } });
      fireEvent.click(screen.getByRole('button', { name: /create place authority/i }));
      await waitFor(() => {
        expect(mockCreatePlaceAuthority).toHaveBeenCalled();
      });
      const payload = mockCreatePlaceAuthority.mock.calls[0][1];
      expect(payload.preferred_name).toBe('Rome');
      expect(payload.place_type).toBe('place');
      expect(payload.status).toBe('active');
    });
  });

  describe('section editing & autosave', () => {
    it('saves on field edit (debounced)', async () => {
      vi.useFakeTimers();
      try {
        mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
        mockUpdatePlaceAuthority.mockResolvedValue(fixturePlace as never);

        renderPage();
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const inputs = screen.getAllByDisplayValue('Florence');
        fireEvent.change(inputs[0], { target: { value: 'Firenze' } });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });

        expect(mockUpdatePlaceAuthority).toHaveBeenCalled();
        const payload = mockUpdatePlaceAuthority.mock.calls[0][2];
        expect(payload.preferred_name).toBe('Firenze');
      } finally {
        vi.useRealTimers();
      }
    });

    it('updates lat/lng when coordinate inputs change', async () => {
      vi.useFakeTimers();
      try {
        mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
        mockUpdatePlaceAuthority.mockResolvedValue(fixturePlace as never);

        renderPage();
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const latInput = screen.getByDisplayValue('43.7696');
        fireEvent.change(latInput, { target: { value: '45.4642' } });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });

        expect(mockUpdatePlaceAuthority).toHaveBeenCalled();
        const payload = mockUpdatePlaceAuthority.mock.calls[0][2];
        expect(payload.coordinates_lat).toBe(45.4642);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('delete flow', () => {
    it('opens dialog and calls deletePlaceAuthority on confirm', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      mockDeletePlaceAuthority.mockResolvedValue({} as never);

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
        expect(mockDeletePlaceAuthority).toHaveBeenCalledWith('org-1', 'place-1');
      });
    });
  });

  describe('permissions', () => {
    it('shows view-only banner when user lacks edit permission', async () => {
      mockHasPermission.mockImplementation((perm: string) => perm !== 'place_authorities.edit');
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Florence')).toBeInTheDocument();
      });
      expect(screen.getByText(/view only/i)).toBeInTheDocument();
    });

    it('hides Change History when audit_logs perm missing', async () => {
      mockHasPermission.mockImplementation((perm: string) => perm !== 'org.view_audit_logs');
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);

      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Florence')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });
  });

  describe('section content', () => {
    it('shows external IDs when section expanded', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Florence')).toBeInTheDocument();
      });
      const externalToggle = screen.getByRole('button', { name: /external identifiers/i });
      fireEvent.click(externalToggle);
      await waitFor(() => {
        expect(screen.getByDisplayValue('7000457')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('3176959')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Q2044')).toBeInTheDocument();
    });

    it('renders variant names when present', async () => {
      mockGetPlaceAuthority.mockResolvedValue(fixturePlace as never);
      renderPage();
      await waitFor(() => {
        const matches = screen.queryAllByText('Firenze');
        expect(matches.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
