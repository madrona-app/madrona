import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationsPage from '../../pages/shared/NotificationsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getNotifications: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => undefined,
}));

const mockGetNotifications = vi.mocked(api.getNotifications);
const mockMarkAllRead = vi.mocked(api.markAllNotificationsAsRead);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(orgId = 'org-1') {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/notifications`]}>
        <Routes>
          <Route path="/organizations/:orgId/notifications" element={<NotificationsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching', () => {
    mockGetNotifications.mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(screen.getByText(/loading notifications/i)).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    mockGetNotifications.mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      has_more: false,
    } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    });
  });

  it('shows empty state for All tab', async () => {
    mockGetNotifications.mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      has_more: false,
    } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    });
  });

  it('switches the empty state copy when toggled to Unread', async () => {
    mockGetNotifications.mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      has_more: false,
    } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));

    await waitFor(() => {
      expect(screen.getByText('No unread notifications')).toBeInTheDocument();
    });
  });

  it('renders rows for each notification', async () => {
    mockGetNotifications.mockResolvedValue({
      items: [
        {
          notification_id: 'n-1',
          title: 'Comment on Object 123',
          message: 'A comment was left',
          notification_type: 'comment',
          entity_type: 'collection_object',
          entity_id: 'obj-1',
          is_read: false,
          created_at: '2026-04-23T10:00:00Z',
        },
        {
          notification_id: 'n-2',
          title: 'Task assigned',
          message: null,
          notification_type: 'task',
          entity_type: 'task',
          entity_id: 't-1',
          is_read: true,
          created_at: '2026-04-22T10:00:00Z',
        },
      ],
      total: 2,
      unread_count: 1,
      has_more: false,
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Comment on Object 123')).toBeInTheDocument();
    });
    expect(screen.getByText('Task assigned')).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('shows the Mark all read button when there are unread notifications', async () => {
    mockGetNotifications.mockResolvedValue({
      items: [
        {
          notification_id: 'n-1',
          title: 'Unread one',
          message: null,
          notification_type: 'comment',
          entity_type: null,
          entity_id: null,
          is_read: false,
          created_at: '2026-04-23T10:00:00Z',
        },
      ],
      total: 1,
      unread_count: 1,
      has_more: false,
    } as never);
    mockMarkAllRead.mockResolvedValue(undefined as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark all read/i })).toBeInTheDocument();
    });
  });

  it('does not render the Mark all read button when no unread', async () => {
    mockGetNotifications.mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      has_more: false,
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument();
  });
});
