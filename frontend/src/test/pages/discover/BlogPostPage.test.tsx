import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import BlogPostPage from '../../../pages/discover/BlogPostPage';
import * as discoverApi from '../../../lib/api/discover';
import * as contentApi from '../../../lib/api/content';

vi.mock('../../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
}));

vi.mock('../../../lib/api/content', () => ({
  getPublishedPost: vi.fn(),
  getPreviewPage: vi.fn(),
}));

vi.mock('../../../pages/discover/components/CollectionSiteShell', () => ({
  CollectionSiteShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="site-shell">{children}</div>
  ),
}));

vi.mock('../../../pages/content/components/BlockRenderer', () => ({
  BlockRenderer: ({ blocks }: { blocks: unknown[] }) => (
    <div data-testid="block-renderer">{blocks.length} blocks</div>
  ),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockGetPublishedPost = vi.mocked(contentApi.getPublishedPost);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgSlug = 'museum-org', postSlug = 'my-post', search = '') {
  const qc = createQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter
          initialEntries={[`/c/${orgSlug}/blog/${postSlug}${search}`]}
        >
          <Routes>
            <Route
              path="/c/:orgSlug/blog/:postSlug"
              element={<BlogPostPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const sampleInfo = {
  organization_name: 'Museum Org',
  organization_slug: 'museum-org',
};

const samplePostResponse = {
  data: {
    page_id: 'p-1',
    title: 'My Great Post',
    excerpt: 'An excerpt',
    author_name: 'Jane Author',
    published_at: '2024-03-15T10:00:00Z',
    featured_image_media_id: null,
    categories: [
      { category_id: 'cat-1', name: 'News', slug: 'news' },
    ],
    blocks: [
      { block_id: 'b-1', block_type: 'paragraph', content: { text: 'Hi' } },
      { block_id: 'b-2', block_type: 'paragraph', content: { text: 'Bye' } },
    ],
  },
};

describe('BlogPostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the loader while fetching', () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockGetPublishedPost.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('site-shell')).toBeInTheDocument();
  });

  it('renders 404 message when post fetch fails', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockGetPublishedPost.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/post not found/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/this post does not exist or has not been published/i),
    ).toBeInTheDocument();
  });

  it('renders post title and author when loaded', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockGetPublishedPost.mockResolvedValue(samplePostResponse as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /my great post/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/jane author/i)).toBeInTheDocument();
  });

  it('renders category badge', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockGetPublishedPost.mockResolvedValue(samplePostResponse as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /news/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders BlockRenderer with blocks', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockGetPublishedPost.mockResolvedValue(samplePostResponse as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('block-renderer')).toHaveTextContent('2 blocks');
    });
  });

  it('renders Back to blog navigation', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockGetPublishedPost.mockResolvedValue(samplePostResponse as any);
    renderPage();
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /back to blog/i });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute('href', '/c/museum-org/blog');
    });
  });

  it('renders preview banner when in preview mode', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    vi.mocked(contentApi.getPreviewPage).mockResolvedValue(
      samplePostResponse as any,
    );
    renderPage(
      'museum-org',
      'my-post',
      '?preview_token=tok&preview_expires=123&preview_page_id=p-1',
    );
    await waitFor(() => {
      expect(screen.getByText(/preview mode/i)).toBeInTheDocument();
    });
  });

  it('renders fallback "no content" if blocks empty', async () => {
    mockGetDiscoverInfo.mockResolvedValue(sampleInfo as any);
    mockGetPublishedPost.mockResolvedValue({
      data: { ...samplePostResponse.data, blocks: [] },
    } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/this post has no content yet/i),
      ).toBeInTheDocument();
    });
  });
});
