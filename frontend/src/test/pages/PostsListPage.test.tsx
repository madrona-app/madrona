import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PostsListPage from '../../pages/content/PostsListPage';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/content', () => ({
  listPages: vi.fn(),
}));

const mockListPages = vi.mocked(contentApi.listPages);

function renderPage(orgId = 'org-123') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/content/posts`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/content/posts"
            element={<PostsListPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PostsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading and new post button', async () => {
    mockListPages.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Blog Posts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new post/i })).toBeInTheDocument();
  });

  it('shows empty state when no posts', async () => {
    mockListPages.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No posts yet.')).toBeInTheDocument();
    });
  });

  it('renders post rows with title/status', async () => {
    mockListPages.mockResolvedValue({
      items: [
        {
          page_id: 'post-1',
          title: 'Hello World',
          slug: 'hello-world',
          status: 'published',
          template: 'default',
          updated_at: '2025-01-01T00:00:00Z',
          created_by: 'user-1234-abcdef',
        },
      ],
      total: 1,
    } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });
    expect(screen.getByText('published')).toBeInTheDocument();
  });

  it('shows error banner on failure', async () => {
    mockListPages.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load posts/i)).toBeInTheDocument();
    });
  });

  it('filters by status tab', async () => {
    mockListPages.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));

    await waitFor(() => {
      expect(mockListPages).toHaveBeenLastCalledWith(
        'org-123',
        expect.objectContaining({ status: 'draft' })
      );
    });
  });
});
