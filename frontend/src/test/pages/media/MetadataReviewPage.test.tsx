import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MetadataReviewPage from '../../../pages/media/MetadataReviewPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  searchMedia: vi.fn(),
  reviewMetadata: vi.fn(),
}));

const mockSearchMedia = vi.mocked(api.searchMedia);
const mockReviewMetadata = vi.mocked(api.reviewMetadata);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/review`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/review"
            element={<MetadataReviewPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MetadataReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton while fetching', () => {
    mockSearchMedia.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByRole('heading', { name: /metadata review queue/i })).not.toBeInTheDocument();
  });

  it('shows "All Caught Up" when no items to review', async () => {
    mockSearchMedia.mockResolvedValue({ hits: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/all media metadata has been reviewed/i)
    ).toBeInTheDocument();
  });

  it('queries for unreviewed media', async () => {
    mockSearchMedia.mockResolvedValue({ hits: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(mockSearchMedia).toHaveBeenCalledWith('org-123', {
        limit: 100,
        metadata_reviewed: false,
      });
    });
  });

  it('renders a table row for each pending item', async () => {
    mockSearchMedia.mockResolvedValue({
      hits: [
        {
          media_id: 'm-1',
          media_type: 'image',
          filename: 'photo.jpg',
          title: 'Vacation',
          description: 'a beach',
          copyright_status: null,
          alt_text: null,
          created_at: '2024-01-01T00:00:00Z',
          thumbnail_url: null,
        },
        {
          media_id: 'm-2',
          media_type: 'video',
          filename: 'clip.mp4',
          title: null,
          description: null,
          copyright_status: null,
          alt_text: null,
          created_at: '2024-02-01T00:00:00Z',
          thumbnail_url: null,
        },
      ],
    } as any);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Vacation')).toBeInTheDocument();
    });
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    // Row 2 is missing title, description, copyright, alt_text → 4 chips
    expect(screen.getAllByText(/Title/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Copyright/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows count in description', async () => {
    mockSearchMedia.mockResolvedValue({
      hits: [
        {
          media_id: 'm-1',
          media_type: 'image',
          filename: 'a.jpg',
          title: 'A',
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/1 media item pending/i)).toBeInTheDocument();
    });
  });

  it('approves a single item on button click', async () => {
    mockSearchMedia.mockResolvedValue({
      hits: [
        {
          media_id: 'm-1',
          media_type: 'image',
          filename: 'a.jpg',
          title: 'A',
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    } as any);
    mockReviewMetadata.mockResolvedValue({} as any);

    renderPage();
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => {
      expect(mockReviewMetadata).toHaveBeenCalledWith('org-123', 'm-1');
    });
  });

  it('shows bulk review button when items selected', async () => {
    mockSearchMedia.mockResolvedValue({
      hits: [
        {
          media_id: 'm-1',
          media_type: 'image',
          filename: 'a.jpg',
          title: 'A',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          media_id: 'm-2',
          media_type: 'image',
          filename: 'b.jpg',
          title: 'B',
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    } as any);

    renderPage();
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    // Find all checkboxes; the first is "select all", the others are per-row
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(checkboxes[1]);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /mark 1 as reviewed/i })
      ).toBeInTheDocument();
    });
  });
});
