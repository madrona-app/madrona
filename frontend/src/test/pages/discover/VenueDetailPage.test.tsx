import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import VenueDetailPage from '../../../pages/discover/VenueDetailPage';
import * as discoverApi from '../../../lib/api/discover';

vi.mock('../../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
  getPublicVenueDetail: vi.fn(),
}));

vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="site-shell">{children}</div>
  ),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockGetPublicVenueDetail = vi.mocked(discoverApi.getPublicVenueDetail);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgSlug = 'museum-org', venueSlug = 'main-venue') {
  const qc = createQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/visit/${venueSlug}`]}>
          <Routes>
            <Route
              path="/c/:orgSlug/visit/:venueSlug"
              element={<VenueDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const sampleVenue = {
  data: {
    venue_id: 'v-1',
    name: 'Main Building',
    slug: 'main-venue',
    description: 'A historic museum building.',
    address: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    phone: '555-0100',
    email: 'info@museum.org',
    website: 'https://museum.org',
    hero_image_url: null,
    hours: {
      monday: { open: '10:00', close: '17:00' },
      tuesday: { open: '10:00', close: '17:00' },
    },
    admission: {
      tiers: [{ label: 'Adult', price: '15' }],
      free_days: 'First Sunday',
    },
    accessibility: {},
    parking: 'Free on-site parking',
    upcoming_exhibitions: [],
  },
};

describe('VenueDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Museum Org',
    } as any);
  });

  it('renders site shell on initial render', () => {
    mockGetPublicVenueDetail.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('site-shell')).toBeInTheDocument();
  });

  it('renders venue not found on error', async () => {
    mockGetPublicVenueDetail.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/venue not found/i)).toBeInTheDocument();
    });
  });

  it('renders venue heading when loaded', async () => {
    mockGetPublicVenueDetail.mockResolvedValue(sampleVenue as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /main building/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders hours table', async () => {
    mockGetPublicVenueDetail.mockResolvedValue(sampleVenue as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Monday')).toBeInTheDocument();
    });
    expect(screen.getByText('Tuesday')).toBeInTheDocument();
  });

  it('renders contact links', async () => {
    mockGetPublicVenueDetail.mockResolvedValue(sampleVenue as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/555-0100/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/info@museum\.org/i)).toBeInTheDocument();
  });

  it('renders back to venues link', async () => {
    mockGetPublicVenueDetail.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /back to venues/i });
      expect(link).toHaveAttribute('href', '/c/museum-org/visit');
    });
  });

  it('queries with correct slug', async () => {
    mockGetPublicVenueDetail.mockResolvedValue(sampleVenue as any);
    renderPage('museum-org', 'main-venue');
    await waitFor(() => {
      expect(mockGetPublicVenueDetail).toHaveBeenCalledWith(
        'museum-org',
        'main-venue',
      );
    });
  });
});
