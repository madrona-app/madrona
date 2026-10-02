import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import ContentPage from '../../pages/discover/ContentPage';
import * as discoverApi from '../../lib/api/discover';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
}));

vi.mock('../../lib/api/content', () => ({
  getPublishedPage: vi.fn(),
  getPreviewPage: vi.fn(),
  getPublicMenu: vi.fn(),
}));

// BlockRenderer pulls heavy editor blocks; replace with a stub.
// Match the absolute resolved path so the mock applies to the import inside ContentPage.
vi.mock('../../pages/content/components/BlockRenderer', () => ({
  BlockRenderer: ({ blocks }: { blocks: unknown[] }) => (
    <div data-testid="block-renderer">{`${blocks.length} blocks`}</div>
  ),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockGetPublishedPage = vi.mocked(contentApi.getPublishedPage);
const mockGetPublicMenu = vi.mocked(contentApi.getPublicMenu);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(orgSlug = 'test-museum', pageSlug = 'about') {
  const client = createTestQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/c/${orgSlug}/pages/${pageSlug}`]}>
          <Routes>
            <Route path="/c/:orgSlug/pages/:pageSlug" element={<ContentPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('ContentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({ organization_name: 'Test Museum' } as never);
    mockGetPublicMenu.mockResolvedValue({ items: [] } as never);
  });

  it('shows the loader while the page is fetching', () => {
    mockGetPublishedPage.mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders the not-found view when the API errors', async () => {
    mockGetPublishedPage.mockRejectedValue(new Error('not found'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    });
  });

  it('renders the page title and block content when loaded', async () => {
    mockGetPublishedPage.mockResolvedValue({
      data: {
        page_id: 'p-1',
        title: 'About Us',
        slug: 'about',
        meta_title: 'About Us',
        meta_description: 'Learn more',
        template: 'default',
        blocks: [
          { block_id: 'b-1', type: 'heading' },
          { block_id: 'b-2', type: 'paragraph' },
        ],
        ancestors: [],
        children: [],
      },
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('block-renderer').textContent).toBe('2 blocks');
    });
  });

  it('renders the back-to-collection link in the not-found state', async () => {
    mockGetPublishedPage.mockRejectedValue(new Error('boom'));
    renderPage('amundsen');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back to collection/i })).toHaveAttribute(
        'href',
        '/c/amundsen',
      );
    });
  });
});
