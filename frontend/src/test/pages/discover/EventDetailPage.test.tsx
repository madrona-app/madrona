import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import EventDetailPage from '../../../pages/discover/EventDetailPage';
import * as discoverApi from '../../../lib/api/discover';
import * as apiUtils from '../../../lib/api/_utils';

vi.mock('../../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
}));

vi.mock('../../../lib/api/_utils', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="site-shell">{children}</div>
  ),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockApiFetch = vi.mocked(apiUtils.apiFetch);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgSlug = 'museum-org', slug = 'spring-event') {
  const qc = createQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/events/${slug}`]}>
          <Routes>
            <Route
              path="/c/:orgSlug/events/:slug"
              element={<EventDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const sampleInfo = { organization_name: 'Museum Org' };

const sampleEvent = {
  data: {
    event_id: 'e-1',
    title: 'Spring Concert',
    slug: 'spring-event',
    event_type: 'performance',
    short_description: 'Live music event',
    description: 'A wonderful evening of music',
    start_at: '2024-04-15T19:00:00Z',
    end_at: '2024-04-15T21:00:00Z',
    venue_name: 'Main Hall',
    location_name: null,
    hero_image_url: null,
    registration_url: 'https://example.com/register',
    price: '25',
    capacity: 100,
    tags: ['music', 'family-friendly'],
    is_free: false,
    is_featured: false,
  },
};

describe('EventDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the site shell on initial load', () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('site-shell')).toBeInTheDocument();
  });

  it('renders 404 when event not found', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockApiFetch.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/event not found/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/this event does not exist or is no longer available/i),
    ).toBeInTheDocument();
  });

  it('renders event title when loaded', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockApiFetch.mockResolvedValue(sampleEvent as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /spring concert/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders event venue', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockApiFetch.mockResolvedValue(sampleEvent as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/main hall/i).length).toBeGreaterThan(0);
    });
  });

  it('renders back to events link', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockApiFetch.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /back to events/i });
      expect(link).toHaveAttribute('href', '/c/museum-org/events');
    });
  });

  it('renders register link when registration_url is present', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockApiFetch.mockResolvedValue(sampleEvent as any);
    renderPage();
    await waitFor(() => {
      const links = screen.getAllByRole('link');
      const registerLink = links.find(
        (l) => l.getAttribute('href') === 'https://example.com/register',
      );
      expect(registerLink).toBeDefined();
    });
  });

  it('queries with the slug', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockApiFetch.mockResolvedValue(sampleEvent as any);
    renderPage('museum-org', 'spring-event');
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/discover/museum-org/events/spring-event',
        expect.any(Object),
      );
    });
  });
});
