import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { DiscoverPage } from '../../../pages/discover/DiscoverPage';
import * as api from '../../../lib/api';
import * as contentApi from '../../../lib/api/content';

vi.mock('../../../lib/api', () => ({
  getDiscoverInfo: vi.fn(),
  searchDiscoverObjects: vi.fn(),
}));

vi.mock('../../../lib/api/content', () => ({
  getPublishedPageById: vi.fn(),
}));

vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="site-shell">{children}</div>
  ),
}));

vi.mock('../../../pages/discover/components/HeroSection', () => ({
  HeroSection: () => <div data-testid="hero-section" />,
}));

vi.mock('../../../pages/discover/components/FeaturedObjectsSection', () => ({
  FeaturedObjectsSection: () => <div data-testid="featured-section" />,
}));

vi.mock('../../../pages/discover/components/FilterPanel', () => ({
  FilterPanel: () => <div data-testid="filter-panel" />,
}));

vi.mock('../../../pages/discover/components/ActiveFilters', () => ({
  ActiveFilters: () => <div data-testid="active-filters" />,
}));

vi.mock('../../../pages/discover/components/ResultsGrid', () => ({
  ResultsGrid: ({ total }: { total: number }) => (
    <div data-testid="results-grid">Total: {total}</div>
  ),
}));

vi.mock('../../../pages/discover/components/Pagination', () => ({
  Pagination: () => <div data-testid="pagination" />,
}));

vi.mock('../../../pages/content/components/BlockRenderer', () => ({
  BlockRenderer: ({ blocks }: { blocks: unknown[] }) => (
    <div data-testid="block-renderer">{blocks.length} blocks</div>
  ),
}));

const mockGetDiscoverInfo = vi.mocked(api.getDiscoverInfo);
const mockSearchDiscoverObjects = vi.mocked(api.searchDiscoverObjects);
const mockGetPublishedPageById = vi.mocked(contentApi.getPublishedPageById);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgSlug = 'museum-org') {
  const qc = createQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}`]}>
          <Routes>
            <Route path="/c/:orgSlug" element={<DiscoverPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Museum Org',
      page_title: 'Explore',
      homepage_page_id: null,
    } as any);
    mockSearchDiscoverObjects.mockResolvedValue({
      hits: [],
      total: 0,
      facets: [],
    } as any);
  });

  it('renders site shell', () => {
    renderPage();
    expect(screen.getByTestId('site-shell')).toBeInTheDocument();
  });

  it('renders hero, featured, and results in default search mode', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('hero-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('featured-section')).toBeInTheDocument();
    expect(screen.getByTestId('results-grid')).toBeInTheDocument();
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
  });

  it('renders filter panel', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
    });
  });

  it('renders active filters component', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('active-filters')).toBeInTheDocument();
    });
  });

  it('passes total count to ResultsGrid', async () => {
    mockSearchDiscoverObjects.mockResolvedValue({
      hits: [],
      total: 42,
      facets: [],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('results-grid')).toHaveTextContent('Total: 42');
    });
  });

  it('queries discover-info with the orgSlug', async () => {
    renderPage('my-museum');
    await waitFor(() => {
      expect(mockGetDiscoverInfo).toHaveBeenCalledWith('my-museum');
    });
  });

  it('queries discover-search with the orgSlug', async () => {
    renderPage();
    await waitFor(() => {
      expect(mockSearchDiscoverObjects).toHaveBeenCalled();
    });
    expect(mockSearchDiscoverObjects.mock.calls[0][0]).toBe('museum-org');
  });

  it('renders CMS homepage when homepage_page_id is set', async () => {
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Museum Org',
      homepage_page_id: 'page-123',
    } as any);
    mockGetPublishedPageById.mockResolvedValue({
      data: {
        page_id: 'page-123',
        title: 'Welcome',
        template: 'default',
        blocks: [{ block_id: 'b-1', block_type: 'paragraph' }],
      },
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('block-renderer')).toHaveTextContent(
        '1 blocks',
      );
    });
  });
});
