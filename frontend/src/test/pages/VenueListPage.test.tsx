import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import VenueListPage from '../../pages/discover/VenueListPage';
import * as discoverApi from '../../lib/api/discover';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
  getPublicVenues: vi.fn(),
}));

vi.mock('../../lib/api/content', () => ({
  getPublicMenu: vi.fn(),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockGetPublicVenues = vi.mocked(discoverApi.getPublicVenues);
const mockGetPublicMenu = vi.mocked(contentApi.getPublicMenu);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(orgSlug = 'test-museum') {
  const client = createTestQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/visit`]}>
          <Routes>
            <Route path="/c/:orgSlug/visit" element={<VenueListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('VenueListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({ organization_name: 'Test Museum' } as never);
    mockGetPublicMenu.mockResolvedValue({ items: [] } as never);
  });

  it('renders the Plan Your Visit hero', async () => {
    mockGetPublicVenues.mockResolvedValue({ data: [] } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /plan your visit/i })).toBeInTheDocument();
    });
  });

  it('shows the empty state when no venues exist', async () => {
    mockGetPublicVenues.mockResolvedValue({ data: [] } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no venues listed yet/i)).toBeInTheDocument();
    });
  });

  it('renders one VenueCard per venue', async () => {
    mockGetPublicVenues.mockResolvedValue({
      data: [
        {
          venue_id: 'v-1',
          slug: 'main-building',
          name: 'Main Building',
          address: '123 Museum Way',
          hours: null,
        },
        {
          venue_id: 'v-2',
          slug: null,
          name: 'Annex',
          address: null,
          hours: null,
        },
      ],
    } as never);

    renderPage('amundsen');

    await waitFor(() => {
      expect(screen.getByText('Main Building')).toBeInTheDocument();
    });
    expect(screen.getByText('Annex')).toBeInTheDocument();
  });

  it('links each venue card to its slug', async () => {
    mockGetPublicVenues.mockResolvedValue({
      data: [
        {
          venue_id: 'v-1',
          slug: 'main-building',
          name: 'Main Building',
          address: null,
          hours: null,
        },
      ],
    } as never);

    renderPage('amundsen');

    await waitFor(() => {
      expect(screen.getByText('Main Building')).toBeInTheDocument();
    });
    const link = screen.getByText('Main Building').closest('a');
    expect(link).toHaveAttribute('href', '/c/amundsen/visit/main-building');
  });

  it('falls back to venue_id when slug is missing', async () => {
    mockGetPublicVenues.mockResolvedValue({
      data: [
        {
          venue_id: 'venue-uuid-99',
          slug: null,
          name: 'Annex',
          address: null,
          hours: null,
        },
      ],
    } as never);

    renderPage('amundsen');

    await waitFor(() => {
      expect(screen.getByText('Annex')).toBeInTheDocument();
    });
    const link = screen.getByText('Annex').closest('a');
    expect(link).toHaveAttribute('href', '/c/amundsen/visit/venue-uuid-99');
  });
});
