import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SimilarMediaPanel } from '../../../components/dam/SimilarMediaPanel';

vi.mock('../../../lib/api/media-dam', () => ({
  getSimilarMedia: vi.fn(),
}));

import { getSimilarMedia } from '../../../lib/api/media-dam';

const mockGetSimilarMedia = vi.mocked(getSimilarMedia);

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SimilarMediaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders similar items grid', async () => {
    mockGetSimilarMedia.mockResolvedValue({
      media_id: 'm-1',
      similar: [
        { media_id: 's-1', similarity: 0.95 },
        { media_id: 's-2', similarity: 0.87 },
      ],
      total: 2,
    });

    renderWithProviders(
      <SimilarMediaPanel organizationId="org-1" mediaId="m-1" />
    );

    await waitFor(() => {
      expect(screen.getByText('Visually Similar')).toBeInTheDocument();
    });

    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('shows similarity percentage badges', async () => {
    mockGetSimilarMedia.mockResolvedValue({
      media_id: 'm-1',
      similar: [
        { media_id: 's-1', similarity: 0.95 },
      ],
      total: 1,
    });

    renderWithProviders(
      <SimilarMediaPanel organizationId="org-1" mediaId="m-1" />
    );

    await waitFor(() => {
      expect(screen.getByText('95%')).toBeInTheDocument();
    });
  });

  it('renders nothing when no similar items', async () => {
    mockGetSimilarMedia.mockResolvedValue({
      media_id: 'm-1',
      similar: [],
      total: 0,
    });

    const { container } = renderWithProviders(
      <SimilarMediaPanel organizationId="org-1" mediaId="m-1" />
    );

    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeNull();
    });

    expect(screen.queryByText('Visually Similar')).not.toBeInTheDocument();
  });

  it('renders nothing while loading (panel only appears once results arrive)', () => {
    mockGetSimilarMedia.mockReturnValue(new Promise(() => {})); // never resolves

    renderWithProviders(
      <SimilarMediaPanel organizationId="org-1" mediaId="m-1" />
    );

    // Component returns null until data is available — no skeleton/spinner
    expect(screen.queryByText('Visually Similar')).not.toBeInTheDocument();
  });
});
