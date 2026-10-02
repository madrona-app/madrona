import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EventWorkspacePage from '../../../pages/collections/EventWorkspacePage';
import * as api from '../../../lib/api';
import * as workspacePageHook from '../../../hooks/useWorkspacePage';
import * as lookupHook from '../../../hooks/useLookupValues';

// -----------------------------------------------------------------------------
// API mocks
// -----------------------------------------------------------------------------
vi.mock('../../../lib/api', () => ({
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  addEventObject: vi.fn(),
}));

// -----------------------------------------------------------------------------
// Hook mocks
// -----------------------------------------------------------------------------
vi.mock('../../../hooks/useWorkspacePage', () => ({
  useWorkspacePage: vi.fn(),
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { user_id: 'u-1', email: 'tester@example.com', is_platform_admin: false },
    activeOrganizationId: 'org-1',
    isPlatformAdmin: false,
    roleOverride: null,
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// -----------------------------------------------------------------------------
// Heavy child component mocks
// -----------------------------------------------------------------------------
vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-task-slideover" /> : null,
}));

vi.mock('../../../components/workspace/RecordAuditHistory', () => ({
  RecordAuditHistory: () => <div data-testid="record-audit-history" />,
}));

vi.mock('../../../components/collections/EventObjectLinker', () => ({
  EventObjectLinker: ({ eventId, isEditing }: { eventId?: string; isEditing?: boolean }) => (
    <div
      data-testid="event-object-linker"
      data-event-id={eventId || ''}
      data-editing={String(!!isEditing)}
    />
  ),
}));

vi.mock('../../../components/collections/EventCollectionsImpact', () => ({
  EventCollectionsImpact: () => <div data-testid="event-collections-impact" />,
}));

vi.mock('../../../components/RecordDiscussionTab', () => ({
  RecordDiscussionTab: () => <div data-testid="record-discussion-tab" />,
}));

// -----------------------------------------------------------------------------
// Typed mock handles
// -----------------------------------------------------------------------------
const mockGetEvent = vi.mocked(api.getEvent);
const mockCreateEvent = vi.mocked(api.createEvent);
const mockUpdateEvent = vi.mocked(api.updateEvent);
const mockDeleteEvent = vi.mocked(api.deleteEvent);
const mockUseWorkspacePage = vi.mocked(workspacePageHook.useWorkspacePage);
const mockUseLookups = vi.mocked(lookupHook.useLookupValues);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function makeWp(overrides: Partial<ReturnType<typeof workspacePageHook.useWorkspacePage>> = {}) {
  return {
    isCreateMode: false,
    isEditing: true, // Event status-transition buttons require isEditing && status !== cancelled
    setIsEditing: vi.fn(),
    useNewLayout: false,
    canEdit: true,
    isRestricted: () => false,
    hasRestrictions: false,
    dialogs: {
      showDeleteConfirm: false,
      setShowDeleteConfirm: vi.fn(),
      showCreateTask: false,
      setShowCreateTask: vi.fn(),
    },
    hasPermission: () => true,
    ...overrides,
  } as ReturnType<typeof workspacePageHook.useWorkspacePage>;
}

function renderPage({
  eventId = 'event-1',
  orgId = 'org-1',
}: { eventId?: string | null; orgId?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const path = eventId
    ? `/organizations/${orgId}/collections/events/${eventId}`
    : `/organizations/${orgId}/collections/events/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/events/create"
            element={<EventWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/events/:eventId"
            element={<EventWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/events"
            element={<div>Events List</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------
const baseEvent = {
  event_id: 'event-1',
  event_reference_number: 'EV-2024-001',
  title: 'Curator Tour',
  event_type: 'program',
  status: 'draft',
  start_at: '2024-04-15T10:00:00',
  end_at: '2024-04-15T12:00:00',
  location_id: '',
  course_code: '',
  instructor_id: '',
  department: '',
  institution: '',
  headcount: null,
  session_format: '',
  audience: 'public',
  capacity: 30,
  registration_url: '',
  description: 'Behind-the-scenes tour',
  notes: '',
  object_count: 2,
  created_at: '2024-04-01T00:00:00Z',
  updated_at: '2024-04-02T00:00:00Z',
};

describe('EventWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspacePage.mockReturnValue(makeWp());
    mockUseLookups.mockReturnValue({
      getLookup: (field: string) => {
        if (field === 'event_type') {
          return [
            { value: 'program', label: 'Program' },
            { value: 'teaching_session', label: 'Teaching Session' },
            { value: 'opening_reception', label: 'Opening Reception' },
          ];
        }
        if (field === 'event_audience') {
          return [
            { value: 'public', label: 'Public' },
            { value: 'members', label: 'Members' },
          ];
        }
        return [];
      },
      getLabel: (_field: string, value: string) => value,
      isLoading: false,
      error: null,
    } as never);
  });

  describe('loading state', () => {
    it('renders the loader while the event fetch is pending', () => {
      mockGetEvent.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the inline error banner on fetch failure', async () => {
      mockGetEvent.mockRejectedValue(new Error('Network down'));
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByText(/error loading event:\s*network down/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('renders the New Event header without the workflow indicator', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ isCreateMode: true }));
      renderPage({ eventId: null });
      await waitFor(() => {
        expect(screen.getByText('New Event')).toBeInTheDocument();
      });
      // No status workflow stepper in create mode (status step circles + button)
      expect(
        screen.queryByRole('button', { name: /^schedule$/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /mark complete/i })
      ).not.toBeInTheDocument();
    });

    it('shows the EventObjectLinker in editable / pending mode', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ isCreateMode: true }));
      renderPage({ eventId: null });
      await waitFor(() => {
        expect(screen.getByTestId('event-object-linker')).toBeInTheDocument();
      });
      const linker = screen.getByTestId('event-object-linker');
      expect(linker.getAttribute('data-event-id')).toBe('');
      expect(linker.getAttribute('data-editing')).toBe('true');
    });
  });

  describe('view / edit mode', () => {
    beforeEach(() => {
      mockGetEvent.mockResolvedValue(baseEvent as never);
    });

    it('renders the event title in the header', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Curator Tour')).toBeInTheDocument();
      });
    });

    it('shows the workflow indicator when an event has been fetched', async () => {
      renderPage();
      // Workflow steps are Draft → Scheduled → Completed; "Draft" appears in
      // both the badge and the workflow text, so use getAllByText.
      await waitFor(() => {
        expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
      });
      expect(screen.getAllByText('Scheduled').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    });

    it('renders the EventObjectLinker bound to the eventId', async () => {
      renderPage();
      await waitFor(() => {
        const linker = screen.getByTestId('event-object-linker');
        expect(linker.getAttribute('data-event-id')).toBe('event-1');
      });
    });

    it('shows the Collections Impact section only for scheduled events with linked objects', async () => {
      mockGetEvent.mockResolvedValue({
        ...baseEvent,
        status: 'scheduled',
        object_count: 3,
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('event-collections-impact')).toBeInTheDocument();
      });
    });

    it('hides the Collections Impact section for draft events', async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Curator Tour')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('event-collections-impact')).not.toBeInTheDocument();
    });

    it('renders the Discussion section header in view mode', async () => {
      renderPage();
      await waitFor(() => {
        // Section starts collapsed, so the inner tab content is not rendered
        // until the user expands it. The header itself is always present.
        expect(screen.getByText('Discussion')).toBeInTheDocument();
      });
    });

    it('shows the view-only banner when canEdit is false', async () => {
      mockUseWorkspacePage.mockReturnValue(
        makeWp({ canEdit: false, isEditing: false })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/view only/i)).toBeInTheDocument();
      });
    });

    it('renders the Change History section header when audit permission is granted', async () => {
      mockUseWorkspacePage.mockReturnValue(
        makeWp({ hasPermission: (p: string) => p === 'org.view_audit_logs' })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Change History')).toBeInTheDocument();
      });
    });

    it('hides the Change History section when audit permission is denied', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ hasPermission: () => false }));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Curator Tour')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });
  });

  describe('status transitions', () => {
    it('schedules a draft event and POSTs status=scheduled', async () => {
      mockGetEvent.mockResolvedValue(baseEvent as never);
      mockUpdateEvent.mockResolvedValue({} as never);
      renderPage();
      const scheduleBtn = await screen.findByRole('button', { name: /^schedule$/i });
      fireEvent.click(scheduleBtn);
      await waitFor(() => {
        expect(mockUpdateEvent).toHaveBeenCalledWith(
          'org-1',
          'event-1',
          { status: 'scheduled' }
        );
      });
    });

    it('completes a scheduled event and POSTs status=completed', async () => {
      mockGetEvent.mockResolvedValue({
        ...baseEvent,
        status: 'scheduled',
      } as never);
      mockUpdateEvent.mockResolvedValue({} as never);
      renderPage();
      const completeBtn = await screen.findByRole('button', { name: /mark complete/i });
      fireEvent.click(completeBtn);
      await waitFor(() => {
        expect(mockUpdateEvent).toHaveBeenCalledWith(
          'org-1',
          'event-1',
          { status: 'completed' }
        );
      });
    });

    it('cancels an event from any non-cancelled status', async () => {
      mockGetEvent.mockResolvedValue(baseEvent as never);
      mockUpdateEvent.mockResolvedValue({} as never);
      renderPage();
      const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i });
      fireEvent.click(cancelBtn);
      await waitFor(() => {
        expect(mockUpdateEvent).toHaveBeenCalledWith(
          'org-1',
          'event-1',
          { status: 'cancelled' }
        );
      });
    });

    it('hides workflow buttons once cancelled', async () => {
      mockGetEvent.mockResolvedValue({
        ...baseEvent,
        status: 'cancelled',
      } as never);
      renderPage();
      // Wait for paint
      await waitFor(() => {
        expect(screen.getByText('Curator Tour')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /^schedule$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
    });
  });

  describe('delete mutation', () => {
    it('deletes the event when the dialog confirm is clicked', async () => {
      mockGetEvent.mockResolvedValue(baseEvent as never);
      mockDeleteEvent.mockResolvedValue({} as never);
      const setShowDeleteConfirm = vi.fn();
      mockUseWorkspacePage.mockReturnValue(
        makeWp({
          dialogs: {
            showDeleteConfirm: true,
            setShowDeleteConfirm,
            showCreateTask: false,
            setShowCreateTask: vi.fn(),
          },
        })
      );
      renderPage();
      const dialogTitle = await screen.findByText('Delete Event');
      const dialogRoot = dialogTitle.closest('div[role="dialog"]')
        || dialogTitle.parentElement?.parentElement?.parentElement
        || dialogTitle.parentElement;
      const confirmBtn = Array.from(
        (dialogRoot as HTMLElement).querySelectorAll('button')
      ).find((b) => b.textContent?.trim() === 'Delete');
      expect(confirmBtn).toBeTruthy();
      fireEvent.click(confirmBtn as HTMLElement);
      await waitFor(() => {
        expect(mockDeleteEvent).toHaveBeenCalledWith('org-1', 'event-1');
      });
      expect(setShowDeleteConfirm).toHaveBeenCalledWith(false);
    });
  });

  describe('create flow', () => {
    it('creates an event with the form payload when title is provided', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ isCreateMode: true }));
      mockCreateEvent.mockResolvedValue({ event_id: 'new-1' } as never);
      renderPage({ eventId: null });

      // Provide a title via the controlled input
      const titleInput = await screen.findByLabelText(/title/i);
      fireEvent.change(titleInput, { target: { value: 'Donor Reception' } });

      const createBtn = screen.getByRole('button', { name: /create event/i });
      fireEvent.click(createBtn);
      await waitFor(() => {
        expect(mockCreateEvent).toHaveBeenCalled();
      });
      const [orgArg, payload] = mockCreateEvent.mock.calls[0] as [string, Record<string, unknown>];
      expect(orgArg).toBe('org-1');
      expect(payload.title).toBe('Donor Reception');
      // Defaults should be normalized to nulls
      expect(payload.event_type).toBe('program');
      expect(payload.status).toBe('draft');
    });

    it('blocks creation when title is missing', async () => {
      mockUseWorkspacePage.mockReturnValue(makeWp({ isCreateMode: true }));
      mockCreateEvent.mockResolvedValue({ event_id: 'new-1' } as never);
      renderPage({ eventId: null });
      const createBtn = await screen.findByRole('button', { name: /create event/i });
      fireEvent.click(createBtn);
      // Validation rejects the empty default title; createMutation should not run.
      // (errorMessage is set in form state but the page does not surface it.)
      await new Promise((r) => setTimeout(r, 50));
      expect(mockCreateEvent).not.toHaveBeenCalled();
    });
  });

  describe('CreateTask slide-over', () => {
    it('renders when the dialog flag is true', async () => {
      mockGetEvent.mockResolvedValue(baseEvent as never);
      mockUseWorkspacePage.mockReturnValue(
        makeWp({
          dialogs: {
            showDeleteConfirm: false,
            setShowDeleteConfirm: vi.fn(),
            showCreateTask: true,
            setShowCreateTask: vi.fn(),
          },
        })
      );
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('create-task-slideover')).toBeInTheDocument();
      });
    });
  });
});
