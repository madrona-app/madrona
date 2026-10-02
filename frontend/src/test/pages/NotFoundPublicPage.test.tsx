import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import NotFoundPublicPage from '../../pages/discover/NotFoundPublicPage';
import * as discoverApi from '../../lib/api/discover';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
}));

vi.mock('../../lib/api/content', () => ({
  getPublishedPageById: vi.fn(),
  getPublicMenu: vi.fn(),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockGetPublishedPageById = vi.mocked(contentApi.getPublishedPageById);
const mockGetPublicMenu = vi.mocked(contentApi.getPublicMenu);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderNotFoundPage(orgSlug = 'test-museum') {
  const client = createTestQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/missing`]}>
          <Routes>
            <Route path="/c/:orgSlug/*" element={<NotFoundPublicPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('NotFoundPublicPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicMenu.mockResolvedValue({ items: [] } as never);
  });

  it('renders the default Page Not Found message when no custom 404 page is configured', async () => {
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Test Museum',
      custom_404_page_id: null,
    } as never);

    renderNotFoundPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    });
  });

  it('renders the explanatory text', async () => {
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Test Museum',
      custom_404_page_id: null,
    } as never);

    renderNotFoundPage();

    await waitFor(() => {
      expect(screen.getByText(/doesn't exist or has been moved/i)).toBeInTheDocument();
    });
  });

  it('renders search-the-collection link(s) pointing to the org home', async () => {
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Test Museum',
      custom_404_page_id: null,
    } as never);

    renderNotFoundPage('amundsen');

    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /search the collection/i });
      expect(links.length).toBeGreaterThan(0);
      links.forEach((link) => {
        expect(link).toHaveAttribute('href', '/c/amundsen');
      });
    });
  });

  it('renders even before discover-info has loaded', () => {
    mockGetDiscoverInfo.mockImplementation(() => new Promise(() => {}));

    renderNotFoundPage();

    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });

  it('does not call getPublishedPageById when no custom 404 page is configured', async () => {
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Test Museum',
      custom_404_page_id: null,
    } as never);

    renderNotFoundPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    });
    expect(mockGetPublishedPageById).not.toHaveBeenCalled();
  });
});
