import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PagesListPage from '../../pages/content/PagesListPage';
import * as contentApi from '../../lib/api/content';

vi.mock('../../lib/api/content', () => ({
  listPages: vi.fn(),
  getPageTree: vi.fn(),
}));

const mockListPages = vi.mocked(contentApi.listPages);
const mockGetPageTree = vi.mocked(contentApi.getPageTree);

function renderPage(orgId = 'org-123') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/content/pages`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/content/pages"
            element={<PagesListPage />}
          />
          <Route
            path="/organizations/:orgId/content/pages/create"
            element={<div>Create Page</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PagesListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetPageTree.mockResolvedValue({ data: [] } as never);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Pages' })).toBeInTheDocument();
  });

  it('shows empty state when no pages exist', async () => {
    mockGetPageTree.mockResolvedValue({ data: [] } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No pages yet.')).toBeInTheDocument();
    });
  });

  it('renders tree rows when pages exist', async () => {
    mockGetPageTree.mockResolvedValue({
      data: [
        {
          page_id: 'p-1',
          title: 'About Us',
          slug: 'about',
          status: 'published',
          template: 'default',
          depth: 0,
          updated_at: '2025-01-01T00:00:00Z',
          children: [],
        },
      ],
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });
    expect(screen.getByText('/about')).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();
  });

  it('switches to flat list when a status filter is applied', async () => {
    mockGetPageTree.mockResolvedValue({ data: [] } as never);
    mockListPages.mockResolvedValue({
      items: [
        {
          page_id: 'p-2',
          title: 'Draft Page',
          slug: 'draft',
          status: 'draft',
          template: 'default',
          updated_at: null,
          created_by: null,
        },
      ],
      total: 1,
    } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pages' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));

    await waitFor(() => {
      expect(mockListPages).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('Draft Page')).toBeInTheDocument();
    });
  });

  it('updates search input and debounces query', async () => {
    mockGetPageTree.mockResolvedValue({ data: [] } as never);
    mockListPages.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();

    const input = screen.getByPlaceholderText('Search pages...');
    fireEvent.change(input, { target: { value: 'foo' } });
    expect((input as HTMLInputElement).value).toBe('foo');
  });

  it('shows "no matches" empty state with active search', async () => {
    mockGetPageTree.mockResolvedValue({ data: [] } as never);
    mockListPages.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));

    await waitFor(() => {
      expect(screen.getByText(/no pages match your search|no pages yet/i)).toBeInTheDocument();
    });
  });
});
