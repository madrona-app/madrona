import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import EventListPage from '../../pages/discover/EventListPage';
import * as discoverApi from '../../lib/api/discover';
import * as apiUtils from '../../lib/api/_utils';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
}));

vi.mock('../../lib/api/_utils', () => ({
  apiFetch: vi.fn(),
  buildQueryString: (p: Record<string, unknown>) => {
    const sp = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const s = sp.toString();
    return s ? `?${s}` : '';
  },
}));

vi.mock('../../lib/api/content', () => ({
  getPublicMenu: vi.fn(),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockApiFetch = vi.mocked(apiUtils.apiFetch);
const mockGetPublicMenu = vi.mocked(contentApi.getPublicMenu);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(orgSlug = 'test-museum') {
  const client = createTestQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/events`]}>
          <Routes>
            <Route path="/c/:orgSlug/events" element={<EventListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('EventListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({ organization_name: 'Test Museum' } as never);
    mockGetPublicMenu.mockResolvedValue({ items: [] } as never);
  });

  it('renders the Events heading', async () => {
    mockApiFetch.mockResolvedValue({ data: [], total: 0 } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no events', async () => {
    mockApiFetch.mockResolvedValue({ data: [], total: 0 } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no events found/i)).toBeInTheDocument();
    });
  });

  it('renders an event when one is returned by the API', async () => {
    mockApiFetch.mockResolvedValue({
      data: [
        {
          event_id: 'ev-1',
          public_url_slug: 'spring-gala',
          title: 'Spring Gala',
          short_description: 'Annual gala',
          event_type: 'fundraiser',
          start_at: '2026-05-01T18:00:00Z',
          end_at: '2026-05-01T22:00:00Z',
          venue_name: 'Main Building',
          location_name: null,
          ticketing_url: null,
          tags: [],
          is_featured: false,
          thumbnail_url: null,
        },
      ],
      total: 1,
    } as never);

    renderPage('amundsen');

    await waitFor(() => {
      expect(screen.getByText('Spring Gala')).toBeInTheDocument();
    });
  });

  it('passes the orgSlug into the events fetch URL', async () => {
    mockApiFetch.mockResolvedValue({ data: [], total: 0 } as never);
    renderPage('amundsen');

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
    const calledUrl = mockApiFetch.mock.calls[0]?.[0];
    expect(calledUrl).toContain('/discover/amundsen/events');
  });
});
