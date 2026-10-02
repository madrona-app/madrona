import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionsReviewsPage from '../../pages/collections/CollectionsReviewsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getCollectionsReviews: vi.fn(),
}));

const mockGetCollectionsReviews = vi.mocked(api.getCollectionsReviews);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/reviews`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/reviews"
            element={<CollectionsReviewsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleReviews = {
  total: 2,
  items: [
    {
      review_id: 'r-1',
      title: 'Q1 Significance Review',
      review_number: 'REV-001',
      scope_description: 'Painting collection',
      review_type: 'significance',
      objects_total: 100,
      objects_reviewed: 30,
      planned_start_date: '2024-01-01',
      planned_end_date: '2024-03-01',
      status: 'in_progress',
    },
    {
      review_id: 'r-2',
      review_number: 'REV-002',
      review_type: 'condition',
      objects_total: 0,
      objects_reviewed: 0,
      status: 'draft',
    },
  ],
};

describe('CollectionsReviewsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows loader on initial render', () => {
    mockGetCollectionsReviews.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /collections reviews/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and review rows', async () => {
    mockGetCollectionsReviews.mockResolvedValue(sampleReviews as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /collections reviews/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Q1 Significance Review')).toBeInTheDocument();
    expect(screen.getByText('REV-002')).toBeInTheDocument();
  });

  it('shows total count', async () => {
    mockGetCollectionsReviews.mockResolvedValue(sampleReviews as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('2 reviews')).toBeInTheDocument();
    });
  });

  it('renders the four stat cards', async () => {
    mockGetCollectionsReviews.mockResolvedValue(sampleReviews as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });

  it('renders error state on failure', async () => {
    mockGetCollectionsReviews.mockRejectedValue(new Error('reviews broke'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading collections reviews/i),
      ).toBeInTheDocument();
    });
  });

  it('renders New Review link', async () => {
    mockGetCollectionsReviews.mockResolvedValue(sampleReviews as any);
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /new review/i });
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/reviews/create',
      );
    });
  });

  it('changing status filter triggers refetch', async () => {
    mockGetCollectionsReviews.mockResolvedValue(sampleReviews as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('REV-002')).toBeInTheDocument();
    });
    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'draft' } });
    await waitFor(() => {
      expect(mockGetCollectionsReviews).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ status: 'draft' }),
      );
    });
  });
});
