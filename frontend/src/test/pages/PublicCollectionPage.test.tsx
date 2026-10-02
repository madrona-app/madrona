import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicCollectionPage from '../../pages/discover/PublicCollectionPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getPublicCollection: vi.fn(),
  getPublicCollectionDownloadUrl: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { ApiError } from '../../lib/apiClient';

const mockGetPublicCollection = vi.mocked(api.getPublicCollection);

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(token = 'share-token-1') {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<PublicCollectionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PublicCollectionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows the loading screen while fetching', () => {
    mockGetPublicCollection.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the collection name and item count when loaded', async () => {
    mockGetPublicCollection.mockResolvedValue({
      collection: {
        name: 'Selected Highlights',
        description: 'A curated set',
        public_share_download_level: 'none',
        public_share_expires_at: null,
      },
      items: [
        { media_id: 'm-1', media: { title: 'Photo One', thumbnail_url: null, filename: 'one.jpg' } },
        { media_id: 'm-2', media: { title: 'Photo Two', thumbnail_url: null, filename: 'two.jpg' } },
      ],
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Selected Highlights' })).toBeInTheDocument();
    });
    expect(screen.getByText('A curated set')).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
    expect(screen.getByText('Photo One')).toBeInTheDocument();
    expect(screen.getByText('Photo Two')).toBeInTheDocument();
  });

  it('renders the empty-collection note when there are no items', async () => {
    mockGetPublicCollection.mockResolvedValue({
      collection: {
        name: 'Empty Set',
        description: null,
        public_share_download_level: 'none',
        public_share_expires_at: null,
      },
      items: [],
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/this collection is empty/i)).toBeInTheDocument();
    });
  });

  it('renders the expired-link screen on 410', async () => {
    mockGetPublicCollection.mockRejectedValue(new ApiError('expired', 410));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    });
  });

  it('renders the not-found screen on 404', async () => {
    mockGetPublicCollection.mockRejectedValue(new ApiError('missing', 404));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument();
    });
  });

  it('shows password challenge on 401', async () => {
    mockGetPublicCollection.mockRejectedValue(new ApiError('forbidden', 401));
    renderPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
  });
});
