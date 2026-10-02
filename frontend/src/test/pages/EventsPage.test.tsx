import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EventsPage from '../../pages/collections/EventsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getEvents: vi.fn(),
}));

const mockGetEvents = vi.mocked(api.getEvents);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/events`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/events"
            element={<EventsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/events/create"
            element={<div>Create Event</div>}
          />
          <Route
            path="/organizations/:orgId/collections/events/:eventId"
            element={<div>Event Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetEvents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    });
  });

  it('shows empty state when no events', async () => {
    mockGetEvents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No events yet.' })).toBeInTheDocument();
    });
  });

  it('renders an event row with title', async () => {
    mockGetEvents.mockResolvedValue({
      items: [
        {
          event_id: 'ev-1',
          title: 'Curator Talk',
          event_type: 'program',
          status: 'scheduled',
          start_at: '2025-01-01T18:00:00Z',
          end_at: '2025-01-01T20:00:00Z',
          location_name: 'Main Hall',
          owner_name: 'Jane Doe',
          object_count: 3,
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Curator Talk')).toBeInTheDocument();
    });
  });

  it('shows error on failure', async () => {
    mockGetEvents.mockRejectedValue(new Error('Service unavailable'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading events/i)).toBeInTheDocument();
    });
  });

  it('passes type filter to query when changed', async () => {
    mockGetEvents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    });

    const typeSelect = screen.getByDisplayValue('All Types');
    fireEvent.change(typeSelect, { target: { value: 'teaching_session' } });

    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ event_type: 'teaching_session' })
      );
    });
  });

  it('shows search-no-results state with active search', async () => {
    mockGetEvents.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Search events...');
    fireEvent.change(input, { target: { value: 'gala' } });

    await waitFor(() => {
      expect(screen.getByText(/no events match your search/i)).toBeInTheDocument();
    });
  });
});
