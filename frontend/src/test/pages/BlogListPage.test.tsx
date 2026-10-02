import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import BlogListPage from '../../pages/discover/BlogListPage';
import * as discoverApi from '../../lib/api/discover';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/discover', () => ({
  getDiscoverInfo: vi.fn(),
}));

vi.mock('../../lib/api/content', () => ({
  getPublishedPosts: vi.fn(),
  getPublicCategories: vi.fn(),
  getPublicMenu: vi.fn(),
}));

const mockGetDiscoverInfo = vi.mocked(discoverApi.getDiscoverInfo);
const mockGetPublishedPosts = vi.mocked(contentApi.getPublishedPosts);
const mockGetPublicCategories = vi.mocked(contentApi.getPublicCategories);
const mockGetPublicMenu = vi.mocked(contentApi.getPublicMenu);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderBlogList(orgSlug = 'test-museum', search = '') {
  const url = `/c/${orgSlug}/blog${search}`;
  const client = createTestQueryClient();
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/c/:orgSlug/blog" element={<BlogListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('BlogListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiscoverInfo.mockResolvedValue({
      organization_name: 'Test Museum',
    } as never);
    mockGetPublicCategories.mockResolvedValue({ data: [] } as never);
    mockGetPublicMenu.mockResolvedValue({ items: [] } as never);
  });

  it('renders the Blog heading', async () => {
    mockGetPublishedPosts.mockResolvedValue({ data: [], total: 0 } as never);
    renderBlogList();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Blog' })).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no posts', async () => {
    mockGetPublishedPosts.mockResolvedValue({ data: [], total: 0 } as never);
    renderBlogList();

    await waitFor(() => {
      expect(screen.getByText(/no posts yet/i)).toBeInTheDocument();
    });
  });

  it('shows category-filter empty message when active category yields no posts', async () => {
    mockGetPublicCategories.mockResolvedValue({
      data: [{ category_id: 'c-1', name: 'News', slug: 'news' }],
    } as never);
    mockGetPublishedPosts.mockResolvedValue({ data: [], total: 0 } as never);

    renderBlogList('test-museum', '?category=news');

    await waitFor(() => {
      expect(screen.getByText(/try removing the filter/i)).toBeInTheDocument();
    });
  });

  it('renders a card per post and links to its slug', async () => {
    mockGetPublishedPosts.mockResolvedValue({
      data: [
        {
          page_id: 'p-1',
          title: 'First Post',
          slug: 'first-post',
          excerpt: 'A first excerpt',
          published_at: '2026-01-01T00:00:00Z',
          categories: [],
          featured_image_media_id: null,
        },
        {
          page_id: 'p-2',
          title: 'Second Post',
          slug: 'second-post',
          excerpt: null,
          published_at: null,
          categories: [],
          featured_image_media_id: null,
        },
      ],
      total: 2,
    } as never);

    renderBlogList('amundsen');

    await waitFor(() => {
      expect(screen.getByText('First Post')).toBeInTheDocument();
    });
    expect(screen.getByText('Second Post')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'First Post' }).closest('a')
    ).toHaveAttribute('href', '/c/amundsen/blog/first-post');
  });

  it('renders the category filter pills when categories exist', async () => {
    mockGetPublicCategories.mockResolvedValue({
      data: [
        { category_id: 'c-1', name: 'News', slug: 'news' },
        { category_id: 'c-2', name: 'Stories', slug: 'stories' },
      ],
    } as never);
    mockGetPublishedPosts.mockResolvedValue({ data: [], total: 0 } as never);

    renderBlogList();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'News' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Stories' })).toBeInTheDocument();
  });

  it('passes the active category to getPublishedPosts', async () => {
    mockGetPublishedPosts.mockResolvedValue({ data: [], total: 0 } as never);
    renderBlogList('test-museum', '?category=news');

    await waitFor(() => {
      expect(mockGetPublishedPosts).toHaveBeenCalledWith(
        'test-museum',
        expect.objectContaining({ category: 'news' }),
      );
    });
  });
});
